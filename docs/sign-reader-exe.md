# ローカル読取EXEのAuthenticode署名（秘密鍵はPC①のみ）
対象は同一HEADの自動受入に合格したFurusatoDocumentReader.exeです。Excel VBAの署名とは別作業です。**現行のv4.18.36候補は未署名であり、公開HOLD**です。

## 手順
1. PC①に正規のコード署名証明書（EKU 1.3.6.1.5.5.7.3.3）と秘密鍵への権限、Windows SDK SignTool（x64）を正規の手続きで用意します。証明書・秘密鍵をGitHub、CI、Artifactsへ登録しません。勝手に自己署名証明書を作成しません。
2. 受入済みEXEのSHA-256を独立確認します。入力EXEと異なる**リポジトリ外の非公開フォルダー**に出力します。既存出力の上書きは拒否します。
3. まず次の**事前検査のみ**を実行します（署名は実行されません）。

\`\`\`powershell
.\tools\sign_reader_exe_local.ps1 -SourceExe "C:\Furusato\accepted\FurusatoDocumentReader.exe" -OutputExe "C:\Furusato\private\FurusatoDocumentReader_signed.exe" -ExpectedSourceSha256 "<受入済みEXEの実際の64桁SHA-256>" -CertificateThumbprint "<実在する40桁の署名証明書Thumbprint>" -TimestampUrl "https://timestamp.digicert.com"
\`\`\`

4. 人手で証明書・配布契約・署名者を確認した場合のみ、同じ引数に \`-Execute -EvidencePath "C:\Furusato\private\reader_signing.json"\` を追加します。GitHub Actions等のCIでの実行は拒否します。
5. 実行時は原本を保持したコピーにSHA-256/RFC3161で署名し、SignTool verify（/pa /all /tw）とWindows Authenticodeの署名者・タイムスタンプを検査します。失敗時に作成されたEXEは削除します。新しいEXEハッシュとローカルのみの証拠JSONを記録します。

## 完了しても正式公開ではない
この手順は**EXE署名のみ**です。Excel VBA署名、署名後の配布ZIP・README・バージョン・ハッシュ再照合、画面条件、物理印刷、独立税務監査、最終承認は別の受入です。現在の自動公開経路は無署名EXEを前提に作られており、**署名済みEXEをそのまま差替えたり旧ハッシュを流用して公開してはいけません**。署名済み配布物の正式受入経路が別途完成するまではHOLDを維持します。

Microsoft公式： [SignTool](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool) / [RFC3161](https://learn.microsoft.com/en-us/windows/win32/seccrypto/time-stamping-authenticode-signatures)
