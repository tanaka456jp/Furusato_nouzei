> **旧受入手順の記録**。以下は履歴です。Excel v4.18.35の現行手順は[自動受入と正式配布](excel-v41835-automated-release.md)を参照してください。

# 正式配布を1サイクルで受け入れるためのローカル手順（2026-11-17）

対象：Excel Draft PR #5。元の正式版、main、本番GAS、実顧客ファイルを変更せず検証する。**GitHub Actionsが緑になっても、下記の実物証拠がない限り Release は HOLD。**

## 準備

1. [Draft PR #5](https://github.com/tanaka456jp/Furusato_nouzei/pull/5) の**現HEAD**、同じHEADのActions全5ジョブSUCCESS、署名前のレビュー用XLSM SHA256を確認する。古い実行結果を流用しない。
2. 本物の源泉徴収票、住宅ローン資料、印刷物、署名証明書、レビューの記録は **GitHub管理外**の社内承認フォルダに保管する。レビューに使用するExcelは匿名合成データのみを入れた専用コピーにする。
3. 社内承認フォルダの例：`C:\FurusatoPrivateReview\2026-11`（公開リポジトリの外）。**原本をGitHub、Actions、Issue、公開Artifactに添付しない。**

## 税額・適用年（税理士または外部税務レビューが必要）

**A. 年末調整済み同一年分：** `python tools/reconcile_salary_only_from_slip.py --input ...` により、原票のG04/G05/G06/G08、社会保険、生命・地震保険、扶養、配偶者等の条件を別途確認し、国税源泉額・住民税控除・所得割・ふるさと納税額を独立算定してExcelと比較する。住民税決定通知書は必須ではない。住宅ローン控除があるときはG29とG36を分け、源泉税額がゼロでも所得税の整合が取れれば源泉額自体は合格としてよい。

**B. 前年票から翌年を試算：** `python tools/audit_prior_year_projection.py --input ...` を用い、翌年の給与、社会保険料、扶養、住宅ローン控除可能額・適用数・入居年、寄附申告方法を**前年とは独立**に確認する。2025年票の2026年試算は確定値ではない。翌年の住民税通知書は使用しない。

**C. 確定申告と住宅ローン控除併用：** `tools/audit_mortgage_filing.py` とExcelの `住宅確申寄附検算`（内部検算シート）を別々に照合し、寄附前後の国税・復興税・住民税、住宅控除の国税適用額/住民税移行額、自己負担2,000円判定を検証する。初年度住宅ローン控除は原則確定申告が必要。自治体、住宅区分、申告分離課税、各種税額控除等が未検証ならHOLD。**合成テストのPASSだけでは実税務の承認にならない。**

## 実画面の3条件（Windows Excel 365）

以下を**同一SHA256の匿名合成XLSM**で検証。拡大率・解像度はPC管理者がWindowsの「システム→ディスプレイ」から手動で設定する。業務PCの解像度をCIやスクリプトから強制変更しない。

- 1920×1080、100%
- 1920×1080、125%
- 1366×768、150%

各条件で個別のプライベートフォルダを作り、対象Excelに個人情報がないことを担当者が確認したうえで次を実行する。ローカル補助は元ファイルのSHA-256を維持し、ランナー用の隔離一時領域に匿名コピーを作成して既存の表示検査を起動する。CIや非対話環境からは拒否する。実ディスプレイ設定は変更しない。

```powershell
.\tools\probe_display_layout_local.ps1 -Workbook "C:\FurusatoPrivateReview\2026-11\Synthetic.xlsm" -EvidenceDirectory "C:\FurusatoPrivateReview\2026-11\display_1920_100" -SyntheticDataReviewed
```

2、3条件目は `-EvidenceDirectory` を `display_1920_125` と `display_1366_150` に変える。各実行はシート部分のみの3画像と観測JSONを作る。Windows画面から得られた `EnumDisplaySettingsW` の表示モードおよびExcelのDPIを確認する。

```powershell
python tools/verify_release_display_matrix.py --workbook-sha256 "<同一XLSMの小文字64桁SHA256>" --folders "C:\FurusatoPrivateReview\2026-11\display_1920_100" "C:\FurusatoPrivateReview\2026-11\display_1920_125" "C:\FurusatoPrivateReview\2026-11\display_1366_150"
```

このコマンドの一致は**3環境での観測と画像の揃い**を示すだけ。担当者が入力欄、警告、翌年試算のD33/D34、文字切れ、スクロール、印刷用ボタンを目視し、各条件の画像に承認記録を付けるまではHOLD。

## 実プリンターへの出力

自動PDF監査とは別に、匿名合成案件でExcelの「計算根拠」表示と**印刷プレビュー**を開き、実プリンターの用紙へ出力する。A4用紙サイズ、改ページ、余白、文字と数字の欠け、税額、日付、再現性を人手で確認する。プレビュー、印刷した紙のスキャン、確認結果は社内プライベート領域に保存する。**仮想PDF出力やプレビューだけでは実プリンター条件を満たさない。**

### 実プリンターで1ページを安全に出力するローカル補助

PC①などExcelがインストールされている作業端末で、**匿名の合成XLSMであることを担当者が確認した後**、印刷先プリンターを実名で指定します。以下のスクリプトはGitHub Actionsから実行しません。

```powershell
.\tools\verify_physical_printer_local.ps1 -Workbook "C:\FurusatoPrivateReview\2026-11\Synthetic.xlsm" -ExpectedWorkbookSha256 "<合成XLSMのSHA256>" -ExpectedDisplayedLimitYen 109000 -ExpectedTaxYear 2026 -PrinterName "<物理プリンター名>" -EvidencePath "C:\FurusatoPrivateReview\2026-11\physical_paper_command.json" -SyntheticDataReviewed -AllowOnePagePrint
```

初回起動したExcelが指定プリンターを実際に選択していない場合は、**別の既定プリンターへ自動振替せず停止**します。その場合はWindowsでプリンター設定を確認し、Excelで指定プリンターを既定にしてから再実行します。検証用ブックは読み取り専用で開き、マクロを無効化します。**Excelの再計算が完了し、操作画面の状態が「正常」、対象所得年が `-ExpectedTaxYear` に一致し、限度額表示と計算根拠の限度額が `-ExpectedDisplayedLimitYen` に一致することを必須**とします。上の109,000円は例示用の架空ケースです。別の合成ケースを使うときは、そのケースの独立計算に基づく期待額を指定してください。画面に印刷プレビューを表示するため、A4縦・1ページに収める設定で、担当者が文字の縮小・ページ・余白・税額等を確認し、**プレビュー内の印刷ボタンを使用せずに閉じた後**、コンソールに `PRINT-ONE-PAGE` と正確に入力した場合に限り、指定プリンターへ1ページ・1部だけ出力指示します。それ以外の入力なら印刷しません。CIや対話操作のない環境からの印刷は拒否します。

実際に紙を受け取って文字切れ・改ページ・印刷品質・税額整合を確認した報告書と紙面のスキャンを**非公開フォルダ**に保存し、独立レビュー証拠として扱います。スクリプトが出力するJSONは印刷命令の成否のみで、`paper_physically_observed=false`、`paper_readability_reviewed=false`、`release_decision=HOLD` を維持します。プリンタースプーラーが命令を受けたことは紙面の実物確認に相当しません。

## Web/GAS版の別製品受入（Excel単体配布の必須項目ではない）

Web/GAS版の正式配布では、認証済みの**実際のGoogle Apps Script Webデプロイ**に対して匿名の独立テスト案件を用い、動いているデプロイID、実行日時、HTTP応答、税額・限度額の独立照合、変更権限と配信版の紐付けを確認する。GASのソースをローカルNode.jsで再実行した41ケース一致はこの条件の代わりにならない。現行本番GASへの書込み・再配信は、別途許可された変更のみ行う。この条件はWeb/GAS版のHOLD要因だが、GASランタイムを利用しないExcel版の9項目受入は妨げない。

### 既存のWeb版PRを用いた実GAS読取検証

Web版は別の [Draft PR #6](https://github.com/tanaka456jp/Furusato_nouzei/pull/6) で並行開発しており、**Excel PR #5の作業フォルダや本番GASを上書きしない**。既存の専用認証がある**別の隔離worktree**から、現HEAD・デプロイの固定版・所有者・認証スコープを確認したうえで、まず読取専用のリモート照合だけ実行する。

```powershell
node gas/scripts/check-live-ocr-readiness.cjs --verify-remote
```

このコマンドはPR #6の `gas/` ツールに存在する。既存の専用非公開GAS・所有者認証・ローカルレシートが存在しない場合、無理に成功扱いせずHOLDとする。追加の `--probe-only` は所有者端末の実ブラウザ到達確認、`--run-synthetic --ack-temporary-google-docs` は合成OCR向け一時的なGoogle文書の生成と削除を伴い得るため、別途所有者が対象と許可範囲を確認した場合に限定する。旧固定版やHousingERPなどの保護対象を変更しない。実GASへの到達証明だけでは**Excel版との同一ルール計算・寄附限度額の独立照合**を満たさないため、後者は別のレビュー記録で証明する。

## 正式版に使用する署名とハッシュ

- 公開用の **署名前・署名済みEXEのコード由来/署名者/証明書チェーンを管理者が照合**。自己署名テスト証明書や署名なしの `REVIEW_HOLD` ZIP を正式版とみなさない。
- 正規のコード署名証明書を社内の安全な環境に保管し、`FurusatoDocumentReader.exe` に信頼できるAuthenticode署名を適用したうえで**別の正式候補ZIPを再構築**。秘密鍵をGitHub Secretsに無断登録したり公開CIログに露出させない。
- 配布前に独立経路で控えた**公開候補ZIPのSHA-256**と署名者証明書のthumbprintを用い、社内Windows PowerShellで次の検査を実行する。スクリプトは署名を**検証するだけで付与しない**。

```powershell
.\tools\verify_signed_release_local.ps1 -Package "C:\FurusatoPrivateReview\2026-11\Furusato_Release_Candidate.zip" -ExpectedPackageSha256 "<64桁SHA256>" -ExpectedSignerThumbprint "<正規署名者のthumbprint>" -EvidencePath "C:\FurusatoPrivateReview\2026-11\signature_verification.json"
```

この検査は同梱EXEのAuthenticodeを確認すると同時に、XLSM内部の **VBAプロジェクトと署名コンテナーの存在を確認**します。署名コンテナーが存在しない配布候補は拒否します。ただし、署名コンテナーの存在は署名の真正性・有効性・VBAコードへの結び付きを証明しないため、Excelの**VBAプロジェクト署名の暗号学的検証までは完了しません**。マクロを署名配布する場合は、実際のOfficeでVBAプロジェクト署名の証明書・有効性・発行者を別途確認し、署名後のVBAソース変更がないことを証明してください。検査用ZIPに余分なファイルが含まれる場合も拒否します。コード署名・ハッシュ一致が成立しても税務・画面・印刷・実GASの最終承認を省略しない。

## Excel単体版9項目の社内オフライン受入マニフェスト

**作成するだけでは承認にならない。** 根拠となるプライベートの報告書を担当者が確認した後、その報告書のSHA-256と担当者区分のみ記録する。氏名・住所・源泉徴収金額・フォルダパスなどはマニフェストに一切記載しない。

```powershell
python tools/collect_local_release_evidence.py create --head "<Draft PR #5 の現HEAD SHA40桁>" --manifest "C:\FurusatoPrivateReview\2026-11\acceptance_manifest.json"
python tools/collect_local_release_evidence.py record --manifest "C:\FurusatoPrivateReview\2026-11\acceptance_manifest.json" --gate mortgage_filing_independent_tax_difference --evidence "C:\FurusatoPrivateReview\2026-11\mortgage_reviewer_report.pdf" --reviewer-role tax_professional --explicitly-reviewed
python tools/collect_local_release_evidence.py check --manifest "C:\FurusatoPrivateReview\2026-11\acceptance_manifest.json" --head "<Draft PR #5 の現HEAD SHA40桁>"
```

`record` は各証拠項目に対して必要回数だけ実行する。許可されないレビュアー区分、証拠ファイル欠落、同一項目への重複記録、GitHub内ファイル、現在のHEADと不一致の証拠を拒否する。**全9項目が記録されても `release_decision=HOLD` とし、権限ある人間による最終承認と実物の再照合を必要とする。** マニフェストはリポジトリや公開CIに追加しない。

正式リリースのブランチ統合・タグ発行・公開・本番GAS更新は、このExcel版9項目を実物で承認した後の独立したリリース工程に限定する。

署名確認の一次資料：[Microsoft Support・VBAマクロプロジェクトにデジタル署名する](https://support.microsoft.com/ja-jp/office/vba/digitally-sign-your-vba-macro-project)、[Microsoft Learn・ブック署名とマクロコード署名の違い](https://learn.microsoft.com/ja-jp/troubleshoot/microsoft-365-apps/excel/digital-signatures-code-signing)。


## 自動CI完走証拠について（正式承認ではない）

最新版の検証ZIP Artifactには `ci_exact_head_acceptance_hold.json` が同梱され、該当するPR HEAD/Run、静的・Windows・Excel・読取4ジョブ、ZIPと各バイナリのSHA-256を確定できる。 `ci_exact_head_gate=PASS` はソフトの自動検査範囲の記録に過ぎず、これを税理士の実原票レビューや署名済み正式配布物、実画面・実印刷等の外部受入と取り違えない。


## 次期Excel版の署名済み候補：公開前の固定手順

`tools/verify_signed_release_local.ps1` を使用し、独立記録済みZIP SHA256、EXE Authenticode、署名者証明書、VBA署名構造を検査する。実際のExcel/VBEにおけるVBA署名の暗号学的真正性、署名後コード不変を人手で確認し、非公開の署名審査報告書を `signed_distribution_and_sha256` として登録する。秘密鍵を新規生成・公開・登録しない。

```powershell
python tools/verify_excel_release_candidate.py --head "<PR #5の現HEAD>" --run-id <同一HEADの5/5 SUCCESS Run ID> --version v4.18.35 --archive "<署名済み候補ZIP>" --expected-archive-sha256 "<独立記録した64桁SHA256>" --ci-receipt "<ci_exact_head_acceptance_hold.json>" --manifest "<非公開9項目マニフェスト>" --signature-evidence "<ローカル署名検査JSON>" --output "<非公開候補照合JSON>"
```

候補照合は `candidate_gate=METADATA_AND_ARCHIVE_CHECKED`、`release_decision=HOLD` まで。税務・実画面・実紙面・Office/VBE署名・公開権限と公開直前のハッシュ再照合を権限ある担当者が最終承認する必要がある。正式版v4.18.2用公開workflowを次期版へ転用せず、未署名REVIEW_HOLD ZIPをReleaseへ掲載しない。
