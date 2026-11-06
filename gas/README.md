# Furusato_nouzei GAS Web版 — v0.1.5（開発・検証版）

## 目的
Excel VBA版 v4.18.2 の計算仕様を正本として、e-Tax Webのようなステップ式で
「基本情報 → 所得 → 控除 → 入力確認 → 限度額＋計算根拠レポート」を表示する。
**現行版は実験用の独立実装**であり、Excel製品の正式版を置き換えません。

## 初期実装（実際に動く範囲）
- スマートフォン対応のHTML Serviceによるステップ式Web UI
- 令和7・8年分の「給与所得のみ・扶養なし・配偶者なし・保険料控除なし・住宅ローン控除なし・追加所得なし」の標準ケース
- 年度別の所得税基礎控除、給与所得控除の限定式、所得税限界税率、住民税標準課税所得と所得割20％上限
- 結果画面に限度額・各中間値・税制版を表示。ブラウザの印刷機能からPDF保存可能
- 対応対象外の条件は必ず `HOLD` として限度額を表示しない（fail closed）
- 既存Windowsローカル読取ツールのJSON/TSV（氏名等を含まない）を仮入力可能
- 入力した個人情報・税額・原票はGoogleスプレッドシートにもGitHubにも**自動保存しない**
- `setupBoundSpreadsheet` は税制マスタの**参照用コピー**のみ作成し、実際の計算エンジンはコード側の承認済み数値表を使用

## 対応しないもの（正式HOLD）
- 給与660万円以下について源泉票の「給与所得控除後の金額」がない場合
- 給与850万円超と所得金額調整控除があるケース
- 生命・地震保険料控除、住宅ローン控除、配偶者/扶養/特定親族、医療費、複数所得、分離課税
- PDF/画像の自動OCR、Apps ScriptとDriveの画像認識連携
- 住民税の自治体固有の税率・特例、特殊な申告、住民税非課税判定、自治体での実額受入
- 案件の保存/共有/ログイン設計、Googleアカウントへの実デプロイ
- 入力時のPDF・個人番号・住所などの取込

実装した標準ケースも市販製品として確定的な限度額を保証するものではありません。
返す状態は `ESTIMATE` のみであり、`APPROVED` を返しません。
課税所得・住民税所得割の計算上は、所得税/住民税人的控除額差に関する標準的調整控除2,500円を用い、
対象条件を限定しています。

## v0.1.4 源泉徴収票仮取込と安全性の強化

- 読取ツールが `READY_FOR_EXCEL_CROSSCHECK` を返しても、その状態だけでは**原票との照合完了を意味しません**。画面の原票照合チェックを付けない限り結果はHOLDです。
- `REQUIRES_REVIEW`、警告が残るデータ、認識形式不正、読取項目不明、重複TSVキーなどは、読取結果の確認チェックでは解除できません。
- 読取金額の修正・年度変更では原票照合チェックを解除します。読取文書の所得年が選択年と異なる場合もサーバー側でHOLDにします。
- 令和7・8年分の源泉徴収票にある基礎控除額（G46）が取得できた場合、計算エンジンの年度別基礎控除額と照合します。不一致はHOLDです。
- 扶養・生命保険料・地震保険料・住宅ローン控除等を読取れた場合は、金額の直接利用をせず該当フラグを立ててHOLDにします。
- 未対応データや個人識別情報を含む読取JSON/TSVは拒否します。利用者の実書類とJSONはGitHub・CI・Google Sheetsへアップロードしません。
- HOLDのまま理由を記載したレポートを印刷できますが、限度額を表示しません。
- Linux/Windowsの税額計算試験に加え、DOMを用いたワークフロー・源泉票取込・HOLD解除防止のブラウザ動作試験を追加しました。

### Google接続前に画面を確認する（ローカル動作プレビュー）

`node gas/scripts/build-preview.cjs` で `gas/dist/Furusato_GAS_LocalPreview.html` を生成します。
ブラウザでこのHTMLファイルを開くと同じGAS用の税額計算エンジンを**ネット接続なし**で操作できます。
生成ファイルには明確に「ローカル検証プレビュー」と表示され、Google Apps Scriptへのデプロイ・実行承認を意味しません。

