# iPhoneでボタンが反応しない場合の合成デモ確認 v0.1.17

## 原因と使い方

ChatGPTの添付HTMLはiPhone上でファイルプレビューとして開く場合があり、
JavaScriptが実行されず「給与の入力」「次へ」などが反応しません。
この現象はアプリ本体のJavaScriptバグとは区別します。

iPhone Safari用に `gas/demo/iphone-test-v0.1.17.html` を
**GAS本番とは別の、完全自己完結型の公開用合成デモ**として用意しました。
このページは専用のGASデプロイやGoogle OAuth、実OCRを必要とせず、
Googleへの転送をしません。給与・社会保険の架空値で画面をテストできます。

公開GitHubのこのHTMLファイルを`raw.githack.com`などからSafariで
`text/html`として配信して検証します。外部CDNは第三者のサービスのため、
**実際の源泉徴収票・個人情報を一切入力・撮影・選択しない**でください。
公開URLは本番運用・正式公開URLを意味しません。
HTMLのCSPは`connect-src 'none'`でネットワーク通信を禁止し、
`<script>`とCSSをインライン化しています。

## 確認手順
1. iPhoneのSafariアプリを直接開き、専用HTTPS操作確認URLへ移動。
   CDNが確認画面を表示した場合はドメインとGitHubソースを確認して進みます。
2. 最初の画面にある「給与の入力」選択状態と「次へ」を確認。
3. 「次へ」でSTEP 2へ移り、`#ocrCamera`からiPhoneカメラが起動するか確認。
   個人情報がない白紙・ダミー帳票のみ撮影します。OCR送信は行いません。
4. iPhoneでSTEP 2へ進めない場合はSafariのURLとJavaScriptの状態、
   画面を取得し、CDN/HTMLの問題とアプリ本体の問題を分離します。

## 維持すべき範囲
- 生の`Index.html`やGitHub rawの`text/plain`ではなく、
  自己完結したHTMLを`text/html`で開く。
- v0.1.17計算エンジン、税制マスタ、GAS権限と本番デプロイは変更しない。
- `.claspignore`は`gas/demo`をデプロイ対象から除外する。
- 実iOS Safari・物理iPhoneのテストは未完了。iOSでの結果を成功と
  断定するのは所有者の実機操作報告を受けてから。
