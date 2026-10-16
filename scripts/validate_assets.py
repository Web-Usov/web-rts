#!/usr/bin/env python3
"""Validate tracked raster image assets in the repository."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import tempfile
import warnings
from pathlib import Path

from PIL import Image, ImageFile

SUPPORTED_FORMATS: dict[str, set[str]] = {
    ".gif": {"GIF"},
    ".jpeg": {"JPEG"},
    ".jpg": {"JPEG"},
    ".png": {"PNG"},
    ".webp": {"WEBP"},
}

MAX_DIMENSION = 16_384
MAX_PIXELS = 100_000_000

ImageFile.LOAD_TRUNCATED_IMAGES = False


def tracked_image_paths() -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "-z"],
        check=True,
        capture_output=True,
    )
    paths = [
        Path(raw.decode("utf-8"))
        for raw in result.stdout.split(b"\0")
        if raw and Path(raw.decode("utf-8")).suffix.lower() in SUPPORTED_FORMATS
    ]
    return sorted(paths)


def validate_image(path: Path) -> list[str]:
    errors: list[str] = []
    expected_formats = SUPPORTED_FORMATS.get(path.suffix.lower())

    if expected_formats is None:
        return [f"unsupported image extension: {path.suffix}"]

    if not path.is_file():
        return ["tracked image path is not a regular file"]

    if path.stat().st_size == 0:
        return ["file is empty"]

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)

            with Image.open(path) as image:
                actual_format = image.format
                width, height = image.size

                if actual_format not in expected_formats:
                    errors.append(
                        "extension/format mismatch: "
                        f"{path.suffix.lower()} contains {actual_format!r}, "
                        f"expected one of {sorted(expected_formats)}"
                    )

                if width <= 0 or height <= 0:
                    errors.append(f"invalid dimensions: {width}x{height}")

                if width > MAX_DIMENSION or height > MAX_DIMENSION:
                    errors.append(
                        f"dimensions exceed {MAX_DIMENSION}px limit: {width}x{height}"
                    )

                if width * height > MAX_PIXELS:
                    errors.append(
                        f"pixel count exceeds {MAX_PIXELS:,} limit: {width}x{height}"
                    )

                image.verify()

            # verify() checks container integrity but intentionally does not decode
            # pixel data. Re-open and load every frame to catch truncated/corrupt
            # payloads such as the malformed JPEG previews that motivated this check.
            with Image.open(path) as image:
                frame_count = getattr(image, "n_frames", 1)
                for frame_index in range(frame_count):
                    image.seek(frame_index)
                    image.load()

    except Exception as exc:  # Pillow exposes format-specific decoder exceptions.
        errors.append(f"decode failed: {exc}")

    return errors


def tracked_manifest_paths() -> list[Path]:
    result = subprocess.run(["git", "ls-files", "-z"], check=True, capture_output=True)
    return sorted(
        Path(raw.decode("utf-8"))
        for raw in result.stdout.split(b"\0")
        if raw and Path(raw.decode("utf-8")).name == "asset-manifest.json"
    )


def validate_manifest(manifest_path: Path, repo_root: Path = Path(".")) -> list[str]:
    """Check schema_version 1 asset manifests; extra checks apply to experimental derivatives.

    Entries whose file is missing are skipped for non-derivatives (legacy manifests may
    describe planned assets); every present file must match its recorded SHA-256/bytes.
    """
    errors: list[str] = []
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        return [f"manifest unreadable: {exc}"]
    assets = manifest.get("assets")
    if manifest.get("schema_version") != 1 or not isinstance(assets, list):
        return ["manifest must have schema_version 1 and an assets list"]
    by_id = {a.get("id"): a for a in assets if isinstance(a, dict)}
    if len(by_id) != len(assets):
        errors.append("duplicate or missing asset ids")
    for asset in assets:
        label = asset.get("id", "?")
        path = repo_root / asset.get("path", "")
        technical = asset.get("technical") or {}
        derivative = asset.get("status") == "experimental-derivative"
        if not path.is_file():
            if derivative:
                errors.append(f"{label}: derivative file missing: {asset.get('path')}")
            continue
        data = path.read_bytes()
        if "sha256" in technical and hashlib.sha256(data).hexdigest() != technical["sha256"]:
            errors.append(f"{label}: SHA-256 differs from manifest")
        if "bytes" in technical and len(data) != technical["bytes"]:
            errors.append(f"{label}: byte size differs from manifest")
        if not derivative:
            continue
        derivation = asset.get("derivation") or {}
        parent = by_id.get(derivation.get("parent_id"))
        if parent is None:
            errors.append(f"{label}: parent_id does not resolve")
            continue
        if parent.get("status") == "experimental-derivative":
            errors.append(f"{label}: parent must be an original reference")
        if (parent.get("technical") or {}).get("sha256") != derivation.get("parent_sha256"):
            errors.append(f"{label}: parent_sha256 does not match parent entry")
        if (asset.get("verification") or {}).get("production_approved") is not False:
            errors.append(f"{label}: derivative must have production_approved=false")
        if not derivation.get("pipeline") or not derivation.get("tool"):
            errors.append(f"{label}: transform pipeline/tool record missing")
        parent_license = (parent.get("source") or {}).get("license", "")
        if (asset.get("source") or {}).get("license") != parent_license:
            errors.append(f"{label}: license differs from parent")
        expected_rights = "pending" if "pending" in parent_license.lower() else "inherited"
        if derivation.get("rights_status") != expected_rights:
            errors.append(f"{label}: rights_status must be {expected_rights!r} (inherited from parent)")
        if derivation.get("rights_restrictions") != (parent.get("source") or {}).get("restrictions"):
            errors.append(f"{label}: rights restrictions differ from parent")
        generation = derivation.get("generation") or {}
        if generation.get("used") is not True and any(
            generation.get(k) for k in ("provider", "model", "seed")
        ):
            errors.append(f"{label}: generation fields set although generation.used is not true")
    return errors


def validate_repository() -> int:
    paths = tracked_image_paths()
    manifest_failures = [
        (m, errs) for m in tracked_manifest_paths() if (errs := validate_manifest(m))
    ]

    if not paths:
        print("asset-validation: no tracked raster images found")
        return 0

    failures: list[tuple[Path, list[str]]] = []

    for path in paths:
        errors = validate_image(path)
        if errors:
            failures.append((path, errors))
        else:
            print(f"OK  {path}")

    if manifest_failures:
        print("\nasset-manifest validation failed:")
        for manifest_path, errors in manifest_failures:
            for error in errors:
                print(f"ERR {manifest_path}: {error}")
        return 1

    if failures:
        print("\nasset-validation failed:")
        for path, errors in failures:
            for error in errors:
                print(f"ERR {path}: {error}")
        return 1

    print(f"\nasset-validation passed: {len(paths)} tracked raster images")
    return 0


def run_self_test() -> int:
    with tempfile.TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)

        valid_path = root / "valid.jpg"
        Image.new("RGB", (2, 2), (30, 90, 150)).save(valid_path, "JPEG")
        valid_errors = validate_image(valid_path)
        if valid_errors:
            print(f"self-test failed: valid JPEG rejected: {valid_errors}")
            return 1

        # Deliberately malformed JPEG: SOI -> SOS -> payload -> EOI, with no
        # Start Of Frame segment. This mirrors the structural failure found in
        # the broken hybrid concept previews from PR #77.
        broken_path = root / "missing-sof.jpg"
        broken_path.write_bytes(
            bytes.fromhex("FFD8 FFDA 0008 010100003F00 00 FFD9")
        )
        broken_errors = validate_image(broken_path)
        if not broken_errors:
            print("self-test failed: malformed JPEG without SOF was accepted")
            return 1

        good = root / "good"
        good.mkdir()
        (good / "a.png").write_bytes(b"orig")
        (good / "b.png").write_bytes(b"deriv")
        base = {
            "schema_version": 1,
            "assets": [
                {"id": "a", "path": "good/a.png", "status": "approved-reference-only",
                 "technical": {"sha256": hashlib.sha256(b"orig").hexdigest(), "bytes": 4},
                 "source": {"license": "rights review pending"}},
                {"id": "b", "path": "good/b.png", "status": "experimental-derivative",
                 "technical": {"sha256": hashlib.sha256(b"deriv").hexdigest(), "bytes": 5},
                 "source": {"license": "rights review pending"},
                 "verification": {"production_approved": False},
                 "derivation": {"parent_id": "a", "parent_sha256": hashlib.sha256(b"orig").hexdigest(),
                                "pipeline": [{"op": "resize"}], "tool": {"name": "t"},
                                "rights_status": "pending"}},
            ],
        }
        manifest_file = root / "asset-manifest.json"
        manifest_file.write_text(json.dumps(base), encoding="utf-8")
        if validate_manifest(manifest_file, root):
            print(f"self-test failed: valid manifest rejected: {validate_manifest(manifest_file, root)}")
            return 1
        (good / "a.png").write_bytes(b"tamp")
        if not validate_manifest(manifest_file, root):
            print("self-test failed: tampered original was accepted")
            return 1
        (good / "a.png").write_bytes(b"orig")
        base["assets"][1]["derivation"]["rights_status"] = "approved"
        manifest_file.write_text(json.dumps(base), encoding="utf-8")
        if not validate_manifest(manifest_file, root):
            print("self-test failed: non-inherited pending rights was accepted")
            return 1

        print("asset-validation self-test passed")
        return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="run validator regression checks instead of scanning the repository",
    )
    args = parser.parse_args()

    return run_self_test() if args.self_test else validate_repository()


if __name__ == "__main__":
    raise SystemExit(main())
