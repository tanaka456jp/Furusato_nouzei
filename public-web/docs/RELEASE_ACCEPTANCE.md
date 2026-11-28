# 正式公開・税制更新チェックリスト（2026-11-26）

この文書は受入計画。承認記録ではない。現時点で RELEASE=HOLD。一般公開、広告、検索登録解除、Cloudflareへの接続は明示承認まで実行しない。main/Excel/非公開GASを変更しない。

## 公開前のゲート

| 項目 | 必要な証拠・承認 |
|---|---|
| 対応条件の表示 | index/about/terms/READMEの対象範囲一致、HOLDと対応外の説明 |
| 税額 | 対象年別の一次資料照合、独立オラクル、端数・税率境界・組合せ・原票照合・不正入力 |
| OCR | OCR_QUALITY_ACCEPTANCE.md の現行基準。合成試験・相関する再読取を独立実原票母数にしない |
| 物理端末 | MOBILE_QA.md、M01–M08。Windows Edge、iPhone Safari実機記録。Android実機は所有者指示により試験省略（NOT_TESTED、合格ではない） |
| 個人情報・セキュリティ | 配信環境でCSP、noindex、外部通信、保存・印刷・CSV、依存ライブラリ、ホストのログ実態を確認 |
| 運営者 | 正式表示名、公開範囲、問い合わせ方法、対応責任者、更新責任者を本人承認。未入力を仮の名で埋めない |
| 規約・プライバシー | 正式な対象・適用日・連絡先、ホスト処理、保存期間・第三者提供の実態、責任範囲を確認。必要に応じ専門家レビュー |
| 配信 | 公開URL、HTTPS、ホスティング設定、ロールバック先、監視・停止手順を確認。公開承認を別途取得 |
| 広告・SEO | 広告導入時の外部通信・Cookie・同意・説明の再監査、審査・個別承認。既存CSPを無断緩和しない |

## 年分の追加・改正時

1. 国税庁の対象年資料、総務省・自治体の住民税と寄附金控除資料、成立法令と経過措置を確認。公表日、対象所得年・住民税年度、該当条項、確認者、確認日を記録する。改正案と成立済み法令を区別する。
2. 共通エンジンとWeb専用モジュール（基礎控除、給与所得控除、家族、保険料、その他、医療費、所得金額調整、調整控除、特例控除、住宅ローン控除）を差分監査。前年原票と対象年を区別し、対象外年はHOLDのまま。
3. 別途承認した開発PRで年分ごとの定数・根拠・独立期待値を変更。非公開GAS/Excelの変更は別工程として承認を得る。税制根拠をコード・画面・READMEに反映。
4. 閾値の直前・一致・直後、扶養等の条件、端数、確定申告/ワンストップ、単票/一括、前年原票、住宅ローン残高変動を考慮しない注記、HOLD出力禁止を検証する。法令を確認できない組合せを有効にしない。
5. ビルドSHA、共通エンジンSHA256、対象年、根拠資料一覧、CI Run、実機試験、承認者と日時を保存。確認者と承認者を記録し、更新前の成果物をロールバック用に保持。未承認の年分・ビルドは公開しない。

### 起点資料（確認対象。最新適用を保証する一覧ではない）

- 国税庁 No.1155 https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1155.htm
- 国税庁 No.1410 https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1410.htm
- 国税庁 No.2260 https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2260.htm
- 国税庁 令和8年度改正に関する源泉所得税資料 https://www.nta.go.jp/users/gensen/2026kiso/index.htm
- 調布市 個人住民税の税額控除 https://www.city.chofu.lg.jp/030010/p014042.html

現時点では対象年2025/2026、正式公開に必要な運営者・問い合わせ・ホスティング・広告の承認記録は未確定。自動的な税制追加・公開判定は行わない。

## 2026-11-27 Windows受入進捗（合成資料限定）

