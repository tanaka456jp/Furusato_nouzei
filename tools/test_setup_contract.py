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
    "withholding_reader.py": ROOT / "tools/withholding_reader.py",
    "README.txt": ROOT / "docs/user-guide.md",
}
assert package.exists(), f"Package not found: {package}"
with ZipFile(package) as archive:
    assert archive.testzip() is None, "Review ZIP CRC failure"
    assert set(archive.namelist()) == set(expected), "Unexpected or missing ZIP members"
    assert all(n.isascii() and n == Path(n).name for n in archive.namelist()), "Setup ZIP is not ASCII/flat"
    for member in ("START_SETUP.cmd", "setup.ps1", "TaxLawUpdater.bas", "withholding_reader.py", "README.txt"):
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
assert "Zone.Identifier" in ps, "Downloaded workbook zone marker must be diagnosed"
assert "Get-FileHash -LiteralPath $source -Algorithm SHA256" in ps, "Input workbook hash check missing"
assert "Get-FileHash -LiteralPath $stagedSource -Algorithm SHA256" in ps, "Staged input hash check missing"
assert "Workbooks.Open($stagedSource, 0, $true)" in ps, "Office must open a local staged workbook copy"
assert "Workbooks.Add()" in ps and "excel_probe.xlsx" in ps, "Excel COM probe missing"
assert "Excelの修復モード" in ps and "Workbooks.Open(" in ps, "Read-only Excel repair probe missing"
assert "$repair.Close($false)" in ps, "Read-only repair probe must be closed"
assert "製品への自動採用はしません" in ps, "Repaired workbook must never silently replace original"
assert "Remove-Item -LiteralPath $stagingDir -Recurse -Force" in ps, "Staging cleanup missing"
assert "Unblock-File" not in ps and "Set-ItemProperty" not in ps, "Do not bypass Office security settings"
assert "TaxLawUpdater.BindButtons" in ps, "First-run macro rebinding smoke missing"
assert "TaxLawUpdater.BindButtons" in ps.split("Private Sub Workbook_Open()", 1)[-1], "Workbook_Open must rebind buttons for saved cases"
assert "Public Sub BindButtons()" in vba, "Workbook-specific button binding routine missing"
assert "Replace(ThisWorkbook.Name" in vba, "Button macros are not workbook-qualified"
assert "SaveCaseToFile" in vba, "Case save routine missing"
assert "ThisWorkbook.SaveCopyAs temporary" in vba, "Case must save to temporary file first"
assert "fso.MoveFile temporary, destination" in vba, "Case save must move verified temporary file atomically"
assert "fso.DeleteFile temporary, True" in vba, "Failed case save must remove partial file"
assert "ThisWorkbook.SaveCopyAs destination" not in vba, "Case save must not write directly to final path"
assert "home.Range(\"B4\").Value2 = oldYear" in vba, "Rollback must restore the visible year"
assert "Public Function ExportDetailsToFile(ByVal destination As String) As Boolean" in vba, "Actual PDF command missing"
assert "fso.MoveFile temporary, destination" in vba, "Export must use staged filename"
assert "fso.GetFile(temporary).Size < 500" in vba, "PDF minimum size validation missing"
assert "If openedDetail Then ReturnHome" in vba, "PDF must restore original detail visibility"
assert "btnSaveCase" in vba and "btnExportDetails" in vba, "Buttons coverage incomplete"
assert "Public Sub ImportWithholding()" in vba
assert "UniqueBackupPath(ThisWorkbook)" in vba
assert "READY_FOR_EXCEL_CROSSCHECK" in vba
assert "ImportWithholding' " not in ps
assert "'ImportWithholding'" in ps
assert "xl/vbaProject.bin" in ps, "VBA project save validation missing"
assert "Furusato_nouzei.xlsm" in ps and "Furusato_nouzei.xlsx" in ps, "Naming mismatch"
assert 'Public Sub TaxLawUpdate()' in vba
assert 'Public Function TaxLawUpdateForTest() As Boolean' in vba
assert "book.SaveCopyAs backup" in vba
assert "book.Save" in vba
assert "PowerShell exit code" in cmd
assert not any(ord(c) > 127 for c in cmd), "CMD launcher must be ASCII-safe"



# Unexpected rejection in unattended VBA must report False, never an
# unhandled COM/VBE exception that can block an Excel runner indefinitely.
assert "mLastTestFailure = problem" in vba
assert "ApplyApprovedYear = False" in vba
assert 'Err.Raise vbObjectError + 116' not in vba
assert "Public Function TaxLawUpdateLastFailure() As String" in vba
assert "TrySaveCaseToFileForTest" in vba and "TryExportDetailsToFileForTest" in vba
verify_ps = (ROOT / "tools/verify_excel.ps1").read_text(encoding="utf-8-sig")
assert "TaxLawUpdater.TrySaveCaseToFileForTest" in verify_ps
assert "TaxLawUpdater.TryExportDetailsToFileForTest" in verify_ps
assert "TaxLawUpdater.TaxLawUpdateLastFailure" in verify_ps
print("PASS: flat ASCII delivery ZIP; source/payload matched; Unicode VBA import and smoke run present.")