GitHub Actions `GAS workflow regression` の `Furusato_GAS_Offline_Preview_<run-id>` Artifactにも同じHTMLを添付します。
これは**ローカル試験専用**であり、販売・税務実務への利用は禁止です。
ブラウザ内の入力データを保存・送信する通信処理はありません。
`node gas/tests/test-preview.cjs` は単一HTMLによる試算と表示を自動検証します。

## Apps Script Webアプリの実行準備
現段階では **GitHub内のソースであり、Google上のGASプロジェクト作成・Webデプロイは未実施** です。
Google Sheetsの実データとは連動させていません。開発者による手順例：

1. 既に作成済みの開発用Googleスプレッドシートを開く。新規に作る場合も必ず**非公開**とする。個人のファイルIDはGitHubへ登録しない。
2. 「拡張機能 → Apps Script」でプロジェクトを作り、`gas/Code.gs` と `gas/Engine.gs` の内容を同名ファイルへ貼る。
3. `gas/Index.html` をHTMLファイルとして追加。必要に応じ `gas/appsscript.json` のスコープを確認・設定する。
4. エディタから `setupBoundSpreadsheet` を**明示実行**して参照シートを作る。既存の税制シートの上書きは禁止。
5. Webアプリとしてテストデプロイし、アクセスは**自分のみ**・実行ユーザーも自分として設定。URLを外部公開しない。
6. 匿名の合成データで「7,000,000円／社保1,000,000円／令和8年分 → 約109,000円」の参照ケースを検証。
7. PC/スマホの画面、印刷/PDF、安全停止、意図しないデータ保存がないことを確認してから試験運用の可否を判断。

2026-11-06現在、このチャットの接続ツールではApps Scriptプロジェクトへのコードアップロードとデプロイ操作は提供されていないため、
未デプロイの状態を成功として扱いません。


### claspを利用する場合（任意・Google認可が必要）

Googleの公式CLI `clasp` を利用して、既存スプレッドシートへ紐付くGASプロジェクトを作成することも可能です。
Node.js 20以降のPCで `npm install -g @google/clasp`、`clasp login` の認可後、
`gas/` フォルダで `clasp create "Furusato GAS検証版" --type sheets --parentId <スプレッドシートID>` を実行し、
生成した `.clasp.json` と `appsscript.json` の対象プロジェクト・スコープを確認した上で `clasp push` します。
`.clasp.json` は環境固有設定のためGitHubコミット対象にしません。OAuthトークン等の認証ファイルもGitHubに登録しません。
Google Apps Script APIを有効化する必要がある場合があります。実Webアプリのデプロイ操作はGoogleアカウント所有者が実施します。

公式資料：https://developers.google.com/apps-script/guides/clasp

## テスト
`node gas/tests/test-engine.cjs`
（Node 22を推奨。GitHub Actions `.github/workflows/gas.yml` はLinux/Windowsで動作する。）
本テストはGAS本体のGoogle認可・実デプロイ・OCR・Excel完全一致の代用ではありません。

## 法令一次資料
- 国税庁 No.1155: https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1155.htm
- 国税庁 No.1199: https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1199.htm
- 国税庁 No.1410: https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1410.htm
- 国税庁 No.2260: https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2260.htm
- GAS HTML Service: https://developers.google.com/apps-script/guides/html/
- GAS実行制限: https://developers.google.com/apps-script/guides/services/quotas

正式版と評価するには、所得年ごとの分岐・扶養・住宅ローン・保険・追加所得を
独立期待値と実Excelの同一入力で多数例比較し、OCRの完全性、認証、
権限制御、印刷、Windows/iOS/Androidを受け入れる必要があります。

## リポジトリ運用
`feature/gas-workflow-20261106` はExcel版の開発ブランチから派生したもの。
GAS用PRのbaseを既存の `feature/oneclick-tax-update-20261105` に設定し、
Excel版PR #1を変更・マージしない。正式リリースはHOLD。

## v0.1.4 読取安全性と配布対象の検査

