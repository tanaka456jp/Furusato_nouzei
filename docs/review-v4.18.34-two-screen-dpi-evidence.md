# v4.18.34 — Excel表示画像の上部・下部検証とDPI仮想化の区別

## v4.18.33実機で確認した事実
[CI #42452875404](https://github.com/tanaka456jp/Furusato_nouzei/actions/runs/42452875404) の全4ジョブはSUCCESS。
PC①の専用の合成データExcelから実際に取得した表示証跡（画像）は
`CAPTURED_REQUIRES_VISUAL_REVIEW`、`release_approved=false`。

- Windows Formsに表示された領域：1536×864。
- 当該Excelウィンドウ：120DPI（125%）。
- この組み合わせはWindowsのDPI仮想化により、
  物理解像度1920×1080を1536×864の論理画素として報告した**可能性**がある。
  しかし物理ディスプレイのモードを直接確認していないので認定はしない。
- 取得画像にはExcelリボンと数式バーが残り、
  先頭の画面下端に入力欄の続きが見切れていた。画像は合成データのみ。

## v4.18.34の変更
- 既存の180px上部除外を350px除外へ修正し、数式バー・リボンを
  画像に含めずにシートのタイトル直下から記録する（現行runnerのUI位置に対応）。
- 先頭のスクロール位置（1行）と下部確認用スクロール位置（12行）を撮影し、
  `review_excel_window_sheet_only.png` と
  `review_excel_window_lower_section.png` の2画面を保存。
- どちらかの画像が欠落した場合、GitHub CIは表示証跡の収集として不合格とする。
  全体表示品質や3倍率条件の**合格を宣言するものではない**。
- 物理解像度をDPI仮想化から推定した値を
  `inferred_pixels_if_dpi_virtualized` と
  `scenario_inferred_from_virtualized_bounds_not_certified` に記録。
  `physical_resolution_verified=false` を維持し推定と実測を分離。
- 本番環境のExcelやOS設定には触らず、
  runnerの隔離一時フォルダ内の合成XLSMだけを読取専用で開き、
  元ブックと他のExcelプロセスは維持する。

## 残る正式リリース条件
実物理ディスプレイでの1920×1080 100%、1920×1080 125%、
1366×768 150%それぞれの視認性・操作検証、
実プリンタ印刷、非機密の実税務資料と自治体の住民税額の突合、
本番GASとは隔離した実Webアプリ受入、署名済み配布の安全確認。
いずれも継続HOLD。数式・税法マスタは今回変更なし。
