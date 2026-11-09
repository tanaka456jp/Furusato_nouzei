# 実Google OCR所有者証跡のオフライン監査 v1（正式リリース HOLD）

対象: 2026年11月9日の既存非公開GAS v0.1.17に対する Windows PDF/PNG/JPEG・iPhone Safari JPEG の所有者報告。**GAS v0.1.20の実Google受入ではない。**

## 実行手順（所有者Windows作業ツリー）

既存の認証・レシート・保護スナップショット・Google資源を書き換えず、Git対象外の `gas/.private/furusato/evidence/owner-ocr-*.json` だけを読みます。

```powershell
cd $HOME\Development\Furusato_nouzei_GAS_OCR
git pull --ff-only origin feature/gas-workflow-20261106
node gas/scripts/audit-owner-ocr-evidence.cjs
```

既存の専用作業ツリー内でのみ実行してください。証跡JSON、画面原本、Google Script ID、WebアプリURL、OAuth、Cookie、個人情報はチャット・GitHub・CIへ提出しません。出力されるのは判定・形式・固定の不合格コード・件数だけであり、Git SHAや絶対パスも出力しません。**コードはGoogleへ接続しません**。

## 判定の意味

- `OWNER_ATTESTED_STRUCTURE_PASS`: 記録の形、指定の全形式、本人のチェック回答、各処理前後のDrive API件数0、保護検査PASS、WindowsとiPhoneで同一の記録ソースコミットを確認できること。**所有者の回答を独立再実行したという意味ではありません。**
- `HOLD`: 未記録・不完全・異なるソース・変則形式・残存ファイル・保護不整合・最新の失敗記録を検出。以前のPASS記録で新しい失敗を覆い隠しません。
- `immutableDeploymentVersion: NOT_IN_OWNER_RECORD`: 旧プロトコルのJSONにはGoogle固定版との強い結び付きがないため、ローカル検査だけでv0.1.17と断定しません。別途、受入時のGoogle API照合証跡・固定版・読み戻したソースdigestを安全なオフライン環境で突合してください。
- `independentOcrAccuracy: NOT_VERIFIED`: 合成源泉徴収票の正しい金額を機械的に比較したログではなく、ユーザーの確認回答です。
- `independentDeletionOutsideOauthScope: NOT_VERIFIED`: 0件とは専用OAuthで検索可能な範囲を指し、全Googleアカウント/全履歴における不可逆削除の証明ではありません。
- `release: HOLD`: 常にHOLD。現行候補v0.1.20の実Google・iPhone受入が終わるまでは正式GOにしません。

## v0.1.20の安全な次工程

1. このオフライン監査で旧受入記録をレビュー。Google固定版の歴史的対応は、秘密情報を外に出さず所有者環境で別途照合。
2. `node gas/deployment/private-gas.cjs diagnose` と `node gas/scripts/check-live-ocr-readiness.cjs` を読取専用で実行し、既存の設定ドリフト、Git/導入ソース不一致を確認。**新HEADと既存v0.1.17の不一致は予想されるHOLDであり、保護検査を無効化しない。**
3. 既存環境を更新する既存の `install --synthetic-update --deploy` は、現在の固定デプロイの書換えとレシート更新を伴う。既存の受入済みv0.1.17を保持する要件に対して自動実行しない。更新が必要なら対象の既存非公開合成GASに限る明示承認、復旧可能性、所有者/権限/保護ハッシュ事前照合を別途確認。
4. 同一候補版でWindows EdgeのPDF/PNG/JPEG、HOLD、各操作後の一時文書0件、iPhone Safariを実Googleで再受入。PC上の合成ブラウザCIでは代用しない。

この監査用スクリプトとテストの追加は非デプロイ・ソース変更であり、Googleに登録された5ファイル、GAS v0.1.20のアプリ実装、Excel main、本番HousingERP、認証、レシート、保護スナップショットを変更しません。


## 読取専用で「既存のGoogle固定版」を独立照合する（追加手順）

証跡構造監査がPASSでも、以前の所有者回答JSON自体には固定デプロイ版の番号がありません。次のコマンドは、元の導入レシートに記録された**当時のGitコミット**から旧ソース5ファイルを取得し、Google APIの現在の固定版・登録ソース・所有者/権限・親シート・HousingERP保護状態を読み取り照合します。

