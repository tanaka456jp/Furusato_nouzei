"""Verify the requested real Windows Excel modes using synthetic captures."""
import argparse
import hashlib
import json
import re
import struct
import zlib
from pathlib import Path

MODES = ("1920x1080@100", "1920x1080@125", "1366x768@150")
EXPECTED_IMAGES = (
    "review_excel_window_sheet_only.png",
    "review_excel_window_lower_section.png",
    "review_excel_window_mortgage_and_projection.png",
    "review_excel_window_municipality.png",
)
COMMANDS = {
    "TaxLawUpdate": "A5", "NewCase": "A7", "SaveCase": "B7",
    "ShowDetails": "C7", "RecalculateCase": "D7", "ShowAdvanced": "B5",
    "ImportWithholding": "B3", "ReviewWithholding": "C3",
    "ImportWithholdingBatch": "D3",
    "ReturnHome": "A17", "PrintDetails": "B17", "ExportDetails": "C17",
    "ReturnFromAdvanced": "B2", "ClearBatchOverviewWithConfirm": "B4",
    "ExportAllBatchReferencePDFs": "K4",
}
VIEWPORTS = ((1, 12, "B4"), (12, 24, "B12"), (24, 39, "D33"), (42, 51, "D51"))
CHECKS = [
    "command_bounds", "command_captions", "no_command_overlap",
    "focus_and_scroll", "visible_content_bounds", "rendered_worksheet",
]


def _safe_png(folder, name):
    if type(name) is not str or name not in EXPECTED_IMAGES:
        raise ValueError("UNEXPECTED_SCREENSHOT_NAME")
    path = folder / name
    if path.is_symlink() or not path.is_file() or not 100 < path.stat().st_size < 25_000_000:
        raise ValueError("SCREENSHOT_MISSING_OR_UNSAFE")
    # A syntactically valid PNG header alone cannot prove the screenshot
    # survived transport. Validate every chunk CRC and the IEND marker.
    with path.open("rb") as f:
        signature = f.read(8)
        if signature != b"\x89PNG\r\n\x1a\n":
            raise ValueError("SCREENSHOT_NOT_PNG")
        saw_header = saw_idat = saw_end = False
        chunk_count = 0
        while True:
            size_data = f.read(4)
            if not size_data:
                break
            if len(size_data) != 4:
                raise ValueError("SCREENSHOT_PNG_TRUNCATED")
            chunk_len = struct.unpack(">I", size_data)[0]
            if chunk_len > 25_000_000:
                raise ValueError("SCREENSHOT_PNG_CHUNK_TOO_LARGE")
            kind = f.read(4)
            data = f.read(chunk_len)
            checksum = f.read(4)
            if len(kind) != 4 or len(data) != chunk_len or len(checksum) != 4:
                raise ValueError("SCREENSHOT_PNG_TRUNCATED")
            crc_expected = struct.unpack(">I", checksum)[0]
            if zlib.crc32(kind + data) & 0xFFFFFFFF != crc_expected:
                raise ValueError("SCREENSHOT_PNG_CRC_MISMATCH")
            chunk_count += 1
            if chunk_count == 1:
                if kind != b"IHDR" or chunk_len != 13:
                    raise ValueError("SCREENSHOT_NOT_PNG")
                width, height = struct.unpack(">II", data[:8])
                if not 400 <= width <= 6000 or not 240 <= height <= 4000:
                    raise ValueError("SCREENSHOT_DIMENSIONS_OUT_OF_SCOPE")
                saw_header = True
            if kind == b"IDAT":
                saw_idat = True
            if kind == b"IEND":
                saw_end = True
                break
        if not (saw_header and saw_idat and saw_end) or f.read(1):
            raise ValueError("SCREENSHOT_PNG_INCOMPLETE")
    return [width, height], hashlib.sha256(path.read_bytes()).hexdigest()


def _measurements_pass(data):
    commands = data.get("commands")
    if not isinstance(commands, list) or len(commands) != len(COMMANDS):
        raise ValueError("INCOMPLETE_COMMAND_SET")
    seen = set()
    for measurement in commands:
        if not isinstance(measurement, dict):
            raise ValueError("INVALID_COMMAND_MEASUREMENT")
        name = measurement.get("command")
        if (type(name) is not str or name not in COMMANDS or name in seen or
                measurement.get("anchor") != COMMANDS[name] or
                measurement.get("inside_anchor") is not True or
                measurement.get("expected_action") is not True or
                type(measurement.get("font_points")) not in (int, float) or
                not 8 <= measurement["font_points"] <= 36):
            raise ValueError("INVALID_COMMAND_MEASUREMENT")
        spare = measurement.get("spare_pixels")
        if (not isinstance(spare, list) or len(spare) != 2 or
                any(type(value) is not int for value in spare) or
                not 6 <= spare[0] <= 6000 or not 4 <= spare[1] <= 4000):
            raise ValueError("COMMAND_CAPTION_NOT_READABLE")
        seen.add(name)
    views = data.get("worksheet_readback")
    if not isinstance(views, list) or len(views) != len(VIEWPORTS):
        raise ValueError("INCOMPLETE_WORKSHEET_VIEWS")
    for view, (top, bottom, cell) in zip(views, VIEWPORTS):
        if (not isinstance(view, dict) or view.get("focused_cell") != cell or
                view.get("first_row") != top or view.get("first_column") != 1 or
                type(view.get("last_row")) is not int or
                not bottom < view["last_row"] <= 1048576 or
                type(view.get("column_count")) is not int or
                not 5 <= view["column_count"] <= 16384):
            raise ValueError("WORKSHEET_VIEW_CLIPPED_OR_NOT_FOCUSED")


