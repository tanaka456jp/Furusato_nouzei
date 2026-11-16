"""Synthetic display evidence matrix checks; never uses personal screenshots."""
import json
import struct
import tempfile
import unittest
import zlib
from pathlib import Path

from verify_release_display_matrix import MODES, EXPECTED_IMAGES, inspect_display_matrix


SHA = "a" * 64


def make_png():
    def chunk(kind, data):
        return (struct.pack(">I", len(data)) + kind + data +
                struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))
    width, height = 500, 300
    rows = (b"\x00" + b"\x01\x02\x03" * width) * height
    return (b"\x89PNG\r\n\x1a\n" +
            chunk(b"IHDR", struct.pack(">IIBBBBB", width, height,
                                       8, 2, 0, 0, 0)) +
            chunk(b"tEXt", b"synthetic=" + b"x" * 180) +
            chunk(b"IDAT", zlib.compress(rows)) +
            chunk(b"IEND", b""))


class DisplayMatrixContract(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.folders = []
        for mode in MODES:
            folder = self.root / mode.replace("@", "_")
            folder.mkdir()
            width, rest = mode.split("x")
            height, scale = rest.split("@")
            data = {
                "schema": "furusato-display-review/v1",
                "status": "CAPTURED_REQUIRES_VISUAL_REVIEW",
                "release_approved": False,
                "observation_requires_manual_visual_review": True,
                "generated_workbook_sha256": SHA,
                "scenario_observed_not_certified": mode,
                "display_observation": {
                    "display_mode_observed": True,
                    "display_mode_source": "EnumDisplaySettingsW",
                    "physical_resolution_verified": False,
                    "current_mode_pixels": [int(width), int(height)],
                    "observed_scale_percent": int(scale),
                },
                "screenshots": list(EXPECTED_IMAGES),
            }
            (folder / "display_review.json").write_text(
                json.dumps(data), encoding="utf-8")
            for name in EXPECTED_IMAGES:
                (folder / name).write_bytes(make_png())
            self.folders.append(folder)

    def test_complete_observations_still_require_human(self):
        result = inspect_display_matrix(self.folders, SHA)
        self.assertEqual(result["image_count"], 9)
        self.assertEqual(result["release_decision"], "HOLD")
        self.assertEqual(result["manual_visual_review"], "REQUIRED")
        self.assertNotIn(str(self.root), str(result))

    def test_missing_or_wrong_mode_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "THREE_DISTINCT"):
            inspect_display_matrix(self.folders[:2], SHA)
        with self.assertRaisesRegex(ValueError, "MISSING_OR_DUPLICATE"):
            inspect_display_matrix(self.folders[:2] + self.folders[:1], SHA)
        with self.assertRaisesRegex(ValueError, "UNVERIFIED_DISPLAY"):
            inspect_display_matrix(self.folders, "b" * 64)

    def test_forged_approval_and_dpi_are_rejected(self):
        folder = self.folders[0]
        file = folder / "display_review.json"
        value = json.loads(file.read_text())
        value["release_approved"] = True
        file.write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError, "UNVERIFIED_DISPLAY"):
            inspect_display_matrix(self.folders, SHA)
        value["release_approved"] = False
        value["display_observation"]["observed_scale_percent"] = 125
        file.write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError, "DPI_MODE_CONTRADICTION"):
            inspect_display_matrix(self.folders, SHA)

    def test_missing_or_fake_capture_is_rejected(self):
        path = self.folders[0] / EXPECTED_IMAGES[0]
        path.unlink()
        with self.assertRaisesRegex(ValueError, "SCREENSHOT_MISSING"):
            inspect_display_matrix(self.folders, SHA)
        path.write_bytes(b"not-png" * 60)
        with self.assertRaisesRegex(ValueError, "SCREENSHOT_NOT_PNG"):
            inspect_display_matrix(self.folders, SHA)

    def test_png_payload_crc_corruption_is_rejected(self):
        path = self.folders[0] / EXPECTED_IMAGES[0]
        data = bytearray(path.read_bytes())
        # Modify a text-chunk byte without updating the PNG CRC.
        pos = data.index(b"synthetic=")
        data[pos] ^= 1
        path.write_bytes(data)
        with self.assertRaisesRegex(ValueError, "SCREENSHOT_PNG_CRC_MISMATCH"):
            inspect_display_matrix(self.folders, SHA)

    def test_no_customer_names_or_filenames_from_private_input_emitted(self):
        report = inspect_display_matrix(self.folders, SHA)
        self.assertEqual(set(report), {
            "display_matrix", "image_count", "manual_visual_review",
            "release_decision", "note",
        })


if __name__ == "__main__":
    unittest.main(verbosity=2)