```powershell
cd $HOME\Development\Furusato_nouzei_GAS_OCR
git pull --ff-only origin feature/gas-workflow-20261106
node gas/scripts/audit-installed-private-version.cjs
```

このコマンドは旧固定版v0.1.17専用です。現在の作業ツリーがv0.1.20でも、旧版と現行版のソースが異なることだけを理由に失敗しません。旧版のSourceコミット、レシート内ソースdigest、GASプロジェクトの現在HEAD、固定versionの5ファイルが全て一致しなければHOLDにします。Googleプロジェクトの新規作成、clasp push、デプロイ更新、ブラウザ自動ログイン、ファイルの削除、レシート/認証/保護スナップショットの書換えは行いません。Google認証のアクセストークン更新HTTPリクエストは必要ですが、専用認証ファイルには書き戻しません。

`status:PASS` は**照合を実行した時点**でGoogleの既存固定版v0.1.17がソースと一致したという限定結果です。過去のOCR操作が正しくその固定版に向けて行われたこと、OCR文字/金額が正しいこと、Drive側で全ファイルが永久削除されたことを証明しません。これらの項目は出力で `NOT_PROVEN` と表示され、正式リリースは常にHOLDです。

公開GitHubやチャットには、判定JSON中の非機密ステータスだけを共有してください。障害時の生Google応答や認証・固定URL・IDを記録/転載しません。

## v0.1.20 実Google受入前の無変更プラン確認

旧v0.1.17の固定版照合がPASSなら、次のコマンドでv0.1.20候補と既存環境を **Googleへの書き込みなし** で照合します。

```powershell
cd $HOME\Development\Furusato_nouzei_GAS_OCR
git pull --ff-only origin feature/gas-workflow-20261106
node gas/scripts/plan-v020-private-stage.cjs
```

このコマンドは以下を調べます。

- 所定のGitリポジトリ/開発ブランチ、追跡ファイルの無変更、HEADに登録された**正確な5ファイル**、v0.1.20のversion
- 既存レシートからたどるv0.1.17のhistorical source/固定デプロイ/所有者専用権限/親シート/保護状態の実Google API照合
- 専用OAuthの可視範囲内における、一時OCRファイル残数0件（ゴミ箱を含む）と前後の保護設定の不変
- 新旧5ファイルのsource digestが異なること。古い環境と最新候補が同じものだと誤認しない。

結果の `READY_FOR_SEPARATE_STAGE_APPROVAL` は、**更新を承認したという意味ではありません**。新しい隔離合成ステージの作成を所有者に明示承認してもらう前提条件だけが整ったことを示します。Googleへのアクセスは認証更新とGET（読み取り）のみで、既存v0.1.17レシート、Googleスクリプト、デプロイURL、固定バージョン、保護スナップショット、HousingERPを変更しません。機密URL・ID・トークン・digestは出力しません。Googleアカウント、OAuthスコープ全体での削除を保証するものでもありません。

### 安全なv0.1.20の正式受入方針

受入済みv0.1.17デプロイと既存 `receipt.json` を保持するため、従来の **`install --synthetic-update --deploy` は実行しない**。この更新モードは既存の5ソース・固定版参照先・レシートを変更するからです。

所有者の**対象を限定した承認後**、v0.1.20は別の非共有合成GAS/シート/専用レシートで試験する方針とします。認証ファイル再初期化、既存保護スナップショット書換え、HousingERPへの操作、本番環境へ配信することは含みません。新規Google資源の作成はこのpreflightコマンドには実装しておらず、承認・バックアウト・隔離実装が整うまでは実施しません。

v0.1.20のWindows PDF/PNG/JPEG・iPhone Safariの実Google OCRと削除確認はまだ未実施です。旧版の所有者受入を流用して最新版PASSとはしません。正式リリースHOLD・Draft PR #2を維持します。

## 2026-11-09 PC①でのv0.1.20事前検査HOLDの修正（preflight revision 2）

PC①で当初表示された `CANDIDATE_NOT_READY` は**ローカル候補の停止**を意味します。旧デプロイ、Google Driveの状態はこの時点で問い合わせていないため、同時に表示された `OLD_DRIVE_TEMP_NOT_ZERO`、`OLD_PRIVATE_RELEASE_NOT_VERIFIED`、`CANDIDATE_SOURCE_NOT_DISTINCT` を独立した障害とみなすのは誤りでした。

