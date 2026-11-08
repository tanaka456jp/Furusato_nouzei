# v0.1.17 実Google OCRへの安全な引継ぎ（iPhone実機撮影合格後）

## 現状と受入境界

- 2026-11-08のiPhone実機で、Safariの公開**静的合成デモ**の画面遷移・カメラ起動・撮影確定・画面復帰・写真変更時の同意解除をユーザーが確認済み。
- 2026-11-07の旧版v0.1.5では隔離した実Google GASで合成PNG/PDF OCRと一時文書残数0を確認済み（`deployment/audit/REPORT.md`）。
- 2026-11-09に非公開v0.1.17の固定版、所有者権限とHousingERP保護をGoogle APIで照合済み。通常EdgeでのSTEP 1表示は所有者の確認済み。PDF・PNG・JPEGの実Google OCRおよび非公開GASのiPhone Safari操作は別途受入が必要です。
- 正式リリースはHOLD。顧客の源泉徴収票、個人情報はテストに使用しない。

## 本番GASを一切触らない安全手順（隔離Windows PC・Google認証済みの作業者のみ）

専用の隔離Git worktreeに最新PR #2のHEADをチェックアウトし、以下を実行。
`gas/.private/furusato/`の認証・レシート・専用clasp情報は**当該worktreeの既存保護ファイル**を利用し、
別worktreeへコピーする場合も所有者の許諾と管理が必要。既存の業務シート、HousingERPおよび本番Apps Scriptには触れない。

```powershell
node gas/scripts/check-live-ocr-readiness.cjs --verify-remote
node gas/scripts/accept-owner-ocr.cjs
```

`--verify-remote` はGoogle API読取のみです。手順がHOLDの場合は原因を診断してください。所有者用CLIは通常ブラウザを開き、画面の確認を所有者に依頼し、OCR前と各形式の処理後に固定版・保護対象・専用Driveの残数を照合します。画面観察とAPI照合は別々に記録します。

合成ファイル3件を `gas/.private/furusato/owner-fixtures/` に展開します。ZIPが手元にない場合は、Pillow、pypdf、ReportLabを用意したPython環境で作れます。

```powershell
$zip = 'gas/.private/furusato/furusato_GAS_v0_1_17_synthetic_OCR_PDF_PNG_JPEG.zip'
python gas/scripts/build-synthetic-ocr-fixtures.py --font "$env:WINDIR/Fonts/meiryo.ttc" --output $zip
Expand-Archive -LiteralPath $zip -DestinationPath gas/.private/furusato/owner-fixtures
```

非公開の証跡は `gas/.private/furusato/evidence/owner-ocr-*.json` に記録されます。新規作成・再デプロイは不要です。所有者認証のある通常ブラウザだけを使い、実Googleの操作は共有runnerやCIで行いません。

## 旧隔離GASのソースを更新したい場合

読取照合だけでは、Google側の版が古いままのケースを解消できない。
旧レシートの保護対象に差分がある場合は`diagnose`の結果を所有者が確認し、
旧ソース・固定版を上書きせず、クリーンな隔離環境の選択・専用認可を行う。
所有者による明示承認なしに`install --synthetic-update --deploy`や`--fresh --deploy`を自動実行しない。

## iPhoneで実GASを操作する場合

合成専用の非公開Webアプリの`/exec` URLは専用PCの非公開レシートにだけ保存する。
共有チャットやGitHubへURL/認証・画面原本を転載しない。Safariでは**デプロイ所有Googleアカウント**でログインする。
Google側が`MYSELF / USER_DEPLOYING`となることをAPIで確認済みのURLだけ開く。
実GASでのカメラ→画像確定→原票ごと再同意→OCR候補→計算HOLDを合成用紙で確認する。
Windows側で `node gas/scripts/accept-owner-ocr.cjs --iphone` を実行して、iPhone Safariの目視結果と処理前後のDrive件数を別に記録できます。カメラを使う場合は合成用紙を撮影してください。
現在の静的URLはOCR機能を持たず、実Google接続の合格にはならない。
