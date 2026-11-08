# 実Google OCR所有者証跡のオフライン監査 v1（正式リリース HOLD）

対象: 2026年11月9日の既存非公開GAS v0.1.17に対する Windows PDF/PNG/JPEG・iPhone Safari JPEG の所有者報告。**GAS v0.1.20の実Google受入ではない。**

## 実行手順（所有者Windows作業ツリー）

既存の認証・レシート・保護スナップショット・Google資源を書き換えず、Git対象外の \`gas/.private/furusato/evidence/owner-ocr-*.json\` だけを読みます。

\`\`\`powershell
cd $HOME\Development\Furusato_nouzei_GAS_OCR
git pull --ff-only origin feature/gas-workflow-20261106
node gas/scripts/audit-owner-ocr-evidence.cjs
\`\`\`

既存の専用作業ツリー内でのみ実行してください。証跡JSON、画面原本、Google Script ID、WebアプリURL、OAuth、Cookie、個人情報はチャット・GitHub・CIへ提出しません。出力されるのは判定・形式・固定の不合格コード・件数だけであり、Git SHAや絶対パスも出力しません。**コードはGoogleへ接続しません**。

## 判定の意味

- \`OWNER_ATTESTED_STRUCTURE_PASS\`: 記録の形、指定の全形式、本人のチェック回答、各処理前後のDrive API件数0、保護検査PASS、WindowsとiPhoneで同一の記録ソースコミットを確認できること。**所有者の回答を独立再実行したという意味ではありません。**
- \`HOLD\`: 未記録・不完全・異なるソース・変則形式・残存ファイル・保護不整合・最新の失敗記録を検出。以前のPASS記録で新しい失敗を覆い隠しません。
- \`immutableDeploymentVersion: NOT_IN_OWNER_RECORD\`: 旧プロトコルのJSONにはGoogle固定版との強い結び付きがないため、ローカル検査だけでv0.1.17と断定しません。別途、受入時のGoogle API照合証跡・固定版・読み戻したソースdigestを安全なオフライン環境で突合してください。
- \`independentOcrAccuracy: NOT_VERIFIED\`: 合成源泉徴収票の正しい金額を機械的に比較したログではなく、ユーザーの確認回答です。
- \`independentDeletionOutsideOauthScope: NOT_VERIFIED\`: 0件とは専用OAuthで検索可能な範囲を指し、全Googleアカウント/全履歴における不可逆削除の証明ではありません。
- \`release: HOLD\`: 常にHOLD。現行候補v0.1.20の実Google・iPhone受入が終わるまでは正式GOにしません。

## v0.1.20の安全な次工程

1. このオフライン監査で旧受入記録をレビュー。Google固定版の歴史的対応は、秘密情報を外に出さず所有者環境で別途照合。
2. \`node gas/deployment/private-gas.cjs diagnose\` と \`node gas/scripts/check-live-ocr-readiness.cjs\` を読取専用で実行し、既存の設定ドリフト、Git/導入ソース不一致を確認。**新HEADと既存v0.1.17の不一致は予想されるHOLDであり、保護検査を無効化しない。**
3. 既存環境を更新する既存の \`install --synthetic-update --deploy\` は、現在の固定デプロイの書換えとレシート更新を伴う。既存の受入済みv0.1.17を保持する要件に対して自動実行しない。更新が必要なら対象の既存非公開合成GASに限る明示承認、復旧可能性、所有者/権限/保護ハッシュ事前照合を別途確認。
4. 同一候補版でWindows EdgeのPDF/PNG/JPEG、HOLD、各操作後の一時文書0件、iPhone Safariを実Googleで再受入。PC上の合成ブラウザCIでは代用しない。

この監査用スクリプトとテストの追加は非デプロイ・ソース変更であり、Googleに登録された5ファイル、GAS v0.1.20のアプリ実装、Excel main、本番HousingERP、認証、レシート、保護スナップショットを変更しません。
