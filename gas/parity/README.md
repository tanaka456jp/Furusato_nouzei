# 2025/2026 GAS versus Excel v4.18.2: independent comparison

The 41 synthetic salary-only cases test the overlap between the two models.
The Excel oracle MUST be calculated by Microsoft Excel from the official
v4.18.2 **ReadyToUse ZIP**, not from GAS formulas, an arbitrary workbook,
or a mocked Excel result. The official SHA-256 is
f534882f56461ea23a75474f24e68ad364d557091609c994341c179e9a655f25.

Windows with Excel 365, Node 22+ and the official ZIP:

1. Run: node gas/tests/test-parity.cjs
2. Run: powershell -NoProfile -File gas/parity/run-excel-oracle.ps1 -PreflightOnly
3. Run: powershell -NoProfile -File gas/parity/run-excel-oracle.ps1 -ReleaseZip 'C:\path\Furusato_nouzei_v4.18.2_ReadyToUse.zip'

Official ZIP download: https://github.com/tanaka456jp/Furusato_nouzei/releases/tag/v4.18.2

The script checks the ZIP checksum, extracts only Furusato_nouzei.xlsm
into an isolated temporary folder, opens a NEW Excel COM instance with
macros/events disabled, writes synthetic numbers, recalculates all 41 cases,
and cleans up. Neither Excel main nor HousingERP nor Google is modified.
By default the oracle JSON has a unique temporary path; use -OutputPath
to specify a non-existing JSON path in an existing private folder.

A mismatch, missing Excel data, bad provenance, or even a passing MOCK
contract test must NOT be called Excel parity. An actual 41/41 agreement is
labeled COVERED_CASES_MATCH, but full tax parity and formal release remain
HOLD. Never delete boundary cases or broaden tolerances just to pass.
Do not use personal information. Physical printing, family/insurance/mortgage,
pensions, business, split tax, and municipality-specific taxes are not covered.
