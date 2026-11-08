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

## 所有者承認後：新規隔離環境の一括作成と実OCR受入 (2026-11-08)

最新のFurusato専用Windows worktreeにのみ適用します。Google認証は
`gas/.private/furusato/auth.json` の専用ファイルを使用し、
HousingERP / main / 共通 `.clasprc.json` は書き換えません。

```powershell
# 読取専用・Googleアクセスなし (CIもこのモードだけ実施)
powershell -NoProfile -File gas/scripts/accept-private-live-ocr.ps1 -PreflightOnly
# 所有者が新規合成プロジェクト作成を明示承認した場合だけ
powershell -NoProfile -File gas/scripts/accept-private-live-ocr.ps1 -CreateAndTest
```

`-CreateAndTest` はクリーンな最新ブランチ、専用OAuth形式、保護されたHousingERP設定、
未作成の `receipt.json` / `creation-journal.json` / プロジェクト設定をチェックしてから、
新しい非共有Googleシート1件と紐付き非公開GASだけを作ります。
登録ソース5ファイルと固定版、所有者、`MYSELF / USER_DEPLOYING` を検証し、
合成PDF/PNG/JPEGのOCR候補値、計算HOLD、各処理後のGoogle一時ファイル0件、
前後の保護環境一致を検査します。生成される非公開証跡・URL・IDはGit対象外です。

Googleでの作成途中にエラーが起きた場合、**同じコマンドを再実行しないでください**。
`creation-journal.json` と `receipt.json` の非公開記録を確認し、
重複作成せず既存の未完了作業だけを調査します。
Webアプリの所有者のGoogle承認画面が必要なら、自動認可せず停止します。
合成OCRがPASSしてもiPhone実機Safariによる非公開GAS操作は別途HOLDです。
公開静的デモの合格をiPhoneの実Google受入と混同しません。

## 初回の実Googleデプロイ成功後にブラウザ受入でHOLDとなった場合

**再度 `-CreateAndTest` または `install --fresh` を実行しないこと。**
新規の合成Googleシート・スクリプト・固定版は、最初の成功した導入記録のまま維持します。
認証、`receipt.json`、`creation-journal.json`、`protectedSnapshot` を初期化・編集しません。

前回のローカルブラウザ証跡を**読み取りのみ**で安全に要約します。ID、URL、OAuth、
実画面原本、ハッシュ、絶対パスやエラー全文は表示しません。

```powershell
node gas/scripts/report-private-ocr-status.cjs
```

以前の証跡は `format:LEGACY_NO_FAILURE_STAGE` の場合があります。その場合、合格した
工程だけ分かり、停止箇所は確定しません。追加後のブラウザ試験は失敗段階と安全な
分類のみを記録し、生のPlaywright例外は外部へ出しません。

まず既存デプロイの読取専用API照合のみ実施する場合:

```powershell
node gas/scripts/check-live-ocr-readiness.cjs --verify-remote
```

既存の**合成専用**非公開デプロイで実Google OCR試験を再開する場合は、
所有者が通常のMicrosoft Edgeを操作する以下の手順を使用します。

```powershell
node gas/scripts/accept-owner-ocr.cjs
```

画面操作は所有者が行い、OCRの前後で専用Google Driveと保護対象を照合します。
合成ファイルの準備は [v0.1.17の引継ぎ手順](../docs/REAL_GOOGLE_OCR_HANDOFF_v0.1.17.md) を参照してください。
実Googleの試験が未完了ならすべてのOCR・一時ファイル削除の合格を主張しません。
iPhone物理Safariと正式リリースは別の受入としてHOLDを維持します。

## 既存GASの画面到達・認証を先に診断（Google OCRを実行しない）

初回の新規非公開GASデプロイが成功し、旧形式のブラウザ証跡が
`LEGACY_NO_FAILURE_STAGE` / `UNRECORDED` となった場合は、
新規プロジェクト作成や `install --fresh` を再実行しません。
既存の所有者・固定版・コード・保護環境を読み取り照合した後、
Google Webアプリの画面が取得できるかだけを検査します。

