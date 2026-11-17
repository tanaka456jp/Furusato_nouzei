# 次期正式版：実証証跡・配布判定（2026-11-17、Draft PR #5）

現行のExcel Draft PR #5のCI 5/5 SUCCESS（Run #43893250068、コミット 3ffa784896e7）と、実際の課税・表示・配布の完全な受入証拠は区別します。後続のコミットに過去のSUCCESSを流用しません。**本マニフェストに記入しても自動リリースは行われません。**

`python tools/release_readiness.py --head <HEADの40文字SHA> --output release_readiness_hold.json` で、実データや氏名を送信せずに未完了条件を列挙できます。住民税決定通知書を受入条件に含めません。CIは証拠未提出として常に `release_decision=HOLD` のレポートを出力し、Artifactに添付します。個人情報や顧客原票はGitHub/CIにアップロードしないでください。

## 正式受入までに必要な10条件

| 証拠の種類 | 内容 |
|---|---|
| `ci_exact_commit` | 出荷する正確なSHAで静的/Windows/Reader/PC① Excelの全ジョブPASS、ブックSHA256整合 |
| `salary_only_independent_withholding_reconciliation` | 年末調整済み・給与所得のみの源泉徴収票から住民税所得割・寄附限度額を法令どおり独立算出し、同年分のExcel結果と照合。住民税決定通知書は要求しない。本人・控除・申告方法など原票外の条件は明示確認 |\n| `prior_year_projection_independent_resident_deductions` | 令和7年源泉票から令和8年を試算する際、当年の給与・社会保険・扶養・所得控除・住民税所得割を前年と独立に再構築し、前年の住宅ローン控除額を無確認で流用しない |\n| `mortgage_filing_independent_tax_difference` | 住宅ローン控除と確定申告を併用する場合、寄附前後の所得税・復興特別所得税・住民税の差額、住宅ローン控除の国税適用額・住民税移行額を独立照合。税務専門家または外部レビュアーの確認が必要 |
| `screen_1920x1080_100pct` | 1920×1080・100%の実Windows画面 |
| `screen_1920x1080_125pct` | 1920×1080・125%の実Windows画面 |
| `screen_1366x768_150pct` | 1366×768・150%の実Windows画面 |
| `physical_printer_preview_and_output` | 印刷プレビューと実プリンタの紙面出力 |
| `live_google_gas_independent_acceptance` | 実Google GAS環境での独立受入（合成41ケースのJavaScript比較とは別） |
| `signed_distribution_and_sha256` | 次期版の署名済み配布物とSHA256、公開物の改ざん防止検証 |

外部保管したレビュー済証拠を整理する場合だけ、`--manifest <ローカルJSON>`を用います。形式は `schema: furusato-release-readiness/v3`、`head_sha`、上記10キーを持つ `checks` で、各キーは `{"status":"REVIEWED","sha256":"64桁小文字hex","reviewer_role":"tax_professional","head_sha":"同じHEADの40桁SHA"}` です。役割欄は用途に応じた `qa_operator`、`release_operator`、`external_reviewer` も可能。**本人の氏名・住所・税額・証拠そのものは書かないこと。**

この形式だけでは証拠の真正性は立証されないため、全ての欄を記入しても結果は `MANUAL_FINAL_AUDIT_REQUIRED`／`HOLD` に留まります。別途、真正な現物、法令、署名者、同年度税額とリリース承認を確認してください。既存の正式v4.18.2、main、本番GAS、Web PR #6には影響させません。


### PC①実ディスプレイ出力モードの証拠を改善（2026-11-16）

従来の `System.Windows.Forms.Screen.Bounds` にはWindows DPI仮想化による座標倍率が含まれることがあり、画面が1920×1080に見えても、実際の出力解像度と断定できません。隔離された合成Excel画面を撮影する `tools/probe_display_layout.ps1` に、Windows `EnumDisplaySettingsW`（現在のディスプレイ出力モード）と `GetDpiForWindow`（ExcelウインドウのDPI）の独立測定を追加しました。

証拠JSONの `display_observation.current_mode_pixels` はWindowsから報告された**現在の出力ピクセル数**であり、パネル固有のネイティブ解像度や紙面の可読性を保証するものではありません。 `scenario_observed_not_certified` は対象3シナリオのいずれかの観測に成功したときだけ付与。スクリーンショットの目視確認および1920×1080 100/125%、1366×768 150%の各設定での実機検証が完了するまで、`physical_resolution_verified=false` と `release_approved=false` を維持します。CIで勝手にWindowsの解像度・拡大率を変更せず、個人のデスクトップ全体や実顧客データも撮影しません。


