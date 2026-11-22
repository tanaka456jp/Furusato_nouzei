# Excel v4.18.36 正式配布基準（2026-11-22 改訂）

この文書は次期Excel版の現行受入基準です。正式版v4.18.35、main、本番GAS/Webは変更しません。VBAおよびEXEのコード署名は任意ですが、署名状態は開示します。

## 正式配布要件から除外（2026-11-22）

- **人間による実紙印刷、紙面を見た人による承認は必須ではありません。** ExcelからのA4合成PDF作成、ページ数、レイアウト、金額照合は引き続き自動実機試験で必須です。実紙印刷スクリプトは希望者向けの任意補助として残します。
- **税務専門家・外部担当者の独立レビューは必須ではありません。** ただし、2025/2026年の給与所得・基礎控除、所得税・住民税、家族／保険料控除、住宅ローン控除／申告方式、ふるさと納税上限について、既存の独立した**自動検算と回帰テスト**を維持します。本人の不明条件は引き続き限度額を安全停止（HOLD）します。
- 人の最終**公開権限による発行承認**は、専門家の独立税務レビューと別です。どのコミット・どのアーカイブを公開するかに対する明示的な発行者の認証は維持します。

## 正式配布の技術要件

1. 同一HEAD・同一GitHub Actionsの `static`、`windows_compat`、`document_reader`、`excel`、`ready_to_use_review` が全5ジョブSUCCESS。
2. PC① Excel 365でVBEコンパイル、2025/2026年の独立自動税額検算、前年原票の翌年試算条件、5人一覧、安全停止、読取EXE起動と再計算、税制更新・復元、VBAUpdater隔離書戻しを完了。
3. ZIP内のXLSM/EXE/README/第三者ライセンスと発行HEAD・同一RunのSHA-256一致。未署名は`UNSIGNED`と表示し、署名を主張する場合のみOffice SIP/Authenticode等の真正性を検証。
4. Windows Excelの画面3条件（1920×1080・100%、1920×1080・125%、1366×768・150%）を記録して文字の欠け・表示重なり・操作可能性を確認。CIが自動測定する1920×1080・125%だけで他の2条件を推測しない。
5. A4合成PDFの5ページとExcelの金額表示を自動検証。**実紙印刷は任意**。
6. 権限ある発行者による、公開するv4.18.36のHEAD・ZIP SHA-256を特定した最終承認と、安全なGitHub公開経路。

## 非公開の配布候補README生成（正式公開操作ではない）

現在の次期版用の版数を必ず明示してください。これはレビュー用コマンド例であり公開処理ではありません。

```powershell
python tools/make_excel_release_readme.py --version v4.18.36 --head <PR_HEAD_SHA> --output "<非公開フォルダ>/README.txt"
```

## 非公開スコープマニフェスト

形式は `furusato-release-readiness/v6`。必須記録は次の5キーだけです：
`ci_exact_commit`、`screen_1920x1080_100pct`、`screen_1920x1080_125pct`、`screen_1366x768_150pct`、`distribution_integrity_and_sha256`。

旧v5の「給与源泉票の独立税務レビュー」「前年→翌年の独立税務レビュー」「住宅ローンと確定申告の独立税務レビュー」「物理紙面印刷」の4キーは正式配布の必須条件から除きました。旧v5マニフェストの流用は拒否します。スコープの記録自体は公開承認を意味しません。

## 未検証の2画面条件をローカル採取する手順（合成データのみ）

同じCI Runで合格した配布ZIPから **合成データのXLSM** を私的作業フォルダへ展開し、Windows画面を操作者が所定モードに設定してから次を実行します。**実際の顧客データ・源泉徴収票を含むブックを使用しないでください。** このスクリプトは画面解像度や拡大率を変更しません。

```powershell
$head = '<合格したPRの40桁HEAD>'
$book = '<同一RunのZIPから展開した合成Furusato_nouzei.xlsmの絶対パス>'
# 画面を 1920×1080・100% に設定した状態で実行
.\tools\probe_display_layout_local.ps1 -Workbook $book -SourceHead $head -ExpectedMode '1920x1080@100' -EvidenceDirectory '<非公開フォルダ>\screen-100' -SyntheticDataReviewed
# 画面を 1366×768・150% に設定した状態で、別フォルダへ採取
.\tools\probe_display_layout_local.ps1 -Workbook $book -SourceHead $head -ExpectedMode '1366x768@150' -EvidenceDirectory '<非公開フォルダ>\screen-150' -SyntheticDataReviewed
```

`-SourceHead` は記録に必要で、省略すると従来の採取器の `source_head` が空欄になり、正式受入できません。各記録の実測モード、HEAD、XLSMのSHA-256を採取時にも検査します。CI上での操作やWindowsの保護機能変更は拒否します。元ファイルは変更せず、スクリーンショットはGitHubにアップロードしません。

両フォルダを `tools/verify_release_display_matrix.py` に渡し、CIの125%受入と同じHEAD・XLSMハッシュの証跡をローカル照合してください。単なる自己申告・OSの推定画素では合格にしません。`physical_resolution_verified=false` はパネル固有の物理解像度を認定した意味ではありません。

## 安全なローカル公開手順（全5ジョブSUCCESSかつ発行者の明示承認が必要）

次の例は**動作検証のための構成例であり、実際に公開済みであることを意味しません**。コード修正後の最新HEADのCIに生成されたZIPと、同一XLSM/HEADで採取した2画面の証拠が必要です。v6マニフェストの5項目はすべて記録し、旧9項目は要求しません。

```powershell
python tools/publish_excel_release.py --head <最新HEAD40桁> --run-id <同一HEADの成功Run番号> --output "<非公開の新規出力フォルダ>" --display-100 "<screen-100フォルダ>" --display-150 "<screen-150フォルダ>" --manifest-v6 "<非公開のv6マニフェスト.json>"
```

上記は**候補検証のみ**で、公開しません。最終発行者による公開操作では、新しい出力フォルダを指定し、同じ引数へ `--publish` を追加してください。GitHub CLIのログイン権限と実際の対話端末を確認し、バージョン、HEAD、ZIP SHA-256、確認語句を手入力して一致した場合のみGitHubへの書込みへ進みます。入力ファイルは非公開フォルダに保管し、発行秘密鍵・承認記録をGitHub公開CIに送信しません。

## 現在の公開状態

2026年11月22日までに、旧HEAD `706212d42e954c82ae5f23c347e05303dd7b43d3` の [Run #44969615866](https://github.com/tanaka456jp/Furusato_nouzei/actions/runs/44969615866) は5/5 SUCCESSでした。**配布要件を修正した新HEADでは、改めて同一HEADの自動受入が必要**です。

残りの2画面条件や発行者の最終承認が未確認の間は正式公開をHOLDとします。`tools/publish_excel_release.py` は同一Runの5ジョブ、ZIP、追加の2画面証跡、非公開v6マニフェストを照合し、ローカルの対話型GitHub認証（maintain/admin権限）とバージョン・HEAD・ZIP SHA-256の明示入力が揃った場合だけ公開処理へ進む設計です。CIや非対話環境では拒否し、秘密鍵・最終承認内容・プライベート画面キャプチャをCIに送信しません。実際の最終承認は未実施です。v4.18.36の正式タグ未発行、v4.18.36-rc.1/rc.2は旧コミットのプレリリースです。v4.18.35は変更しません。

税額・機能の対応範囲は [税務照合範囲](excel-v41836-tax-scope.md) を参照。実顧客PDF、氏名、住所、金額、秘密鍵、非公開証跡をGitHub/CIへ送信しません。
