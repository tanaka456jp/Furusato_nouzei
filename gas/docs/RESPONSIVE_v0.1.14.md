# GAS v0.1.14 PC・スマートフォン共通画面（Draft/HOLD）

GAS HTML Serviceの単一 `Index.html` をPC・タブレット・iPhone・Androidで共有する。
ブラウザ幅1100px以上では3列、681～1099pxでは2列、680px以下では1列。
スマホでは押下対象44～48px以上、数字入力16px以上、モード切替と前後ボタンを全幅表示。
viewport設定、iPhoneのsafe-area対応、長い日本語ラベル・金額・ファイル入力の折返しを追加。
利用者のピンチズームは制限しない。計算・HOLD・OCRデータ保護ロジックは従来の単一GASエンジンを維持。

合成QA: `node gas/scripts/build-preview.cjs` → `node gas/tests/test-responsive.cjs`。
320/375/390/430/768/1280/1920pxで表示幅・列数・入力フォント・タッチ領域・横スクロール
・給与所得の109,000円および分離課税の最大55,771円を検証。
PC①EdgeとLinux ChromiumでHTMLプレビューを試験する。画像は`gas/dist/acceptance/responsive/`。
これらは物理iPhone/AndroidおよびGoogle本番Webアプリの受入ではない。
実スマホと実Google隔離環境での確認、実紙印刷、税額の追加独立突合はHOLD。
本番GAS/Excel正式版/HousingERPにデプロイや書戻しをしない。
