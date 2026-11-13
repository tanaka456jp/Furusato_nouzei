"""Verify the review package and Unicode-safe PowerShell/VBA installation contract.

This is a STATIC check, not a Windows Excel execution. Actual COM/VBA
installation must still pass tools/verify_excel.ps1 on a dedicated runner.
"""
from __future__ import annotations
from pathlib import Path
import re
from zipfile import ZipFile
import sys

ROOT = Path(__file__).resolve().parents[1]
package = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "Furusato_nouzei_v4_REVIEW.zip"
expected = {
    "Furusato_nouzei.xlsx": ROOT / "workbook/baseline.xlsx",  # built XLSX verified separately
    "START_SETUP.cmd": ROOT / "tools/START_SETUP.cmd",
    "setup.ps1": ROOT / "tools/setup.ps1",
    "TaxLawUpdater.bas": ROOT / "vba/TaxLawUpdater.bas",
    "BatchWithholding.bas": ROOT / "vba/BatchWithholding.bas",
    "withholding_reader.py": ROOT / "tools/withholding_reader.py",
    "README.txt": ROOT / "docs/user-guide.md",
}
assert package.exists(), f"Package not found: {package}"
with ZipFile(package) as archive:
    assert archive.testzip() is None, "Review ZIP CRC failure"
    assert set(archive.namelist()) == set(expected), "Unexpected or missing ZIP members"
    assert all(n.isascii() and n == Path(n).name for n in archive.namelist()), "Setup ZIP is not ASCII/flat"
    for member in ("START_SETUP.cmd", "setup.ps1", "TaxLawUpdater.bas", "BatchWithholding.bas", "withholding_reader.py", "README.txt"):
        assert archive.read(member) == expected[member].read_bytes(), f"Stale ZIP payload: {member}"
    assert len(archive.read("Furusato_nouzei.xlsx")) > 20_000, "Incomplete workbook payload"
    ps = archive.read("setup.ps1").decode("utf-8-sig")
    cmd = archive.read("START_SETUP.cmd").decode("ascii")
    vba = archive.read("TaxLawUpdater.bas").decode("utf-8-sig")

assert "VBComponents.Add(1)" in ps, "Setup must register a standard VBA module"
assert "BatchWithholding.bas" in ps, "Installer must require local batch VBA source"
assert "BatchWithholding.BindButtons" in ps, "Reopen must restore local batch buttons"
assert "CodeModule.AddFromString($batchBody)" in ps, "Installer must embed batch macro"
assert "btnShowBatch" in (ROOT / "vba/BatchWithholding.bas").read_text(encoding="utf-8-sig")
assert "FurusatoDocumentReader.exe" in (ROOT / "vba/BatchWithholding.bas").read_text(encoding="utf-8-sig")
# VBA accepts Exit Function only inside Function and Exit Sub only inside Sub.
# An invalid Exit Sub in ExecuteBatch previously opened a hidden compile
# dialog during unattended Excel COM and exhausted the 8-minute runner window.
batch_vba = (ROOT / "vba/BatchWithholding.bas").read_text(encoding="utf-8-sig")
for match in re.finditer(
    r"(?im)^\s*(?:Public|Private)\s+(Function|Sub)\s+([A-Za-z][A-Za-z0-9_]*)\b[^\n]*\n"
    r"(.*?)^\s*End\s+(Function|Sub)\b",
    batch_vba, re.S,
):
    kind, name, body, ending = match.groups()
    assert kind.lower() == ending.lower(), f"Wrong VBA end for {name}"
    forbidden = "Exit Sub" if kind.lower() == "function" else "Exit Function"
    assert not re.search(r"\b" + forbidden + r"\b", body, flags=re.I), (
        f"VBA {name} uses {forbidden} within {kind}"
    )


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
# Manual batch corrections are never silently approved. Excel event wiring
# must trigger the same per-person VBA engine once H/I are reconfirmed.
batch = (ROOT / "vba/BatchWithholding.bas").read_text(encoding="utf-8-sig")
assert 'If Sh.Name = "一括試算一覧" Then BatchWithholding.BatchInvalidate Target' in ps
assert 'Optional ByVal onlyRow As Long = 0' in batch
assert 'Call ExecuteBatch(True, index)' in batch
assert 'ws.Cells(index, "H").Value2 = "未確認"' in batch
assert 'ws.Cells(index, "I").Value2 = "未確認"' in batch
assert 'For index = firstRow To lastRow' in batch
assert 'Private Sub ApplyCaseRow' in batch
assert 'ws.Cells(index, "K").Value2' in batch
assert 'ws.Cells(index, "L").Value2' in batch
assert "batch-manual-edit-automatic-recalc-pass" in verify_ps
assert "$excel.EnableEvents = $true" in verify_ps
assert 'Case "NAME_UTF8_HEX"' in batch
assert 'DecodeRecipientNameHex' in batch
assert 'ws.Cells(rowNum, "B").Value2 = DecodeRecipientNameHex' in batch
assert 'If cell.Column = 1 Or cell.Column = 2' in batch
assert 'recipient-name' not in batch.lower(), "Only the approved field is used"
assert 'NAME_UTF8_HEX' in verify_ps
assert 'Recipient name from safe UTF8 hex' in verify_ps
assert 'Changing beneficiary name revokes old estimate' in verify_ps
reader = (ROOT / "tools/withholding_reader.py").read_text(encoding="utf-8-sig")
assert 'extract_recipient_name(text, words)' in reader
assert 'writer.writerow(["NAME_UTF8_HEX", safe_name.encode("utf-8").hex().upper()])' in reader
assert 'w[4] == "E03"' in reader

assert 'ws.Cells(rowNum, "AX").Value2 = CLng(record("YEAR"))' in batch
assert 'ws.Cells(rowNum, "C").Value2 = CLng(ThisWorkbook.Worksheets(SHEET_HOME).Range("B4").Value2)' in batch
assert 'ws.Cells(index, "AX").Value2' in batch
assert '"前年参考概算"' in batch
assert "previous-year-reference-2026-forecast-pass" in verify_ps
assert "REFERENCE_PREVIOUS_YEAR_FORECAST" not in batch
single = (ROOT / "vba/TaxLawUpdater.bas").read_text(encoding="utf-8-sig")
assert "extra.Range(\"B40\").Value2 = year" in single
assert "home.Range(\"B11\").Value2 = targetYear" in single
assert "home.Range(\"B4\").Value2 = year" not in single
assert "PRIOR_YEAR_REFERENCE_FORECAST" in single

print("PASS: flat ASCII delivery ZIP; source/payload matched; Unicode VBA import and smoke run present.")