- 原票から検出した住宅ローン控除・扶養・保険料控除などを `sourceIndicators` に別保持し、利用者が画面チェックを外してもHOLDになるよう改修。
- 原票由来の該当チェックは編集不可。読取データの破棄時は入力・原票照合を初期化。
- JSONの `personal_identifiers` が `NEVER_EXTRACTED` 以外の場合は取込拒否。原票側警告があれば引き続きHOLD。
- `gas/tests/test-contract.cjs` でPython読取フィールドとGAS許可項目が厳密一致することを確認。
- `gas/.claspignore` で `Code.gs`、`Engine.gs`、`SourceOCR.gs`、`Index.html`、`appsscript.json` のみGASへアップロード。生成プレビューとテストは対象外。
- `gas/.gitignore` で個人のScript IDやOAuth情報、生成プレビューを誤コミットから保護。
- Google実デプロイ、実PDF→GAS直接取込、全税制ケース一致は依然未検証。正式版はHOLD。

## GASを実際のGoogleスプレッドシートへ導入する前の確認（実デプロイ未実施）

CI `GAS workflow regression` の `Furusato_GAS_DeploySources_<run-id>` Artifactは、
`Code.gs`、`Engine.gs`、`SourceOCR.gs`、`Index.html`、`appsscript.json`、`.claspignore` の6ファイルだけを収録します。
`.claspignore` はアップロード制御用でありGAS本体へ送信されません。
実データ・Excelブック・認証情報・テストコード・プレビューは同梱しません。

Google Sheetsを開いて「拡張機能 → Apps Script」を選び、既存の`Code.gs`の内容を上書きし、
`Engine.gs`、`SourceOCR.gs`と`Index.html`を新規作成、`appsscript.json`をマニフェスト表示設定から更新してください。
最初は「デプロイ → テストデプロイ（ウェブアプリ）」を選び、非公開・所有者のみで動作を検証してください。
その後、一般公開を行うには別途認証方式・保存ポリシー・税額精度の正式受入が必要です。

**この工程はGoogleアカウント所有者の認可操作が必要**であり、GitHub Actionsの成功のみで実デプロイ成功と判断しません。
`.clasp.json` やOAuthトークンを公開GitHub/Artifactsへアップロードしてはいけません。

## v0.1.4 給与所得自動計算・税率判定根拠

給与所得の標準ケースで、所得税法の年末調整等のための給与所得控除後の表による端数処理を実装。
2025年分の給与190万円以上、2026年分の給与220万円以上、いずれも850万円以下の標準条件について、
給与所得控除後の金額の入力を省略できます（給与850万円超は旧来どおりHOLD）。
190万円～360万円／220万円～360万円は「給与総額÷4を千円未満切捨てた A×2.8−8万円」、
360万円～660万円未満は「A×3.2−44万円」、660万円以上は従来の所得控除計算。
2026年分の給与220万円未満の特殊な金額表・2025年分の給与190万円未満は、原票の給与所得額の確認が必須です。
給与所得控除後の額が入力された場合は自動計算との不一致をHOLDとし、年末調整・所得金額調整控除等の要因を確認する必要があります。
 
住民税特例控除の「適用税率」は、所得税の限界税率を単純に再利用せず、
住民税課税所得から、基本の人的控除差5万円と「所得税の基礎控除−48万円」を控除して独立計算します。
この限定条件では所得税課税所得と一致することも検証し、一致しなければHOLDにします。
結果レポートにも住民税特例控除の税率判定額を追加します。

一次資料：
- https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1410.htm
- https://www.nta.go.jp/users/gensen/nencho/index/shikata.htm
- https://www.city.sapporo.jp/citytax/syurui/shiminzei/kojin_zeigaku.html
- https://www.city.otsu.lg.jp/soshiki/005/1215/g/shimin/koujo/28359.html

上記は給与・扶養等なしの限定ケースの暫定試算であり、住民税独自の税額控除や自治体差がある場合は計算対象外です。

## v0.1.4 令和8年分・低所得給与の特別表への対応

国税庁「令和8年度税制改正（所得税の基礎控除の引上げ等関係）Q&A（2026年5月）」Q3-1、
および「No.1410 給与所得控除」を出典として、令和8年分の給与収入220万円未満の例外帯域を実装した。
- 69万1,000円以上74万1,000円未満：給与所得なし（0円）
- 74万1,000円以上219万1,000円未満：給与収入から74万円控除
- 219万1,000円以上219万3,000円未満：給与所得145万1,000円
- 219万3,000円以上219万6,000円未満：給与所得145万3,000円
- 219万6,000円以上220万円未満：給与所得145万6,000円
- 220万円以上：既存の年末調整給与所得計算表へ接続。

