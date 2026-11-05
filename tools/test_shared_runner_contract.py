"""Static safety checks for the shared-PC runner enrollment.

The runner is registered with THIS repository in a new directory, without
altering or reusing any runner belonging to other projects.
"""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
source = (root / "tools/register_shared_pc_runner.ps1").read_text(encoding="utf-8-sig")
workflow = (root / ".github/workflows/workbook.yml").read_text(encoding="utf-8")

assert "https://github.com/tanaka456jp/Furusato_nouzei" in source
assert "[ValidateSet('PC1', 'PC2')]" in source
assert "[Type]::GetTypeFromProgID('Excel.Application')" in source
assert "New-Object -ComObject" not in source and ".Quit()" not in source
assert "Test-Path -LiteralPath $folder" in source
assert "Refusing to modify an existing runner folder" in source
assert "'config.cmd'" in source
assert "'run.cmd'" in source
assert "Read-Host 'Temporary registration token (input hidden)' -AsSecureString" in source
assert "ZeroFreeBSTR" in source
assert "'furusato-excel,'" in source
assert "if ($StartNow)" in source

# Do not read/write any other project's registration, environment, credentials,
# Windows service registrations, task scheduler or Excel Trust Center settings.
for forbidden in (
    "Remove-Item", "sc.exe", "Start-Service", "Stop-Service",
    "Set-ItemProperty", "reg.exe", "Register-ScheduledTask", "--replace",
    "Unregister-ScheduledTask", "BankStatementJournalConverter",
    "FXAutoTrader", "USA-Converter",
):
    assert forbidden not in source, f"Forbidden side effect in runner setup: {forbidden}"

hosted_script = (root / "tools/verify_windows_hosted.ps1").read_bytes()
assert hosted_script.startswith(b"\\xef\\xbb\\xbf".decode("unicode_escape").encode("latin-1")), "Windows PowerShell 5.1 script with Japanese literals must carry UTF-8 BOM"
assert "runs-on: windows-2022" in workflow, "Public-repository hosted Windows checks not enabled"
assert "Verify native PowerShell 5.1 and Japanese-path extraction" in workflow
assert "runs-on: [self-hosted, Windows, furusato-excel]" in workflow
assert "github.event.pull_request.head.repo.full_name == github.repository" in workflow
assert "[run-windows-excel]" in workflow
print("PASS: shared-host PC1/PC2 script is isolated; workflow uses a scoped runner label.")
