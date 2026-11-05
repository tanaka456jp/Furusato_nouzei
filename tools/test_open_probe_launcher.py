"""Contract checks for the one-click Windows Excel diagnostic launcher."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
cmd = (ROOT / "tools/START_EXCEL_PROBE.cmd").read_bytes()
script_bytes = (ROOT / "tools/run_excel_open_probe.ps1").read_bytes()
probe_bytes = (ROOT / "tools/probe_excel_open.ps1").read_bytes()
assert cmd.isascii()
assert script_bytes.startswith(b"\xef\xbb\xbf")
assert probe_bytes.startswith(b"\xef\xbb\xbf")
source = script_bytes.decode("utf-8-sig")
assert "Furusato_nouzei_Excel読込確認用.xlsx" in source
assert "-ConfirmationWorkbook $confirmation" in source
assert "-EvidencePath $evidence" in source
assert "DIAGNOSTIC_ONLY" in source
assert "native_excel_control" in probe_bytes.decode("utf-8-sig")
print("PASS: ASCII one-click CMD, BOM PowerShell, optional exact confirmation, read-only evidence.")
