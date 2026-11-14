"""Fail-closed static contract for the isolated Windows display evidence collector.

Does not assert real desktop coverage. That requires an interactive PC,
the captured evidence, and independent human visual assessment.
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
    "ScrollRow = [int]$capture.row",
    "row = 12",
    "$top = [Math]::Min(350",
    "inferred_pixels_if_dpi_virtualized",
    "physical_resolution_verified = $false",
    "scenario_inferred_from_virtualized_bounds_not_certified",
    "screenshots = @($pictures)",
    "display_review.json",
    "CAPTURED_REQUIRES_VISUAL_REVIEW",
    "'UNVERIFIED'",
    "release_approved = $false",
    "unverified_scenarios",
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
):
    assert token in workflow, f"Display CI hook missing: {token}"
print("DISPLAY_EVIDENCE_CONTRACT_PASS (not real-display release acceptance)")
