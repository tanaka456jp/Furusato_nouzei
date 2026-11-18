"""Synthetic display evidence matrix checks; never uses personal screenshots."""
import json
import hashlib
import struct
import tempfile
import unittest
import zlib
from pathlib import Path

from verify_release_display_matrix import (
    CHECKS, COMMANDS, EXPECTED_IMAGES, MODES, VIEWPORTS, inspect_display_matrix,
)


SHA = "a" * 64
HEAD = "b" * 40


def make_png(index):
    def chunk(kind, data):
        return (struct.pack(">I", len(data)) + kind + data +
                struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))
    width, height = 500, 300
    rows = (b"\x00" + bytes((index, 2, 3)) * width) * height
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
                "schema": "furusato-display-review/v2",
                "status": "MEASURED",
                "source_head": HEAD,
                "workbook_sha256": SHA,
                "mode": mode,
                "inside_workbook_link": "A2->A42",
                "excel_zoom_percent": 85,
                "failure_category": "",
                "display_observation": {
                    "display_mode_observed": True,
                    "display_mode_source": "EnumDisplaySettingsW",
                    "physical_resolution_verified": False,
                    "current_mode_pixels": [int(width), int(height)],
                    "observed_scale_percent": int(scale),
                    "excel_window_dpi": 96 * int(scale) // 100,
                },
                "commands": [
                    {"command": name, "anchor": anchor, "inside_anchor": True,
                     "expected_action": True, "font_points": 10, "spare_pixels": [9, 6]}
                    for name, anchor in COMMANDS.items()
                ],
                "worksheet_readback": [
                    {"first_row": top, "last_row": bottom + 1, "first_column": 1,
                     "column_count": 5, "focused_cell": cell}
                    for top, bottom, cell in VIEWPORTS
                ],
                "screenshots": [],
            }
            for index, name in enumerate(EXPECTED_IMAGES):
                png = make_png(index)
                (folder / name).write_bytes(png)
                data["screenshots"].append(
                    {"file": name, "sha256": hashlib.sha256(png).hexdigest(),
                     "pixels": [500, 300], "sampled_colors": 8}
                )
            (folder / "display_review.json").write_text(
                json.dumps(data), encoding="utf-8")
            self.folders.append(folder)

    def test_all_modes_and_target_specific_report(self):
        result = inspect_display_matrix(self.folders, SHA, HEAD)
        self.assertEqual(result["image_count"], len(EXPECTED_IMAGES) * len(MODES))
        self.assertEqual(result["verified_modes"], list(MODES))
        self.assertEqual(result["unverified_modes"], [])
        self.assertEqual(result["checks"], CHECKS)
        self.assertNotIn(str(self.root), str(result))
        target = inspect_display_matrix(self.folders[1:2], SHA, HEAD, MODES[1:2])
        self.assertEqual(target["verified_modes"], ["1920x1080@125"])
        self.assertEqual(target["unverified_modes"], ["1920x1080@100", "1366x768@150"])

    def test_missing_or_wrong_mode_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "DISTINCT"):
            inspect_display_matrix(self.folders[:2], SHA, HEAD)
        with self.assertRaisesRegex(ValueError, "MISSING_OR_DUPLICATE"):
            inspect_display_matrix(self.folders[:2] + self.folders[:1], SHA, HEAD)
        with self.assertRaisesRegex(ValueError, "UNVERIFIED_DISPLAY"):
            inspect_display_matrix(self.folders, "b" * 64, HEAD)
        with self.assertRaisesRegex(ValueError, "UNVERIFIED_DISPLAY"):
            inspect_display_matrix(self.folders, SHA, "c" * 40)

    def test_forged_dpi_and_clipped_content_are_rejected(self):
        folder = self.folders[0]
        file = folder / "display_review.json"
        value = json.loads(file.read_text())
        value["display_observation"]["excel_window_dpi"] = 120
        file.write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError, "DPI_MODE_CONTRADICTION"):
            inspect_display_matrix(self.folders, SHA, HEAD)
        value["display_observation"]["excel_window_dpi"] = 96
        value["worksheet_readback"][0]["last_row"] = VIEWPORTS[0][1]
        file.write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError, "WORKSHEET_VIEW_CLIPPED"):
            inspect_display_matrix(self.folders, SHA, HEAD)
        value["worksheet_readback"][0]["last_row"] = VIEWPORTS[0][1] + 1
        value["commands"][0]["spare_pixels"] = [5, 4]
        file.write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError, "COMMAND_CAPTION_NOT_READABLE"):
            inspect_display_matrix(self.folders, SHA, HEAD)

    def test_missing_or_fake_capture_is_rejected(self):
        path = self.folders[0] / EXPECTED_IMAGES[0]
        path.unlink()
        with self.assertRaisesRegex(ValueError, "SCREENSHOT_MISSING"):
            inspect_display_matrix(self.folders, SHA, HEAD)
        path.write_bytes(b"not-png" * 60)
        with self.assertRaisesRegex(ValueError, "SCREENSHOT_NOT_PNG"):
            inspect_display_matrix(self.folders, SHA, HEAD)
        path.write_bytes(make_png(9))
        with self.assertRaisesRegex(ValueError, "SCREENSHOT_HASH"):
            inspect_display_matrix(self.folders, SHA, HEAD)

    def test_png_payload_crc_corruption_is_rejected(self):
        path = self.folders[0] / EXPECTED_IMAGES[0]
        data = bytearray(path.read_bytes())
        # Modify a text-chunk byte without updating the PNG CRC.
        pos = data.index(b"synthetic=")
        data[pos] ^= 1
        path.write_bytes(data)
        with self.assertRaisesRegex(ValueError, "SCREENSHOT_PNG_CRC_MISMATCH"):
            inspect_display_matrix(self.folders, SHA, HEAD)

    def test_no_customer_names_or_filenames_from_private_input_emitted(self):
        report = inspect_display_matrix(self.folders, SHA, HEAD)
        self.assertEqual(set(report), {
            "schema", "status", "source_head", "workbook_sha256",
            "verified_modes", "unverified_modes", "image_count", "checks",
        })


if __name__ == "__main__":
    unittest.main(verbosity=2)
