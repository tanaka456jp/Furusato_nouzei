"""Generate independent, DIAGNOSTIC-ONLY Excel-open variants from the frozen source."""
from hashlib import sha256
from pathlib import Path
import json
from shutil import copyfile
import sys

from openpyxl import Workbook, load_workbook
from build_workbook import ROOT, HOME, build
from rebuild_xlsx import LAYOUT_GROUPS, reconstruct


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
        ("fresh_minimal_openpyxl", "06_fresh_minimal_openpyxl.xlsx"),
        ("baseline_values_only", "07_baseline_values_only.xlsx"),
        ("baseline_unstyled_formulas", "08_baseline_unstyled_formulas.xlsx"),
        ("baseline_rebuilt_styles", "09_baseline_rebuilt_styles.xlsx"),
        ("baseline_rebuilt_full", "10_baseline_rebuilt_full.xlsx"),
        ("review_rebuilt_full", "11_review_rebuilt_full.xlsx"),
        *[
            ("layout_" + group, f"{number:02d}_layout_{group}.xlsx")
            for number, group in enumerate(LAYOUT_GROUPS, 12)
        ],
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
    # OOXML origin control: if the trivial openpyxl file fails but Excel native
    # succeeds, inspect host file-block policies rather than changing formulas.
    clean = Workbook()
    clean.active.title = "Probe"
    clean.active["A1"] = "OOXML origin control - DIAGNOSTIC ONLY"
    clean.save(paths["fresh_minimal_openpyxl"])
    clean.close()

    # Reconstruct 19 baseline worksheets with no source metadata or styles.
    # Separate values-only from formula-preserving variants.
    def write_clean(keep_formulas, target):
        original = load_workbook(source)
        fresh = Workbook()
        fresh.remove(fresh.active)
        for src in original:
            dst = fresh.create_sheet(src.title)
            for row in src:
                for cell in row:
                    if cell.value is not None and (keep_formulas or cell.data_type != "f"):
                        dst[cell.coordinate] = cell.value
        fresh.active = 0
        fresh.save(target)
        fresh.close()
        original.close()

    write_clean(False, paths["baseline_values_only"])
    write_clean(True, paths["baseline_unstyled_formulas"])
    reconstruct(source, paths["baseline_rebuilt_styles"], styles=True, layout=False)
    reconstruct(source, paths["baseline_rebuilt_full"], styles=True, layout=True)
    build(paths["baseline_rebuilt_full"], paths["review_rebuilt_full"])
    for group in LAYOUT_GROUPS:
        reconstruct(source, paths["layout_" + group],
                    styles=True, layout=False, layout_parts=[group])
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
        assert len(report["probes"]) == 11 + len(LAYOUT_GROUPS)
        assert all(p["bytes"] > 0 for p in report["probes"])
        assert all(p["bytes"] > 20000 for p in report["probes"][:5])
        assert paths["fresh_minimal_openpyxl"].stat().st_size < 20000
        v = load_workbook(paths["baseline_values_only"])
        f = load_workbook(paths["baseline_unstyled_formulas"])
        original = load_workbook(source)
        try:
            assert len(v.sheetnames) == len(f.sheetnames) == len(original.sheetnames) == 19
            for original_sheet in original:
                vs, fs = v[original_sheet.title], f[original_sheet.title]
                for row in original_sheet:
                    for cell in row:
                        expected = cell.value
                        assert fs[cell.coordinate].value == expected
                        assert vs[cell.coordinate].value == (
                            expected if cell.data_type != "f" else None
                        )
        finally:
            original.close()
            v.close()
            f.close()
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
        for key in ("baseline_rebuilt_styles", "baseline_rebuilt_full"):
            copybook = load_workbook(paths[key])
            original = load_workbook(source)
            try:
                assert copybook.sheetnames == original.sheetnames
                for a, b in zip(copybook, original):
                    for row in b:
                        for c in row:
                            if c.value is not None:
                                assert a[c.coordinate].value == c.value
            finally:
                copybook.close()
                original.close()
        rebuilt = load_workbook(paths["review_rebuilt_full"])
        try:
            assert len(rebuilt.sheetnames) == 20
            assert rebuilt["自動回帰テスト"]["B49"].data_type == "f"
        finally:
            rebuilt.close()
    print(f"DIAGNOSTIC ONLY: generated {len(names)} XLSX opening candidates.")
    return report


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3) or (len(sys.argv) == 3 and sys.argv[2] != "--self-test"):
        raise SystemExit("Usage: python make_excel_open_probes.py DIRECTORY [--self-test]")
    make(sys.argv[1])