令和7年分は190万円未満について給与収入から65万円（下限0円）を控除する単一給与の標準ケースに対応。
これらの帯域も給与所得額を自動計算でき、原票記載額があれば1円単位の完全一致検査を行う。
給与額・社保等から所得税課税所得を算出できないケース（課税所得0円等）では、
引き続き寄附限度額を `HOLD` とし、数値を表示しない。
給与所得控除以外の扶養・住宅ローン等が未対応である点は変わらない。

参考一次資料：
https://www.nta.go.jp/users/gensen/2026kiso/pdf/0026005-024.pdf
https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1410.htm

本改正は令和8年12月1日施行分の通常年末調整を想定しており、施行前準確定申告・特殊な申告は未対応。
Google Apps Scriptでの実デプロイは引き続き未実施。正式リリースHOLD。

## Windowsから非公開GASプロジェクトを作成する補助ツール（v0.1.4）

`gas/scripts/setup-private-gas.ps1` を追加した。**何も引数を付けずに実行すると読取専用の事前検査だけ**を実施し、Googleへログインせず、コード転送・公開は一切行わない。

1. Node.js 20以上とGoogle公式 `@google/clasp` をインストールする：`npm install -g @google/clasp`。
2. Google Apps Script設定からApps Script APIによる管理アクセスを許可し、手元PCで `clasp login` を行い、正しいGoogleアカウントであることを確認する。個人用の認証情報をGitHubへ送らない。
3. 展開した配布ZIPの `scripts/` 以下にPowerShell補助ツールがある。まず展開先のルートで `powershell -NoProfile -File .\\scripts\\setup-private-gas.ps1` を実行する。
4. 利用者が**新規の非公開プロジェクト作成とコード登録を明示的に希望する場合に限り**、`powershell -NoProfile -File .\\scripts\\setup-private-gas.ps1 -SpreadsheetId <対象シートID> -CreateProject -PushSource -OpenProject` を実行する。補助ツールは `MYSELF/USER_DEPLOYING`、OAuthスコープ、5ファイル限定の転送設定を確認してから `clasp create-script` → `clasp show-file-status` → `clasp push` を行う。
5. デプロイは自動実行しない。Googleのスクリプトエディタで所有者のみのテストデプロイを明示選択し、別途実際のブラウザで確認する。

この補助ツールを含めた `Furusato_GAS_Windows_Private_Setup_<run-id>` ZIP をGitHub Actionsで生成する。
本ツールが検証できるのはローカル側ソース・最低限の設定・転送先の新規作成経路であり、認証・GAS稼働・現物印刷・会計上の正確性まで証明するものではない。
既存プロジェクトへの上書きは `-AllowExistingProject` を追加した明示操作が必要。

Google公式資料：https://developers.google.com/apps-script/guides/clasp


## v0.1.5 — PDF・画像の非公開OCR試験（実Googleでの受入未実施）

Google Drive Advanced Service v3によるPDF・JPEG・PNGの日本語OCRを追加。画面で明示同意後、2MB以下のファイルを所有者のGoogle Drive上で一時Googleドキュメントに変換し、読み取った年・金額候補だけをブラウザへ返却する。元の画像/PDF、OCR本文、氏名、住所などは結果に含めず、計算データをスプレッドシートへ保存しない。一時Googleドキュメントは成功・失敗時とも削除を試行し、削除失敗はエラー・HOLDにする。Google Drive上には処理中に一時保存が発生する。

OCR候補は常にREQUIRES_REVIEWであり、候補値から寄附限度額を自動的に算定しない。読取が不確か・原票年度不一致のときはHOLDのまま。人が原票と照合して手入力し直す必要がある。検証中は合成PDFのみ使用し、実源泉徴収票の投入は禁止。

Apps Scriptのサービス設定でGoogle Drive Advanced Service v3を有効化し、必要なGoogle Drive API設定・認可（drive.file、documents）を実施する。非公開GASでのOCR品質、削除監査、印刷、税額Excel一致は未検証。正式版はHOLD。

参考: https://developers.google.com/workspace/drive/api/guides/manage-uploads
https://developers.google.com/apps-script/advanced/drive
