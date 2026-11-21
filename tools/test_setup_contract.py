"""Verify the review package and Unicode-safe PowerShell/VBA installation contract.

This is a STATIC check, not a Windows Excel execution. Actual COM/VBA
installation must still pass tools/verify_excel.ps1 on a dedicated runner.
"""
from __future__ import annotations
from pathlib import Path
from zipfile import ZipFile
import re
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

# The review title and installer log must identify the same candidate build.
# A stale v4.10 setup label can make isolated evidence appear to be an old release.
workbook_source = (ROOT / "tools/build_workbook.py").read_text(encoding="utf-8-sig")
workbook_version = re.search(r'v[0-9]+\.[0-9]+\.[0-9]+', workbook_source)
installer_version = re.search(r'Furusato_nouzei setup (v[0-9]+\.[0-9]+\.[0-9]+)', ps)
assert workbook_version and installer_version, "Workbook or installer candidate version is missing"
assert installer_version.group(1) == workbook_version.group(0), (
    f"Installer version {installer_version.group(1)} differs from review workbook {workbook_version.group(0)}"
)

assert "VBComponents.Add(1)" in ps, "Setup must register a standard VBA module"
assert "$tempBook = Join-Path $stagingDir 'Furusato_nouzei.xlsm'" in ps, (
    "Staged XLSM must use the final workbook filename before Excel serializes Forms OnAction")
assert "Workbooks.Open($tempBook, 0, $true)" in ps, (
    "Saved Forms OnAction references must be inspected without running macros")
assert "保存済み全16ボタンのマクロ参照: PASS" in ps
assert ps.index("保存済み全16ボタンのマクロ参照: PASS") < ps.index("[System.IO.File]::Move($tempBook, $final)"), (
    "Reject misbound buttons BEFORE final workbook publication")
assert "CodeModule.AddFromString($sourceBody)" in ps, "VBA Unicode registration missing"
assert "GetBytes($sourceVba)" not in ps, "Installer still depends on local ANSI code page"
assert "VBComponents.Import($tempBas)" not in ps, "Installer still imports locale-sensitive ANSI BAS"
assert "TaxLawUpdater.RecalculateCase" in ps, "Deferred macro acceptance must stay documented"
assert "$excel.Run(" not in ps, "Installer must not run macros in its force-disabled COM session"
assert "verify_excel.ps1" in ps, "Dedicated post-install macro verification required"
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
assert "btnRecalculateBatchEdits" in ps, "Batch edit button must match BindButtons name"
assert '"btnRecalculateBatchEdits", "RecalculateBatchFromEditor"' in vba, "VBA batch button must match the installer"
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
# VBA module-level declarations and constants MUST precede the first
# procedure. Putting either below a Sub can open an unattended compile dialog
# that hangs Windows Excel COM without an actionable Python exception.
first_proc = re.search(r"^(?:Public|Private|Friend)\s+(?:Sub|Function|Property)\b", vba, re.M)
assert first_proc is not None, "VBA entrypoints not found"
module_decls = re.finditer(
    r"^(?:(?:Private|Public|Friend|Global)\s+)?(?:Const\s+|"
    r"m[A-Z][A-Za-z0-9_]*\s+As\s+)",
    vba, re.M
)
for item in module_decls:
    assert item.start() < first_proc.start(), (
        "VBA module declaration occurs after a procedure: " + item.group(0)
    )
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
assert "If withFiling And Len(CStr(pieces(19)))" not in vba, (
    "VBA And evaluates out-of-range pieces(19) on legacy batch rows")
assert "If withFiling Then" in vba and "If Len(CStr(pieces(19))) > 0 Then" in vba, (
    "Legacy v1/v2/v3 schemas must guard the filing column before indexing")
assert "'TaxLawUpdater.LoadBatchFromTsv'" not in verify_ps, (
    "Direct VBA batch loader call may leave unattended Excel blocked by error modal")
assert "BATCH_V1_LOAD_REJECTED_CODE" in verify_ps
assert "BATCH_V2_LOAD_REJECTED_CODE" in verify_ps
workflow = (ROOT / ".github/workflows/workbook.yml").read_text(encoding="utf-8")
assert "probe_reader_launch_policy.ps1" in workflow
assert "reader_launch_diagnostic.json" in workflow
assert "PC1_BATCH_READER_EXE_ACCESS_DENIED_RELEASE_HOLD" in workflow
assert "WriteBatchEditorInputFile" in vba and "ExportBatchEditsForTest" in vba, (
    "PC1 source-only bridge must use production editor TSV serialization")
assert "-BatchBridgeOnly -FullSyntheticSuite" in workflow and "QA_BATCH_SOURCE_BRIDGE_PASS_RELEASE_STILL_HOLD" in verify_ps, (
    "PC1 must test full Excel VBA/tax fixtures using Python bridge without blocked unsigned EXE")
assert "QA_SOURCE_ONLY_FULL_SYNTHETIC_SUITE_PASS_RELEASE_STILL_HOLD" in verify_ps, (
    "Source-only acceptance cannot be called a release PASS")
assert "SOURCE_ONLY_PASS_RELEASE_HOLD" in verify_ps and "signed_product_accepted = $false" in verify_ps, (
    "Source-only receipt must explicitly remain non-release, even after Excel PASS")
assert "Independent VBAUpdater sandbox project push (HOLD diagnostic)" in workflow, (
    "VBAUpdater must receive isolated diagnostics even when unsigned reader is blocked")
assert "Compare independent 41 Excel / GAS synthetic cases (HOLD diagnostic)" in workflow, (
    "PC1 41-case comparison must not be skipped by unsigned EXE access denial")
