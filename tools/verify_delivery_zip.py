"""Check ZIP layout and Windows filename decoding for the first-run installer."""
from pathlib import Path
from zipfile import ZipFile
import sys

path = Path(sys.argv[1]) if len(sys.argv)>1 else Path("Furusato_nouzei_画面改善_セットアップ修正_納品.zip")
required = {
    "ふるさと納税限度額計算_修正版.xlsx",
    "初回セットアップ.cmd",
    "初回セットアップ.ps1",
    "TaxLawUpdater.bas",
    "はじめにお読みください.txt",
}
with ZipFile(path) as archive:
    names = {i.filename for i in archive.infolist()}
    assert required <= names, f"Missing/misencoded ZIP files: {sorted(required - names)}"
    assert all("/" not in name and "\\" not in name for name in names), "ZIP should have flat root"
    for item in archive.infolist():
        if not item.filename.isascii():
            assert item.flag_bits & 0x800, "UTF-8 filename flag absent: " + item.filename
    assert archive.testzip() is None, "CRC error"
print("PASS: root-level .cmd/.ps1/XLSX/VBA with Windows-readable Unicode filenames")
