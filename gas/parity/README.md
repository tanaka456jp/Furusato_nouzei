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

The in-memory Windows Excel oracle also synchronizes the hidden 設定・税率!B4
with 操作画面!B4 (the signed release normally does this via its tax-update
macro), verifies the active master year, requires at least five NORMAL
results per year, and checks the 2026 7-million-yen 109,000-yen anchor.
A workbook returning HOLD for every case is not a passing oracle.


### Owner-only Windows device execution

An explicit [excel-parity-41] marker on a trusted owner push to
feature/gas-workflow-20261106 triggers a one-shot 41-case Excel audit.
The self-hosted workflow verifies the official ReadyToUse release
SHA-256 before Excel starts. It downloads only the public release ZIP,
uses a unique temporary folder and a new Excel COM PID, leaves
previously-running Excel processes untouched, and deletes the downloaded
ZIP after completion. Subsequent ordinary commits do not repeat it.
Only owner-authored trusted push workflows run on the private Windows
device; untrusted pull requests never do.

The artifact contains synthetic test results only (14-day retention).
HousingERP, the formal Excel release, Google credentials, and real
customer data must not be accessed or modified. A mismatch, missing
source, or too few NORMAL Excel cases means HOLD, not success.


### Live Excel performance and timeout

Only the first case calls CalculateFullRebuild. Subsequent cases use
Calculate after the input batch has been assigned in a separate Excel
instance with automatic recalculation disabled. Each synthetic case logs
EXCEL_CASE_START and EXCEL_CASE_CALCULATED with elapsed time; any
non-completing case remains HOLD after a bounded timeout. This preserves
full Excel calculation while avoiding repeated dependency rebuilding.


### Excel calculation performance: diagnostic run

A previous first-case FullCalculationRebuild took over 205 seconds without
returning xlDone on the self-hosted Windows runner; it is not a valid
calculation result. The current implementation instead uses Excel's
standard dependency-aware Calculate method after batching the inputs,
and tests the known 2026 7m/1m 109,000-yen reference first. The
CalculationState must still reach xlDone for each case; otherwise the
run fails with HOLD. No simulation or cached value is substituted.


### First-case calculation diagnosis

An owner-authored push containing `[excel-calc-diagnostic]` runs one
synthetic 2026 / 7-million-yen case using an isolated Excel COM process.
The JSON evidence captures numeric Excel CalculationState values (0=done,
1=calculating, 2=pending), COM calculation-call time and a few state samples.
It is **not** an Excel-parity oracle: `release=HOLD` and
`eligibleForParity=false` even when an observed number appears plausible.


A follow-up diagnostic uses an **ABA input test** (2026, salary
7,000,000 → 5,000,000 → 7,000,000 yen, social insurance 1,000,000 yen)
to distinguish live Excel recalculation from an unchanged cached value.
It records both salary income and donation estimates at each point,
compares the first/last anchor, and **still reports HOLD**. A successful
ABA response is evidence of dynamic updates, not full Excel parity.


### 41-case Excel observed difference report (NOT formal parity)

Owner push marker `[excel-observed-41]` runs all 41 synthetic cases in a
fresh Excel COM instance using the official ZIP. It records the observed
salary/levy/donation values even where application `CalculationState=2`
remains pending. These observations are compared against GAS, and the
result is **always HOLD**, even if there are no numerical differences.
The report and the input-only JSON contain no personal data and are
uploaded as separate artifacts. Never call this complete Excel parity.
