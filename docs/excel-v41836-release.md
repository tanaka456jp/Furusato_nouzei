# Excel v4.18.36 自動受入と正式配布（次期版）

2026年11月18日に公開した **v4.18.35は維持**します。次期v4.18.36は複数人の給与所得限定一覧、特定親族の5人上限、PDF所得年認識修復、個別案件へのデータ混入防止を対象とし、Draft PR #5の新しいHEADから**別タグ**として発行します。公開済みのタグ・Release・本番GAS・Web版は上書きしません。

## 必須の自動受入

1. Draft PR #5の現HEADと同じGitHub Actions実行で `static`・`windows_compat`・`document_reader`・`excel`・`ready_to_use_review` の5ジョブがすべてSUCCESS。
2. PC① Excel 365でVBEコンパイル、2025/2026年の独立合成検算、5ページの独立5行、HOLDの限度額空欄、個別案件保存の分離、5人親族の境界、税制更新・ロールバック・保存再読込、VBAUpdater隔離書戻しを検査。
3. ローカル源泉徴収票読取EXEとXLSMが同じ実行のハッシュと一致し、配布ZIPの展開・再読取・README・バージョン・第三者ライセンス情報が一致。実顧客PDF、氏名、住所、個人番号をGitHub/CIへ登録しない。
4. 実画面の自動実機検証は**1920×1080・125%のみ**。1920×1080・100%、1366×768・150%、物理プリンターの出力は自動版の検証範囲外。合成A4 PDFの印刷レイアウトは検査する。
5. VBA未署名では **UNSIGNED**を明記し、同梱EXEのAuthenticode未署名も別に開示。署名ありと表示するには署名の真正性・Office SIP等を検査。Office全体のマクロ保護は解除しない。
6. **新タグv4.18.36が未使用であること、公開直前のHEADと公開資産SHA-256が一致すること**を検証する。現行v4.18.35は変更しない。

## 版数・パッケージの整合

正式版用XLSMの画面表示、配布ZIP、README、CI受入レポートには同じ **v4.18.36** を使用します。実機検証用の `REVIEW_HOLD` ZIPは正式版として再配布しません。

次のコマンドは同じ最新HEADと5ジョブSUCCESSのRunに限り、未作成のディレクトリを指定してください。最初の確認コマンドは公開を行いません。

```powershell
python tools/make_excel_release_readme.py --version v4.18.36 --head <HEAD_SHA> --output <非公開フォルダ>\README.txt
python tools/publish_excel_release.py --run-id <RUN_ID> --head <HEAD_SHA> --output <未作成の検証フォルダ>
```

現在の同一HEAD受入候補はPC①のEXE起動拒否・表示環境・物理紙面・独立税務監査・最終承認の正式公開ゲートが残るため、事前検証は `CANDIDATE_VERIFIED_PUBLICATION_HOLD` と表示します。`--publish` を指定しても、PC①での読取EXE実行成功・同一HEADの配布ZIPのSHA-256一致・他の2表示条件・物理紙面・2025/2026年独立税務監査・非公開の明示的最終承認が揃わなければ、GitHub APIアクセスより前に拒否します。現状のCI結果を手作業で `READY` と書き換えても公開できません。今後これらの証拠を実際に取得し、GitHubに秘密鍵や顧客情報を上げずに、別途正規の最終承認経路を実装してから公開判定します。公開スクリプトはタグやReleaseの上書きを拒否します。

詳細は[税務照合範囲](excel-v41836-tax-scope.md)をご確認ください。

**署名は任意です。** 未署名のXLSM・読取EXEも配布対象ですが、署名済みとは表示せず、同一HEAD・SHA-256・PC①の実機EXE起動確認を必須とします。セキュリティ制限の自動解除は禁止します。任意に署名する場合のみ[署名手順](sign-reader-exe.md)を参照してください。

## 公開操作の追加安全ロック（署名済み最終ZIPの独立受入経路が未完成）

現状の `publish_excel_release.py` はGitHub Actionsの受入候補を検証できるだけで、署名後の別ZIPを暗号学的に同定し、非公開の税務・実画面・実印刷・発行者承認と結び付けて公開する経路がありません。したがって **`--publish` は、署名状態や承認フラグを手動で全部合格に書き換えても必ず `PUBLICATION_HOLD:SIGNED_FINAL_PACKAGE_ROUTE_NOT_IMPLEMENTED` で拒否**します。これはGitHub APIによるタグ・Release作成より前に実行します。ステージング用 `prepare_official_excel_release.py` も従来どおり `HOLD` です。

正式公開を可能にするには、独立した署名済みアーカイブと配布ハッシュの実体検証・承認者認証・発行対象の固定・非公開証拠の最終監査を実装してテストし、上記ロックを意図的に解除する別の開発・受入工程が必要です。現時点ではタグ `v4.18.36` を発行しません。

EXE署名に使用するSignToolも、VBA署名と共通のWindows SDK x86版・Microsoft署名の確認を必須とします。署名用ソフト自身の真正性を検証できない場合は署名を実行せずHOLDです。

## 署名済み最終ZIPのローカル組立（2026年11月20日追加・公開許可ではない）

`tools/assemble_signed_release_local.py` は、同一HEADのCI合格済み **未署名** XLSM・EXEと、PC①で個別に署名した **別ファイル** 2つを照合し、**リポジトリ外の非公開フォルダ**に3ファイル構成の最終候補ZIPを組み立てます。入力する2つの署名実行証跡は `sign_excel_vba_local.ps1` の `furusato-local-vba-signing/v2` と `sign_reader_exe_local.ps1` の `furusato-reader-authenticode-local/v1` です。

```powershell
python tools/assemble_signed_release_local.py `
  --head "<PR_HEAD_SHA>" --run-id <同一HEADの5ジョブ合格Run-ID> --version v4.18.36 `
  --accepted-book "C:\Private\accepted\Furusato_nouzei.xlsm" `
  --signed-book "C:\Private\signed\Furusato_nouzei_signed.xlsm" `
  --accepted-reader "C:\Private\accepted\FurusatoDocumentReader.exe" `
  --signed-reader "C:\Private\signed\FurusatoDocumentReader_signed.exe" `
  --vba-evidence "C:\Private\signed\vba_signing_local.json" `
  --reader-evidence "C:\Private\signed\reader_signing_local.json" `
  --accepted-book-sha "<CIで受入済みの未署名XLSM SHA-256>" `
  --accepted-reader-sha "<CIで受入済みの未署名EXE SHA-256>" `
  --target "C:\Private\final\Furusato_nouzei_v4.18.36_ReadyToUse.zip" `
  --receipt "C:\Private\final\local_assembly_hold.json"
```

このコマンドは署名を行いません。署名済みXLSMとEXEの実バイト・署名前ソースSHA-256・VBAプロジェクト不変性・構造・証跡整合を確認しますが、**証跡ファイルの自己申告だけでは暗号署名の真正性が確認できないため**、出力は必ず `HOLD` です。ZIP生成後は `verify_signed_release_local.ps1` に署名者サムプリント、アーカイブSHA-256、署名済みZIPと独立した新規証跡パスを指定して、Office SIP・Authenticode・署名者・タイムスタンプ・Office VBA認識を実機で再検証してください。

その後も、税務独立監査、残る2表示倍率、実紙への印刷、権限ある発行者の最終承認と、署名済み最終ZIPに承認を紐付ける安全な公開処理が未完了です。**この組立ツール単独の合格で正式公開可能にはなりません。** 署名用秘密鍵、個人情報、発行承認証跡をGitHub/CI/Artifactsへアップロードしないでください。
