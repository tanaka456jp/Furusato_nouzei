"""Static XML quality contract; no client data or third-party dependencies."""
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET
import sys

PATH = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "ふるさと納税限度額計算_修正版.xlsx"
NS = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REQUIRED = {
    "操作画面", "設定・税率", "年度パラメータ", "年度別基礎控除",
    "年度別人的控除", "年度別特定親族", "年度別配偶者控除",
    "年度別保険料計算", "年度別控除上限", "年度別所得税率",
    "年度別給与控除", "整合性チェック", "自動回帰テスト",
    "住民税再計算", "源泉徴収票入力", "追加人的控除",
}

def cell(root, address):
    c = root.find(f".//x:sheetData/x:row/x:c[@r='{address}']", NS)
    if c is None:
        return None
    v, t = c.find("x:v", NS), c.find("x:is", NS)
    return v.text if v is not None else "".join(t.itertext()) if t is not None else None

with ZipFile(PATH) as archive:
    assert archive.testzip() is None, "Corrupted XLSX archive"
    wb = ET.fromstring(archive.read("xl/workbook.xml"))
    names = [s.attrib["name"] for s in wb.findall(".//x:sheets/x:sheet", NS)]
    assert len(names) == 19, names
    assert REQUIRED.issubset(names), REQUIRED - set(names)
    roots = {name: ET.fromstring(archive.read(f"xl/worksheets/sheet{i}.xml")) for i, name in enumerate(names, 1)}
    for name, root in roots.items():
        for f in root.findall(".//x:f", NS):
            assert "#REF!" not in (f.text or ""), (name, f.text)
    assert cell(roots["操作画面"], "B4") == "2026"
    reg = roots["自動回帰テスト"]
    assert cell(reg, "B47") == "52"
    assert cell(reg, "B48") == "0"
    assert cell(reg, "B49") == "PASS", "Regression summary must have recalculated PASS"
    master = roots["年度パラメータ"]
    assert [cell(master, f"A{r}") for r in (4, 5, 6)] == ["2025", "2026", "2027"]
    main = roots["ふるさと納税限度額計算"]
    assert cell(main, "A62") == "ふるさと納税｜限度額算定の根拠"
    assert (cell(main, "A73") or "").startswith("住宅ローン控除・配当控除")
    assert cell(main, "C70") in (None, "")
    assert cell(main, "E73") in (None, "")
    for ref in ("Z4", "C78"):
        found = main.find(f".//x:sheetData/x:row/x:c[@r='{ref}']", NS)
        assert found is not None and found.find("x:f", NS) is not None, "Core calculation reference missing: " + ref
    assert not any(n.startswith("xl/media/") for n in archive.namelist()), "Old formula image remains"
print("PASS: 19 sheets, dashboard, master approvals, regression, screen fixes, image removal and no #REF!")