assert "gas_sourceonly_comparison.json" in workflow and "sourceonly_excel_acceptance.json" in workflow, (
    "Source-only partial artifacts must survive blocked reader failure")
assert workflow.index("Independent PC1 source-only full Excel acceptance (HOLD)") < workflow.index("python tools/smoke_batch_recalculate_exe.py $readers[0].FullName"), (
    "Independent Excel evidence must be collected before reader execution")
assert workflow.count("-BatchBridgeOnly -FullSyntheticSuite") == 1, (
    "Full source-only Excel COM suite must run once per PC1 job; reuse exact-run receipt before EXE smoke")
assert "PC1_PRE_READER_SOURCE_ONLY_RECEIPT_INVALID_OR_STALE" in workflow, (
    "EXE smoke must not run against a different workbook or stale HEAD receipt")
assert workflow.index("Independent VBAUpdater sandbox project push (HOLD diagnostic)") < workflow.index("python tools/smoke_batch_recalculate_exe.py $readers[0].FullName")
assert workflow.index("Compare independent 41 Excel / GAS synthetic cases (HOLD diagnostic)") < workflow.index("python tools/smoke_batch_recalculate_exe.py $readers[0].FullName")
assert "FULL_SYNTHETIC_SUITE_REQUIRES_SOURCE_ONLY_MODE" in verify_ps, (
    "No alternate full-suite flag can skip production binary requirements")
assert "BATCH_SOURCE_ONLY_CANNOT_APPROVE_RELEASE" in verify_ps, (
    "A source-only Excel bridge must never create a full release acceptance receipt")
assert "NoMatchingEventsFound" in (ROOT / "tools/probe_reader_launch_policy.ps1").read_text(encoding="utf-8"), (
    "No recent Windows policy events must not be misreported as access denied")
signing_ps = (ROOT / "tools/try_release_excel_signature.ps1").read_text(encoding="utf-8-sig")
assert "EXISTING_SIGNING_IDENTITY_REQUIRES_CONFIGURATION" not in signing_ps
assert "SIGNING_NOT_CONFIGURED" in signing_ps
readiness_policy = (ROOT / "tools/release_readiness.py").read_text(encoding="utf-8")
assert '"distribution_integrity_and_sha256"' in readiness_policy
assert '"signed_distribution_and_sha256"' not in readiness_policy
assert "UNSIGNED_CANDIDATE_NOT_IDENTICAL_TO_ACCEPTED_CI_BYTES" in (
    ROOT / "tools/verify_excel_release_candidate.py").read_text(encoding="utf-8")
assert "BatchRecalcLastStageForTest" in vba and "BatchRecalcLastExitCodeForTest" in vba, (
    "Recalculation must expose numeric-only PC1 diagnostics")
assert "BATCH_V5_RECALC_VALID_ROW_REJECTED stage=" in verify_ps, (
    "PC1 failed batch edit must distinguish EXE startup from bridge import")

assert "Len(CStr(target.Cells(index + 5, 11).Value2)) >= 30" in vba, (
    "Japanese filing-comparison notes must get a readable minimum row height")
assert 'target.Rows(index + 5).RowHeight = 66' in vba
assert "Len(CStr(target.Cells(index + 5, 11).Value2)) > 50" not in vba, (
    "Old 50-character threshold clipped the v4 synthetic filing note on PC1")
assert "TaxLawUpdater.TrySaveCaseToFileForTest" in verify_ps
assert "TaxLawUpdater.TryExportDetailsToFileForTest" in verify_ps
assert "TaxLawUpdater.TaxLawUpdateLastFailure" in verify_ps

# One same-command retry is permitted only for VBA Err 70; fail closed otherwise.
assert "RunBatchReaderWithAccessRetry(shell, command, fso, temporaryOut)" in vba
retry = vba.split("Private Function RunBatchReaderWithAccessRetry(", 1)[1].split("End Function", 1)[0]
assert retry.count("launcher.Run(command, 0, True)") == 2
assert "If firstError <> 70 Or fso.FileExists(outputPath) Then" in retry
assert "mBatchRecalcLastLaunchAttempts = 1" in retry
assert "mBatchRecalcLastLaunchAttempts = 2" in retry
assert "Application.Wait Now + TimeSerial(0, 0, 1)" in retry
assert "Err.Raise firstError" in retry
assert "BatchRecalcLaunchAttemptsForTest" in vba
assert verify_ps.count("TaxLawUpdater.BatchRecalcLaunchAttemptsForTest") == 3
# Never launch the unsigned reader from an unattended PR build.
# A durable manual Actions dispatch is necessary before Apex One can prompt.
assert "apex_one_operator_ready:" in workflow
assert "default: false" in workflow.split("apex_one_operator_ready:", 1)[1].split("\n", 4)[3]
assert "APEX_ONE_OPERATOR_CONFIRMATION_REQUIRED_RELEASE_HOLD" in workflow
assert workflow.index("Apex One operator confirmation gate (reader EXE not started)") < workflow.index("python tools/smoke_batch_recalculate_exe.py")
assert workflow.index("Compare independent 41 Excel / GAS synthetic cases") < workflow.index("Apex One operator confirmation gate (reader EXE not started)")
assert "github.ref == 'refs/heads/fix/excel-2026-salary-nta-20261107'" in workflow
assert "'${{ inputs.apex_one_operator_ready }}' -ceq 'true'" in workflow
assert "'${{ inputs.excel }}' -ceq 'true'" in workflow
assert "throw 'APEX_ONE_OPERATOR_CONFIRMATION_REQUIRED_RELEASE_HOLD'" in workflow
print("PASS: flat ASCII delivery ZIP; source/payload matched; Unicode VBA import and smoke run present.")
