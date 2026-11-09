# v0.1.20 — 新規非公開合成GASステージの承認済み実行手順

2026-11-09に所有者が**既存v0.1.17を変更せず、新しい非公開合成スプレッドシート・GAS・固定バージョン・Webアプリのデプロイに限り**承認したことに基づきます。これはv0.1.20の正式公開・一般ユーザーへの配布・OCR受入GOの承認ではありません。

## 設計・作用範囲

- 実行プログラム: \`gas/scripts/create-v020-isolated-stage.cjs\`
- モード \`--preflight\`: Google APIのGET照合のみ（OAuthトークン取得リクエストを除く）、リソース作成なし
- モード \`--create-approved FURUSATO_V020_NEW_PRIVATE_SYNTHETIC_ONLY\`: 書込み先を**この実行で生成する新規Sheet・その親を指定して作成した新規GAS・新規固定版・新規デプロイ**に限定。既存GASへPUT/POSTしない
- 専用OAuth: 以前v0.1.17で使用した \`gas/.private/furusato/auth.json\` を**読み取りだけ**で利用。共通 \`~/.clasprc.json\` は認証に使わない
- 元の \`gas/.private/furusato/{auth.json,receipt.json,project/.clasp.json}\`、保存済み保護スナップショット、HousingERP、既存v0.1.17の固定版/Web URL/親Sheet、Excel正式版、mainは変更禁止
- 新規ローカル証跡の保管先 \`gas/.private/furusato-v020-stage/\`。Git無視対象。ここだけ新しい \`journal.json\`, \`receipt.json\` を作成
- 既存レシート内の共有認証スナップショットのハッシュ不一致は**解消していない**。過去の共通認証の真正な内容も書込元も未確定のまま保持。別ステージの権限検証は従来のFurusato専用OAuthとGoogle側所有者・旧固定版ソースの独立再照合で行う。旧レシートの保護チェックを改変しない

## 実施前の機械的ゲート

既存作業ツリーのGit HEADが公開GitHubの最新Draft PR #2の正規開発ブランチの先端SHAと完全一致し、追跡ファイルに変更がなく、デプロイ対象のGAS5ファイルとv0.1.20版が一致すること。

既存v0.1.17の元コミットに対応した5ファイルと現在の配信済み固定版・Google Project HEAD・オーナー権限・専用Sheet・デプロイ（\`MYSELF / USER_DEPLOYING\`）をGETで再照合。HousingERPの3ファイルが旧レシート通り無変更、遠隔GASソース・デプロイのdigestも旧レシート通り一致すること。共通認証が作業中に変化していないこと。専用OAuthから見えるOCR一時ファイル残数が0であること。これらが一つでも不一致なら**作成前にHOLD**。

## PC①での実行

認証、Googleログイン、ブラウザログインの自動化はありません。PC①のPowerShellを開いて専用作業ツリーから実行してください。

**読み取り専用の最終事前検査**：

\`\`\`powershell
cd $HOME\Development\Furusato_nouzei_GAS_OCR
git pull --ff-only origin feature/gas-workflow-20261106
node gas/scripts/create-v020-isolated-stage.cjs --preflight
\`\`\`

\`READY_TO_CREATE_ONLY_NEW_PRIVATE_STAGE\` の場合だけ、所有者が既に承認済みの新規合成環境を**一度だけ**作成：

\`\`\`powershell
node gas/scripts/create-v020-isolated-stage.cjs --create-approved FURUSATO_V020_NEW_PRIVATE_SYNTHETIC_ONLY
\`\`\`

**重要: 成功/失敗を問わず、作成コマンドを自動で再実行しないこと。** 初回実行は作業開始前に新規privateディレクトリを作り、各Google API作成リクエスト直前にジャーナルを保存します。リクエスト後にネットワークが切れた場合もGoogle側の作成有無を自動判断せずに停止します。ステージディレクトリがすでに存在する場合、再実行は \`STAGE_ALREADY_EXISTS_DO_NOT_RETRY\` で拒否。環境作成が途中で止まった場合はジャーナルを**非公開のまま**専門家に照合させ、未確認のGoogleリソースを推測で削除・再作成しません。ローカルフォルダを手動削除して繰り返さないでください。

成功時の出力は \`DEPLOYED_PENDING_OWNER_ACCEPTANCE\`、\`release:HOLD\`、\`ocrWindows:NOT_TESTED\`、\`ocrIPhone:NOT_TESTED\` 等の安全なステータスのみ。**新しいScript ID、Sheet ID、Web URL、認証ファイル、Git SHA、レシート本文、作業ジャーナル本文をGitHub・チャット・CI Artifactへ転載しないこと。**

## Microsoft Edge / iPhone Safariでの受入

新規レシートはPC①ローカルの \`gas/.private/furusato-v020-stage/receipt.json\` に保管されます。ユーザーはPC①の通常Microsoft Edgeで、新しいレシート内の非公開WebアプリURLを開きます。自動ログイン／Playwrightログインは使用しません。

Windows Edge: PDF → PNG → JPEGの順に**v0.1.20**の実Google OCRを実施。給与700万円、社会保険料100万円、給与所得控除後520万円の値を原票と照合して、仮転記と未照合HOLD、ファイル変更による転送同意解除を再確認。その都度、専用OAuthのDrive APIでOCR一時ファイル残数0件を確認。

iPhone Safari: 同じ**新規デプロイ版**でJPEGを試験。OCRの認識値、仮転記、未照合HOLD、ファイル切替、タッチ操作、削除結果を確認。利用するGoogleアカウントは作成者本人に限定し、旧版URLと取り違えない。

受入状況は **(A)新規環境が作られたこと (B)実Google APIの固定版照合 (C)Windows/iPhone所有者によるOCR操作 (D)税額計算の独立照合** を厳密に分離して記録し、一般公開GOとは判断しません。

## 権限・復旧・保護事項

このコマンドはGoogleの新規作成だけを許可し、既存リソースの\`deployments.update\`、\`files.delete\`、\`projects.updateContent\`（旧ID宛て）を認めません。実行中に保護状態、Git HEAD、リモート先端SHAが変わった場合はHOLDして途中記録を残します。旧認証や旧保護スナップショットの上書き・再計算・復元はしません。

Googleに作成した新ステージが不要になった場合も、削除前に所有者・レシートの一致と対象限定承認を別途取得してください。
