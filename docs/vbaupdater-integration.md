# VBAUpdater連携（開発者向け・試験導入）

VBAUpdater本体はプライベートリポジトリであり、この公開リポジトリへ複製しません。
実装対象は **既にPC①で受入済みの合成レビュー用 XLSM** の一時コピーだけです。
税制マスタ、計算式、顧客案件ファイル、既存のVBAUpdater設定は変更しません。

## 開発手順

1. 配布ZIPから既存 `START_SETUP.cmd` でレビュー用 `Furusato_nouzei.xlsm` を生成し、独立した `verify_excel.ps1` 受入を通します。
2. `tools/prepare_vbaupdater_project.py --workbook <verified.xlsm> --destination <new-empty-folder>` で、`project.json`・`source/standard/TaxLawUpdater.bas`・`target/Furusato_nouzei.xlsm` をステージします。出力フォルダは存在してはいけません。
3. `tools/verify_vbaupdater_bridge.ps1` はステージングした隔離ブックに対して、VBAUpdaterがあれば `project-preflight` と **読み取り専用** `project-diff` を実行します。インストールされていなければ `PREPARED_UPDATER_NOT_FOUND` と明記します。
4. GitHub ActionsのPC①実機受入は、既存の税額計算・バックアップ・PDF・案件保存PASSに加えて連携証跡 `vbaupdater_bridge.json` を保存します。

VBAUpdater CLI は `VBAUPDATER_ROOT` 環境変数、または `%USERPROFILE%\Development\VBAUpdater` / `%USERPROFILE%\VBAUpdater` の順に探します。
VBAUpdaterのソースを外部へ送信せず、実行出力から個人のローカルパス等を公開CIログに転載しません。

`project-push`、`project-sync`、`workbook-apply` はこの段階では実行しません。
VBAUpdater自身の復元・差分エンジンに既存プロジェクトのコピーを取り込むための準備と非破壊照合までです。
将来の書込テストは別の隔離コピーで、SHA-256・内蔵52回帰・保存後のExcel再読込・復元試験を伴う場合に限ります。
一般利用者にVBAUpdaterをインストールさせる設計ではありません。

**正式受入はHOLD、Draft PRを維持。**