修正後は `stage: LOCAL_CANDIDATE`、`candidateChecks`（安全な理由コード）、`oldPrivateAudit: NOT_RUN`、`driveAudit: NOT_RUN`、`sourceComparison: NOT_RUN` を返します。これらの診断項目に認証情報、ファイルパス、ソースコード、Google IDは含まれません。Googleへのアクセスは実行しません。CIはGitの**実際のHEADから取得した5ソース**と作業ツリーの一致までLinuxとWindowsで回帰します。

```powershell
cd $HOME\Development\Furusato_nouzei_GAS_OCR
git pull --ff-only origin feature/gas-workflow-20261106
node gas/scripts/plan-v020-private-stage.cjs
```

`TRACKED_WORKTREE_DIRTY` は追跡ファイルのローカル差分を示します。ユーザーの変更を一括破棄する `git reset --hard`、`git clean`、レシート/認証/スナップショット編集は行わず、別途安全に差分を特定してください。`WORKTREE_SOURCE_DIFFERS_FROM_COMMIT` は5ソースの作業ファイルとGit HEAD不一致です。旧v0.1.17の失敗とは結び付けず、比較対象の文字コードや改行を確認してください。`WRONG_DEVELOPMENT_BRANCH` や `UNTRUSTED_GIT_ORIGIN` は指定作業ツリーの確認を要求します。どれも安全検査を無効化して回避しません。

## 2026-11-09 PC①のブランチ名不一致対応（事前検査 revision 3）

以前のPC①では `candidateChecks:["WRONG_DEVELOPMENT_BRANCH"]` を確認しました。`git pull --ff-only` の成功だけでは、現在のローカルブランチ名と開発ブランチ名の一致は保証されません。

修正後の事前検査は、許可済み `origin` に対する読取専用の `git ls-remote --heads` でGitHubの**現在の開発ブランチ先端SHA**を確認します。作業ツリーHEADがそのSHAに完全一致し、追跡ファイルの変更がなく、転送対象5ソースとHEADが一致する場合のみ、ローカルブランチが別名やdetachedであっても**読取専用事前検査に限り**受け入れます。取得失敗・古いSHA・別リポジトリ・追跡変更は従来通りHOLDです。Google読み取り後にも同じ先端SHAを再確認します。

```powershell
cd $HOME\Development\Furusato_nouzei_GAS_OCR
git pull --ff-only origin feature/gas-workflow-20261106
node gas/scripts/plan-v020-private-stage.cjs
```

新しい出力の `checkoutIdentity:TRUSTED_REMOTE_EXACT_COMMIT` は、別名worktreeのGit HEADが現在の許可済み開発ブランチと一致したことを意味します。更新承認ではありません。

`REMOTE_TIP_DIFFERS_FROM_CHECKOUT` または `TRUSTED_REMOTE_TIP_UNVERIFIED` のときはHOLDで停止します。ローカル変更を消す `reset --hard` / `git clean` / 強制checkout、既存レシート更新、Google書込はしません。


## 2026-11-09 PC①での PROTECTED_CONFIG_DRIFT（事前検査 revision 4）

PC①の読取専用実行で `V020_PRIVATE_STAGE_PREFLIGHT_HOLD: PROTECTED_CONFIG_DRIFT` が出ました。ブランチ名不一致は解消されましたが、**保存済みの4つのローカル保護対象と現在のファイルの差異**が検出されています。原因は未確定です。v0.1.17の過去のGoogle固定版PASSも、この新しいローカル差異を承認・解消する根拠にはなりません。

最新版は `stage:PROTECTED_LOCAL_CONFIG`、`protectedConfiguration.checks` として固定の対象名（`housing-clasp`、`housing-appsscript`、`housing-project`、`global-clasp-auth`）の状態だけを報告します。差異があっても古いハッシュを再計算・上書きせず、GAS/Driveの照合・デプロイを行わず、HOLDで停止します。認証トークン・ファイル内容・パス・実ハッシュ・更新日時は出力しません。

```powershell
cd $HOME\Development\Furusato_nouzei_GAS_OCR
git pull --ff-only origin feature/gas-workflow-20261106
node gas/scripts/plan-v020-private-stage.cjs
```

さらに原因を分けて確認する既存の読取専用診断は以下です。

```powershell
node gas/deployment/private-gas.cjs diagnose
```

