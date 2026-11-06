# Furusato_nouzei GAS Web版 — v0.1.0（開発・検証版）

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

## Apps Script Webアプリの実行準備
現段階では **GitHub内のソースであり、Google上のGASプロジェクト作成・Webデプロイは未実施** です。
Google Sheetsの実データとは連動させていません。開発者による手順例：

1. 利用者用の**新規**Googleスプレッドシートを作る。
2. 「拡張機能 → Apps Script」でプロジェクトを作り、`gas/Code.gs` と `gas/Engine.gs` の内容を同名ファイルへ貼る。
3. `gas/Index.html` をHTMLファイルとして追加。必要に応じ `gas/appsscript.json` のスコープを確認・設定する。
4. エディタから `setupBoundSpreadsheet` を**明示実行**して参照シートを作る。既存の税制シートの上書きは禁止。
5. Webアプリとしてテストデプロイし、アクセスは**自分のみ**・実行ユーザーも自分として設定。URLを外部公開しない。
6. 匿名の合成データで「7,000,000円／社保1,000,000円／令和8年分 → 約109,000円」の参照ケースを検証。
7. PC/スマホの画面、印刷/PDF、安全停止、意図しないデータ保存がないことを確認してから試験運用の可否を判断。

2026-11-06現在、このチャットの接続ツールではApps Scriptプロジェクトへのコードアップロードとデプロイ操作は提供されていないため、
未デプロイの状態を成功として扱いません。

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
