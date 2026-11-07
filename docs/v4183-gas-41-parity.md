# v4.18.3 review Excel versus GAS PR #2: 41-case comparison

This test is added to the separate Excel candidate Draft PR #5, not the
public v4.18.2 release or the GAS deployment branch.

Sources: the freshly built and real-Windows-accepted Furusato_nouzei.xlsm
(SHA-256 matched to that CI run's excel_acceptance.json), and GAS
Engine.gs plus parity/cases.cjs from pinned commit
17147b0b3ba06fb8f23b1fa9b459c7d7b8030ab2.
The Excel file opens read-only with macros disabled in a newly created
Excel process; no existing Excel process is modified or terminated.

The 41 synthetic 2025/2026 salary-only cases are imported unchanged from
the pinned GAS branch. A 2026 7m -> 5m -> 7m input reversal confirms that
the Excel formula responds dynamically. Salary income, resident tax income
levy, and donation limit are compared at exact 1-yen granularity.

MATCH_41_OF_41 is only a numerical comparison of the 41 overlapping
cases. The result always includes releaseVerdict=HOLD because other tax
scenarios and physical printing are unverified, and Excel may report
global xlPending. The test does not change or approve v4.18.2 main
or deploy GAS.

Any wrong original hash, missing source, altered inputs, duplicate cases,
an invalid 2026 seven-million-yen 109000 anchor, an Excel HOLD, an
invalid amount, one of the three 2026 special salary bands incorrect, a
failed dynamic reversal, or any Excel/GAS mismatch fails the CI.

Compare the Workbook checks excel job and the two synthetic-only evidence
files excel_gas_41_observations.json and excel_gas_41_comparison.json.

## 2026-11-07 Excel再計算フラグの隔離検証

旧検証版は `xl/workbook.xml` の `forceFullCalc=1` を保持しており、
PC①で読み取り専用のExcelメモリ上だけ無効化した場合も
`CalculationState=2` のままだった。
Microsoftの仕様上、強制再計算モードはExcelセッション終了まで影響する
可能性があるため、その結果だけで根本原因の否定・確定はできない。

今回の検証ブランチでは、初回読込時の全数式計算要求
`fullCalcOnLoad=True` を維持したまま、毎回全数式を強制再計算する
`forceFullCalc` だけを `False` に変更した。
新規Excelインスタンスで既存52件・新規13境界件・GAS比較41件・
VBAUpdater隔離書戻しを再検証し、`xlPending` 状態変化をJSONに記録する。
正式リリース・GASデプロイはHOLDを維持。
