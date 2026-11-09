# GAS v0.1.16: 新しい原票選択時の安全停止・非同期競合排除

## 監査した問題
以前のJSON/TSVの取込が`READY_FOR_EXCEL_CROSSCHECK`で原票確認済みとなった後、
別のカメラ写真またはPDFを選んでも、OCRボタンを押す前は旧原票の状態が残る。
その間に既存値・控除チェックで計算すると、**選択済みの新原票を未照合のまま扱う**可能性がある。
また、進行中のJSON読取の`onload`が「読取破棄」後に到着すると、古い
`READY_FOR_EXCEL_CROSSCHECK`を復活させ得る。

## 修正仕様
- カメラ写真/通常PDF/画像の**新しいファイル選択**で、即時
  `sourceStatus=REQUIRES_REVIEW`、原票確認チェック解除、源泉票照合欄非表示、
  扶養等の旧原票由来ロック解除、控除確認チェック解除。OCR未実行でも計算HOLD。
- JSON/TSVへ再切替、読取破棄、OCR実行開始時に世代番号`sourceFileSequence`を更新し、
  古いFileReader `onload/onerror`を破棄する。旧OCRは既存`ocrSequence`で破棄。
- 支払額などの手入力欄は新原票選択だけでは削除せず、勝手なデータ転送も行わない。
- Apps Script HTML ServiceのWebアプリ出力に公式viewport設定`viewport-fit=cover`追加。
- 税制マスタ、税額計算エンジン、Google Drive OCR、導入権限は不変更。

## 独立テスト
`gas/tests/test-browser.cjs`:
(1) 前の読取READY+確認済み→新写真選択→OCR前計算HOLD、
(2) 読取中に破棄→遅着onload無視、
(3) 読取中に新カメラ選択→遅着onload無視。
PC/スマホ画面・OCR合成試験も既存CIで再実行。

**受入境界**: 合成オフラインブラウザとPC① Edge。物理iPhone/Androidでの操作、
新規Google隔離デプロイと実Google OCR、実物印刷は未受入。正式公開はDraft/HOLD。
顧客原票、個人識別情報、GAS認証情報はGitHubへ登録しない。
