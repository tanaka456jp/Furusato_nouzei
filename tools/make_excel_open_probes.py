"""Generate independent, DIAGNOSTIC-ONLY Excel-open variants from the frozen source."""
from hashlib import sha256
from pathlib import Path
import json
from shutil import copyfile
import sys

from openpyxl import load_workbook
from build_workbook import ROOT, HOME, build


def checksum(path):
    return sha256(path.read_bytes()).hexdigest().upper()


def make(folder):
    folder = Path(folder).resolve()
    if folder.exists() and any(folder.iterdir()):
        raise FileExistsError("Refusing to overwrite nonempty diagnostic directory")
    folder.mkdir(parents=True, exist_ok=True)
    source = ROOT / "workbook/baseline.xlsx"
    names = [
        ("baseline_original", "01_baseline_original.xlsx"),
        ("baseline_roundtrip", "02_baseline_roundtrip.xlsx"),
        ("current_review", "03_current_review.xlsx"),
        ("all_sheets_visible", "04_all_sheets_visible.xlsx"),
        ("without_status_formula", "05_without_status_formula.xlsx"),
    ]
    paths = {key: folder / name for key, name in names}
    original_sha = checksum(source)
    copyfile(source, paths["baseline_original"])
    book = load_workbook(source)
    book.save(paths["baseline_roundtrip"])
    book.close()
    build(source, paths["current_review"])
    book = load_workbook(paths["current_review"])
    for sheet in book:
        sheet.sheet_state = "visible"
    book.active = 0
    book.save(paths["all_sheets_visible"])
    book.close()
    book = load_workbook(paths["current_review"])
    book[HOME]["B28"] = "診断専用・計算禁止"
    book.save(paths["without_status_formula"])
    book.close()
    assert checksum(source) == original_sha
    assert checksum(paths["baseline_original"]) == original_sha
    report = {
        "schema": "furusato-excel-open-probes/v1",
        "warning": "DIAGNOSTIC ONLY. These files are NOT approved tax workbooks.",
        "probes": [
            {
                "id": key, "file": name, "bytes": paths[key].stat().st_size,
                "sha256": checksum(paths[key]),
            }
            for key, name in names
        ],
    }
    (folder / "manifest.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    if len(sys.argv) == 3 and sys.argv[2] == "--self-test":
        assert len(report["probes"]) == 5
        assert all(p["bytes"] > 20000 for p in report["probes"])
        a = load_workbook(paths["current_review"])
        b = load_workbook(paths["all_sheets_visible"])
        c = load_workbook(paths["without_status_formula"])
        try:
            assert len(a.sheetnames) == len(b.sheetnames) == len(c.sheetnames) == 20
            assert a["自動回帰テスト"]["B49"].value == b["自動回帰テスト"]["B49"].value
            assert a["自動回帰テスト"]["B49"].value == c["自動回帰テスト"]["B49"].value
            assert a[HOME]["B28"].data_type == "f"
            assert c[HOME]["B28"].value == "診断専用・計算禁止"
            assert all(s.sheet_state == "visible" for s in b)
        finally:
            a.close()
            b.close()
            c.close()
        assert checksum(source) == original_sha
    print("DIAGNOSTIC ONLY: generated five XLSX opening candidates.")
    return report


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3) or (len(sys.argv) == 3 and sys.argv[2] != "--self-test"):
        raise SystemExit("Usage: python make_excel_open_probes.py DIRECTORY [--self-test]")
    make(sys.argv[1])