### Windows配布ZIPの完全性・EXE署名を分離した自動監査

`tools/verify_distribution_integrity.py` を追加。実際にWindowsで作成した **Python不要の検証ZIP** に対し、ZIP内の全6ファイルの構成・重複・パストラバーサル/シンボリックリンク・CRC・SHA256・展開サイズを検査し、ファイル名とSHA256だけの匿名メタデータを保存します。入力元ファイルは実行しません。 `--expected-sha256` を指定すると、事前に配布者が控えたZIPのSHA256との完全一致も要求できます。GitHub-hosted Windowsでは個人情報を含まない合成パッケージを用いて正常系と改ざん・欠落・重複ケースを自動検査します。

Windowsジョブで `Get-AuthenticodeSignature` を使用して同梱の `FurusatoDocumentReader.exe` が信頼できる証明書で署名されているかを**別途**確認し、その結果を `distribution_signature_hold.json` に記録します。署名者の識別情報・秘密鍵・実顧客資料はGitHubへ送信しません。ZIPのハッシュ一致も署名の代用ではありません。配布ZIP本体の署名または外部署名・証明書の安全な管理・最終人手承認が完了するまで、CIが全ジョブSUCCESSでも `release_decision=HOLD` のままです。


### セットアップ不要の「ReadyToUse」検証ZIPを合成成果物だけで組み立てる

正式v4.18.2には `ReadyToUse.zip` があるため、次期版も同じ提供方式を維持します。 `ready_to_use_review` ジョブが、**同一GitHub Actions Run** の「PC① Excel/VBAUpdater/GAS受入済みXLSM」「Windows読取EXE」だけを取得し、XLSMのSHA256がExcel実機受入レポートと一致する場合に限り `Furusato_nouzei_ReadyToUse_REVIEW_HOLD.zip` を作成します。ZIP内には元バイトのXLSM、読取EXE、ユーザーガイド、`NOT_FOR_PUBLIC_RELEASE.txt` を含めます。検証用ZIPのSHA256・各EXE/XLSMのSHA256を匿名JSONに記録。再構築によるバイナリ内容改変をせず、古い別Run成果物を混ぜません。

**このZIPは検証専用です。** コード署名・実税務・画面3条件・紙面印刷・live GAS・最終承認の代わりにはならず、正式Releaseや既存v4.18.2への上書きは行いません。テストには架空のバイト列だけを使い、実顧客書類はCIへ送信しません。


### 2026-11-16 実CIのDPI撮影障害検出と修正

Run #43825689764 の実画面証拠ZIPをダウンロードして確認した結果、`display_review.json` が `UNVERIFIED`・スクリーンショット0枚・`failure_category=Unable_to_find_type__ushort__` でした。Windows PowerShell 5.1で認識できない `[ushort]` キャストを、明示的に解決できる `[UInt16]` に修正。再発を防ぐため静的テストで型名を検査し、PC① Excel受入では**合成Excelのシート部分のスクリーンショット2枚を実際に撮影できない限りジョブをFAIL**とするよう変更しました。

撮影成功は画面条件の正式合格ではなく、`release_approved=false` と `physical_resolution_verified=false` を維持します。3つの所定解像度/DPIごとの目視検証は別途必要です。撮影自体に失敗してもCIが緑になる従来の状態は受入不可としました。


### 実画面で発見した「前年試算の確認入力がボタンに隠れる」問題を修正（2026-11-16）

