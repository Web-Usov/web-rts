"""Positive and negative tests for prepare_reference.py (AT5 / #105).

Run: python scripts/test_asset_pipeline.py   (needs Pillow; uses only the stdlib otherwise)
"""

from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / ".agents/skills/create-game-assets/scripts"))
sys.path.insert(0, str(REPO / "scripts"))

import prepare_reference as pr  # noqa: E402
import validate_assets as va  # noqa: E402

MANIFEST = "refs/asset-manifest.json"


def gradient(size=(120, 160), mode="RGB") -> Image.Image:
    image = Image.new("RGB", size)
    for x in range(size[0]):
        for y in range(size[1]):
            image.putpixel((x, y), ((x * 7) % 256, (y * 5) % 256, (x + y) % 256))
    return image.convert(mode)


class Workspace(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name).resolve()
        (self.root / "refs").mkdir()
        (self.root / "out").mkdir()
        self.addCleanup(self._tmp.cleanup)
        self.add_original("orig-a", "refs/a.png", gradient())

    def add_original(self, asset_id: str, rel: str, image: Image.Image, **source) -> None:
        path = self.root / rel
        image.save(path, "PNG")
        data = path.read_bytes()
        manifest_path = self.root / MANIFEST
        manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {"schema_version": 1, "assets": []}
        manifest["assets"].append({
            "id": asset_id, "path": rel, "status": "approved-reference-only",
            "technical": {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "view": "front"},
            "source": {"license": "not recorded; rights review pending", **source},
        })
        manifest_path.write_text(json.dumps(manifest, indent=2))

    def manifest(self) -> dict:
        return json.loads((self.root / MANIFEST).read_text())

    def run_cli(self, *argv: str, env: dict | None = None) -> tuple[int, str]:
        err = io.StringIO()
        with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
            code = pr.main(["--root", str(self.root), *argv], env=env or {})
        return code, err.getvalue()

    def derive(self, out="out/a-96.png", size="96x128", asset_id="deriv-a", source="refs/a.png", *extra: str):
        return self.run_cli("derive", "--manifest", MANIFEST, "--source", source, "--out", out, "--id", asset_id,
                            "--role", "test", "--max-size", size, "--created", "2026-10-16", *extra)

    def assert_clean(self, before: dict) -> None:
        """A rejected run leaves no output, no temp file and an untouched manifest."""
        self.assertEqual(self.manifest(), before)
        leftovers = [p.name for d in ("out", "refs") for p in (self.root / d).iterdir()
                     if p.name.startswith(".") or p.name.endswith(".tmp")]
        self.assertEqual(leftovers, [])
        self.assertEqual(list((self.root / "out").iterdir()), [])


