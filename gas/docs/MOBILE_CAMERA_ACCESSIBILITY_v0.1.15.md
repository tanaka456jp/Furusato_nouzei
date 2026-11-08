# GAS v0.1.15 — スマホの撮影導線／アクセシビリティ改善（Draft/HOLD）

- 同じGAS画面でPCファイル選択とスマホのカメラ撮影(`capture=environment`)を選べる。
- カメラ撮影・画像選択はユーザー操作が必要。OCRを押す前にGoogle Drive一時転送に明示同意を要求。
- 2MB以下のPDF/JPEG/PNGは従来通り送信準備。PDFが2MB超なら拒否。
- 2MB超・20MB以下のJPEG/PNG/ブラウザが読めるHEIC/HEIF画像は端末のCanvasで
  最長辺2400→2100→1800→1600px、JPEG品質0.86→0.72→0.58を順に試し2MB以下へ変換する。
  変換できない・50MP超・ブラウザ非対応の場合は明示エラー。元画像を勝手にアップロードしない。
  変換はオプトイン後、ローカルメモリ内。Googleへ送るのは署名チェック付きの対応MIME画像のみ。
- OCRは候補転記のみ。ユーザーの原票照合前は`REQUIRES_REVIEW`／寄附限度額`HOLD`。
  OCR結果の自動承認はしない。選択変更後に遅着した旧OCR応答はnonceで拒否。
- 5段階入力の画面切替後に見出しへフォーカスを移し、aria-liveとaria-currentで進行を通知。
  PCのキーボード操作とスマホの支援機能を共通化。従来の計算・税制表不変更。
- `test-mobile-camera.cjs`でスマホ幅/横向き/PC、2MB超の合成画像、圧縮、同意、
  HOLD、見出しフォーカスをオフラインChromiumとPC① Edgeで回帰。画像や原票は保存しない。

この試験は物理iPhone/Android、実Google撮影取込・OCRデータ処理の確認ではない。
既存GASデプロイ・HousingERP・Excel mainは変更しない。正式配布判定Draft/HOLD継続。