```powershell
node gas/scripts/check-live-ocr-readiness.cjs --probe-only
```

このモードは新規シート、GAS、Google OCR文書、PDF/PNG/JPEGを作成せず、
Webアプリを開いて `#next` が存在することだけを確認します。
`browser-probe-evidence.json` は非公開フォルダ内に作られ、
既存の `browser-evidence.json` は上書きされません。
`REAL_GOOGLE_WEB_APP_PROBE: PASS; OCR NOT EXECUTED` は画面到達のみの合格であり、
OCRの金額認識、計算HOLD、一時ファイル残数0やiPhone実機受入を意味しません。
認証が足りない場合は安全な理由コードを表示して停止し、同意画面の自動操作はしません。
公開CIではこのモードを実行できません。

## 非公開GAS画面検証：ローカルブラウザ起動の失敗時

`LOCAL_BROWSER_UNAVAILABLE; step=PRIVATE_BROWSER_SETUP` は、
Google側のデプロイ不整合やOCRの結果ではなく、
PC内でPlaywrightがブラウザを起動できなかったことを示します。
`npm ci --ignore-scripts` はブラウザ本体を導入しないため、
Playwright Chromiumが存在しないWindowsでも
既存のMicrosoft Edge、次いでChromeを自動選択します。
ブラウザが見つからない場合はHOLDで停止し、
Google側・Windows既定ブラウザ設定・既存プロファイルを変更しません。

まずローカル環境だけを確認できます（Google接続なし・秘密情報表示なし）。

```powershell
node gas/scripts/check-local-browser.cjs
```

`status:PASS` ならブラウザ本体を検出できたことを表し、
ブラウザの起動成功やGoogle認証成功を保証するものではありません。
`status:HOLD` の場合は`reason`を確認し、既存GASを再作成しないでください。
ブラウザが利用可能であれば、既存の認証済み合成環境に対して

```powershell
node gas/scripts/check-live-ocr-readiness.cjs --probe-only
```

を実行します。プローブではGoogle OCR文書は作成しません。
通常ブラウザで所有者が画面到達を確認した場合は、所有者用OCR手順に進めます。
Google固定版の変更やiPhone実機の検証は別工程です。

## 既存非公開GASの所有者ログイン：通常ブラウザのみ（2026-11-09）

Google公式ヘルプは、ソフトウェア自動制御によるブラウザからの
Googleログインを拒否する場合があると説明しています。
実Windowsで「このブラウザまたはアプリは安全でない可能性があります」
と表示されたため、**GoogleログインをPlaywrightから完全に分離**しました。
自動化判定を回避するフラグ、CDP、Cookie移植、認証画面の自動入力を行いません。

**初回作成済みの非公開GASを作り直し・再デプロイしないでください。**
既存の `MYSELF / USER_DEPLOYING` とソース5ファイルを維持します。
所有者Windows PCの作業用worktreeで、開発ブランチを取得した後、

```powershell
node gas/scripts/check-live-ocr-readiness.cjs --authorize-owner
```

を実行します。まずローカル証跡・Git HEAD・保護設定・Google APIの
固定版・所有者・ソースを検証します。その上で作成済みレシートに
保存された **専用WebアプリURLをWindows既定ブラウザで開くだけ** です。
Playwrightや自動制御ブラウザ、専用Playwrightプロファイルは使用しません。
URL/Script ID/認証データはコンソール・GitHub・CIに出しません。
表示されるのは
`OWNER_SYSTEM_BROWSER_OPENED: MANUAL_REVIEW_REQUIRED; OCR NOT EXECUTED; release HOLD`
であり、**ログイン成功や画面到達のPASSではありません**。

通常のEdgeまたはChromeで、GAS作成に使ったGoogle所有者アカウントで
ログインしてください。画面に「ログインできませんでした」と出続ける場合は
Googleのブラウザサポート・組織ポリシーを確認し、認証保護を回避しません。
実際のふるさと納税入力画面を所有者が目視確認した時点では、
「手動画面到達確認」として報告できますが、OCR合格とは区別します。
`--authorize-owner` と `--probe-only` / `--run-synthetic` は同時指定不可です。

