# v0.1.17 実Google OCRへの安全な引継ぎ（iPhone実機撮影合格後）

## 現状と受入境界

- 2026-11-08のiPhone実機で、Safariの公開**静的合成デモ**の画面遷移・カメラ起動・撮影確定・画面復帰・写真変更時の同意解除をユーザーが確認済み。
- 2026-11-07の旧版v0.1.5では隔離した実Google GASで合成PNG/PDF OCRと一時文書残数0を確認済み（`deployment/audit/REPORT.md`）。
- 現在のv0.1.17についてはGoogle非公開デプロイ・実Google OCRは**未受入**。CIのChromium/PC① Edgeは実Google環境ではない。
- 正式リリースはHOLD。顧客の源泉徴収票、個人情報はテストに使用しない。

## 本番GASを一切触らない安全手順（隔離Windows PC・Google認証済みの作業者のみ）

専用の隔離Git worktreeに最新PR #2のHEADをチェックアウトし、以下を実行。
`gas/.private/furusato/`の認証・レシート・専用clasp情報は**当該worktreeの既存保護ファイル**を利用し、
別worktreeへコピーする場合も所有者の許諾と管理が必要。既存の業務シート、HousingERPおよび本番Apps Scriptには触れない。

```powershell
npm ci --prefix gas --ignore-scripts --no-audit --no-fund
# 1. 完全オフライン・変更なしの隔離GAS受入可否判定
node gas/scripts/check-live-ocr-readiness.cjs --protected-root ../HousingERP
# 2. READYの場合のみGoogleの固定版・権限・保護対象を読取照合（更新なし）
node gas/scripts/check-live-ocr-readiness.cjs --verify-remote --protected-root ../HousingERP
# 3. 所有者が合成Googleドキュメントの作成・削除を許可した場合に限り実OCR検証
node gas/scripts/check-live-ocr-readiness.cjs --run-synthetic --ack-temporary-google-docs --protected-root ../HousingERP
```

ステップ1が`HOLD`ならそのまま停止する。専用認証なし・隔離デプロイのバージョン不一致・外部修正・保護設定の差分・Git HEAD不一致を**自動修復しない**。
`--verify-remote`はGoogle API読取のみ、`--run-synthetic`は専用の合成画像のみをOCRに渡し、Google側で一時文書の作成/削除を行う。
CI/共有runnerではGoogle認証・実OCRを実行しない。

`--run-synthetic`は既存の`test-real-browser.cjs --live --attest-head --token-auth`を実行し、
合成PNG/PDF/JPEGの候補、HOLD、一時ファイル残数0と計算の根拠を検証する。
実Googleの証跡は`gas/.private/furusato/evidence/`のみに保存し、スクリーンショット・ID/URL・OAuth・レシートをGitHubへ追加しない。
CLIの出力にも個別URL・ハッシュ・IDを載せない。

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
現在の静的URLはOCR機能を持たず、実Google接続の合格にはならない。
