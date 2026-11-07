# Furusato_nouzei GAS v0.1.11 — 開発・検証版 / 正式リリースHOLD

Excel正式版v4.18.2とは独立した、Apps Script HTML Serviceの5ステップ試算画面です。
Draft PR #2を維持し、mainのExcel正式版とHousingERPの本番運用を変更しません。

## 導入・非公開デプロイ

**[専用導入手順](deployment/README.md)** を使用します。従来の既存シート指定・既存Script ID採用・手動上書きの手順は廃止しました。
デフォルト実行はオフラインの読取専用検査です。

```powershell
npm ci --prefix gas --ignore-scripts --no-audit --no-fund
powershell -NoProfile -File gas/scripts/setup-private-gas.ps1
powershell -NoProfile -File gas/scripts/setup-private-gas.ps1 -Login
# 所有者がブラウザでFurusato専用のGoogle認証を完了
powershell -NoProfile -File gas/scripts/setup-private-gas.ps1 -CreateProject -PushSource -DeployPrivate -ProtectedRoot ../HousingERP
```

新規の合成データ専用シート/GASだけを作成し、HousingERPのScript/Sheet IDとの衝突、
Google側の所有者・親ID・共有範囲・登録コードを照合します。`MYSELF / USER_DEPLOYING` は
ソースmanifest、immutable version、実際のdeployment entryPointの3段階で検査します。
認証・個別ID・実Google証跡は `.private/furusato/` に置き、GitHubへ登録しません。
既存のグローバルclasp認証やHousingERPの設定・業務データには書き込みません。

## 対応範囲

- 基本情報→所得→控除→入力確認→結果/計算根拠のWeb UI。
- 2025/2026年の単一給与所得・給与850万円以下・扶養/配偶者/保険料控除/住宅ローン/追加所得なしの限定概算。
- 給与660万円未満の年末調整表の端数処理、令和8年分の220万円未満の特殊区分、基礎控除、税率判定。
- 「詳細設定・申告分離課税」で、2025/2026年の通常税率の土地・株式・先物を試算。税目別の控除配分・寄附前後の税額と、千円刻みの寄附目安を表示。対応条件と停止後の操作は[根拠・検証範囲](../taxdata/SEPARATE_TAX_AUDIT.md)を参照。
- 合成参照例：2026年、給与700万円・社保100万円→寄附限度額概算109,000円。
- 対応対象外、原票未照合、年度や原票数値の矛盾、読取警告はHOLD。`APPROVED` は返しません。
- JSON/TSV仮取込。読取結果がREADYでも利用者の原票照合が必要。読取で検出した扶養等はチェック解除で回避できません。
- 2MB以内のPDF/PNG/JPEGを明示同意後にDriveの一時Google文書へ変換してOCR。本文・氏名等は返さず、一時文書は削除を試行。失敗時はHOLDと手動確認警告。
- OCRは常にREQUIRES_REVIEW。候補値を自動承認せず、照合して手入力し直すまで計算停止。
- 計算根拠とHOLD理由をブラウザで印刷/PDF出力。入力値・原票・税額をシートへ自動保存しません。

Google Advanced Drive v3と `spreadsheets.currentonly / drive.file / documents` が必要です。
実源泉徴収票を試験に使用しません。参照シート作成関数は明示実行時だけ動き、導入処理では呼びません。
税務実務・販売・申告用の正式受入、全税制ケースのExcel一致、自治体差、実物印刷は未完了です。

## 回帰試験

```powershell
node gas/tests/test-contract.cjs
node gas/tests/test-engine.cjs
node gas/tests/test-parity.cjs
node gas/tests/test-ocr.cjs
node gas/tests/test-deployment.cjs
node gas/tests/test-browser.cjs
node gas/scripts/build-preview.cjs
node gas/tests/test-preview.cjs
$env:FURUSATO_BROWSER_CHANNEL='msedge'
node gas/tests/test-real-browser.cjs
# 実Google非公開デプロイ・所有者のWebアプリ認可が済んだ環境だけ
node gas/tests/test-real-browser.cjs --live --headed
# 所有者の初回認可後、既存認証によるヘッドレス実Google試験
node gas/tests/test-real-browser.cjs --live --token-auth
```

ローカルプレビューは `dist/Furusato_GAS_LocalPreview.html`。Google未接続と画面表示します。
`.github/workflows/gas.yml` はLinux/Windowsで合成回帰と許可リスト限定の配布ZIPを生成します。
`gas-private-acceptance.yml` は導入安全性と実Chromiumを検査し、所有者の指定ブランチへのpushでは
Furusato専用Windows self-hosted runnerのEdgeで合成データの操作とPDFを試験します。
CI成功はGoogle認可・デプロイ・実OCRの成功を意味しません。両者の証跡を区別します。

2026-11-07、専用の実Google環境で合成データによる税額、PNG/PDF OCR、HOLD、
一時文書削除、PDF出力の受入を実施しました。個別ID/URLと実Google画面の原本は非公開です。
公開可能な結果は [検証記録](deployment/audit/REPORT.md) を参照してください。

## Excel正式版との独立照合（41合成ケース）

[別計算の手順](parity/README.md)に沿って公式ReadyToUse ZIPのハッシュを検証し、Windows Excel COMの別プロセスで再計算した結果のみGASと比較します。モック試験だけではExcel一致を宣言できません。差異・原本不足はHOLD、正式判定もHOLDを維持します。

## 参考一次資料

- [Google clasp](https://github.com/google/clasp)
- [Google Webアプリmanifest](https://developers.google.com/apps-script/manifest/web-app-api-executable)
- [Google Deployment API](https://developers.google.com/apps-script/api/reference/rest/v1/projects.deployments)
- [Google Drive変換/OCR](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
- [国税庁 給与所得控除](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1410.htm)
- [国税庁 基礎控除](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1199.htm)
- [国税庁 令和8年改正Q&A](https://www.nta.go.jp/users/gensen/2026kiso/pdf/0026005-024.pdf)

税制計算そのものは本導入改修で変更していません。正式リリースはHOLDです。

Excel差分照合の追加ガード: **操作画面**と非表示の**設定・税率**に年度を同期、
2025/2026各年に一定数の正常ケース必須、2026年の700万円アンカーを照合。
オールHOLDは「一致」と扱わない。実Excel COMによる正式受入は未完了。
