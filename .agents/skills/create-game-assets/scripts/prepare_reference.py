#!/usr/bin/env python3
"""Deterministic offline 2D reference processing with manifest provenance (AT5 / #105).

Requires Pillow 10+. No network access and no extra dependencies. Subcommands:

  inspect   print image metadata (dimensions, format, mode, alpha, bytes, SHA-256)
  derive    resize one registered reference into a new experimental derivative, run QA,
            and record the derivative in the existing schema_version 1 asset manifest
  verify    re-check every derivative in a manifest (hashes, parent link, rights
            inheritance) and optionally re-run the pipeline to prove byte reproducibility
  sheet     build a labelled before/after contact sheet
  generate  generation gate; disabled by default and always BLOCKED/ERROR without
            explicit resources (this tool never calls a network provider)

Exit codes: 0 PASS, 1 FAIL (QA/verification), 2 ERROR (bad input/unsafe path/limits),
3 BLOCKED (generation resources missing). A failed run leaves no output file and no
manifest change.

Ideas adapted (not copied) from rehan-remade/universal-modder (MIT): per-asset trace record
and "skip remote calls by default"; processing here is original Pillow code.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import os
import platform
import sys
import tempfile
import time
import warnings
from pathlib import Path
from typing import Any

import PIL
from PIL import Image, ImageDraw, ImageFile, ImageFont

TOOL_NAME = "prepare_reference.py"
TOOL_VERSION = "1.0.0"
DERIVATIVE_STATUS = "experimental-derivative"
SUPPORTED = {".png": "PNG", ".jpg": "JPEG", ".jpeg": "JPEG", ".webp": "WEBP"}
METHODS = {
    "nearest": Image.Resampling.NEAREST,
    "box": Image.Resampling.BOX,
    "bilinear": Image.Resampling.BILINEAR,
    "hamming": Image.Resampling.HAMMING,
    "bicubic": Image.Resampling.BICUBIC,
    "lanczos": Image.Resampling.LANCZOS,
}
# Same hard ceilings as scripts/validate_assets.py; the file-size cap is new.
DEFAULT_LIMITS = {"max_bytes": 32 * 1024 * 1024, "max_dimension": 16_384, "max_pixels": 100_000_000}

ImageFile.LOAD_TRUNCATED_IMAGES = False


class PipelineError(Exception):
    """Operational problem (bad input, unsafe path, limits). Exit code 2."""


class PipelineFail(Exception):
    """QA / verification failure. Exit code 1."""


class Blocked(Exception):
    """Generation resources missing. Exit code 3."""


# --------------------------------------------------------------------------- paths


def safe_path(root: Path, raw: str | Path, label: str) -> Path:
    """Resolve `raw` under `root`; reject traversal and symlinks anywhere on the path."""
    root = root.resolve()
    raw_path = Path(raw)
    if ".." in raw_path.parts:
        raise PipelineError(f"{label}: path traversal ('..') is not allowed: {raw}")
    candidate = raw_path if raw_path.is_absolute() else root / raw_path
    try:
        relative = candidate.relative_to(root)
    except ValueError:
        raise PipelineError(f"{label}: path escapes repository root: {raw}") from None
    current = root
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise PipelineError(f"{label}: symlink in path is not allowed: {current}")
    if not str(current.resolve()).startswith(str(root)):
        raise PipelineError(f"{label}: path escapes repository root: {raw}")
    return current


# --------------------------------------------------------------------------- image io


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_source(path: Path, limits: dict[str, int]) -> bytes:
    if not path.is_file():
        raise PipelineError(f"source is not a regular file: {path}")
    size = path.stat().st_size
    if size == 0:
        raise PipelineError(f"source is empty: {path}")
    if size > limits["max_bytes"]:
        raise PipelineError(f"source is {size} bytes; limit is {limits['max_bytes']}: {path}")
    return path.read_bytes()


def decode(data: bytes, extension: str, limits: dict[str, int]) -> Image.Image:
    """Validate limits from the header first, then fully decode (no truncated images)."""
    expected = SUPPORTED.get(extension.lower())
    if expected is None:
        raise PipelineError(f"unsupported extension: {extension}")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            probe = Image.open(io.BytesIO(data))
            fmt, (width, height) = probe.format, probe.size
            if fmt != expected:
                raise PipelineError(f"extension/format mismatch: {extension} contains {fmt!r}")
            if width <= 0 or height <= 0:
                raise PipelineError(f"invalid dimensions {width}x{height}")
            if max(width, height) > limits["max_dimension"]:
                raise PipelineError(f"dimensions {width}x{height} exceed {limits['max_dimension']}px limit")
            if width * height > limits["max_pixels"]:
                raise PipelineError(f"decoded pixels {width * height:,} exceed {limits['max_pixels']:,} limit")
            image = Image.open(io.BytesIO(data))
            image.load()
            return image
    except PipelineError:
        raise
    except Exception as exc:  # Pillow raises format-specific decoder errors
        raise PipelineError(f"decode failed: {exc}") from exc


def alpha_info(image: Image.Image) -> dict[str, Any]:
    has_alpha = "A" in image.getbands() or "transparency" in image.info
    fully_opaque = True
    if has_alpha:
        fully_opaque = image.convert("RGBA").getchannel("A").getextrema() == (255, 255)
    return {"alpha_channel_present": has_alpha, "fully_opaque": fully_opaque}


def describe(data: bytes, image: Image.Image) -> dict[str, Any]:
    return {
        "dimensions": f"{image.width}x{image.height}",
        "format": image.format or "PNG",
        "pixel_mode": image.mode,
        "sha256": sha256_hex(data),
        "bytes": len(data),
        **alpha_info(image),
    }


# --------------------------------------------------------------------------- processing


def parse_size(value: str) -> tuple[int, int]:
    try:
        w, h = value.lower().split("x", 1)
        size = (int(w), int(h))
    except ValueError:
        raise argparse.ArgumentTypeError("size must look like WIDTHxHEIGHT") from None
    if size[0] <= 0 or size[1] <= 0:
        raise argparse.ArgumentTypeError("size must be positive")
    return size


def target_dimensions(src: tuple[int, int], box: tuple[int, int], fit: str) -> tuple[int, int]:
    if fit == "exact":
        return box
    if fit == "inside":
        scale = min(box[0] / src[0], box[1] / src[1])
        scale = min(scale, 1.0)  # never upscale a reference
        return max(1, round(src[0] * scale)), max(1, round(src[1] * scale))
    raise PipelineError(f"unknown fit mode: {fit}")


def process(image: Image.Image, params: dict[str, Any]) -> tuple[bytes, Image.Image]:
    """Pure, deterministic transform. Returns encoded PNG bytes and the decoded result."""
    method = METHODS[params["method"]]
    out_size = target_dimensions(image.size, tuple(params["box"]), params["fit"])
    if params["fit"] == "exact" and not params.get("allow_aspect_change"):
        if abs(image.width * out_size[1] - image.height * out_size[0]) > max(image.size):
            raise PipelineError("fit=exact would change aspect ratio; pass --allow-aspect-change explicitly")
    work = image.convert("RGBA") if image.mode not in ("RGB", "RGBA") else image
    resized = work.resize(out_size, method, reducing_gap=None)
    if params["alpha"] == "drop-if-opaque" and resized.mode == "RGBA":
        # Only a channel that is genuinely all-255 is dropped; no transparency is ever invented.
        if resized.getchannel("A").getextrema() == (255, 255):
            resized = resized.convert("RGB")
    buffer = io.BytesIO()
    resized.save(buffer, "PNG", optimize=True, compress_level=9)  # no metadata chunks written
    data = buffer.getvalue()
    return data, resized


def qa_checks(source: Image.Image, data: bytes, params: dict[str, Any], source_bytes: int) -> list[str]:
    """Return a list of QA failures for an encoded output (empty list == PASS)."""
    problems: list[str] = []
    try:
        out = decode(data, ".png", {**DEFAULT_LIMITS})
    except PipelineError as exc:
        return [f"output does not decode: {exc}"]
    expected = target_dimensions(source.size, tuple(params["box"]), params["fit"])
    if out.size != expected:
        problems.append(f"output size {out.size} != expected {expected}")
    if params["fit"] == "inside":
        drift = abs(out.width * source.height - out.height * source.width)
        if drift > max(source.size):
            problems.append("aspect ratio drift beyond rounding tolerance")
    src_alpha, out_alpha = alpha_info(source), alpha_info(out)
    if src_alpha["fully_opaque"] and out_alpha["alpha_channel_present"] and not out_alpha["fully_opaque"]:
        problems.append("output has transparency that the source did not have")
    if not src_alpha["alpha_channel_present"] and out_alpha["alpha_channel_present"] and params["alpha"] != "preserve":
        problems.append("output gained an alpha channel")
    extrema = out.convert("L").getextrema()
    if extrema[0] == extrema[1]:
        problems.append("output is a single flat tone (blank image)")
    if len(data) > source_bytes:
        problems.append(f"output ({len(data)} B) is larger than source ({source_bytes} B)")
    return problems


# --------------------------------------------------------------------------- manifest


def load_manifest(path: Path) -> dict[str, Any]:
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise PipelineError(f"cannot read manifest {path}: {exc}") from exc
    if manifest.get("schema_version") != 1 or not isinstance(manifest.get("assets"), list):
        raise PipelineError("manifest must be schema_version 1 with an assets list")
    return manifest


def write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    text = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".manifest-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def find_asset(manifest: dict[str, Any], *, path: str | None = None, asset_id: str | None = None) -> dict[str, Any] | None:
    for asset in manifest["assets"]:
        if (path is not None and asset.get("path") == path) or (asset_id is not None and asset.get("id") == asset_id):
            return asset
    return None


def is_derivative(asset: dict[str, Any]) -> bool:
    return asset.get("status") == DERIVATIVE_STATUS


def build_entry(
    *, asset_id: str, role: str, rel_out: str, parent: dict[str, Any], tech: dict[str, Any],
    params: dict[str, Any], created: str, view: str | None,
) -> dict[str, Any]:
    pipeline = [{
        "op": "resize",
        "fit": params["fit"],
        "box": f"{params['box'][0]}x{params['box'][1]}",
        "method": params["method"],
        "never_upscale": True,
    }, {
        "op": "alpha",
        "mode": params["alpha"],
        "note": "channel dropped only if source alpha is entirely 255; no mask or background removal is applied",
    }, {"op": "encode", "format": "PNG", "optimize": True, "compress_level": 9, "metadata": "none"}]
    return {
        "id": asset_id,
        "role": role,
        "path": rel_out,
        "status": DERIVATIVE_STATUS,
        "technical": {**tech, **({"view": view} if view else {})},
        "source": {
            "kind": "derived",
            "url_or_tool": f"{TOOL_NAME} {TOOL_VERSION} (Pillow {PIL.__version__})",
            "creator": "deterministic local processing; no generative model involved",
            "created_at": created,
            "license": "inherited from parent: not recorded; rights review pending",
            "attribution": "derived from " + parent["id"],
            "prompt_or_source_record": f"offline resize of {parent['path']}",
        },
        "verification": {
            "raster_decode_passed": True,
            "qa_result": "PASS",
            "production_approved": False,
            "in_engine_reviewed": False,
            "visual_review": "pending",
        },
        "derivation": {
            "parent_id": parent["id"],
            "parent_path": parent["path"],
            "parent_sha256": parent["technical"]["sha256"],
            "pipeline": pipeline,
            "tool": {"name": TOOL_NAME, "version": TOOL_VERSION, "pillow": PIL.__version__, "python": platform.python_version()},
            "generation": {"used": False, "provider": None, "model": None, "seed": None, "cost_usd": 0},
            "rights_status": "pending",
            "rights_inherited_from": parent["id"],
        },
        "notes": "Experimental reference derivative; not production-approved, not for runtime import.",
    }


# --------------------------------------------------------------------------- derive


def derive(args: argparse.Namespace) -> dict[str, Any]:
    root = Path(args.root).resolve()
    limits = {"max_bytes": args.max_bytes, "max_dimension": args.max_dimension, "max_pixels": args.max_pixels}
    manifest_path = safe_path(root, args.manifest, "manifest")
    source_path = safe_path(root, args.source, "source")
    out_path = safe_path(root, args.out, "output")
    rel_source, rel_out = source_path.relative_to(root).as_posix(), out_path.relative_to(root).as_posix()

    if out_path.suffix.lower() != ".png":
        raise PipelineError("output must be a .png file")
    if out_path == source_path:
        raise PipelineError("output path equals source path; originals are never overwritten")
    manifest = load_manifest(manifest_path)

    parent = find_asset(manifest, path=rel_source)
    if parent is None:
        raise PipelineError(f"no provenance: source {rel_source} is not registered in {args.manifest}")
    if is_derivative(parent):
        raise PipelineError("derive from an original reference, not from another derivative")
    for key in ("sha256", "bytes"):
        if key not in parent.get("technical", {}):
            raise PipelineError(f"provenance incomplete: parent technical.{key} missing")
    if not parent.get("source", {}).get("license"):
        raise PipelineError("provenance incomplete: parent source.license missing")

    protected = {a["path"] for a in manifest["assets"] if not is_derivative(a)}
    if rel_out in protected:
        raise PipelineError(f"refusing to overwrite registered original reference: {rel_out}")
    existing = find_asset(manifest, path=rel_out)
    if out_path.exists() and not (args.overwrite and existing is not None and is_derivative(existing)):
        raise PipelineError(f"output exists and is not a registered derivative to overwrite: {rel_out}")
    clash = find_asset(manifest, asset_id=args.id)
    if clash is not None and not (args.overwrite and is_derivative(clash) and clash["path"] == rel_out):
        raise PipelineError(f"asset id already in use: {args.id}")

    started = time.perf_counter()
    source_bytes = read_source(source_path, limits)
    actual_sha = sha256_hex(source_bytes)
    if actual_sha != parent["technical"]["sha256"]:
        raise PipelineError(f"source SHA-256 mismatch: manifest {parent['technical']['sha256']} != actual {actual_sha}")
    if len(source_bytes) != parent["technical"]["bytes"]:
        raise PipelineError("source byte count differs from manifest")
    source_image = decode(source_bytes, source_path.suffix, limits)

    params = {"fit": args.fit, "box": list(args.max_size), "method": args.method, "alpha": args.alpha,
              "allow_aspect_change": args.allow_aspect_change}
    data, result = process(source_image, params)
    problems = qa_checks(source_image, data, params, len(source_bytes))
    if problems:
        raise PipelineFail("; ".join(problems))
    # Reproducibility inside the run: encoding twice must be byte-identical.
    if process(source_image, params)[0] != data:
        raise PipelineFail("processing is not deterministic within one run")
    elapsed_ms = (time.perf_counter() - started) * 1000

    tech = describe(data, result)
    tech["format"] = "PNG"
    entry = build_entry(
        asset_id=args.id, role=args.role, rel_out=rel_out, parent=parent, tech=tech, params=params,
        created=args.created or time.strftime("%Y-%m-%d"), view=parent["technical"].get("view"),
    )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=out_path.parent, prefix=".derive-", suffix=".tmp")
    created_new = not out_path.exists()
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
        if sha256_hex(Path(tmp_name).read_bytes()) != tech["sha256"]:
            raise PipelineFail("written output hash differs from computed hash")
        os.chmod(tmp_name, 0o644)
        os.replace(tmp_name, out_path)
        manifest["assets"] = [a for a in manifest["assets"] if a.get("id") != args.id] + [entry]
        write_json_atomic(manifest_path, manifest)
    except BaseException:
        if created_new and out_path.exists():
            out_path.unlink()
        raise
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)

    return {"status": "PASS", "id": args.id, "output": rel_out, "source_sha256": actual_sha,
            "output_sha256": tech["sha256"], "dimensions": tech["dimensions"], "bytes": tech["bytes"],
            "source_bytes": len(source_bytes), "elapsed_ms": round(elapsed_ms, 1)}


# --------------------------------------------------------------------------- verify


def verify(args: argparse.Namespace) -> list[str]:
    root = Path(args.root).resolve()
    manifest_path = safe_path(root, args.manifest, "manifest")
    manifest = load_manifest(manifest_path)
    limits = dict(DEFAULT_LIMITS)
    errors: list[str] = []
    derivatives = [a for a in manifest["assets"] if is_derivative(a)]
    for asset in derivatives:
        label = asset.get("id", "?")
        try:
            path = safe_path(root, asset["path"], label)
            data = read_source(path, limits)
            tech, deriv = asset["technical"], asset["derivation"]
            if sha256_hex(data) != tech["sha256"] or len(data) != tech["bytes"]:
                errors.append(f"{label}: output hash/bytes differ from manifest")
                continue
            image = decode(data, path.suffix, limits)
            if tech["dimensions"] != f"{image.width}x{image.height}":
                errors.append(f"{label}: dimensions differ from manifest")
            parent = find_asset(manifest, asset_id=deriv["parent_id"])
            if parent is None or is_derivative(parent):
                errors.append(f"{label}: parent {deriv['parent_id']} missing or not an original")
                continue
            if parent["technical"]["sha256"] != deriv["parent_sha256"]:
                errors.append(f"{label}: parent_sha256 does not match parent entry")
            if asset["verification"].get("production_approved") is not False:
                errors.append(f"{label}: derivative must not be production-approved")
            if "pending" in parent["source"].get("license", "") and deriv.get("rights_status") != "pending":
                errors.append(f"{label}: pending rights not inherited")
            if args.reproduce:
                parent_bytes = read_source(safe_path(root, parent["path"], label), limits)
                if sha256_hex(parent_bytes) != deriv["parent_sha256"]:
                    errors.append(f"{label}: parent file differs from recorded parent_sha256")
                    continue
                step = deriv["pipeline"][0]
                box = tuple(int(v) for v in step["box"].split("x"))
                params = {"fit": step["fit"], "box": list(box), "method": step["method"], "alpha": deriv["pipeline"][1]["mode"]}
                again, _ = process(decode(parent_bytes, Path(parent["path"]).suffix, limits), params)
                if again != data:
                    # PNG encoders (zlib builds) may differ between machines; pixels must not.
                    same_pixels = (
                        Image.open(io.BytesIO(again)).tobytes() == image.tobytes()
                        and Image.open(io.BytesIO(again)).mode == image.mode
                    )
                    if args.strict_bytes or not same_pixels:
                        errors.append(f"{label}: re-running the pipeline does not reproduce the committed "
                                      f"{'bytes' if same_pixels else 'pixels'}")
                    else:
                        print(f"WARN {label}: pixel-identical, bytes differ (different PNG encoder/zlib build)")
        except (PipelineError, KeyError) as exc:
            errors.append(f"{label}: {exc}")
    originals_ok = all(find_asset(manifest, asset_id=a["derivation"]["parent_id"]) for a in derivatives if "derivation" in a)
    if not originals_ok and not errors:
        errors.append("derivative references unknown parent")
    return errors


# --------------------------------------------------------------------------- sheet


def build_sheet(pairs: list[tuple[str, Path, Path]], out: Path, cell: int = 256) -> None:
    font = ImageFont.load_default()
    pad, label_h = 12, 28
    columns = 3
    width = columns * (cell + pad) + pad
    height = len(pairs) * (cell + label_h + pad) + pad
    sheet = Image.new("RGB", (width, height), "#202124")
    draw = ImageDraw.Draw(sheet)
    for row, (label, before, after) in enumerate(pairs):
        top = pad + row * (cell + label_h + pad)
        with Image.open(before) as src, Image.open(after) as derived:
            src_rgb, derived_rgb = src.convert("RGB"), derived.convert("RGB")
            shown_src = src_rgb.copy()
            shown_src.thumbnail((cell, cell), Image.Resampling.LANCZOS)
            minified = derived_rgb.copy()
            minified.thumbnail((cell // 2, cell // 2), Image.Resampling.LANCZOS)
            cells = [
                (shown_src, f"{label} source {src.width}x{src.height}"),
                (derived_rgb, f"{label} deriv {derived.width}x{derived.height} @1:1"),
                (minified, f"{label} mini {minified.width}x{minified.height} @1:1"),
            ]
            for col, (img, caption) in enumerate(cells):
                left = pad + col * (cell + pad)
                sheet.paste(Image.new("RGB", (cell, cell), "#3a3d41"), (left, top))
                sheet.paste(img, (left + (cell - img.width) // 2, top + (cell - img.height) // 2))
                draw.text((left, top + cell + 6), caption[:44], fill="#ffffff", font=font)
    out.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=out.parent, prefix=".sheet-", suffix=out.suffix)
    os.close(fd)
    try:
        sheet.save(tmp, quality=90) if out.suffix.lower() in (".jpg", ".jpeg") else sheet.save(tmp, optimize=True)
        os.replace(tmp, out)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


# --------------------------------------------------------------------------- generate gate


def generation_gate(args: argparse.Namespace, env: dict[str, str]) -> None:
    """Fail-closed preflight. Generation is off by default; this tool never contacts a provider."""
    if not args.enable_generation:
        raise Blocked("generation is disabled by default; pass --enable-generation with explicit resources")
    if args.provider not in ("comfyui", "fal"):
        raise Blocked("no generation provider selected (--provider comfyui|fal)")
    if args.provider == "comfyui":
        if not args.workflow or not Path(args.workflow).is_file():
            raise Blocked("ComfyUI workflow file is missing (--workflow)")
        if not env.get("COMFYUI_URL"):
            raise Blocked("COMFYUI_URL is not set; no local ComfyUI endpoint configured")
    if args.provider == "fal":
        if not env.get("FAL_KEY"):
            raise Blocked("FAL_KEY is not set; external provider credentials are missing")
        if not args.allow_upload or not args.allow_paid:
            raise Blocked("external provider needs explicit --allow-upload and --allow-paid user approval")
    raise Blocked("adapter transport is not implemented in AT5: resources alone do not enable generation")


# --------------------------------------------------------------------------- cli


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--root", default=".", help="repository root; all paths must stay inside it")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("inspect")
    p.add_argument("paths", nargs="+")

    d = sub.add_parser("derive")
    d.add_argument("--manifest", required=True)
    d.add_argument("--source", required=True)
    d.add_argument("--out", required=True)
    d.add_argument("--id", required=True)
    d.add_argument("--role", required=True)
    d.add_argument("--max-size", type=parse_size, required=True, metavar="WxH")
    d.add_argument("--fit", choices=["inside", "exact"], default="inside")
    d.add_argument("--method", choices=sorted(METHODS), default="lanczos")
    d.add_argument("--alpha", choices=["preserve", "drop-if-opaque"], default="drop-if-opaque")
    d.add_argument("--allow-aspect-change", action="store_true")
    d.add_argument("--overwrite", action="store_true", help="replace an existing registered derivative only")
    d.add_argument("--created", help="override created_at date (YYYY-MM-DD)")
    d.add_argument("--max-bytes", type=int, default=DEFAULT_LIMITS["max_bytes"])
    d.add_argument("--max-dimension", type=int, default=DEFAULT_LIMITS["max_dimension"])
    d.add_argument("--max-pixels", type=int, default=DEFAULT_LIMITS["max_pixels"])

    v = sub.add_parser("verify")
    v.add_argument("--manifest", required=True)
    v.add_argument("--reproduce", action="store_true", help="re-run pipelines and compare with committed output")
    v.add_argument("--strict-bytes", action="store_true", help="with --reproduce: require byte-identical PNGs")

    s = sub.add_parser("sheet")
    s.add_argument("--out", required=True)
    s.add_argument("--pair", action="append", required=True, metavar="LABEL=BEFORE,AFTER")

    g = sub.add_parser("generate")
    g.add_argument("--enable-generation", action="store_true")
    g.add_argument("--provider")
    g.add_argument("--workflow")
    g.add_argument("--allow-upload", action="store_true")
    g.add_argument("--allow-paid", action="store_true")
    return parser


def main(argv: list[str] | None = None, env: dict[str, str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    env = os.environ if env is None else env
    try:
        if args.command == "inspect":
            root = Path(args.root).resolve()
            for raw in args.paths:
                path = safe_path(root, raw, "input")
                data = read_source(path, DEFAULT_LIMITS)
                print(json.dumps({"path": raw, **describe(data, decode(data, path.suffix, DEFAULT_LIMITS))}))
            return 0
        if args.command == "derive":
            print(json.dumps(derive(args)))
            return 0
        if args.command == "verify":
            errors = verify(args)
            for error in errors:
                print(f"FAIL {error}")
            print("PASS verify" if not errors else f"FAIL verify: {len(errors)} problem(s)")
            return 1 if errors else 0
        if args.command == "sheet":
            root = Path(args.root).resolve()
            pairs = []
            for item in args.pair:
                label, _, files = item.partition("=")
                before, _, after = files.partition(",")
                if not (label and before and after):
                    raise PipelineError(f"--pair must look like LABEL=BEFORE,AFTER: {item}")
                pairs.append((label, safe_path(root, before, "sheet input"), safe_path(root, after, "sheet input")))
            build_sheet(pairs, safe_path(root, args.out, "sheet output"))
            print(f"Wrote {args.out}")
            return 0
        generation_gate(args, env)
    except Blocked as exc:
        print(f"BLOCKED {exc}", file=sys.stderr)
        return 3
    except PipelineFail as exc:
        print(f"FAIL {exc}", file=sys.stderr)
        return 1
    except PipelineError as exc:
        print(f"ERROR {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
