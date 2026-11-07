# Furusato専用・非公開導入 v0.1.5 / 正式リリースHOLD

この手順は従来の `-SpreadsheetId` / `-AllowExistingProject` や手動貼付を置き換えます。
既存Script ID・既存シートを指定する機能はありません。HousingERPは読取保護対象です。

## 構成

- `policy.json`: 公開可能な設定。5ファイルの転送許可リスト、MYSELF / USER_DEPLOYING、clasp固定版。
- `private-gas.cjs`: Google API照合、clasp新規作成・push・非公開デプロイ。
- `../.private/furusato/`: Git対象外の認証、作成記録、Script/Sheet/Deployment ID、専用ブラウザプロファイル、実Google証跡。
- `../dist/acceptance/`: 合成データのローカルブラウザ証跡のみ。CI Artifactに公開可能。

## 実行（リポジトリのルートから、Windows / Node 22以上）

```powershell
npm ci --prefix gas --ignore-scripts --no-audit --no-fund
powershell -NoProfile -File gas/scripts/setup-private-gas.ps1
# 所有者が既存認証の再利用を希望する場合のみ。元ファイルは変更しない。
node gas/deployment/private-gas.cjs reuse-auth
# 既存認証が利用できない場合だけ新規認可を行う。
powershell -NoProfile -File gas/scripts/setup-private-gas.ps1 -Login
# Googleアカウント所有者がブラウザで専用の認証を完了する。
powershell -NoProfile -File gas/scripts/setup-private-gas.ps1 -CreateProject -PushSource -DeployPrivate -ProtectedRoot ../HousingERP
node gas/deployment/private-gas.cjs verify --protected-root ../HousingERP
```

配布ZIPから実行する場合は `gas/` に相当する展開フォルダで `npm ci` を行い、
`scripts/setup-private-gas.ps1` を使います。`-ProtectedRoot` はHousingERPの読取可能なローカルフォルダを指定します。
GoogleのApps Script API管理アクセスが未許可の場合は、所有者による許可が必要です。
本ツールは既存GCPプロジェクトのAPI、OAuth設定、共有設定を変更しません。
claspの既定認証としてグローバル `.clasprc.json` を使わず、元ファイルへ書き込みません。
明示的な `reuse-auth` 時だけ元認証を読み取り、専用コピーで更新します。

## 登録先の保護

1. HousingERP `.clasp.json` のScript IDと、Google側で取得した親シートIDを拒否リストにする。
2. HousingERPの設定3ファイルとグローバルclasp認証のハッシュを前後照合する。
3. Drive APIで新規の合成データ専用シートを作成し、所有者・非共有・編集権限・作成マーカーを検査する。
4. claspでその新規シートに紐付くGASを作成する。clasp 3.3.0では `--type sheets` がparentIdを使わず別シートを作るため、`--type standalone --parentId` を使う。
5. APIのScript ID、親Sheet ID、タイトル、作成者と、ローカル作成記録・`.clasp.json` を照合する。
6. 初回は空プロジェクト、以後は直前の登録ソースのハッシュと一致する場合だけpushする。外部編集は自動上書きしない。
7. immutable versionのソースと非公開manifestを確認して新しいデプロイを作り、Google APIの実際のentryPointもMYSELF / USER_DEPLOYINGか検査する。

作成途中で失敗した場合は `.private/furusato/creation-journal.json` に記録が残ります。
自動で別プロジェクトを増やしたり、既存プロジェクトを採用したりしません。記録を確認して復旧します。
ローカル作成記録は秘密鍵による署名ではなく、意図的に改ざんされていない信頼済み作業環境を前提とします。
IDやURL、認証、プロファイル、実Google画面をGitHub/CI Artifactsへ追加しないでください。

## 試験の区別

```powershell
node gas/tests/test-deployment.cjs
node gas/scripts/build-preview.cjs
$env:FURUSATO_BROWSER_CHANNEL='msedge'
node gas/tests/test-real-browser.cjs
# 実Google環境。専用プロファイルで所有者がWebアプリ認可を完了してから再実行する。
node gas/tests/test-real-browser.cjs --live --authorize
node gas/tests/test-real-browser.cjs --live --headed
# 所有者の初回Webアプリ認可済みなら既存OAuthで隔離ブラウザを利用可能。
node gas/tests/test-real-browser.cjs --live --token-auth
```

ローカル試験は実Chromiumで合成給与700万円/社保100万円→109,000円、住宅ローンHOLD、
PC/モバイル、印刷ボタンとPDF出力を検査します。Googleサーバーの実行ではありません。
`--live` は先にAPIで実デプロイを照合してから同じ操作を実Google Webアプリで実行し、
合成PNG/PDFのOCR、候補金額、OCR後HOLD、一時ファイル残数0も検査します。
Googleログイン・アプリ認可画面は自動操作しません。`--authorize` は専用画面を最大10分開き、所有者操作を待ちます。認証だけの証跡と機能受入は別ファイルです。
PDF本文検査にはPythonと `pypdf==6.1.3` が必要です。隔離導入する場合は `python -m pip install --target gas/.qa-python pypdf==6.1.3` を実行します。
ブラウザPDF出力はプリンタ本体やOS印刷ダイアログの受入ではありません。
`--token-auth` は専用認証のBearerをscript.google.comだけへ付与します。
各応答はredirect追随0で取得し、redirect先へ認証を継承しません。元のfetch例外も外へ返しません。
合成Bearerによるcross-origin redirect・例外秘匿の実ブラウザ回帰をCIで実行します。

実Googleの合成PDF変換では見出し/複数項目が同じ行へ連結されるため、OCRは空白境界と
厳密な項目名を照合します。重複額・語内部分一致は採用せず、候補は引き続きREQUIRES_REVIEWです。

Windows self-hosted試験は既存のFurusato専用 `furusato-excel` runnerを使用します。
所有者の指定ブランチへのpush時だけ実行し、Excel COM、HousingERP、既存認証、Google環境には接続しません。
runnerの登録・サービス・ラベルは変更しません。Google実試験は手元の専用認証を使います。

公式仕様: [clasp](https://github.com/google/clasp)、[Web manifest](https://developers.google.com/apps-script/manifest/web-app-api-executable)、[Deployment API](https://developers.google.com/apps-script/api/reference/rest/v1/projects.deployments)。