旧 `test-real-browser.cjs --live --authorize` は安全上明示拒否します。
ログイン済み通常ブラウザのCookieをPlaywrightへ移すことも行いません。
現行のPlaywrightによるOCR完全自動検証には別途Google承認済みの
正式な認証経路が必要です。代替として通常ブラウザから合成画像で手動受入を行い、
結果と残存ファイル0件をGoogle側で個別に監査できます。
一般ユーザー向けの静的デモ成功と実GAS/iPhone成功は混同しません。
正式リリースはHOLDのままです。

## v0.1.17 実Google OCR：通常Edgeでの合成データ手動受入

Googleがソフトウェア制御ブラウザでのログインを拒否した環境では、
通常のWindows既定ブラウザ（Edge/Chrome）だけで実Google OCRを受け入れます。
Google側のログイン制限を回避せず、ブラウザCookieのコピー・
Playwrightでのログイン自動化・既存GAS再作成は一切行いません。

検証データは**個人情報を含まない合成源泉徴収票**だけを使用します。
架空の令和8年分（2026年）、支払金額700万円、
社会保険料等100万円、給与所得控除後520万円を
PDF（画像だけのスキャン型）、PNG、JPEGの3形式で用意してください。
各ファイルは2MB以下とします。実務の源泉徴収票は使いません。

手動検証前と各形式のOCR後に、認証済み専用Googleアカウントで
見える一時ファイルの件数を読取専用で検査できます。

```powershell
node gas/scripts/check-private-ocr-temporary-files.cjs
```

このコマンドはまず、専用合成環境のレシート、Git HEAD、
固定版、所有者、HousingERP保護設定を読取専用で検証し、
その後Google Drive APIを**GETだけ**でページ末尾まで照合します。
結果は `temporaryOcrFiles` の残数、`pages`、
`coverage:FURUSATO_DEDICATED_OAUTH_SCOPE_ONLY` のみで
名前・ID・URL・トークンを表示しません。
`PASS / temporaryOcrFiles:0` は**そのOAuthの権限範囲で見える
ファイルがゴミ箱を含め0件**であることを意味します。
Googleアカウント全体に対して完全な削除を保証するものではなく、
必要に応じてGoogle Driveの所有者画面でも
`Furusato_OCR_TEMP_` の検索を行い、残存0件を確認してください。
検出されるファイルが1件でもあればHOLDとし、この診断ツールが
自動削除することはありません。認証エラーもHOLDとします。

非公開GASの画面に到達していることを通常Edgeで目視確認後、
STEP 1「基本情報」で2026年と給与所得のみを選択し、
「次へ」でSTEP 2「給与の入力」に進みます。

1. PNGを選択し、Google転送同意が未チェックになることを確認
2. 同意内容を読み、**合成ファイルに限って**同意をチェックしてOCR実行
3. 2026年・支払金額7,000,000円・社会保険料1,000,000円、
   参考値5,200,000円の認識候補を確認（0件や誤額は不合格）
4. 「OCR完了（原票照合待ち・HOLD）」を確認。
   認識値が仮転記されても**原票照合チェックを付けずに**結果まで進み、
   「計算停止」「HOLD」を確認する
5. Google Drive一時ファイルの残数0件を確認
6. 「読取データを破棄して手入力に戻る」で前回値を消し、
   PDF、JPEGも**1件ずつ**同様に実施。
   ファイル選択後は転送同意が解除されることも確認

3形式のうち1つでもGoogle OCR・候補値・HOLD・削除検査が失敗すれば
本受入はHOLDとします。成功した形式だけを個別に記録し、
未検証の形式を合格扱いしません。