[Run #43827764129](https://github.com/tanaka456jp/Furusato_nouzei/actions/runs/43827764129) の画面実証では、PC①がWindows出力モード1920×1080・Excel DPI120（125%）であり、合成Excel画面の上下2枚のシートスクリーンショットを得られました。しかし画像を目視すると、新設した `操作画面B7` の「翌年試算の前提確認」が既存のフォームボタンに覆われていました。**この操作性欠陥は正式配布のHOLD要因**です。

確認入力を住宅ローン控除欄の右側 **D33** へ、原票年と試算年の関係表示を **D34** へ移動しました。入力確認が従来のB7に残って誤作動しないよう、全てのVBA・所得控除計算式・入力署名・操作説明・Excel回帰テストを更新し、案件初期化時に関連する前年原票参照値も破棄します。画面証拠の3枚目を新設し、D33/D34を目視できる住宅ローン欄の撮影を必須化しました。物理解像度のモード観測とスクリーンショットが揃っても、所定3シナリオすべての現物目視承認が済んだわけではありません。


## 住民税決定通知書を使わない独立照合方針（2026-11-16決定）

同一所得年の**年末調整済み源泉徴収票のみから、給与所得・所得控除・住民税所得割・ふるさと納税額を再構築**する方式へ変更しました。前年の通知書は所得年が違うため、寄附年の上限を保証しません。令和7年の源泉票から令和8年を見込む場合は見込給与・保険・扶養等を当年条件で置き直し、令和8年分の確定源泉票とは区別します。

独立照合では①原票支払金額・給与所得控除後額の年分整合、②原票所得控除合計・源泉徴収税額と独立所得税検算、③原票とは異なる住民税の基礎・人的・保険料控除の再構築、④非課税判定、調整控除、地方税率、⑤所得税寄附金控除・住民税基本分・所得割20%上限付き特例分（復興税を含む）、⑥ソフトの同年分の計算結果・端数処理との突合、の順に行います。

**ふるさと納税の正確な本人負担を証明できるのは条件が確定したケースだけ**です。源泉票にない当年の扶養状況、自治体、居住地、生命・地震保険料の住民税額、医療費等の追加控除、住宅・寄附・外国税額控除、配偶者・特定親族の所得、寄附の申告方式等について不明がある場合は、別途資料や本人確認で確定し、推測でPASSにしません。源泉票の源泉徴収税額をそのまま住民税所得割額として流用しません。

作業はローカル環境で行い、**実顧客源泉徴収票・実税額・氏名・住所を公開GitHub/CIへアップロードしません**。CIには個人を特定しない合成回帰のみ、公開可能なリリース判定には必要証拠の匿名ハッシュ・確認者区分のみを残します。

法令の参照元：国税庁 No.1155 https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1155.htm 、No.1410 https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1410.htm 、No.1199 https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1199.htm 。自治体所得割・調整控除については居住地の最新条例を照合します。


### 一括解消時の最終受入手順（2026-11-17）

- **コード上で完了した事項：** 対象コミットにおける合成テスト、PC① Excel COM、VBAUpdaterの隔離書戻し、Excel/GASエンジン合成41ケース、検証用ReadyToUse ZIPの完全性。これは実税務・紙面・本番GAS・署名を承認した意味ではありません。
- **実務で別途必要な事項：** 各原票の源泉税額の独立一致確認だけでなく、源泉票に書かれない住民税独自控除・扶養/同居/所得・住宅ローンの2026年可能額・寄附申告方法の確認。同一年分のExcel表示値と独立計算の照合。令和7年原票を令和8年分の確定資料とみなすことはできません。
- **現物検証でのみ通過する事項：** 独立した実Windows表示3条件（1920×1080 100%、同125%、1366×768 150%）の目視、実プリンターによるプレビュー・印刷、実GASデプロイでの独立照合、正式配布物に対する検証可能なコード署名とSHA-256。CIのPNG・仮想PDF・合成41ケース・ハッシュ一致はそれぞれの代用にはなりません。
- **承認権限：** 税額に関する2項目と住宅ローン確定申告1項目は税務専門家または外部レビュー担当者、署名配布はリリース担当者または外部レビュー担当者が確認。自己申告のJSONだけでは本人や証拠の真正性を証明できないため、人手による最終承認を必須とします。

公式資料：[国税庁 No.1155](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1155.htm)、[住宅ローン控除の初年度申告](https://www.nta.go.jp/publication/pamph/koho/kurashi/html/05_1.htm)、[令和8年度住民税の住宅ローン控除の基礎控除差](https://www.city.tomigusuku.lg.jp/kurashi_tetsuzuki/zeikin/3/9204.html)。


### OPCの署名内容タイプ検査（2026-11-17）

ローカル署名配布検査では、VBAプロジェクトと署名パーツの関連付けに加え、XLSMの `[Content_Types].xml` が示すVBA・署名の内容タイプも一致必須としました。欠落・誤った型・重複宣言・XML外部エンティティ・内部ZIPの同名エントリは拒否します。構造検査は暗号学的なVBA署名の真正性検証ではありません。Office/VBEでの署名確認と人手承認を別途必須とし、正式配布HOLDを維持します。

一次資料：[Microsoft VBA Project Signature](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xlsb/8fbb98c8-bf03-429e-b6e8-ae024539b5b9)、[Agile Signature](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xlsb/301bfe6b-5acc-4223-81e6-4ee2cc3fc09b)、ECMA-376 OPC。


### VBAプロジェクトのExcelブック参照・Agile署名URIの検証（2026-11-17）

ローカル署名配布ガードで、`xl/_rels/workbook.xml.rels` のWorkbook→VBA Project参照も検査し、別の署名パーツを付けただけの未接続VBAを排除します。外部参照・欠落・重複・誤った参照先・XML外部エンティティを拒否する合成テストを追加しました。さらにMicrosoft公式仕様に合わせてAgile VBA署名Relationship Typeの `office/2014` 誤記を `office/2006` に修正しました。これは構造検査であり暗号学的な署名検証・Office実機確認を代替しません。正式配布はHOLDです。

一次資料：Microsoft Learn [VBA Project](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xlsb/0b351d0c-0f5a-498d-bd44-e88dbd298b6c)・[Agile Signature](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xlsb/301bfe6b-5acc-4223-81e6-4ee2cc3fc09b)。


### ReadyToUse検証ZIPのREADME誤認防止（2026-11-17）

CI #44000373135は5ジョブすべてSUCCESS（Excel COM、VBAUpdaterの実書戻し、合成41ケースのExcel/GAS一致を含む）。配布検証ZIPのXLSM/EXEハッシュも同一Runの証拠と一致。しかし検証ZIP内READMEの冒頭と本文に「v4.18.2正式版」の旧案内が残っていた。検証ZIP生成処理で先頭に開発HEAD・**正式配布HOLD**・署名未検証の警告を付け、旧案内がこのZIP自体を正式版と誤認させる文言を検証ZIP内でのみ修正する。Git管理の原本ガイドと正式v4.18.2は変更しない。追加の匿名回帰テストでヘッダー、HEAD、警告、原本不変更、README SHAを照合。再度、同一HEADで5ジョブ受入が必要。


### 未入力状態の誤エラー表示を解消（2026-11-17）

2026-11-17のPC①合成画面では、源泉徴収票の3つの主要金額欄が空の初期状態でも操作画面のA9:D9に赤い「エラー：入力または計算式を確認してください」が出ており、利用者が操作前に故障と誤認する恐れがあった。主要額B12/B15/B16が未入力かつ既入力値に文字列が混入していない状態だけ、「入力待ち：支払金額・源泉徴収税額・社会保険料等を入力してください」と青い中立表示に変更する。未入力、非数値、正常、税額安全停止は別扱いを維持し、B8/D8の試算額はB28が「正常」の場合だけ表示。既存の税額算式、署名、安全停止を変更せず、PowerShell Excel実機テストと静的式テストで確認する。前コミットの5/5 SUCCESSは変更後のHEADの合格判定には流用しない。


### 2026-11-17：検証ZIPの全品質ゲート依存を修正

レビュー用ReadyToUse ZIP生成ジョブはこれまでExcel実機と文書リーダーの成功だけに依存していた。このため静的テストやWindows互換性が失敗したRunでもレビューZIPが生成され得る不備があった。正確な同一HEADの `static`、`windows_compat`、`excel`、`document_reader` の**全てのSUCCESS**を必要条件へ変更し、回帰テストを追加。

自動CIが5/5成功した場合でも、ローカル税務照合・実画面3条件・紙面印刷・実GAS・真正な署名と販売承認は別の受入条件であり、正式配布 `HOLD` は維持する。静的ジョブ内で事前作成する `release_readiness_hold.json` は外部レビュアーの証拠提出状態であって、CIが最後までSUCCESSしたかの実績レポートではない。両者を区別する。


### 同一HEAD全CIジョブの自動受入記録と、人手の正式受入は別物（2026-11-17）

`ready_to_use_review` は `static`、`windows_compat`、`excel`、`document_reader` の全成功が前提。さらに `tools/record_ci_acceptance.py` が、GitHubの同一Run/PR HEAD・4ジョブの成功・XLSM/EXE/READMEの実ZIP内ハッシュ・実ZIP SHA256を検査し、`ci_exact_head_acceptance_hold.json` を検証ZIPと同じArtifactに含める。検証用の署名なし成果物を署名済みと誤認させることも拒否する。この証拠は `ci_exact_head_gate=PASS` と `release_decision=HOLD` の両方を出力する。

`release_readiness_hold.json` は社内税務専門家・画面・署名などの**人手受入証拠が未提出**であることを示す。自動CIが実際に不合格という意味ではない。両者を混同しない。旧版v4.18.2を維持し、正式配布は署名と外部受入が終わるまでHOLD。
