# ふるさと納税 限度額シミュレーター — 公開Webサイト（Draft / HOLD）

利用者無料、ログイン不要、広告収益による継続運営を目標とする**一般公開サイトの開発ブランチ**です。現時点では公開・配信・広告導入・検索インデックス化を行わず、税額精度の未受入を理由に **HOLD** とします。

## 現在実装したもの

- PC・スマートフォン向け日本語Web画面、手入力・試算結果・根拠表示・ブラウザから印刷／PDF保存
- `gas/Engine.gs` の同一ソースをビルド時に `public-web/dist/engine.js` へコピー（税額ロジックの分岐実装を作らない）
- 2025年・2026年の単一給与、給与850万円以下、扶養・配偶者・住宅ローン・追加控除等なしの**限定条件**のみ概算。条件外・未確認・年分不整合・入力不正は **HOLD** で金額を非表示
- 初期版ではサーバー保存、ログイン、Google Drive、源泉徴収票の外部アップロード、外部OCR API、広告配信、アクセス解析、Cookie、ブラウザストレージを実装しない。ブラウザ上の日本語OCRは試験機能として追加
- プライバシーおよび運営説明の検証用ページ。運営者の正式表示・連絡先は未確定で、公開前に必須
- CSPで外部スクリプトや `connect-src` を拒否。 `robots.txt` / HTML / HTTP `X-Robots-Tag` によって検索登録を一時禁止
- Cloudflare Pagesの静的ファイル構成に適合。**実際のCloudflareアカウントへの接続・新規サイトの作成・デプロイはまだ行っていない**

## ローカルで確認する

```powershell
git switch feature/public-web-ads-20261109
npm ci --prefix gas --ignore-scripts --no-audit --no-fund
node public-web/scripts/build.cjs
node public-web/tests/test-public-web.cjs
```

生成物：`public-web/dist/index.html`、`engine.js`、`app.js`、`style.css`、案内ページ、`_headers`、`robots.txt`。

CIで生成するファイルは**非公開のレビュー用artifact**として扱います。将来の静的ホスティング用設定は、`Build command: node public-web/scripts/build.cjs`、`Output directory: public-web/dist` を想定します。ユーザーのCloudflare権限・公開URLなしでは作成・配信できません。

## AdSenseとSEOへの対応（未実施）

1. 所得税・住民税・寄附限度額の最新一次資料照合、自治体差、家族・控除等の対象範囲を監査し、未対応ケースのHOLDを維持する。利用者が迷わない説明とアクセシビリティを検証する。
2. サイトの運営者（実名／法人名の公開範囲）、問い合わせ窓口、プライバシーポリシー、広告・Cookie管理、利用条件を正式確定。広告導入後は現行の「広告なし」説明を必ず改訂する。
3. 実スマートフォン/PC（Edge/Safari）と税額独立オラクル、印刷/PDF、ブラウザ更新時の復元設計などの受入後に、Cloudflare接続と一般公開の明示承認を得る。
4. 広告表示位置を計算操作・入力・結果付近から分離し、誤クリックを誘導しない。記事は国税庁等の原典と独自の具体例・監修履歴を明示。実際の審査を通すまで AdSense スクリプトや `ads.txt` を追加しない。
5. 審査と公開許可を得た版でのみ `noindex` / `Disallow: /` を外し、サイトマップとcanonicalを設定する。SEOページの増産より利用者に役立つ税務解説を優先する。

参考：[AdSense申請要件](https://support.google.com/adsense/answer/9724?hl=ja) ／ [広告掲載ポリシー](https://support.google.com/adsense/answer/48182?hl=ja) ／ [Google検索の品質ガイド](https://developers.google.com/search/docs/fundamentals/creating-helpful-content) ／ [Cloudflare Pages](https://developers.cloudflare.com/pages/)。

**既存の非公開GAS v0.1.17 / v0.1.20 / v0.1.23開発、HousingERP、Excel正式版、mainおよび認証情報には変更を加えません。**

## 端末内の源泉徴収票OCR（試験機能・未受入）

- `public-web/src/ocr.js`: JPEG/PNG/1ページPDF（8MBまで）、Canvasによる画像の輝度・コントラスト補正、Tesseractの日本語OCR2回、端末内PDF文字抽出＋必要時画像化。元原票のネットワーク送信は行わず、二度のOCR一致と信頼度条件、明示した原票確認チェックを通過した候補だけを手入力欄へ反映する。
- `public-web/src/ocr-review.js`: 源泉徴収票のタイトル・年分・4金額の厳密抽出、一致検査。読取候補は常に`REQUIRES_SOURCE_REVIEW`、計算結果は既存の `FurusatoEngine` のHOLD条件に従う。生の認識テキストは返さず保存しない。
- `npm install --prefix public-web --ignore-scripts --no-audit --no-fund --no-package-lock`後にビルド。Tesseract.js 7.0.0、jpn学習データ1.0.0、pdfjs-dist 6.3.289をコピーし、worker/core/言語データを同一サイト内で配信。外部CDNなし。CSP `connect-src 'self'` は同一サイト内の静的学習データのダウンロード専用であり、原票送信用APIは実装しない。
- `node public-web/tests/test-ocr-review.cjs` は合成テキストだけで項目の誤読・重複・欠損・年分不一致・信頼度不足をHOLDとすることを試験。実画像でのOCR精度、iPhone Safari、PDFレイアウト、撮影時の遠近歪み・HEICには未受入で正式公開HOLD。
- **HousingERPのGoogle Document AIを転載・利用していない。** TaxTheoryAudioAppのSwift/Apple Vision APIもWebからは直接実行していない。両プロジェクトの帳票安全規則と画像補正の思想を採用し、ソースや利用者の実データは共有していない。
