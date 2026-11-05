"""Verify the review package and Unicode-safe PowerShell/VBA installation contract.

This is a STATIC check, not a Windows Excel execution. Actual COM/VBA
installation must still pass tools/verify_excel.ps1 on a dedicated runner.
"""
from __future__ import annotations
from pathlib import Path
from zipfile import ZipFile
import sys

ROOT = Path(__file__).resolve().parents[1]
package = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "Furusato_nouzei_v4_REVIEW.zip"
expected = {
    "Furusato_nouzei.xlsx": ROOT / "workbook/baseline.xlsx",  # built XLSX verified separately
    "START_SETUP.cmd": ROOT / "tools/START_SETUP.cmd",
    "setup.ps1": ROOT / "tools/setup.ps1",
    "TaxLawUpdater.bas": ROOT / "vba/TaxLawUpdater.bas",
    "README.txt": ROOT / "docs/user-guide.md",
}
assert package.exists(), f"Package not found: {package}"
with ZipFile(package) as archive:
    assert archive.testzip() is None, "Review ZIP CRC failure"
    assert set(archive.namelist()) == set(expected), "Unexpected or missing ZIP members"
    assert all(n.isascii() and n == Path(n).name for n in archive.namelist()), "Setup ZIP is not ASCII/flat"
    for member in ("START_SETUP.cmd", "setup.ps1", "TaxLawUpdater.bas", "README.txt"):
        assert archive.read(member) == expected[member].read_bytes(), f"Stale ZIP payload: {member}"
    assert len(archive.read("Furusato_nouzei.xlsx")) > 20_000, "Incomplete workbook payload"
    ps = archive.read("setup.ps1").decode("utf-8-sig")
    cmd = archive.read("START_SETUP.cmd").decode("ascii")
    vba = archive.read("TaxLawUpdater.bas").decode("utf-8-sig")

assert "VBComponents.Add(1)" in ps, "Setup must register a standard VBA module"
assert "CodeModule.AddFromString($sourceBody)" in ps, "VBA Unicode registration missing"
assert "GetBytes($sourceVba)" not in ps, "Installer still depends on local ANSI code page"
assert "VBComponents.Import($tempBas)" not in ps, "Installer still imports locale-sensitive ANSI BAS"
assert "TaxLawUpdater.RecalculateCase" in ps, "Macro smoke run missing"
assert "TaxLawUpdater.BindButtons" in ps, "First-run macro rebinding smoke missing"
assert "TaxLawUpdater.BindButtons" in ps.split("Private Sub Workbook_Open()", 1)[-1], "Workbook_Open must rebind buttons for saved cases"
assert "Public Sub BindButtons()" in vba, "Workbook-specific button binding routine missing"
assert "Replace(ThisWorkbook.Name" in vba, "Button macros are not workbook-qualified"
assert "SaveCaseToFile" in vba, "Case save routine missing"
assert "ThisWorkbook.SaveCopyAs temporary" in vba, "Case must save to temporary file first"
assert "fso.MoveFile temporary, destination" in vba, "Case save must move verified temporary file atomically"
assert "fso.DeleteFile temporary, True" in vba, "Failed case save must remove partial file"
assert "ThisWorkbook.SaveCopyAs destination" not in vba, "Case save must not write directly to final path"
assert "btnSaveCase" in vba and "btnExportDetails" in vba, "Buttons coverage incomplete"
assert "xl/vbaProject.bin" in ps, "VBA project save validation missing"
assert "Furusato_nouzei.xlsm" in ps and "Furusato_nouzei.xlsx" in ps, "Naming mismatch"
assert 'Public Sub TaxLawUpdate()' in vba
assert 'Public Function TaxLawUpdateForTest() As Boolean' in vba
assert "book.SaveCopyAs backup" in vba
assert "book.Save" in vba
assert "PowerShell exit code" in cmd
assert not any(ord(c) > 127 for c in cmd), "CMD launcher must be ASCII-safe"

print("PASS: flat ASCII delivery ZIP; source/payload matched; Unicode VBA import and smoke run present.")
