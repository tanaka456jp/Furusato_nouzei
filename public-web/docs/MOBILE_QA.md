# スマートフォン実機・ローカル動作試験（合成原票専用）

正式公開ではありません。GitHub ActionsのMOBILE_LOCAL_QA成果物をPCへダウンロードし、展開します。Node.js 22以上を使用します（既にある場合は再インストール不要）。npm installは不要です。

1. PowerShellで展開先を開き、`node scripts/serve-review.cjs --root dist` を実行。PCブラウザで表示された127.0.0.1のURLを開く。
2. iPhone/Androidを同じ信頼できる家庭内・事務所内Wi-Fiに接続。PCの `ipconfig` でWi-FiのプライベートIPv4を確認する。
3. PC側のサーバーをCtrl+Cで停止し、例として `node scripts/serve-review.cjs --root dist --lan-synthetic-only 192.168.1.10` を実行する（IPは実際のPCアドレスに置換）。
4. スマートフォンのSafari/Chromeで表示されたURLを開く。接続できない場合は組織の管理者に確認する。ファイアウォールを無効化したり、ルーターのポート転送、公開トンネルを設定しない。
5. OCR_QUALITY_ACCEPTANCE.mdのM01〜M08を合成原票で実施し、試験後Ctrl+Cで停止する。

LAN HTTPは暗号化されない。**実原票・実際の氏名・金額を使用しない**。このサーバーは静的ファイルのGET/HEADのみ許可し、アップロードAPI、外部通信処理、アクセスログを実装しない。ブラウザ・OS・ネットワーク機器側の記録や盗聴を防ぐ機能ではない。HTTPのためブラウザの安全なコンテキストを要する機能が利用できない可能性がある。物理端末の正式受入と実原票検証は別途、承認済みの安全な環境で行う。

既定はPC内のみに限定し、LAN接続は明示指定したRFC1918のIPv4だけにバインドする。ルーターやファイアウォール設定は変更しない。サーバーは公開ホスティング用途ではない。NO DEPLOY / NO ADS / RELEASE HOLD。
