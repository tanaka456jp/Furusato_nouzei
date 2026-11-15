# 次期正式版：実証証跡・配布判定（2026-11-16）

現行のExcel Draft PR #5のCI 4/4 SUCCESSと、実際の課税・表示・配布の完全な受入証拠は区別します。**本マニフェストに記入しても自動リリースは行われません。**

`python tools/release_readiness.py --head <HEADの40文字SHA> --output release_readiness_hold.json` で、実データや氏名を送信せずに未完了条件を列挙できます。CIは証拠未提出として常に `release_decision=HOLD` のレポートを出力し、Artifactに添付します。個人情報や顧客原票はGitHub/CIにアップロードしないでください。

## 正式受入までに必要な8条件

| 証拠の種類 | 内容 |
|---|---|
| `ci_exact_commit` | 出荷する正確なSHAで静的/Windows/Reader/PC① Excelの全ジョブPASS、ブックSHA256整合 |
| `real_tax_and_resident_notice_reconciliation` | 匿名化した実税務資料と同一年度の住民税額、限度額の独立計算と差分理由 |
| `screen_1920x1080_100pct` | 1920×1080・100%の実Windows画面 |
| `screen_1920x1080_125pct` | 1920×1080・125%の実Windows画面 |
| `screen_1366x768_150pct` | 1366×768・150%の実Windows画面 |
| `physical_printer_preview_and_output` | 印刷プレビューと実プリンタの紙面出力 |
| `live_google_gas_independent_acceptance` | 実Google GAS環境での独立受入（合成41ケースのJavaScript比較とは別） |
| `signed_distribution_and_sha256` | 次期版の署名済み配布物とSHA256、公開物の改ざん防止検証 |

外部保管したレビュー済証拠を整理する場合だけ、`--manifest <ローカルJSON>`を用います。形式は `schema: furusato-release-readiness/v1`、`head_sha`、上記8キーを持つ `checks` で、各キーは `{"status":"REVIEWED","sha256":"64桁小文字hex","reviewer_role":"tax_professional","head_sha":"同じHEADの40桁SHA"}` です。役割欄は用途に応じた `qa_operator`、`release_operator`、`external_reviewer` も可能。**本人の氏名・住所・税額・証拠そのものは書かないこと。**

この形式だけでは証拠の真正性は立証されないため、全ての欄を記入しても結果は `MANUAL_FINAL_AUDIT_REQUIRED`／`HOLD` に留まります。別途、真正な現物、法令、署名者、同年度税額とリリース承認を確認してください。既存の正式v4.18.2、main、本番GAS、Web PR #6には影響させません。