`global-clasp-auth:CHANGED` だけの場合は、一般的なOAuthアクセストークン更新の可能性がありますが、自動的に承認・無視はしません。既存の診断が `TOKEN_REFRESH_COMPATIBLE` と表示しても、それは2つの認証ファイルの差分パターンであり、保存済みスナップショットを変更してよい証明ではありません。`housing-*:CHANGED`、`MISSING`、`APPEARED`、`BLOCKED_LINK` などの場合は保護対象の変更や経路の異常を疑い、変更履歴を個別に監査します。いずれも元の認証ファイルや保護スナップショットを再作成しないこと。

正式リリースHOLD、v0.1.20の実Google OCRは未実施です。


## 2026-11-09 PC①：共通clasp認証だけがCHANGED（事前検査 revision 5）

PC①実画面で `housing-clasp`、`housing-appsscript`、`housing-project` はすべて `UNCHANGED`、`global-clasp-auth` のみ `CHANGED` と確認しました。これは**ローカル保存時から共通認証ファイルの内容が変わった**という事実で、更新理由は未確定です。v0.1.17のGoogle固定版・保護検査の過去PASSとは別に扱います。

事前検査 revision 5 は、前回からの共通認証ファイルの変更が典型的なトークン更新の形に限られているか、**オフラインで読み取って評価**します。まず保存済みスナップショットの共通認証ハッシュと、既存のFurusato用隔離認証コピー（`gas/.private/furusato/auth.json`）のSHA-256が完全一致するかを検査します。一致したときに限り、隔離コピーと現在の共通認証のJSONを比較します。

**出力例の意味：**

- `globalAuthReview.baseline: HISTORICAL_BYTES_MATCHED`：隔離コピーのバイト列が保存済みスナップショットのハッシュと一致。共通認証の現在の内容とは一致するとは限りません。
- `globalAuthReview.pattern: TOKEN_REFRESH_COMPATIBLE`：旧・新JSONにおける変更が、アクセストークン、有効期限、整合したIDトークンなど、既存コードの許容する更新パターンに限られること。書込元が本物のclaspかどうかを**証明しません**。
- `HISTORICAL_BYTES_NOT_MATCHED`、`UNVERIFIED`、`HISTORICAL_COMPARISON_UNAVAILABLE`：自動で原因を決めない。旧認証コピーが過去に更新された、内容が一致しない等の可能性があります。
- `writer: UNVERIFIED` / `ownerReview: REQUIRED` / `snapshotWrite: PROHIBITED` / `status: HOLD` は、どの結果でも変更されません。

```powershell
cd $HOME\Development\Furusato_nouzei_GAS_OCR
git pull --ff-only origin feature/gas-workflow-20261106
node gas/scripts/plan-v020-private-stage.cjs
```

ハッシュ・OAuthトークン本文・認証JSON・Google Script ID・URL・ローカル絶対パスは表示しません。隔離認証コピー、共通認証ファイル、既存レシート、保護スナップショット、HousingERP、Google側の設定には書き込みません。**トークン更新パターンが一致してもHOLDを自動解除しません。** 未確認の書込元を推測で承認したり、保護ハッシュを差し替えたり、認証ファイルを再初期化したりしないでください。今回の検査はGoogle APIに接続する前に停止するため、v0.1.20の実Google OCRの受入を証明しません。


## 2026-11-09：HISTORICAL_BYTES_NOT_MATCHED の原因分析（revision 6）

実PC①の結果は `global-clasp-auth:CHANGED` かつ `globalAuthReview.baseline:HISTORICAL_BYTES_NOT_MATCHED`、`pattern:UNVERIFIED` でした。この結果は**隔離認証コピーが既存レシートの過去共通認証ハッシュと一致しない**という事実だけを示します。改ざん・不正利用・通常トークン更新のいずれも断定できません。

コード上の作成時点を確認すると、`reuse-auth` は共通 `~/.clasprc.json` の内容を隔離 `.private/furusato/auth.json` にコピーし、その**後**、`install` が保護スナップショットに共通認証のSHA-256を保存します。したがって、隔離コピーは保存時の共通認証の真正な原本だと保証できず、時間差・認証更新・別の書込元などによる差異をこの2ファイルだけで再構成することはできません。

