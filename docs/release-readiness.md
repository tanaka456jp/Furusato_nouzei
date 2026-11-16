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


### PC①実ディスプレイ出力モードの証拠を改善（2026-11-16）

従来の `System.Windows.Forms.Screen.Bounds` にはWindows DPI仮想化による座標倍率が含まれることがあり、画面が1920×1080に見えても、実際の出力解像度と断定できません。隔離された合成Excel画面を撮影する `tools/probe_display_layout.ps1` に、Windows `EnumDisplaySettingsW`（現在のディスプレイ出力モード）と `GetDpiForWindow`（ExcelウインドウのDPI）の独立測定を追加しました。

証拠JSONの `display_observation.current_mode_pixels` はWindowsから報告された**現在の出力ピクセル数**であり、パネル固有のネイティブ解像度や紙面の可読性を保証するものではありません。 `scenario_observed_not_certified` は対象3シナリオのいずれかの観測に成功したときだけ付与。スクリーンショットの目視確認および1920×1080 100/125%、1366×768 150%の各設定での実機検証が完了するまで、`physical_resolution_verified=false` と `release_approved=false` を維持します。CIで勝手にWindowsの解像度・拡大率を変更せず、個人のデスクトップ全体や実顧客データも撮影しません。


### Windows配布ZIPの完全性・EXE署名を分離した自動監査

`tools/verify_distribution_integrity.py` を追加。実際にWindowsで作成した **Python不要の検証ZIP** に対し、ZIP内の全6ファイルの構成・重複・パストラバーサル/シンボリックリンク・CRC・SHA256・展開サイズを検査し、ファイル名とSHA256だけの匿名メタデータを保存します。入力元ファイルは実行しません。 `--expected-sha256` を指定すると、事前に配布者が控えたZIPのSHA256との完全一致も要求できます。GitHub-hosted Windowsでは個人情報を含まない合成パッケージを用いて正常系と改ざん・欠落・重複ケースを自動検査します。

Windowsジョブで `Get-AuthenticodeSignature` を使用して同梱の `FurusatoDocumentReader.exe` が信頼できる証明書で署名されているかを**別途**確認し、その結果を `distribution_signature_hold.json` に記録します。署名者の識別情報・秘密鍵・実顧客資料はGitHubへ送信しません。ZIPのハッシュ一致も署名の代用ではありません。配布ZIP本体の署名または外部署名・証明書の安全な管理・最終人手承認が完了するまで、CIが全ジョブSUCCESSでも `release_decision=HOLD` のままです。


### セットアップ不要の「ReadyToUse」検証ZIPを合成成果物だけで組み立てる

正式v4.18.2には `ReadyToUse.zip` があるため、次期版も同じ提供方式を維持します。 `ready_to_use_review` ジョブが、**同一GitHub Actions Run** の「PC① Excel/VBAUpdater/GAS受入済みXLSM」「Windows読取EXE」だけを取得し、XLSMのSHA256がExcel実機受入レポートと一致する場合に限り `Furusato_nouzei_ReadyToUse_REVIEW_HOLD.zip` を作成します。ZIP内には元バイトのXLSM、読取EXE、ユーザーガイド、`NOT_FOR_PUBLIC_RELEASE.txt` を含めます。検証用ZIPのSHA256・各EXE/XLSMのSHA256を匿名JSONに記録。再構築によるバイナリ内容改変をせず、古い別Run成果物を混ぜません。

**このZIPは検証専用です。** コード署名・実税務・画面3条件・紙面印刷・live GAS・最終承認の代わりにはならず、正式Releaseや既存v4.18.2への上書きは行いません。テストには架空のバイト列だけを使い、実顧客書類はCIへ送信しません。