class PositiveTests(Workspace):
    def test_derive_records_provenance_and_inherits_pending_rights(self):
        code, err = self.derive()
        self.assertEqual((code, err), (0, ""))
        entry = next(a for a in self.manifest()["assets"] if a["id"] == "deriv-a")
        self.assertEqual(entry["status"], "experimental-derivative")
        self.assertFalse(entry["verification"]["production_approved"])
        self.assertEqual(entry["derivation"]["parent_id"], "orig-a")
        self.assertEqual(entry["derivation"]["rights_status"], "pending")
        self.assertFalse(entry["derivation"]["generation"]["used"])
        self.assertIsNone(entry["derivation"]["generation"]["model"])
        self.assertEqual(entry["technical"]["dimensions"], "96x128")
        out = (self.root / "out/a-96.png").read_bytes()
        self.assertEqual(entry["technical"]["sha256"], hashlib.sha256(out).hexdigest())
        self.assertEqual(va.validate_manifest(self.root / MANIFEST, self.root), [])
        self.assertEqual(pr.main(["--root", str(self.root), "verify", "--manifest", MANIFEST, "--reproduce"]), 0)

    def test_repeated_runs_produce_identical_bytes(self):
        digests = set()
        for index in range(4):
            self.assertEqual(self.derive(out=f"out/run{index}.png", asset_id=f"d{index}")[0], 0)
            digests.add(hashlib.sha256((self.root / f"out/run{index}.png").read_bytes()).hexdigest())
        self.assertEqual(len(digests), 1)

    def test_aspect_ratio_preserved_and_never_upscaled(self):
        self.assertEqual(self.derive(size="60x60")[0], 0)
        with Image.open(self.root / "out/a-96.png") as img:
            self.assertEqual(img.size, (45, 60))  # 120x160 fitted inside 60x60
        self.assertEqual(self.derive(out="out/big.png", asset_id="big", size="999x999")[0], 0)
        with Image.open(self.root / "out/big.png") as img:
            self.assertEqual(img.size, (120, 160))

    def test_opaque_alpha_channel_is_dropped_not_invented(self):
        self.add_original("orig-rgba", "refs/rgba.png", gradient(mode="RGBA"))
        self.assertEqual(self.derive(source="refs/rgba.png", asset_id="d-rgba")[0], 0)
        with Image.open(self.root / "out/a-96.png") as img:
            self.assertEqual(img.mode, "RGB")

    def test_real_transparency_is_preserved(self):
        image = gradient(mode="RGBA")
        image.putpixel((0, 0), (0, 0, 0, 0))
        self.add_original("orig-t", "refs/t.png", image)
        self.assertEqual(self.derive(source="refs/t.png", asset_id="d-t", size="120x160")[0], 0)
        with Image.open(self.root / "out/a-96.png") as img:
            self.assertEqual(img.mode, "RGBA")
            self.assertEqual(img.getchannel("A").getextrema()[0], 0)

    def test_inspect_reports_metadata(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(pr.main(["--root", str(self.root), "inspect", "refs/a.png"]), 0)
        info = json.loads(out.getvalue())
        self.assertEqual((info["dimensions"], info["format"], info["pixel_mode"]), ("120x160", "PNG", "RGB"))

    def test_committed_repo_derivatives_reproduce(self):
        manifest = REPO / "docs/art/assets/core-002/characters/asset-manifest.json"
        if not any(a.get("status") == "experimental-derivative" for a in json.loads(manifest.read_text())["assets"]):
            self.skipTest("no committed derivatives")
        rel = manifest.relative_to(REPO).as_posix()
        self.assertEqual(pr.main(["--root", str(REPO), "verify", "--manifest", rel, "--reproduce"]), 0)
        self.assertEqual(va.validate_manifest(manifest, REPO), [])


class NegativeTests(Workspace):
    def setUp(self) -> None:
        super().setUp()
        self.before = self.manifest()

    def expect(self, result, code, text):
        self.assertEqual(result[0], code, result[1])
        self.assertIn(text, result[1])
        self.assert_clean(self.before)

    def test_truncated_image(self):
        data = (self.root / "refs/a.png").read_bytes()
        half = data[: len(data) // 2]
        (self.root / "refs/a.png").write_bytes(half)
        manifest = self.manifest()  # refresh the checksum so truncation is the only fault
        meta = manifest["assets"][0]["technical"]
        meta["sha256"], meta["bytes"] = hashlib.sha256(half).hexdigest(), len(half)
        (self.root / MANIFEST).write_text(json.dumps(manifest))
        self.before = self.manifest()
        self.expect(self.derive(), 2, "decode failed")

    def test_corrupted_bytes(self):
        self.add_original("orig-j", "refs/junk.png", gradient())
        (self.root / "refs/junk.png").write_bytes(b"not an image at all")
        manifest = self.manifest()
        data = b"not an image at all"
        manifest["assets"][-1]["technical"].update(sha256=hashlib.sha256(data).hexdigest(), bytes=len(data))
        (self.root / MANIFEST).write_text(json.dumps(manifest))
        self.before = self.manifest()
        self.expect(self.derive(source="refs/junk.png", asset_id="dj"), 2, "decode failed")

    def test_extension_format_mismatch(self):
        gradient().save(self.root / "refs/fake.png", "JPEG")
        self.add_original("orig-f", "refs/fake2.png", gradient())  # entry is re-pointed below
        data = (self.root / "refs/fake.png").read_bytes()
        manifest = self.manifest()
        manifest["assets"][-1].update(path="refs/fake.png")
        manifest["assets"][-1]["technical"].update(sha256=hashlib.sha256(data).hexdigest(), bytes=len(data))
        (self.root / MANIFEST).write_text(json.dumps(manifest))
        self.before = self.manifest()
        self.expect(self.derive(source="refs/fake.png", asset_id="df"), 2, "extension/format mismatch")

    def test_wrong_source_checksum(self):
        manifest = self.manifest()
        manifest["assets"][0]["technical"]["sha256"] = "0" * 64
        (self.root / MANIFEST).write_text(json.dumps(manifest))
        self.before = self.manifest()
        self.expect(self.derive(), 2, "SHA-256 mismatch")

    def test_source_not_registered_has_no_provenance(self):
        gradient().save(self.root / "refs/orphan.png", "PNG")
        self.expect(self.derive(source="refs/orphan.png"), 2, "no provenance")

    def test_incomplete_provenance(self):
        manifest = self.manifest()
        del manifest["assets"][0]["source"]["license"]
        (self.root / MANIFEST).write_text(json.dumps(manifest))
        self.before = self.manifest()
        self.expect(self.derive(), 2, "license missing")

    def test_cannot_overwrite_registered_original(self):
        self.add_original("orig-b", "refs/b.png", gradient((50, 50)))
        self.before = self.manifest()
        before_bytes = (self.root / "refs/b.png").read_bytes()
        result = self.run_cli("derive", "--manifest", MANIFEST, "--source", "refs/a.png", "--out", "refs/b.png",
                         "--id", "evil", "--role", "x", "--max-size", "40x40", "--overwrite")
        self.assertEqual(result[0], 2)
        self.assertIn("overwrite registered original", result[1])
        self.assertEqual((self.root / "refs/b.png").read_bytes(), before_bytes)
        self.assertEqual(self.manifest(), self.before)

    def test_cannot_overwrite_source_or_unregistered_existing_file(self):
        result = self.derive(out="refs/a.png")
        self.assertEqual(result[0], 2)
        self.assertEqual(self.manifest(), self.before)
        (self.root / "out/stranger.png").write_bytes(b"user file")
        result = self.derive(out="out/stranger.png")
        self.assertEqual(result[0], 2)
        self.assertEqual((self.root / "out/stranger.png").read_bytes(), b"user file")

    def test_path_traversal(self):
        self.expect(self.derive(out="../escape.png"), 2, "traversal")
        self.expect(self.derive(source="../refs/a.png"), 2, "traversal")
        self.assertFalse((self.root.parent / "escape.png").exists())

    def test_absolute_path_outside_root(self):
        self.expect(self.derive(out="/tmp/at5-escape.png"), 2, "escapes repository root")

    def test_symlink_escape(self):
        outside = tempfile.TemporaryDirectory()
        self.addCleanup(outside.cleanup)
        os.symlink(outside.name, self.root / "link")
        self.expect(self.derive(out="link/x.png"), 2, "symlink")
        self.assertEqual(list(Path(outside.name).iterdir()), [])

    def test_symlinked_source(self):
        os.symlink(self.root / "refs/a.png", self.root / "refs/alias.png")
        self.expect(self.derive(source="refs/alias.png"), 2, "symlink")

    def test_limits_by_dimensions_pixels_and_bytes(self):
        self.expect(self.run_cli("derive", "--manifest", MANIFEST, "--source", "refs/a.png", "--out", "out/x.png",
                                 "--id", "x", "--role", "r", "--max-size", "10x10", "--max-pixels", "1000"),
                    2, "decoded pixels")
        self.expect(self.run_cli("derive", "--manifest", MANIFEST, "--source", "refs/a.png", "--out", "out/x.png",
                                 "--id", "x", "--role", "r", "--max-size", "10x10", "--max-dimension", "100"),
                    2, "exceed 100px limit")
        self.expect(self.run_cli("derive", "--manifest", MANIFEST, "--source", "refs/a.png", "--out", "out/x.png",
                                 "--id", "x", "--role", "r", "--max-size", "10x10", "--max-bytes", "10"),
                    2, "limit is 10")

    def test_exact_fit_refuses_aspect_change(self):
        self.expect(self.run_cli("derive", "--manifest", MANIFEST, "--source", "refs/a.png", "--out", "out/x.png",
                                 "--id", "x", "--role", "r", "--max-size", "50x50", "--fit", "exact"),
                    2, "aspect ratio")

    def test_duplicate_asset_id(self):
        self.expect(self.derive(asset_id="orig-a"), 2, "already in use")

    def test_manifest_validator_rejects_tampered_derivative(self):
        self.assertEqual(self.derive()[0], 0)
        (self.root / "out/a-96.png").write_bytes(b"tampered")
        self.assertTrue(any("SHA-256" in e for e in va.validate_manifest(self.root / MANIFEST, self.root)))
        self.assertEqual(pr.main(["--root", str(self.root), "verify", "--manifest", MANIFEST]), 1)

    def test_manifest_validator_rejects_promotion_and_missing_parent(self):
        self.assertEqual(self.derive()[0], 0)
        manifest = self.manifest()
        entry = manifest["assets"][-1]
        entry["verification"]["production_approved"] = True
        entry["derivation"]["parent_id"] = "ghost"
        (self.root / MANIFEST).write_text(json.dumps(manifest))
        errors = va.validate_manifest(self.root / MANIFEST, self.root)
        self.assertTrue(any("parent_id" in e for e in errors))

    def test_generation_gate_blocked(self):
        def gen(env, *argv):
            err = io.StringIO()
            with contextlib.redirect_stderr(err):
                return pr.main(["generate", *argv], env=env), err.getvalue()
        self.assertEqual(gen({})[0], 3)
        self.assertIn("disabled by default", gen({})[1])
        self.assertIn("no generation provider", gen({}, "--enable-generation")[1])
        self.assertIn("workflow file is missing", gen({}, "--enable-generation", "--provider", "comfyui")[1])
        wf = self.root / "wf.json"
        wf.write_text("{}")
        self.assertIn("COMFYUI_URL", gen({}, "--enable-generation", "--provider", "comfyui", "--workflow", str(wf))[1])
        self.assertIn("FAL_KEY", gen({}, "--enable-generation", "--provider", "fal")[1])
        self.assertIn("--allow-upload", gen({"FAL_KEY": "k"}, "--enable-generation", "--provider", "fal")[1])
        # even with everything configured the tool refuses to pretend it generated something
        code, text = gen({"FAL_KEY": "secret-key"}, "--enable-generation", "--provider", "fal", "--allow-upload", "--allow-paid")
        self.assertEqual(code, 3)
        self.assertNotIn("secret-key", text)


if __name__ == "__main__":
    unittest.main()
