源泉徴収票のオフライン読取基盤（開発版）

PDFは埋込文字とG04等の項目コード＋座標で解析し、画像／スキャンPDFは端末内Tesseract（日本語＋英語）を使用。JPEG、PNG、WebP、TIFF、BMP、HEIC／HEIF（プラグイン必須）、CSV、TSV、TXT、定義済みJSONをサポート。個人名・住所・個人番号は抽出結果に保存しない。外部クラウドへ送信しない。

実行: python tools/withholding_reader.py --input slip.pdf --output result.json --bridge result.tsv

PDF依存: PyMuPDF。OCR依存: Pillow、pytesseract、Tesseract本体のjpn/eng言語データ。HEICはpillow-heif。コード位置が曖昧な場合、欠損、年度未承認の場合はREQUIRES_REVIEW。画像OCRは現段階では自動承認しない。READY_FOR_EXCEL_CROSSCHECKは数値抽出の候補であり、税額計算PASSではない。住宅ローン控除や分離課税は別フォームへ反映し、未対応の税額計算はHOLDとする。

Source samples should never be committed to a public repository or uploaded to CI. User data should be kept locally.