def inspect_display_matrix(folders, workbook_sha256, source_head, modes=MODES):
    if (type(workbook_sha256) is not str or
            re.fullmatch(r"[0-9a-f]{64}", workbook_sha256) is None or
            type(source_head) is not str or
            re.fullmatch(r"[0-9a-f]{40}", source_head) is None):
        raise ValueError("INVALID_WORKBOOK_OR_HEAD")
    if (not modes or any(mode not in MODES for mode in modes) or
            len(set(modes)) != len(modes) or len(folders) != len(modes)):
        raise ValueError("DISTINCT_MODE_FOLDERS_REQUIRED")
    observed = {}
    for path in folders:
        folder = Path(path)
        if folder.is_symlink() or not folder.is_dir():
            raise ValueError("UNSAFE_DISPLAY_EVIDENCE_FOLDER")
        source = folder / "display_review.json"
        if source.is_symlink() or not source.is_file() or source.stat().st_size > 20_000:
            raise ValueError("DISPLAY_EVIDENCE_JSON_MISSING")
        try:
            data = json.loads(source.read_text(encoding="utf-8-sig"))
        except (UnicodeError, json.JSONDecodeError):
            raise ValueError("INVALID_DISPLAY_EVIDENCE_JSON") from None
        if (not isinstance(data, dict) or
                data.get("schema") != "furusato-display-review/v2" or
                data.get("status") != "MEASURED" or
                data.get("source_head") != source_head or
                data.get("workbook_sha256") != workbook_sha256 or
                data.get("excel_zoom_percent") != 85 or
                data.get("inside_workbook_link") != "A2->A42" or
                data.get("failure_category") != ""):
            raise ValueError("UNVERIFIED_DISPLAY_OR_WRONG_BUILD")
        obs = data.get("display_observation")
        if (not isinstance(obs, dict) or
                obs.get("display_mode_observed") is not True or
                obs.get("display_mode_source") != "EnumDisplaySettingsW" or
                obs.get("physical_resolution_verified") is not False):
            raise ValueError("UNVERIFIED_DISPLAY_MODE")
        mode = data.get("mode")
        if mode not in modes or mode in observed:
            raise ValueError("MISSING_OR_DUPLICATE_DISPLAY_MODE")
        width, height = (int(x) for x in mode.split("@")[0].split("x"))
        scale = int(mode.split("@")[1])
        if (obs.get("current_mode_pixels") != [width, height] or
                obs.get("observed_scale_percent") != scale or
                obs.get("excel_window_dpi") != 96 * scale // 100):
            raise ValueError("DPI_MODE_CONTRADICTION")
        _measurements_pass(data)
        images = data.get("screenshots")
        if not isinstance(images, list) or len(images) != len(EXPECTED_IMAGES):
            raise ValueError("INCOMPLETE_SCREENSHOT_SET")
        hashes = set()
        for name, record in zip(EXPECTED_IMAGES, images):
            if (not isinstance(record, dict) or record.get("file") != name or
                    type(record.get("sampled_colors")) is not int or
                    record["sampled_colors"] < 8):
                raise ValueError("BLANK_OR_UNBOUND_SCREENSHOT")
            pixels, sha = _safe_png(folder, name)
            if record.get("pixels") != pixels or record.get("sha256") != sha or sha in hashes:
                raise ValueError("SCREENSHOT_HASH_OR_DIMENSIONS_MISMATCH")
            hashes.add(sha)
        observed[mode] = len(EXPECTED_IMAGES)
    if set(observed) != set(modes):
        raise ValueError("DISPLAY_MODE_MATRIX_INCOMPLETE")
    return {
        "schema": "furusato-excel-display-acceptance/v2",
        "status": "PASS",
        "source_head": source_head,
        "workbook_sha256": workbook_sha256,
        "verified_modes": [mode for mode in MODES if mode in observed],
        "unverified_modes": [mode for mode in MODES if mode not in observed],
        "image_count": sum(observed.values()),
        "checks": CHECKS,
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--workbook-sha256", required=True)
    p.add_argument("--source-head", required=True)
    p.add_argument("--folders", type=Path, nargs="+", required=True)
    p.add_argument("--modes", choices=MODES, nargs="+", default=MODES)
    p.add_argument("--output", type=Path, required=True)
    args = p.parse_args()
    try:
        result = inspect_display_matrix(
            args.folders, args.workbook_sha256, args.source_head, args.modes)
        with args.output.open("x", encoding="utf-8") as output:
            json.dump(result, output, indent=2)
    except (OSError, ValueError) as exc:
        category = str(exc) if isinstance(exc, ValueError) else "DISPLAY_EVIDENCE_IO_ERROR"
        print(f"DISPLAY_MATRIX_HOLD: {category}")
        return 2
    print("DISPLAY_MATRIX_PASS: " + ", ".join(result["verified_modes"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
