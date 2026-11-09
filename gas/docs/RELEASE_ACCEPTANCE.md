# GASの検証範囲と再開手順

正式リリースは **HOLD**。開発はDraft PR #2で行います。配布判断では合成回帰、実Google、Windows、iPhoneの証跡を分け、同じ候補版で確認します。

## 税額の対応範囲

| 項目 | v0.1.23の検証範囲 | 根拠 |
| --- | --- | --- |
| 給与所得・基礎控除・所得税 | 所得年2025年と2026年の通常年末調整・申告。650,999円と651,000円、2026年の219.1万円付近、税率区分の境界を回帰。給与・社保のみの標準例で所得税・復興特別所得税を検算。準確定申告等の経過措置は簡易試算を停止。 | [国税庁 No.1410](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1410.htm)、[令和7年分の給与所得表](https://www.nta.go.jp/publication/pamph/gensen/nencho2025/pdf/114.pdf)、[No.1199](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1199.htm)、[No.2260](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2260.htm) |
| 社会保険料・住民税所得割・調整控除 | 2025年所得は2026年度、2026年所得は2027年度。給与簡易試算は標準税率の合算概算。詳細設定は市・県分の計算を区別。課税自治体の税率が不明な場合は停止。 | [国税庁 No.1130](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1130.htm)、[大阪市の調整控除](https://www.city.osaka.lg.jp/zaisei/page/0000370599.html) |
| 寄附上限・申告方式 | 標準例で所得割の20%上限と概算寄附額を検算。給与の確定申告では、標準市町村・指定都市の市・県別端数も照合して千円単位の目安を引き下げます。所得税率区分をまたぐ等の条件はHOLD。詳細設定は確定申告の対象条件に限定。 | [国税庁 No.1155](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1155.htm)、[市川市の特例控除割合](https://www.city.ichikawa.lg.jp/page/3898.html)、[大阪市の所得割の計算](https://www.city.osaka.lg.jp/zaisei/page/0000383147.html) |
| 医療費・配偶者・扶養・その他所得控除 | 給与簡易試算は申告された追加控除をHOLD。詳細設定は照合済みの税目別控除合計と法定人的控除差を使用。年齢・所得・医療費等からの適格性と控除額の自動判定は未受入。 | [国税庁 No.1100](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1100.htm)、[No.1120](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1120.htm)、[No.1180](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1180.htm)、[No.1191](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1191.htm) |
| 生命保険料・地震保険料・障害者控除 | 2025年・2026年とも給与簡易試算はHOLD。生命保険料の新旧契約や、2026年分の23歳未満扶養親族に関する控除額の別表は適用条件と税目差の照合が必要です。 | [国税庁 No.1140](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1140.htm)、[No.1145](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1145.htm)、[No.1160](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1160.htm) |
| 住宅ローン・配当・分離課税・給与以外の所得 | 詳細設定の対応条件内で検算。適格性の自動判定、損失・特別控除・自治体条例差などを含む全組合せの受入は未完。停止理由と再計算条件を画面に表示。 | [分離課税と税額控除の根拠・範囲](../../taxdata/SEPARATE_TAX_AUDIT.md)、[国税庁 No.1211-1](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1211-1.htm)、[No.1250](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1250.htm) |

標準例は給与700万円・社会保険料100万円。期待値は2025年が所得税286,500円・復興特別所得税6,016円、2026年が所得税278,500円・復興特別所得税5,848円です。住民税所得割概算374,500円、寄附概算109,000円は両年で同じです。申告時の源泉徴収・納付額の精算や個別の条例差は別途照合します。

## 受入の順序

1. 作成済みの固定版v0.1.20と専用worktreeで、[通常Edgeでの所有者試験](V020_APPROVED_ISOLATED_STAGE.md)を実行します。PDF・PNG・JPEGの認識、原票未照合HOLD、再同意、各処理後のDrive残数を記録します。旧固定版v0.1.17の所有者受入は版別に管理します。
2. 同じv0.1.20非公開GASをiPhone実機のSafariで確認します。Windowsのモバイルエミュレーションと別に記録します。v0.1.23はこの実Google環境と別の開発候補です。

   所有者がWindows（PDF・PNG・JPEG）とiPhone（JPEG）の両方を完了したら、PC①の専用worktreeで次の**オフライン・読取専用**監査を実施します。旧v0.1.17の証跡とは別フォルダだけを読み、v0.1.20のレシートのSHA-256・元ソースコミットと受入記録を照合します。認証やGoogle APIへのアクセスは行いません。

   ```powershell
   cd $HOME\Development\Furusato_nouzei_GAS_OCR
   git pull --ff-only origin feature/gas-workflow-20261106
   node gas/scripts/audit-owner-ocr-evidence.cjs --stage-v020
   ```

   証跡に不正な日付や時刻がある場合、古い合格記録で上書きせず **HOLD** にします。同じミリ秒の複数証跡も読込順で合格とせず **HOLD** にします。後から実施した正常な再試験は、過去の同時刻競合を置き換えられます（ただし不正日時の記録が残る場合は安全のため引き続きHOLD）。証跡原本の削除・変更は自動実行しません。

   `structuralStatus: OWNER_ATTESTED_STRUCTURE_PASS` は所有者申告と専用OAuthのDrive残数記録が揃った意味に限られます。実Google固定版の独立GET再照合、OCR精度の第三者検証、OAuth可視範囲外の削除保証、v0.1.23の受入は**別の判定**です。監査結果の非機密ステータスのみ共有し、Google URL、レシート本文、OCR原票を公開しないでください。
### v0.1.20 所有者報告PASS後の一括・読取専用照合

所有者からWindows / iPhoneの試験項目がPASSだった旨の報告を受けています。ただし、オフライン証跡の機械集計と、Google側の新規隔離固定版・保護対象・一時ファイル残数を照合したことは別の判定です。**過去のOCRを繰り返す必要はありません。** 既存の所有者PC①の専用worktreeから次を一度実行します。

```powershell
cd $HOME\Development\Furusato_nouzei_GAS_OCR
git pull --ff-only origin feature/gas-workflow-20261106
node gas/scripts/attest-v020-owner-acceptance.cjs --verify-readonly
```

このプログラムはローカルの非公開受入記録（Windows: PDF/PNG/JPEG、iPhone: JPEG）とv0.1.20隔離レシートを検査した後、**Google APIへのGETとOAuthトークン取得のみ**で、旧v0.1.17の保護、隔離シート所有者、5ソース、固定版、非公開デプロイ（MYSELF / USER_DEPLOYING）、専用OAuth範囲のDrive一時OCR残数0件を再照合します。照合中のレシート・受入証跡の変更も検出します。

`status: LIMITED_V020_OWNER_EVIDENCE_AND_GOOGLE_GET_PASS` は、限定的に「所有者申告の記録と独立したリモート読取照合が一致」の意味です。**Safari直接操作・OCR正確性の第三者検証・専用OAuth可視範囲外の削除・v0.1.23の受入・正式販売許可を意味しません。** 出力は許可済みの状態コードだけです。非公開URL、レシート・認証情報の本文、源泉徴収票の実データは共有しないでください。失敗は `HOLD` で終了します。修復目的でも旧GASや共有claspを更新せず、Google作成要求の再試行もしません。

### v0.1.23の独立した新規隔離受入の事前計画（読取専用）

v0.1.20は固定版として保持し、**既存のv0.1.20 Webアプリをv0.1.23で上書きしません**。所有者のv0.1.20証跡と独立Google GETの一括ゲートを通したうえで、v0.1.23の新規隔離ステージの作成可否を以下で**計画だけ**確認します。

```powershell
cd $HOME\Development\Furusato_nouzei_GAS_OCR
git pull --ff-only origin feature/gas-workflow-20261106
node gas/scripts/plan-v023-isolated-stage.cjs --check-readonly
```

この計画は以下の検証に限定します。認証の必要な外部リクエストは、既存照合処理のOAuthアクセストークン取得とGoogle API GET（GitHubのGit先端読取も実施）だけです。Googleの新規作成・更新・削除、clasp push、デプロイ、保護スナップショットの再基準化はしません。

- GitHubの正規開発ブランチ先端とPC①追跡ファイルの完全一致、想定リモートorigin、5ソースとpackage/Engineのv0.1.23一致、v0.1.20固定ソースとの差異
- 既存v0.1.20の所有者証跡、Google側の所有者・非公開固定版・5ソース・一時ファイル残数0、旧v0.1.17とHousingERP保護状態
- 計画前後の作業ツリー・ソースと旧固定版レシートの同一性、v0.1.23用ローカルステージディレクトリが**存在しない**こと

`status: READY_FOR_SEPARATE_V023_STAGE_APPROVAL` が返っても、これは**事前計画PASS**であり、Google上のv0.1.23作成不存在や販売承認を意味しません。今回の事前計画では、専用OAuthで見えるGoogle Driveのv0.1.23ステージ名・識別マーカーを、**ゴミ箱を除外せず**独立したGoogle API GETで2回照合します。結果が不完全・競合・1件以上の該当資源を含む場合はHOLDです。ただし、この検索は専用OAuthの可視範囲に限られ、親シートと切り離された孤立Apps Scriptの不存在を証明するものではありません。新規作成要求の結果が不明な場合は作成コマンドを再送せず、所有者による別途の照合が必要です。作成先ジャーナル・所有者限定デプロイ・PCとiPhoneの新バージョン実試験はまだ別工程です。新しいGoogleリソース作成には**対象と許可範囲を特定した別の明示承認**が必要です。過去のv0.1.20作成承認を流用しません。

失敗した場合は原因コードのみ記録してHOLDし、既存のv0.1.20/0.1.17リソースや共通認証ファイルを変更しないでください。v0.1.23の実Google受入は一度固定版が作成・照合された後、Windows EdgeとiPhone Safariで実施します。

3. 次の候補へ更新する場合は、所有者の承認と既存の照合手順に沿い、固定版、所有者、保護対象を更新前後で確認します。最新候補でOCR、保存と再読込、印刷・PDFを再試験します。
4. Windows配布ZIPの展開・起動、初回導入、更新、復旧を実運用から隔離して確認し、対象版と証跡を記録します。開発者以外が同じ候補で主要手順を再確認した後に販売・配布を判定します。

## 更新・復旧

- 年次改訂では所得年・住民税課税年度・施行時期を別々に記録し、国税庁の給与所得表、基礎控除、自治体の調整控除・寄附控除を再照合します。期待値は実装と別に作成し、変更前後の境界を回帰します。
- 下書きは利用者が端末に保存したJSONから再読込できます。計算結果、原票、Google転送同意、確認済みチェックは含まれません。再読込後に適用条件を確認して再計算します。
- 更新前に使用中の版、Gitコミット、配布ZIPのSHA-256を記録し、現行ZIPと必要な下書きJSONを退避します。新しい候補は別のフォルダに展開し、事前点検・再読込・再計算が完了するまで旧版を保持します。
- 隔離Google版の切替に失敗した場合は旧固定版のレシートとGoogle APIの照合に戻り、受入済みの旧環境を使います。共有のclasp認証、保護スナップショット、旧固定デプロイは復元操作の対象外です。部分作成の結果はジャーナルとGET診断で確定します。
- 非公開GASがHOLDになった場合は、専用認証、既存の導入記録、固定版、保護対象を [導入の読取診断](../deployment/README.md) で照合します。残存ファイルがある場合は、所有者が対象を確認するまで受入を停止します。
