"""Static XML quality contract; no client data or third-party dependencies."""
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET
import sys

PATH = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "ふるさと納税限度額計算_ワンクリック更新.xlsx"
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
    assert cell(reg, "B49") in ("PASS", None)
    master = roots["年度パラメータ"]
    assert [cell(master, f"A{r}") for r in (4, 5, 6)] == ["2025", "2026", "2027"]
print("PASS: 19 sheets, dashboard, master approvals, regression results and no #REF!")