revision 6では、この不確実性を保持したまま、**隔離コピーと現在の共通認証の間**の限定的なOAuthトークン更新パターンを、歴史的ハッシュ不一致でもオフラインで独立比較します。出力の `pattern` はこの現在の2ファイル間の差分のみで、`comparisonScope: ISOLATED_COPY_VS_CURRENT_GLOBAL_ONLY`、`historicalSnapshotReconstruction: NOT_PROVEN`、`writer: UNVERIFIED` と明示します。`TOKEN_REFRESH_COMPATIBLE` でも過去の共通認証との同一性や書込元が証明されたことにはならず、**常に status:HOLD / ownerReview:REQUIRED / snapshotWrite:PROHIBITED** とします。

```powershell
cd $HOME\Development\Furusato_nouzei_GAS_OCR
git pull --ff-only origin feature/gas-workflow-20261106
node gas/scripts/plan-v020-private-stage.cjs
```

**今回の制約の下では過去の共通認証原本をハッシュ値だけから復元することは不可能です。** 認証・レシート・保護スナップショットの書換え、`git reset --hard`、旧GAS上書き、合成環境の勝手な新規作成は行いません。現在の共通認証を隔離コピーで置き換えることも禁止です。所有者が変更履歴を確認するか、過去の信頼できるバックアップが別途見つからない限り、元の厳格な保護ゲートはHOLDのままです。この調査自体はGoogleへ接続しません。

## 2026-11-09 PC① 11:12 — revision 6の実行結果とrevision 7の安全な切分け

PC①でrevision 6を再実行した結果、`HISTORICAL_BYTES_NOT_MATCHED`、`pattern:UNVERIFIED` が再現しました。HousingERPの保護設定3件は `UNCHANGED`、`global-clasp-auth` のみ `CHANGED`、GitHubの開発先端SHAとの一致はPASSです。

`UNVERIFIED` は既存の `oauthRefreshPattern` において多数の状況を一括した結果です。**不正変更・正常更新のいずれとも判定できない**ことを維持します。revision 7では「隔離コピー」と「現在の共通認証」の2ファイルだけをローカルで比較し、限定的な `globalAuthReview.pairDifference` を追加します。

- `STABLE_CREDENTIAL_FIELDS_DIFFER`：比較した認証ペアのrefresh token・client ID・client secretのいずれかに差異。値そのものや識別子は表示しません。過去に保存された内容との比較とは別です。
- `SCHEMA_OR_TOKEN_FIELDS_UNEXPECTED`：認証JSONが既存の想定形や必要な文字列・時刻値を満たしていない。
- `OTHER_CREDENTIAL_METADATA_DIFFERS`：認証ペアで、一般的な短期トークン・有効期限以外のメタデータにも差異。差異の具体的なJSONキーは表示しません。
- `TRANSIENT_TOKEN_FIELDS_NOT_VERIFIED`：固定的な認証項目とその他のメタデータは一致するが、トークン／期限欄に関する厳格な更新条件を満たしていない。
- `KNOWN_REFRESH_FIELDS_COMPATIBLE`：比較対象の2ファイル間は既存のトークン更新パターンと一致する。ただし**保存時の認証原本や書込元を証明しない**。
- `NOT_ASSESSED`：比較可能なファイルが得られなかった、または他の保護項目も変わっている。

診断は**読取専用**で、認証本文・ハッシュ・パス・変更されたキー名・トークン・ID・Google URLを表示しません。すべての結果で `stage:PROTECTED_LOCAL_CONFIG`、`status:HOLD`、`snapshotWrite:PROHIBITED`、`writer:UNVERIFIED`、`historicalSnapshotReconstruction:NOT_PROVEN`、`realV020GoogleAcceptance:NOT_TESTED` を維持します。

```powershell
cd $HOME\Development\Furusato_nouzei_GAS_OCR
git pull --ff-only origin feature/gas-workflow-20261106
node gas/scripts/plan-v020-private-stage.cjs
```

これ以上この同じ2つの認証ファイルを読み直しても、保存時の実バイト列が別の信頼済み保管先に存在しなければ、過去のハッシュ一致を復元できません。**保護を解除するためのハッシュ再保存、認証ファイル上書き、資格情報の再初期化は行いません。** v0.1.20を検証するには、所有者の個別承認を得て、既存v0.1.17に触れない独立隔離ステージへ移るための別途設計・復旧手順が必要です。
