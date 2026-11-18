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

現在の同一HEAD受入候補は署名・表示環境・物理紙面・独立税務監査・最終承認の正式公開ゲートが残るため、事前検証は `CANDIDATE_VERIFIED_PUBLICATION_HOLD` と表示します。`--publish` を指定しても、VBAの信頼済み署名・読取EXEの有効なAuthenticode・他の2表示条件・物理紙面・2025/2026年独立税務監査・非公開の明示的最終承認が揃わなければ、GitHub APIアクセスより前に拒否します。現状のCI結果を手作業で `READY` と書き換えても公開できません。今後これらの証拠を実際に取得し、GitHubに秘密鍵や顧客情報を上げずに、別途正規の最終承認経路を実装してから公開判定します。公開スクリプトはタグやReleaseの上書きを拒否します。

詳細は[税務照合範囲](excel-v41836-tax-scope.md)をご確認ください。
