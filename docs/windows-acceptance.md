# Windows Excel実機受入手順（現行 Draft PR #5／旧PR #1の履歴を含む）

## 現行受入状況（2026年11月8日現在）

この文書の下部はv4.1〜v4.9の**当時の開発履歴**です。
「実機未実行」「runner未登録」「PR #1」などの記述を現在の判定と
誤読しないでください。現行ソース・検証対象は
[Draft PR #5](https://github.com/tanaka456jp/Furusato_nouzei/pull/5)です。

- 検証済みの例：v4.18.25 [GitHub Actions #42438917733](https://github.com/tanaka456jp/Furusato_nouzei/actions/runs/42438917733) は
  `static / windows_compat / document_reader / excel` 全4ジョブSUCCESS。
  PC①で税額機能、52基準ケース、分離課税70ケース、PDF電子印刷、
  VBAUpdater隔離書戻し、Excel/GAS合成41ケース数値照合を実行。
- 後続の版は必ず**対応するSHAのGitHub Actionsを確認**してください。
  古い版のPASSを新しい版の実機PASSとして流用しません。
- 現在の正式販売・本番配布判定は**HOLD**。合成データでの合格と、
  実顧客の税額・匿名化原票・自治体通知書による照合は区別します。
- 未解消項目：実際のプリンタによる印刷・印刷プレビュー、
  Windows 1920×1080（100%/125%）および1366×768（150%）の
  実デスクトップ表示、顧客情報を含まない実税務資料による独立突合、
  GASの独立実Google再受入、署名済み最終配布。
  PDFのPNGは実Windows画面のスクリーンショットではありません。
- main、本番GAS、既存正式版にはDraft PRの修正を自動展開しません。

---

## v4.1当時の受入メモ（以下は履歴）

**当時の状態：実機未実行。正式判定はHOLD。**

## CIで自動化した項目

- 静的テスト合格時に `Furusato_nouzei_v4_REVIEW.zip` をActions Artifactsへ保存。
- Windows Excel受入成功時に限り、マクロ付き `Furusato_nouzei.xlsm` を検証用Artifactとして保存（正式版ではありません）。
- Windows受入スクリプトはリポジトリから生成した検証用コピーにのみ操作し、利用者の実案件にはアクセスしません。
- 実行に失敗した場合、`setup.log` と `setup_launcher.log` をArtifactへ保存。作業用の一時フォルダは検証後に削除。

## 専用runnerの準備

1. Windows 11 / Excel 365が利用できる**専用の検証用PC**にself-hosted runnerを登録。
2. runnerを**このリポジトリに登録**し、標準の `self-hosted`・`Windows` に加えて `furusato-excel` ラベルを付ける。`tools/register_shared_pc_runner.ps1` は新しいフォルダを使用してこの登録を支援する。
3. ローカルにPython 3.11以上を準備し、Excelを対話型ログオン可能なユーザーコンテキストで使用。
4. VBAプロジェクトへのアクセス設定は**専用ビルドユーザーに限定**して許可。組織のポリシーで禁止されている場合は回避せずHOLDとする。
5. 業務用データや他案件を操作しない独立した実行環境を使用。

## 起動方法（Draft PRをmainへマージする必要はありません）

同一リポジトリのブランチから提出されたDraft PR #1の本文に、実機受入を許可するときだけ次の文字列を追記し、PR本文を保存してください。

`[run-windows-excel]`

GitHub Actionsの `pull_request.edited` でWindowsジョブを開始します。**外部フォークから提出されたPRは起動できない条件**です。ジョブを再実行したくない場合はこの文字列をPR本文から削除します。

※専用runnerが登録されていない場合はジョブが待機し、PASSにはなりません。

## Windowsジョブで照合する内容

- XLSX → XLSMの初回生成、VBA組込み、ボタン紐づけ
- Excelでの52件の回帰計算
- 合成データ（所得年2025/2026）での所得割374,500円・寄附目安109,000円
- GitHubの承認済税制に対する**実際の更新処理**（通信必須）
- 2027年の更新拒否、および適用年・更新状態を維持すること
- 更新前バックアップ生成、保存・再起動・入力データ保持
- 計算根拠のPDF生成、詳細シートを閉じた際の非表示

## 自動化できていない受入条件

- 実際のプリンタに対する印刷・プレビューの操作確認
- Windows 1920×1080 100%、1920×1080 125%、1366×768 150%の実表示スクリーンショット
- 匿名化した実際の源泉徴収票と住民税通知書の金額突合
- 署名済みの完成版（現在のアップロードは検証用で署名なし）
- 2027年以降の承認済マスタ追加配信

これらが終わるまで製品の正式受入はHOLD。合成データの成功を実額の正確性と混同しないこと。


## v4.3 追加した受入チェック（2026-11-05）

- `tools/setup.ps1` で `VBComponents.Import` を廃止し、UTF-8のVBAコードを `CodeModule.AddFromString` へUnicodeのまま受け渡す。WindowsシステムのANSIコードページに依存しない。
- 初回生成時に `RecalculateCase` マクロを実行し、VBAが動作することを保存前に確認する。構造検査だけではPASSとしない。
- `tools/test_setup_contract.py` でZIPが平坦なASCII名であること、取り込み用のVBA/PowerShellがソースと一致すること、文字コード変換方式・マクロ実行検査を静的チェックする。
- `SaveCase` と実機テストに共通の `SaveCaseToFile` を使用。実機テストでは保存コピー作成、再読込、入力値・計算結果・更新ボタン保持、既存案件上書き拒否を確認する。
- **実機受入を実行できた場合に限り**上記のPASS/FAILを記録する。静的CI成功はマクロ受入完了を意味しない。

### 現在のブロッカー

受入ジョブは `self-hosted / Windows / furusato-excel` を要求します。ほかのリポジトリで動いているWindows runnerを停止・流用せず、同じPCの**別フォルダ**にFurusato_nouzei用登録を追加してください。


## v4.4：案件を複数同時に開く場合のマクロ誤実行防止（2026-11-05）

- 従来のボタン `OnAction = TaxLawUpdater.処理名` はブック名で限定されておらず、複数の顧客案件ブックを同時に開いたときに別ブックのマクロを起動するおそれがありました。
- 新たに `TaxLawUpdater.BindButtons` を実装し、すべてのフォームボタンの `OnAction` を `'現在のブック名.xlsm'!TaxLawUpdater.処理名` と明示的に限定します。ファイル名にアポストロフィがある場合も正しくエスケープします。
- `Workbook_Open` で再割り当てするため、案件保存後に別のファイル名で開いても、その案件ブック自身を操作します。
- Windows実機テストは `FurusatoQA.xlsm` と `case_preservation.xlsm` を別々に開き、更新ボタンとPDF出力ボタンの割当先が各ブックの名前と一致することを確認します。
- **静的検査は実行コードの存在確認に過ぎず、Excelで複数ブックを開いた際の実動作判定はWindows受入待ちです。**


## v4.5：案件保存の不完全ファイル防止（2026-11-05）

- 保存先へ直接書き込まず、**同一フォルダ内の一時 .xlsm** を作成し、20KB以上のファイルが生成されたことを確認してから完成名に移動します。
- 既存の案件ファイルを上書きしないルールを維持。失敗時に一時ファイルが残らないよう削除します。ネットワーク先などの例外では、移動処理が失敗した場合も不完全な完成名を利用者に渡しません。
- Windowsの専用受入テストに、既存案件の上書き拒否前後でSHA-256が同一であること、および保存後に一時ファイルが残らないことを確認する検証を追加。
- 画面が複数ブックにまたがる場合のマクロ取り違え防止と、案件保存は別の保護事項です。両方のテストが実機でPASSするまで正式受入を保留します。

## v4.6: 年度ロールバック・PDF出力の実機受入（2026-11-05）

- 税制更新が**マスタを書き換えた後に失敗**した場合、内部の適用年とともに操作画面の選択年（B4）も更新前の年分に戻し、ブックへ保存する。
- PDF出力はVBAの `ExportDetailsToFile` を使って検証する。Excelから直接 `ExportAsFixedFormat` を呼ぶだけのテストでは「PDF出力」ボタンの実装不具合を捕捉できない。
- 正常な出力で先頭5バイトが `%PDF-` であることを検証。既存PDFへの再出力は拒否し、前後のSHA-256が一致することを確認する。
- 処理前に計算根拠が非表示だった場合、PDF出力後も非表示に戻す。既に表示していた場合は表示状態を維持する。
- 不完全なPDF一時ファイルが保存先に残らないことを確認する。
- 利用者向けの「印刷」ボタンは現時点では**Excelの印刷プレビューを開く操作**であり、直接印刷ではないためボタン名を「印刷プレビュー」に変更。
- これらの受入試験はコードへ追加済み。ただしWindows Excelの実機ジョブがPENDINGの間、PASSと報告しない。


## 既存PC①にFurusato_nouzei専用runnerを追加する方法

既存のBankStatementJournalConverter / FXAutoTrader等のrunnerサービスや設定は変更・停止しません。**別フォルダ・別runnerとして**追加します。

1. [Furusato_nouzei の Settings → Actions → Runners](https://github.com/tanaka456jp/Furusato_nouzei/settings/actions/runners)を開き、`New self-hosted runner` → `Windows` → `x64` を選択。
2. PC①の検証専用ユーザーでWindows PowerShellを開く。例：`C:\gh-runners\Furusato_nouzei` を新しい空のフォルダとして使う。ほかのrunnerのフォルダを流用しない。
3. **GitHub画面が提示するWindows用コマンド**に従ってrunner本体を取得・展開する。画面に提示された登録トークンをチャット、CIログ、リポジトリに貼り付けない。トークンは短時間で失効する。
4. GitHub画面の `config.cmd --url https://github.com/tanaka456jp/Furusato_nouzei --token ...` を新しいrunnerフォルダで実行。runner名は例 `PC1-Furusato-Excel` とする。標準ラベル `self-hosted` / `Windows` を残す。
5. Excel 365を使える**対話型ユーザーのセッション**で `run.cmd` を実行。Excel COMが動かない場合に、業務PCの既存Excelプロセスを強制終了しない。
6. GitHubのrunner一覧に `Idle` と表示されたら、[Draft PR #1のActions](https://github.com/tanaka456jp/Furusato_nouzei/actions) で最新の `Workbook checks` のWindowsジョブを実行または再実行する。PR本文には既に `[run-windows-excel]` が設定済み。

リポジトリにrunnerが割り当てられていない状態では、`runs-on` のラベルを変えるだけでは実行されません。実機ジョブが開始したときに初めてExcelマクロのPASS/FAILを判定できます。


## 共有PCでの最小作業（2026-11-05更新）

PC①を優先し、PC①に問題がある場合のみPC②を登録・起動します。1台のPCの中で、ほかのリポジトリのrunnerとFurusato_nouzei用runnerを並行運用できます。**厳密なGitHubジョブの優先順指定ではなく、通常PC①だけ起動し、障害時PC②を起動する運用**です。

1. [このリポジトリのrunner設定](https://github.com/tanaka456jp/Furusato_nouzei/settings/actions/runners)から `New self-hosted runner` → `Windows` → `x64` を開く。
2. GitHubの公式Windows runner ZIPをPC①へダウンロードし、公式のSHA-256が提示されていれば照合する。
3. PC①でこのPRの作業コピーを開き、以下を実行する（ZIPパスは実際の保存先へ変更）。**登録トークンはコマンド引数やチャットに書かず、表示されたプロンプトへ入力**する。

```powershell
powershell.exe -NoProfile -File .\tools\register_shared_pc_runner.ps1 -Role PC1 -RunnerZip "C:\Downloads\actions-runner-win-x64.zip" -StartNow
```

4. PC①が利用できない場合、PC②で `-Role PC2` を指定して同じ操作を実施する。既存runnerのフォルダは一切変更しない。

追加したrunnerの名前は `<PC名>-Furusato-PC1` または `<PC名>-Furusato-PC2`、追加ラベルは `furusato-excel` および `pc1` / `pc2` とする。既定の `self-hosted`、`Windows` ラベルも維持する。サービス登録やOS設定の変更は行わず、ログオン中の検証用ユーザーで `run.cmd` を実行する。

**留意事項：** ExcelのCOM動作には対話型ユーザーセッションが必要な場合がある。VBAプロジェクト操作の許可が管理ポリシーで禁止されている場合は無理に回避しない。既存顧客データや他開発の実行中Excelは終了しない。資格情報や登録トークンはGitHubへ保存・報告しない。

登録前は、CIの `excel` ジョブが `queued` のままになっても正常な待機であり、実機PASSを意味しません。

## v4.8: 公開リポジトリでのGitHub-hosted Windows互換性検証（2026-11-05）

この公開リポジトリでは、**GitHub-hosted `windows-2022` をPRごとに自動実行**します。self-hosted runnerがオフラインでも、このジョブは別に進行します。

`windows_compat` ジョブは次を確認します。

- Windows上のPython 3.11で検証用ブックとZIPを再生成し、既存の静的契約テストを実行
- Windows PowerShell 5.1でsetup/Excel受入/runner登録/Windows検証の各スクリプトを構文解析
- 日本語を含むフォルダ名にZIPを展開し、5ファイルの存在・配布ソースのSHA-256を確認
- ASCII安全な初回実行CMD、UTF-8 VBA、日本語文字の取扱い、XLSXの主要OOXML構造を確認
- 日本語文字を含むPowerShell 5.1ファイルはUTF-8 **BOM必須**。初回CIでBOM欠落による文字化けを発見し、修復後のWindowsジョブでPASSを確認

**実施した検証：** [GitHub Actions #41998559266](https://github.com/tanaka456jp/Furusato_nouzei/actions/runs/41998559266) — `static` PASS / `windows_compat` PASS（実際のGitHub-hosted Windows Server 2022で実行）。

**実施していない検証：** GitHub-hosted WindowsにMicrosoft Excelデスクトップはないため、VBAコンパイル、Excel COMによる52件実再計算、実際の税制更新ボタン、案件保存復元、印刷、PDF出力、実画面3条件は確認できない。これらは引き続き `self-hosted / Windows / furusato-excel` で検証する。

GitHub-hostedでの成功と、完成版.xlsmの正式受入を混同しない。Excel実機ジョブはrunner待機中、正式判定HOLDを維持する。


## v4.9：通常CIとExcel実機受入の運用分離・検証証跡（2026-11-05）

- `main` は税制カタログのみで、現行WorkflowはDraft PRブランチに存在しています。そのため現段階では手動 `workflow_dispatch` に依存せず、PR本文の明示的な許可文字列でExcel受入を有効化する方式を維持します。
- PC①/PC②のFurusato用runnerがまだ未登録の間、PR本文から実機受入の許可文字列を外して、通常の`static`と`windows_compat`を完了させます。runnerを登録・起動してから、PR本文に指定の許可文字列を追加して実機ジョブを起動します。
- Excel受入スクリプトでは、年度更新に失敗した後の**操作画面の選択年**も検証し、Excelを閉じた後の再起動でも復旧が保持されることを確認します。
- Excel COMの解放処理を保護し、受入テスト失敗時にも専用Excelインスタンスの終了処理を試みます。既存の他業務Excelインスタンスを強制終了しません。
- `verify_excel.ps1 -EvidencePath <path>` を指定すると、受入終了時に`excel_acceptance.json`を出力します。内容はPASS/FAIL、検証対象ブックのSHA-256、Excelバージョン、実施した検査の種類、対象外条件、開始・終了UTC日時です。PC名、利用者名、機密顧客データ、登録トークンは含めません。
- 実機ジョブはJSONの状態が**PASS**であり、検証対象SHA-256が記録されている場合だけ、検証用XLSMとJSONをArtifactへアップロードします。FAIL時は可能な限りJSONを診断用Artifactへ保存します。**これらの証跡は実機ジョブが実行されてから生成されます。**
