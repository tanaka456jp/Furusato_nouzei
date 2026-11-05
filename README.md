# ふるさと納税 寄附限度額試算

Windows 11／Excel 365向け開発版。正式配布の判定はHOLDです。

- [操作手順](docs/user-guide.md)
- [税制マスタの更新管理](taxdata/README.md)
- [品質検証・残存課題](docs/review-v4.md)

## ビルドと検証

Python 3.11以降と openpyxl 3.1.5 を使用します。元の配布ブックは `workbook/baseline.xlsx` に保存しています。

    python -m pip install openpyxl==3.1.5
    python tools/qa_contract.py workbook/baseline.xlsx
    python tools/test_workbook.py
    python tools/package_review.py Furusato_nouzei_v4_REVIEW.zip

Windowsの専用テスト環境でZIPを展開し、`START_SETUP.cmd` を実行します。Excel COMと、ビルド用アカウントに許可済みのVBAプロジェクトへのアクセスが必要です。生成物の検証は `tools/verify_excel.ps1 -Workbook <生成したxlsmのパス>` を使用します。実機テストには合成データを使用します。

Excelブックは通常起動時に操作画面だけを表示します。保守時は作業用コピーでExcel VBEのシートのVisibleプロパティを変更するか、Pythonから基準ブックや生成ブックを参照します。
