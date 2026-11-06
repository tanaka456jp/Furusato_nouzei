"""Synthetic workbook dependency probe: formulas only, never user data."""
from pathlib import Path
from openpyxl import load_workbook
from build_workbook import ROOT,build
from tempfile import TemporaryDirectory
with TemporaryDirectory() as tmp:
    dest=Path(tmp)/"inspected.xlsx"
    build(ROOT/"workbook/baseline.xlsx",dest)
    book=load_workbook(dest)
    for name, cells in {"住民税再計算":[f"B{x}" for x in range(2,27)],
                        "ふるさと納税限度額計算":["J12","J43","J44","J48","D15","D10","D11","D14","F15","F24","F25"],
                        "設定・税率":["B4","B8","B10"],
                        "源泉徴収票入力":[f"B{x}" for x in range(5,20)]}.items():
        sheet=book[name]
        for addr in cells:
            val=sheet[addr].value
            print("MODEL_WIRING",name,addr,str(val)[:1800] if (name=="住民税再計算" and addr in ("B20","B21","B25","B26")) else str(val)[:240])
