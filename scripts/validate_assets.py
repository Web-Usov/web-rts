#!/usr/bin/env python3
"""Validate tracked raster image assets in the repository."""

from __future__ import annotations

import argparse
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


def validate_repository() -> int:
    paths = tracked_image_paths()

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