この手動試験はWindows Edgeでの実Google操作であり、
**iPhone Safariの実GAS操作は別に検証が必要**です。
iPhoneでは未公開の非公開GASにアクセスできる
所有者アカウントかを確認します。公開静的デモの成功は代用できません。
試験後にGoogle ID、WebアプリURL、OAuth情報を公開GitHubや
CI Artifactsに追加しないでください。正式版はHOLDのままです。

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

## 設定ハッシュ不一致の安全診断（オフライン・読取専用）

Google API・clasp・Drive・HousingERPへ一切書き込まず、過去の導入記録に保存された4ファイルのSHA-256と現在の内容を照合できます。

```powershell
powershell -NoProfile -File gas/scripts/setup-private-gas.ps1 -Diagnose -ProtectedRoot ../HousingERP
# 同じ操作をNodeから直接実行する場合
node gas/deployment/private-gas.cjs diagnose --protected-root ../HousingERP
```

- 出力の `housing-clasp` / `housing-appsscript` / `housing-project` はHousingERPの設定3ファイル、`global-clasp-auth` は共通の `.clasprc.json` です。
- `UNCHANGED` は保存時と一致、`CHANGED` は内容が変化、`MISSING` / `APPEARED` は存在状態の変化、`BLOCKED_LINK` はシンボリックリンク・ジャンクションによる危険な参照です。
- 不一致時は `status: HOLD` と終了コード2を返します。**一致しても正式リリースはHOLD**であり、実Google試験に合格した意味ではありません。
- 認証本文・トークン・ユーザー名・ID・ハッシュ・絶対パスは出力しません。診断モードは過去ハッシュの再採用、承認、認証更新、push、デプロイ、削除を実行しません。
- 共通clasp認証だけの `CHANGED` は、トークンの自動更新を含む複数の可能性があります。**保存記録に旧本文がないため、原因を確定できません。**所有者が更新履歴・用途を確認してから、独立した合成専用環境の認証・デプロイ照合と実Google試験を実施してください。
- `receipt.json` やハッシュを編集して検査を通すことは禁止です。対象の設定が変更された理由が未確認なら自動再試行しません。
- 実行には専用の非公開 `gas/.private/furusato/receipt.json` と対象のHousingERPフォルダが必要です。GitHub Actions上では認証情報を入れずに合成テスト `node gas/tests/test-config-drift.cjs` のみ実行します。

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

### 新しい合成受入プロジェクト

既存の受入デプロイや認証記録に差分があるときは、旧記録を保管し、独立したクリーンなGit worktreeを用意します。旧記録の読取は `diagnose --reference-private <旧非公開フォルダ>` を使用します。TOKEN_REFRESH_COMPATIBLE は比較したコピーに対する差分パターンです。元の記録とのバイト一致や書込元の特定とは別です。

専用認証を用意した空の非公開フォルダで、`node gas/deployment/private-gas.cjs install --fresh --deploy --protected-root ../HousingERP` を実行します。既存の受入記録や途中作成の記録があると停止します。保護対象、ローカルGit HEAD、登録コード、固定バージョン、Webアプリの権限と実行者を確認します。試験の再開は `verify --attest-head` と `node gas/tests/test-real-browser.cjs --live --attest-head --token-auth` を使用します。本人同意が必要な場合は専用プロファイルで `--live --attest-head --authorize` を実行します。

受入候補の改訂は、初回のfreshで作成・認証した合成環境に限り `install --synthetic-update --deploy` を使用します。直前の候補の固定バージョン・登録先・URLを検証してから、新しい固定バージョンへ同じ合成URLを切り替えます。正式環境や旧受入記録は対象外です。HousingERPのリモートソース・デプロイの照合値は非公開で保持し、`verify --attest-head` でも確認します。

導入ツール revision 3 の受入再照合は、実デプロイの固定ソースと現在のGit HEADの転送対象5ファイルを比較します。導入ツールだけを変更したコミットでは実ソースを再登録せず、初回登録のコミットと現在照合したコミットを別々に証跡へ記録します。保護リモートの証跡がない旧レシートは候補更新に利用できません。
