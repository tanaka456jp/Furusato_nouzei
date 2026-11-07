# 2026-11-07 GAS v0.1.5 導入・検証記録

対象: tanaka456jp/Furusato_nouzei、Draft PR #2、feature/gas-workflow-20261106。
開始HEAD: `3b3262bbc1612ead84306ac29ffef213343c8aaf`。
HousingERPのGitHub比較HEAD: `3842454e25f150d14668e23759d34049c84275d1`。
正式リリース: **HOLD**。Excel正式版v4.18.2は変更しない。

## 実Google環境で完了した範囲

既存Google認証を専用ファイルへコピーし、元認証を変更せずにトークン更新を確認した。
新規の合成データ用非共有シートと紐付きGASを作成し、許可した5ファイルだけを登録した。
Google上の登録ソース、immutable version、実deployment entryPointを読み戻し、
`MYSELF / USER_DEPLOYING` を確認した（API検証時刻: 2026-11-07 09:41 JST）。
HousingERPのGoogle上ソース・デプロイ一覧、ローカル設定、元clasp認証のハッシュは前後一致した。
業務シートへの読書き、HousingERPへのコード登録・デプロイ変更、GCP/API/OAuth設定変更は行っていない。

初回登録したアプリソースdigest:
`b2ec960d8fa9f938590b8d30180aba5a091e1cb1f83889153deaf6dbe5867146`。
実行時は開始HEAD上の変更候補だったため、API証跡はHEADとこのdigestを併記している。
個別Script/Sheet/Deployment ID、URL、認証ファイル、実Google画面は公開しない。
原本はGit対象外の `.private/furusato/` に保存した。

最初のComputer Useによる既存Chrome操作は、Windowsの現在URLを安全に判定できず停止した。
その後、所有者が専用Webアプリの5ステップ表示を確認し、自動検証の継続を明示した。
既存ブラウザの認証情報や設定には触れず、専用OAuthと隔離ブラウザの試験コードで機能検証を完了した。

## 実Google機能受入（合成データのみ）

2026-11-07 09:59 JST、実Google Webアプリの7項目がPASS:

- GASサーバー計算: 給与700万円・社保100万円・2026年→109000円。
- 実結果の印刷ボタン、A4 1ページPDF、期待値/根拠/注意書きの本文検査。
- 390px幅の結果表示、住宅ローン条件の計算停止。
- Drive APIへの実接続。
- 合成PNG/PDFのOCR候補700万円/100万円、年2026、原票未照合HOLD。
- PNG/PDF各処理後のOCR一時ファイル残数0。

PDF試験で給与候補欠落を再現し、Drive変換が見出しと複数金額項目を同一行へ連結することを、
新規合成文書の変換・export・削除で確認した。OCRの項目先頭を空白境界にも対応させ、
重複額拒否・語内部分一致拒否・REQUIRES_REVIEWの回帰を追加し、専用GASへ再登録した。
最終GASソースdigest:
`079258437307dd18630a9e5d5c5720db24ea0d68878334ec868025e6e400fe90`。
税制計算エンジン・OAuth scopeは変更していない。

Bearerはscript.google.comの完全一致originにだけ付与する。Playwrightのcontinueによる
redirect継承を独立レビューで指摘し、fetch(maxRedirects:0)→fulfillへ修正した。
合成Bearerで別originへの不配送、redirectへの不継承、失敗時の例外秘匿を実Edgeで検査した。
実Google証跡は `.private/furusato/evidence/`、匿名公開可能な要約はEVIDENCE.jsonに記録する。

## 合成試験と修正

- 税額30ケース、DOM12ケース、OCR安全性、manifest/読取フィールド契約を実施。
- 誤ID・所有者・親シート・非公開設定・外部編集・symlink等の40項目の安全性試験。
- 固定版clasp 3.3.0の実ファイル収集で転送5ファイルとAPI名/型を検査（Google未接続）。
- Windowsの実Edgeによるローカルプレビュー: 標準109000円、住宅ローンHOLD、390px幅、印刷ボタンとPDF本文。
- PDFレンダリングで注意書きだけの2ページ目を発見。印刷用CSSを修正しA4 1枚で再検査した。
- 印刷機本体とOS印刷ダイアログ、全税制のExcel一致は未検証。

## 独立レビュー

実装担当と異なる `independent_safety_review` エージェントがソース、試験、実clasp収集、合成画面/PDFを再確認した。
指摘と対処:

|重要度|所見|対処|
|---|---|---|
|High|Apps Script Projectのcreator項目誤り|実API schemaのcreatorへ修正|
|High|OCR試験が以前の入力値を継承して偽陽性|各PNG/PDF前に値を空にし年も変更して検査|
|Medium|PDFヘッダだけで成功判定|期待数値/見出しとA4 1ページを検査|
|Medium|認証だけで全機能受入PASSになる|認証専用証跡とHOLDを分離|
|Medium|デプロイ済み版と試験候補の不一致を未検知|immutable versionとlocal digestを再照合|
|Medium|ステージ済みsymlinkから保護設定へ書込可能|全書込先とdangling linkを事前拒否|
|High|認証ヘッダーがredirect先へ継承される可能性|自動redirect追随を禁止し合成Bearerの実ブラウザ回帰を追加|
|Medium|実PDFの項目連結で給与候補欠落|空白境界の厳密ラベル照合へ修正し実Googleで再受入|
|Low|モバイル最上部タイトル末尾の単独改行|表示/操作支障なしとして保留|

独立レビューは合成/実装範囲でPASS。実Google機能は実装担当が合成データで受入したが、
別担当による実Google再実行と物理印刷は未実施。正式リリースはHOLD。
先行4225046の全CIはPASS。最終修正のCIはpush後の確定SHAで確認してPRに記録する。
範囲表はCOVERAGE.csvを参照。