- SHA `fe24d3ca464d160db2304b4fcb82942aac8739d7` の [CI #45787347854](https://github.com/tanaka456jp/Furusato_nouzei/actions/runs/45787347854) 全4ジョブ成功。専用Windows Runner上のheadless Edgeで正常・異常PDF、混在一括CSV、360/390/768/1280px、入力変更失効、外部通信0件。実際の合成画面で日本語HOLD理由と狭幅の正常/HOLD行を目視確認。対話型OS操作、物理印刷、実原票精度、PC②・iPhone実機は未受入。
- Androidは試験環境がないため所有者指示により物理端末動作試験を省略。既存OCR統計v3の9セル精度基準は変更せず、Androidの精度を証明したとは扱わない。公開可能範囲・対応端末の最終判断は別途必要。
- 連続10回の合成負例画像読取・正常電子PDFによる回復試験を追加した。新SHAのCI成功を確認するまでは未受入。繰返し読取は独立実原票精度の母数にしない。

- [CI #45969258649](https://github.com/tanaka456jp/Furusato_nouzei/actions/runs/45969258649) / SHA `72628d034edac4d1d0591583ef2d46436c9e92db`: 全4ジョブ成功。10回負例読取、20ページHOLD、取消し3回、復帰、外部通信なしを再検証。合成画像09は所得年・4金額の完全一致候補取得、明示確認後109,000円の試算まで成功。08はHOLD。合成画像認識は0/2から1/2へ改善したが、実原票精度は未実証。
- 08の全体認識は二回とも区切り文字を誤認識。固定合成資料に限定し、金額行のOCR位置から切り出した4種類の認識設定を測定する試験を追加。ピリオドの置換、数字の補完、認識設定ごとの都合のよい値の採用、製品への自動転記は行わない。

- [CI #45980913948](https://github.com/tanaka456jp/Furusato_nouzei/actions/runs/45980913948) / SHA `9c0309d4ae699180ac62957bb7b07dbeaa74b673` 全4ジョブ成功。PC①の画面08/09・360pxを開発側で目視。合成画像08の4設定は全て信頼度75以上の完全一致0/4（全16回中14書式異常、2低信頼度の正解）。09は完全一致、外部要求0件。実原票精度の証明ではない。
- 次の研究：日本語モデルと区別して、固定合成画像08の金額領域だけを英語モデル（npm固定版）で比較する。ネイティブTesseract 5.5.0のローカル補助実験では原寸4/4正解だが、2倍時に7000000を1000000と高信頼度で誤認した。ネイティブとブラウザのモデル・実行系の同一性は未証明。拡大・高信頼度のみを採用理由にしない。英語モデルは短命の独立研究成果物、テスト内のローカルルートのみ。製品資産・転記判定・CSP・実原票・公開条件は変更しない。新CIの実測が得られるまで研究結果は未受入。

- [CI #45996819507](https://github.com/tanaka456jp/Furusato_nouzei/actions/runs/45996819507): PC①英語モデルPSM7原寸4/4（信頼度96）、2倍4/4（95–96）、PSM13原寸0/4、2倍2/4（社会保険料を11,000,000と誤認・86）。画像08は製品側HOLD、09は完全一致。PSM13を候補から除外。実原票精度ではない。
- 次の固定合成研究：日本語の2回の位置照合、英語PSM7原寸/補正2倍の完全一致・各75以上、正しく読めた日本語金額との矛盾を拒否。追加合成5枚（異なる金額/2025年、実際のピリオド、負号、重複欄、年分競合）で誤った研究一致と既存製品のHOLDを区別して計測。実際のピリオドとOCRによるカンマ誤認の識別はまだ未証明。研究一致は転記可能候補ではなく、結果によらず製品へ反映しない。公開基準・CSP・既存製品は変更しない。

- [CI #45998808943](https://github.com/tanaka456jp/Furusato_nouzei/actions/runs/45998808943): 全4ジョブ成功。08/10の研究一致2/2、11–14のHOLD4/4、誤研究一致0。11は実ピリオドを英語OCR2回ともピリオドとして認識（信頼度96）、厳格金額解析でHOLD。12–14は位置計画なし。画面08/09/11–14を目視。外部要求0件。研究の少数合成結果で実原票精度を証明しない。
- Draft検証版に限定した次の実装：正確な日本語見出しが縦並びで2回一致した未補正画像・文字層空の画像PDFに限り、英語PSM7の原寸と補正2倍の厳格金額・信頼度75以上・文字列一致を求める。元日本語の数字列の矛盾も拒否し、ピリオド置換・補完は行わない。明示的な年分・項目・値の競合、部分電子PDF、変形補正経路には適用しない。日本語ワーカー終了後にのみ英語ワーカーを起動、同一ホスト固定モデル・CSP維持。原票確認と税額整合性は従来通り必須。新CIで08/09/10の製品候補と11–14のHOLDを確認するまでは未受入。公開・広告・税額計算・既存品質統計基準は変更しない。

- [CI #46002793349](https://github.com/tanaka456jp/Furusato_nouzei/actions/runs/46002793349) / SHA `6106270a54bb92ffe0c44091fb9aed7a5b340f66`: 全4ジョブ成功。PC①の製品側で08/09の完全一致候補と明示確認後109,000円、10の2025年原票・2026年対象への正しい転記、11–14のHOLDを確認。08/09/10/11–14の画面を目視。08 3.901秒、09 3.666秒、外部要求0件。実原票精度・10の税額計算は未実証。
- 次の工程：JPEG、濃淡変更PNG、画像PDF、正常/異常混在の画像PDF、税額整合性を考慮した2025年合成原票を追加。正常のHOLDは失敗として計測し、誤った転記候補・異常CSV金額はCI失敗。英語認識中の原票差替えと再試行を実ブラウザ回帰。金額再読取の候補・停止理由を日本語表示。全て合成資料、公開基準変更なし。新CIと目視確認前は未受入。

- [CI #46096816601](https://github.com/tanaka456jp/Furusato_nouzei/actions/runs/46096816601) / SHA `c45ab731c24296941d6b9d2c55d709e8eebacdea`: 全4ジョブ成功。15 JPEG HOLD（位置不一致）、16 低コントラストPNG完全一致・109,000円、17 画像PDF HOLD（所得年不一致）、19 2025年原票完全一致・転記、18混在画像PDF両方HOLD・CSV金額空欄、英語OCR中差替え・再試行PASS。外部要求0件。合成6画面を目視。19の翌年試算は別の最新CIで検証中。正常のHOLDは認識失敗。
- 次の固定比較：15 JPEGは現行1.35/139補正と弱い1.15/128補正、17 画像PDFは現行3倍と2倍描画を同じPDF.jsと固定日本語・英語モデルで比較。製品と同じ位置・年分・数字列・金額・信頼度の安全判定を利用し、研究結果のみ記録。各形式の製品側OCRトレースも合成試験限定で保存。製品の倍率や基準は変更しない。誤研究一致を隠さず記録し、追加異常試験前の製品採用は行わない。実原票・公開条件変更なし。

- [CI #46096858836](https://github.com/tanaka456jp/Furusato_nouzei/actions/runs/46096858836) / SHA 0cd572a35d293d0306899b2dd839f24722ff083a 全4ジョブ成功。19の2025年原票読取・転記・前年見込額確認前HOLD・確認後57,000円・原票控除額保持をPC①で確認。結果画面を目視。15/17/18正常HOLD、16完全一致、取消し再試行PASS、外部要求0件。19結果画面の上部には原票年・試算対象年が明示されていなかったため、計算根拠を開かずに試算年・住民税年度・原票年（前年参考／同年／OCR未取込）を表示する修正を追加。基本・家族控除・課税所得ゼロの有効結果に適用し、HOLD時に限度額を表示しない従来の条件を維持。360px・印刷CSS・年分変更後の旧結果印刷禁止も追加検証。物理印刷や実原票の証明ではない。新CI合格前は未受入。

- CI #46099072357: Windows Edge/Linux WebKit成功、静的テスト失敗、PC①スキップ。原因は家族控除53,000円の旧年分表示正規表現（旧一行）で、新しい2行の内容は正しい。テストを試算年・住民税年度と参照原票年の個別完全一致に修正。金額・HOLD基準は変更なし。
- [CI #46098414241](https://github.com/tanaka456jp/Furusato_nouzei/actions/runs/46098414241) / SHA 40e5a0f7913a43af6a2760c146cdd7a19898c1cf 全4ジョブ成功。合成画像PDFの3倍は表題末尾「票」を「京」と2回誤認、年分も未確定。2倍は所得年・4金額完全一致の研究結果。JPEG原寸の強弱補正とも2回目で見出し「合計額」を「合計客」と誤認、位置計画HOLD。単純濃淡変更では改善なし。次の研究は固定1.18倍再サンプリングと、画像PDF2倍で実ピリオド・負号・重複欄・年分競合・前年正常を検証する。研究結果の転記可否フラグも明示的にfalseに固定。現行製品の描画倍率、信頼度、項目の完全一致、原票確認、公開基準は変更しない。新CIの追加異常試験前の製品採用は行わない。実原票は使用しない。

- CI #46105256547 の静的・Windows Edge・Linux WebKit合格を確認（PC①追加比較・画面受入は実行中）。既存税額独立試験も合格。家族控除結果の年分表示回帰修正済み。物理iPhone用手順書の旧08 HOLD記述を訂正し、01～24の合成原票の期待値・現行HOLD・正常認識失敗と安全停止の区別・M01～M08記録方法を明記。公開CIで合成原票24件の固定目録・ファイル形式を検証し、モバイル成果物は明示した合成ファイルだけを梱包。目録検査は実原票識別器ではなく、生成元・運用上の個人情報排除も引き続き必須。実機・実原票認識精度・新CIは未受入。

- [CI #46105969670](https://github.com/tanaka456jp/Furusato_nouzei/actions/runs/46105969670) / SHA 5a9f1de61311d79480553374d4369bbdd454bf0b 全4ジョブ成功（#46105256547も全4成功）。PC① Edge 158.0.4370.45 / Windows 10.0.26300。正常17・24の2倍画像PDF研究一致、20～23のHOLD、JPEG15の1.18倍研究一致（原寸の2方式HOLD）。誤研究一致0。19の通常・360px・印刷CSSで参照2025、対象2026、住民税2027と57,000円を目視。外部要求0件、24件の固定目録PASS。物理印刷やiPhone受入ではない。
- 画像PDFの文字層EMPTY経路のみ、最低解像度750×400を満たすときに認識前から2倍描画（上限長辺2600）とするDraft製品変更。小寸法は従来倍率、部分文字層や電子PDF処理は変更しない。候補の選択・年分/位置/金額/信頼度ゲート変更なし。17/24製品正常、20～23製品HOLD、18正常＋異常の一括CSVを必須試験化。JPEG25～29を固定生成、1.18倍を研究限定で測定。29件目録も更新。新CI合格・画面確認までは未受入。公開基準変更なし。

- [CI #46117260601](https://github.com/tanaka456jp/Furusato_nouzei/actions/runs/46117260601) / SHA 94342c4e333576adaa718e9a75b94857f219278a 全4ジョブ成功。PC① Edge 158.0.4370.45 / Windows 10.0.26300。17/24画像PDF製品候補完全一致、109,000/57,000円。18正常行109,000円、異常行HOLD・CSV空欄。20～23製品HOLD。JPEG研究15/29完全一致、25～28HOLD、誤研究一致0。外部要求0件、合成29件固定目録PASS。画像PDF17は4.555秒、24は5.400秒（テスト操作込み）。20ページ105.763秒、取消3回0.611～0.665秒。合成のみ。
- JPEG製品変更：元寸法750×400以上、長辺1600以下のJPEGに限って事前に1.18倍を固定し、高品質補間を指定。元画像のヘッダー・デコード寸法検査、キャンバス上限、全体/領域の厳格な年分・金額の一致、原票確認は変更しない。PNG/WebP、大画像、解像度不足は従来どおり。15/29の製品正常、25～28の製品HOLDを必須回帰とし、画像PDFと取消試験も維持。新CI合格・画面確認までは未受入。実原票精度の証明ではない。

- 2026-11-28 税額一次資料の再照合（AIによる開発監査、税理士の最終承認ではない）：国税庁 No.1199 https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1199.htm 、No.1410 https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1410.htm 、No.1190 https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1190.htm 、No.1800 https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1800.htm 、令和8年度改正 https://www.nta.go.jp/users/gensen/2026kiso/index.htm （原則2026-12-01施行、2026年分所得税。施行前源泉徴収を年分計算と混同しない）。福岡市2026-08-06更新 https://www.city.fukuoka.lg.jp/zaisei/shisanzei/life/R9_kaisei.html （2026所得・2027年度住民税、給与所得控除最低74万円、扶養所得62万円、勤労学生89万円、給与160万円の20歳の子は所得86万円・住民税特定親族特別控除45万円、扶養なし非課税の例119万円）。浦添市Q&A https://www.city.urasoe.lg.jp/doc/2026103000097/ の検索掲載内容では住民税新一般生命保険料控除2.8万円維持（本文取得不可、これ単独で根拠確定せず）。給与所得換算→配偶者・特定親族分類→所得税/住民税控除・人的控除差→生命保険料の年分差、勤労学生と扶養なし所得割非課税境界を独立固定期待値21組で追加。年分の誤適用・給与収入と所得の取り違え防止。福岡市の例を全自治体の均等割非課税判定に一般化しない。現行計算定数・製品UI・共通GASは変更せず、CI合格前は未受入。実原票を使用しない。

- 2026-11-28: [CI #46120493721](https://github.com/tanaka456jp/Furusato_nouzei/actions/runs/46120493721) (b96f668) and [CI #46121363264](https://github.com/tanaka456jp/Furusato_nouzei/actions/runs/46121363264) (1df9bf99fb390ee09f38ef173030a0375bad4fa0) both all four jobs SUCCESS. PC1-Furusato-Excel, Edge 158.0.4370.45, Windows 10.0.26300. Downloaded both synthetic screenshot artifacts; latest result.json confirms JPEG15/29, PNG16/19, raster PDF17/24 all EXACT_CANDIDATE; JPEG25–28 HOLD per logs; 109,000/57,000 yen per product assertions; original review gate, mixed CSV blank negative amount, 20-page recovery, external requests 0. Latest screenshots visually reviewed: JPEG15, 25–28, PNG16, PDF17, JPEG29 result and 360px, mixed summary. Static CI confirms 9 gross + 6 exemption + 6 student cross-source expectations. Real-slip accuracy, interactive physical iPhone, PC2 not accepted.
- Additional statutory review: Osaka city's income-levy exemption rule (https://www.city.osaka.lg.jp/zaisei/page/0000384084.html) and Imizu city's post-credit income-levy adjustment (https://www.city.imizu.toyama.jp/guide/svGuideDtl.aspx?servno=54771). Existing Web engines did not account for the separate adjustment near the ordinary exemption threshold. Add conservative HOLD when unrounded pre-credit levy exceeds income above the threshold; do not infer actual relief or change the special cap formula. Add independent 2025/2026, both municipality classes, one-yen boundary cases including family one-stop/filing/trial; strengthen previously recovered PNG regression and capture current-year positive results and mixed raster rows. No GAS/Excel modifications or real data. New HEAD CI and final relief arithmetic NOT yet accepted; release HOLD.
