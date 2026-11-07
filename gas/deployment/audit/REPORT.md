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

登録したアプリソースdigest:
`b2ec960d8fa9f938590b8d30180aba5a091e1cb1f83889153deaf6dbe5867146`。
実行時は開始HEAD上の変更候補だったため、API証跡はHEADとこのdigestを併記している。
個別Script/Sheet/Deployment ID、URL、認証ファイル、実Google画面は公開しない。
原本はGit対象外の `.private/furusato/` に保存した。

実Web画面の確認は、Computer UseがWindowsの現在URLを安全に判定できず停止した。
その後のブラウザ入力は行わず、所有者に専用Webアプリの表示/追加認可を確認依頼した。
**実Google UI・サーバー税額呼出・PNG/PDF OCR・Google一時文書削除の受入はHOLD**。
APIでデプロイできたことを機能受入PASSとして扱わない。

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
|Low|モバイル最上部タイトル末尾の単独改行|表示/操作支障なしとして保留|

独立レビューは合成/実装範囲でPASS。実Google機能・物理印刷は独立受入していない。
CIはpush後の確定SHAで別途確認する。範囲表はCOVERAGE.csvを参照。
