# Excel単体版：実印刷を最後に行う正式配布受入

この手順はExcel PR #5専用。現行正式v4.18.2、main、Web PR #6、本番GASは変更しない。匿名の検証ZIPを公式版と誤表示しない。

実印刷前に、次を原本の証拠とともに完了させること。

1. 最終PR HEADの同一Actions Runで5ジョブSUCCESS。ci_exact_head_acceptance_hold.jsonと署名前XLSM、リーダー、ZIPのSHA256が一致。
2. 2025/2026税制の独立税額レビュー（給与源泉徴収票、住民税所得割・寄附限度額、扶養・保険、住宅ローン、所得金額調整、非課税、翌年試算と確定申告併用）。資料外の本人条件が不明ならHOLD。実顧客書類はGitHubと公開CIにアップロードしない。
3. 1920×1080 100%、1920×1080 125%、1366×768 150%の3条件を同一ハッシュのExcelで撮影・人手目視承認。画面が1条件しか観測されない場合はHOLD。
4. 正規の証明書でEXEとVBAプロジェクトに署名。Windows Authenticode、Office/VBE署名真正性、発行者、署名後コード不変、候補ZIP SHA256を独立確認。SelfCert証明書は正式配布不可。秘密鍵を生成・GitHub登録・公開しない。
5. 署名済み3ファイル候補ZIPのREADME・画面・税制版の表記を一致させ、検証版・旧正式版の誤表示を除去。tools/verify_signed_release_local.ps1とtools/verify_excel_release_candidate.pyで最終候補をローカル照合。非公開9項目マニフェストを準備。

以上の未達が残る間は、実印刷だけが残課題だとは判定しない。

最後に実印刷する際は、署名済み候補ZIPと一致するブックのみを使用。匿名合成データで明示指定のA4物理プリンターへ1ページを印刷し、紙面の文字欠け・改ページ・表示税額・限度額を人手で確認する。証拠はプライベート領域に保管。

ローカルの物理確認JSONスキーマ furusato-physical-paper-manual/v1 は次のフィールドだけを持つ:
schema, signed_candidate_archive_sha256, printed_workbook_sha256, tax_year,
expected_limit_yen, observed_limit_yen, physical_printer_confirmed,
one_page_a4_checked, paper_physically_observed, paper_readability_reviewed,
tax_amounts_cross_checked, only_synthetic_data, reviewer_role,
manual_human_review, release_decision (HOLD).

紙面を実見しない限り真偽値をtrueにしない。ファイルのSHA256をprivate manifestの physical_printer_preview_and_output に登録する。

すべての証拠がそろった後、社内Windows端末で次を実施する（出版はしない）。

python tools/prepare_official_excel_release.py --head HEAD40 --run-id RUNID --version vX.Y.Z --candidate SIGNED.zip --expected-sha256 EXPECTED64 --ci-receipt ci_exact_head_acceptance_hold.json --private-manifest private_manifest.json --signature-evidence signature_verification.json --physical-paper-review private_paper_review.json --output-folder NEW_PRIVATE_STAGE_DIR

これは署名済み候補の元バイトを変更せずにZIP・SHA256SUMS.txt・release-preflight-vX.Y.Z.jsonを生成する。成功でも STAGED_NOT_PUBLISHED / HOLD。最終の発行者と本人確認、署名原本、公開対象SHAと未使用タグ、GitHubの正式Release公開は別途の明示的な承認と操作を要する。既存v4.18.2リリースは上書きしない。


## 正式候補の表示とREADMEを一致させる（署名前）
次期Excelブックは v4.18.35 を候補版番号とし、「検証版」という表示を削除する。ただしこれは配布承認ではない。
ソースHEADの全CI（Excel実機を含む）が成功し、税務/表示の受入が済んだ後、正規の証明書でExcel VBAプロジェクトとEXEに署名する。Office/VBEの署名真正性を確認した後、次の作業をGit管理外のPC上で行う。

```powershell
python tools/make_excel_release_readme.py --version v4.18.35 --head "<現在の40桁HEAD>" --output "<PRIVATE>\\README.txt"
python tools/assemble_excel_candidate_local.py --book "<PRIVATE>\\Furusato_nouzei.xlsm" --reader "<PRIVATE>\\FurusatoDocumentReader.exe" --readme "<PRIVATE>\\README.txt" --version v4.18.35 --target "<PRIVATE>\\Furusato_candidate.zip"
```

上記アーカイブ作成は署名を検証・適用しない。続けて既存の `verify_signed_release_local.ps1` と `verify_excel_release_candidate.py` で、EXE署名、VBA署名構造、ZIP SHA256、Excel表示版とREADME版、CI同一HEAD、非公開の税務レビューを照合する。
実印刷はこの最終署名済み候補を用い、印刷するブックが同一SHA256か確認する。検証版REVIEW_HOLD ZIPを正式版として流用しない。
