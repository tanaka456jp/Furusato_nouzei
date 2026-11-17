"""Fail-closed static contract for the isolated Windows display evidence collector.

Real desktop coverage requires the PC runner and the captured evidence.
"""
from pathlib import Path
root = Path(__file__).resolve().parents[1]
ps = (root / "tools/probe_display_layout.ps1").read_text(encoding="utf-8-sig")
workflow = (root / ".github/workflows/workbook.yml").read_text(encoding="utf-8")
for token in (
    "generated synthetic review workbook",
    "StartsWith($runnerTemp",
    "Workbooks.Open($source,0,$true)",
    "$excel.AutomationSecurity = 3",
    "FurusatoWindowCapture]::PrintWindow",
    "GetDpiForWindow",
    "review_excel_window_sheet_only.png",
    "review_excel_window_lower_section.png",
    "review_excel_window_mortgage_and_projection.png",
    "FromHandle($hwnd)",
    "$link.Follow()",
    "$home.Range($capture.focus).Select()",
    "COMMAND_OVERLAP_OR_CLIP",
    "COMMAND_CAPTION_CLIPS",
    "WORKSHEET_CONTENT_CLIPPED_BY_VIEWPORT",
    "DISPLAY_WORKBOOK_CHANGED_DURING_CAPTURE",
    "ScrollRow = [int]$capture.row",
    "row = 12", "row = 31",
    "$top = [Math]::Min(350",
    "physical_resolution_verified = $false",
    "screenshots = @($pictures)",
    "display_review.json",
    "furusato-display-review/v2",
    "source_head = $SourceHead",
    "workbook_sha256 = $workbookHash",
    "'MEASURED'",
    "'UNVERIFIED'",
    "1920x1080@100", "1920x1080@125", "1366x768@150",
    "book.Close($false)", "excel.Quit()",
):
    assert token in ps, f"Missing display safety invariant: {token}"
for forbidden in ("SetDisplayConfig", "ChangeDisplaySettings", "Set-DisplayResolution",
                  "GetDesktopWindow", "CopyFromScreen", "BitBlt(", "CAPTURED_PASS"):
    assert forbidden not in ps, f"Unreviewed desktop/screen mutation: {forbidden}"
for token in (
    r".\tools\probe_display_layout.ps1",
    "tools/test_display_contract.py",
    "Furusato_nouzei_DISPLAY_REVIEW_",
    "display_review.json",
    "verify_release_display_matrix.py",
):
    assert token in workflow, f"Display CI hook missing: {token}"
print("DISPLAY_EVIDENCE_CONTRACT_PASS (not real-display release acceptance)")
