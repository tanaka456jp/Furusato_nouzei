"""Offline verification of all three required observed Windows Excel DPI modes.

Reads ONLY local synthetic display captures from probe_display_layout.ps1.
A successful result requests a human visual review; it does NOT authorize
release and cannot prove a monitor's native panel or physical print quality.
"""
import argparse
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
)


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


def inspect_display_matrix(folders, workbook_sha256):
    if (not isinstance(workbook_sha256, str) or
            re.fullmatch(r"[0-9a-f]{64}", workbook_sha256) is None):
        raise ValueError("INVALID_WORKBOOK_SHA256")
    if not isinstance(folders, (list, tuple)) or len(folders) != 3:
        raise ValueError("THREE_DISTINCT_MODE_FOLDERS_REQUIRED")
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
                data.get("schema") != "furusato-display-review/v1" or
                data.get("status") != "CAPTURED_REQUIRES_VISUAL_REVIEW" or
                data.get("release_approved") is not False or
                data.get("observation_requires_manual_visual_review") is not True or
                data.get("generated_workbook_sha256") != workbook_sha256):
            raise ValueError("UNVERIFIED_DISPLAY_OR_WRONG_WORKBOOK")
        obs = data.get("display_observation")
        if (not isinstance(obs, dict) or
                obs.get("display_mode_observed") is not True or
                obs.get("display_mode_source") != "EnumDisplaySettingsW" or
                obs.get("physical_resolution_verified") is not False):
            raise ValueError("UNVERIFIED_DISPLAY_MODE")
        mode = data.get("scenario_observed_not_certified")
        if mode not in MODES or mode in observed:
            raise ValueError("MISSING_OR_DUPLICATE_DISPLAY_MODE")
        width, height = (int(x) for x in mode.split("@")[0].split("x"))
        scale = int(mode.split("@")[1])
        if (obs.get("current_mode_pixels") != [width, height] or
                obs.get("observed_scale_percent") != scale):
            raise ValueError("DPI_MODE_CONTRADICTION")
        if data.get("screenshots") != list(EXPECTED_IMAGES):
            raise ValueError("INCOMPLETE_SCREENSHOT_SET")
        for name in EXPECTED_IMAGES:
            _safe_png(folder, name)
        observed[mode] = len(EXPECTED_IMAGES)
    if set(observed) != set(MODES):
        raise ValueError("DISPLAY_MODE_MATRIX_INCOMPLETE")
    return {
        "display_matrix": "ALL_THREE_MODES_OBSERVED_SAME_WORKBOOK",
        "image_count": sum(observed.values()),
        "manual_visual_review": "REQUIRED",
        "release_decision": "HOLD",
        "note": "No personal screenshots or paths included. A reviewer must still inspect readability.",
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--workbook-sha256", required=True)
    p.add_argument("--folders", type=Path, nargs=3, required=True)
    args = p.parse_args()
    try:
        result = inspect_display_matrix(args.folders, args.workbook_sha256)
    except (OSError, ValueError):
        print("DISPLAY_MATRIX_INCOMPLETE RELEASE=HOLD")
        return 2
    print(result["display_matrix"] +
          " CAPTURES=" + str(result["image_count"]) +
          " MANUAL_VISUAL_REVIEW_REQUIRED RELEASE=HOLD")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
