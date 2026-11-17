# Excel v4.18.35 自動受入と正式配布

対象は [Draft PR #5](https://github.com/tanaka456jp/Furusato_nouzei/pull/5) のExcel単体版です。既存のv4.18.2を保持します。正式版のタグは受入を通過したPRのHEADから作成します。Web版とGAS版には適用しません。

| 必須条件 | 自動で調べる証拠 |
|---|---|
| 同一ソース | PR #5のHEAD、GitHub ActionsのRun・Attempt、独立した実行結果5ジョブ、ビルドと配布メンバーのSHA-256 |
| 税額と更新 | 2025年・2026年の合成ケース、独立Python期待値とのExcel計算比較、税制カタログ、不承認年と失敗時ロールバック、案件保存・再読込 |
| PC①実機 | Windows Excel実機、VBEのコンパイル状態、VBAマクロ、VBAUpdaterの隔離書戻し、同一XLSMでの出力 |
| 画面 | Windows出力1920×1080・125%で、操作ボタン、セル、スクロール、表示領域を検査。1920×1080・100%、1366×768・150%は対象外 |
| 印刷レイアウト | Excelが出力した合成A4 PDFの用紙、ページ数、各金額、文字、余白と印刷範囲。実紙印刷は対象外 |
| VBA署名 | 適格な証明書・秘密鍵・x86 SignTool・Office SIPが揃うときだけ署名。署名の検証に失敗した候補はHOLD。署名基盤を利用できない場合は未署名の証拠とREADMEの表示を照合 |
| 同梱EXE | Windows上の合成PDF/CSVテスト。Authenticodeの未署名状態をVBA署名とは別に記録 |
| 配布 | ZIP内の3メンバー名、重複、サイズ、CRC、シンボリックリンク、XLSMのバージョン、READMEの署名状態、全SHA-256、タグのコミット一致 |

CIのビルド成果物は自動検証の候補です。5番目のジョブ自身の成否は、CI終了後にGitHub APIから取得します。PC①や表示のモードが異なる場合は採用しません。証拠には合成データだけを使用します。個人の原票、認証情報、証明書の秘密鍵を入れないでください。

## 検証と公開

完成したPR #5の実行IDと40桁HEADを指定します。Pythonはopenpyxlが必要です。作成先は未作成のフォルダを指定します。

```powershell
python tools/publish_excel_release.py --run-id <RUN_ID> --head <HEAD_SHA> --output <未作成フォルダ>
```

全条件を通過すると `READY` とSHA-256が出ます。公開実行では未作成の別フォルダを指定し、同じ引数に `--publish` を付けます。新規Draft ReleaseにアップロードしてGitHub側の資産SHA-256を照合し、同一HEADのタグを作って公開します。既に同じタグまたはReleaseが存在する場合は停止します。途中で止まった場合は、GitHubのタグと下書き、HEAD、資産SHA-256を調べてから引き継いでください。

Excelのマクロ保護は変更しません。未署名成果物を利用するときは公式ReleaseのZIPハッシュを照合し、READMEと組織のポリシーに従ってください。[Microsoft 365のインターネット由来マクロの扱い](https://learn.microsoft.com/ja-jp/deployoffice/security/internet-macros-blocked)
