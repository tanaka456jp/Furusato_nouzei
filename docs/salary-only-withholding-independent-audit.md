# 年末調整済み・給与所得のみ：源泉徴収票からの独立検算（住民税決定通知書不要）

**運用決定：住民税決定通知書は入手・利用しません。** 寄附を行った**同一年の確定した給与所得・控除**を基に、法令から住民税所得割額とふるさと納税の寄附上限を独立に計算し、Excelと照合します。

税額は（原票G05や源泉税額をそのまま住民税額と置かず）次の順序で独立に検算します。

1. 源泉徴収票G04「支払金額」、G05「給与所得控除後の金額」（所得金額調整控除後を含む）、G06「所得控除額合計」、G08「源泉徴収税額」、G26社会保険料を取得。給与収入660万円以上の単純ケースは国税庁1410の給与所得表でG05を再計算。**660万円未満は所得税法別表第五の年分別給与所得表と照合し、早見算式で代用しない**。
2. 家族構成・年齢・配偶者所得・居住自治体・年末調整済み・他所得なし等を原票や本人確認により確定。所得税の基礎控除・配偶者・扶養等と社会保険料控除を独立合算しG06と照合。G06の内訳に未対応控除があれば安全停止（厳密な給与-only検算v2では、保険料の実際の支払額を別途確認できる場合に限り、生命保険料控除・地震保険料控除を所得税・住民税別に独立検算する。住宅ローン控除・所得金額調整控除などは依然**未対応**）。
3. 国税庁の所得税率・年末調整税額の100円未満切捨て・復興特別所得税を用いてG08と独立照合。G08が一致しても、それだけで住民税や寄附限度額は証明できない。
4. 所得税とは異なる住民税基礎控除43万円と扶養等の控除を適用し、住民税課税所得を千円未満切捨て、所得割・調整控除・市区町村／都道府県の100円未満切捨てを計算。家族状況に応じた所得割非課税判定も先に行う。
5. 住民税所得割額の20%を特例控除限度とし、所得税率（復興特別所得税を含む）・住民税基本分10%・特例割合・総所得額の寄附上限を使い、**千円単位で安全側に丸めたふるさと納税上限参照値**を計算。対象年のExcel「寄附限度額の目安」と住民税所得割額に相違があれば不一致として検出する。

## オフラインの匿名・数値のみ入力例

下のJSONは実在しない**合成データ**で、令和7年・年末調整済み給与700万円、給与所得520万円、社会保険料100万円、その他控除なし、京都市型の指定都市の例です。

```json
[
  {
    "year": 2025,
    "confirmations": {
      "year_end_adjusted": true,
      "one_salary_source": true,
      "no_other_income": true,
      "no_unmodelled_deductions": true,
      "no_tax_credits": true,
      "no_salary_income_adjustment": true,
      "nta_fifth_table_rechecked": true,
      "family_eligibility_confirmed": true,
      "resident_municipality_confirmed": true,
      "donation_filing_method_confirmed": true,
      "no_post_adjustment_changes": true
    },
    "family": {
      "spouse": "none",
      "general": 0,
      "special": 0,
      "elderly": 0,
      "cohabiting_elderly": 0,
      "under16": 0
    },
    "source": {
      "salary_gross": 7000000,
      "salary_reference": 5200000,
      "deductions_reference": 1630000,
      "income_tax_withheld": 292500,
      "social_insurance": 1000000
    },
    "workbook": {
      "year": 2025,
      "donation_limit": 109000,
      "resident_income_levy": 374500
    },
    "municipality": "designated"
  }
]
```

数値・本人確認結果を端末内の `private_cases.json` として作り、次をローカルだけで実行します。

```powershell
python tools/reconcile_salary_only_from_slip.py --input private_cases.json --summary anonymous_review.json --min-cases 1
```

正式受入では原則 `--min-cases 5`（既定値）を使用します。出力レポートは **MATCH_REFERENCE / MISMATCH / NOT_COMPARABLE** のみで、元の金額・氏名・住所・原票をコピーしません。`MATCH_REFERENCE` は本モデルの**千円単位参照値一致**であり、実際の地方税の賦課決定や1円単位の実質負担額保証ではありません。指定税額以外に生活の変化・控除・住民税の特殊取扱いがある場合は対象外・再検算とします。実顧客JSON・源泉徴収票・税額を公開GitHubやCIにアップロードしないでください。

**年分上の重要な制限：** 令和7年の源泉票から令和8年の給与・家族・保険料等を見込む計算は、令和8年分の確定票の検算とは異なります。このCLIの実原票照合は源泉票年＝Excel計算対象年のときだけMATCH判定します。

**法令根拠：** 国税庁 [No.1155](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1155.htm)、[No.1410](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1410.htm)、[No.1199](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1199.htm) 。京都市の調整控除は [京都市公式](https://www.city.kyoto.lg.jp/gyozai/page/0000028147.html) を確認。居住自治体による条例・課税条件は個別検証してください。


## v2追加：保険料控除の独立照合（2026-11-16、Draft/HOLD）

`tools/audit_insurance_deductions.py` は税制マスタのExcel数式を呼ばず、独立に保険料控除を計算します。保険料控除額の原票欄だけから**支払保険料を逆算してはいけません**。各契約の控除証明書等に記載された実際の支払額を別に確認した上で、源泉票G27・G28と国税上の控除額を照合します。住民税に適用する額は**所得税用の額を流用せず**、住民税の別表で算出します。

- 必須：`insurance`の７種類の支払額は`new_life, old_life, care, new_pension, old_pension, earthquake, old_long`（円、該当なしは0）。`life_reference`と`earthquake_reference`には原票に記載の**所得税控除額**を入力します。旧長期と地震保険が重複計上されないことを確認し、`distinct_earthquake_contracts_confirmed=true`とします。
- 2026年：23歳未満の扶養親族が**いない**ことを確認した場合は従来どおり`no_2026_under23_life_exception_confirmed=true`とします。23歳未満の扶養親族が**いる**ことを別途確認した場合は、`no_2026_under23_life_exception_confirmed=false`かつ任意追加の`verified_2026_under23_dependent=true`を指定して、所得税の新生命保険料控除の特例（上限6万円、支払額3万／6万／12万円の境界）を計算します。`family`に`under16`、`general`又は`special`が少なくとも1人必要で、`general`の場合は年齢の別途確認が必須です。住民税の新生命保険料控除上限2万8千円は変更しません。該当有無が未確認・確認情報が矛盾する場合は**NOT_COMPARABLE**です。2025年分にこの2026年特例キーを設定した場合も照合対象外にします。
- G06には既存の社会保険料・基礎控除等に、**独立計算した所得税用の生命・地震保険料控除**を足した値を照合。住民税所得割の計算には**住民税用の生命・地震保険料控除**を加えます。未入力や不一致はNOT_COMPARABLE。
- 源泉徴収票の他所得、複数給与の未確定合算、住宅ローン控除、所得金額調整控除、住民税独自の特殊控除は従来どおりHOLD。保険控除の追加だけで全税制の実証とはしません。

次は**架空の2025年給与・保険料データ**による入力例です。元のJSON配列中の1件に `insurance` を追加し、既存の `source.deductions_reference`を1705902、`source.income_tax_withheld`を276900、`workbook.resident_income_levy`を368500、`workbook.donation_limit`を107000に変更します。

```json
"insurance": {
  "new_life": 50000,
  "old_life": 0,
  "care": 0,
  "new_pension": 50000,
  "old_pension": 0,
  "earthquake": 10902,
  "old_long": 0,
  "life_reference": 65000,
  "earthquake_reference": 10902,
  "distinct_earthquake_contracts_confirmed": true,
  "no_2026_under23_life_exception_confirmed": true
}
```

この例は控除証明書を照合した**実在納税者の記録ではありません**。合成テストの一部として税制式・分岐を確認するもので、実原票からの正式版合格を証明しません。原票・住所・氏名・納税者番号・実額をGitHub、Actions、PRコメント、コミットに載せないでください。

根拠：[国税庁No.1140（生命保険料控除）](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1140.htm)、[京都市（住民税の所得控除）](https://www.city.kyoto.lg.jp/gyozai/page/0000028135.html)、[京都市令和8年度市税のしおり](https://www.city.kyoto.lg.jp/gyozai/cmsfiles/contents/0000125/125883/99_R8shizei_no_shiori%28zentai%29.pdf)。適用年に応じた法令確認は引き続き必須です。

### 令和8年特例の合成確認ケース（実原票ではない）

給与収入700万円・給与所得520万円・社会保険料100万円、16歳未満の確認済扶養親族1人、新生命保険料支払額12万円の**2026年合成例**です。基本例のyearを2026にし、`family.under16=1`、`source.deductions_reference=1730000`、`source.income_tax_withheld=272000`、`workbook.resident_income_levy=371600`、`workbook.donation_limit=108000`としたうえで次の`insurance`を追加します。

```json
"insurance": {
  "new_life": 120000,
  "old_life": 0,
  "care": 0,
  "new_pension": 0,
  "old_pension": 0,
  "earthquake": 0,
  "old_long": 0,
  "life_reference": 60000,
  "earthquake_reference": 0,
  "distinct_earthquake_contracts_confirmed": true,
  "no_2026_under23_life_exception_confirmed": false,
  "verified_2026_under23_dependent": true
}
```

この計算では所得税の一般生命保険料控除は6万円ですが、住民税の同控除は2万8千円で据え置きます。一般生命保険料の新旧双方がある場合は、**旧生命保険料の年間支払額6万円超／以下**を分けて判定します。旧契約支払額が6万円以下の場合のみ旧新合算選択肢を適用でき、令和8年特例の所得税側合算上限は6万円です。6万円超の場合に旧新の控除額を無条件に加算することはできません。旧契約のみと新契約のみの各選択肢も比較します。住民税側は従来の控除額・限度額を別計算します。2026年特例の適格性は本人の証明・家族の年齢と所得等の確認が前提で、原票の表面だけから推定しません。2026年分が未確定である間は令和7年の実票を令和8年に読み替えて`MATCH_REFERENCE`にしません。

公式出典：[国税庁 令和8年分 年末調整のあらまし](https://www.nta.go.jp/publication/pamph/gensen/aramashi2026/pdf/04.pdf)、[財務省 令和7年度税制改正の解説](https://www.mof.go.jp/tax_policy/tax_reform/outline/fy2025/explanation/PDF/p0137-0264.pdf)（192頁以下）。

### 住民税特例控除割合の法定判定額を維持する

**注意：** 所得税で実際に使用する課税所得から所得税率を選択して住民税の寄附金「特例控除割合」を設定してはいけません。割合の判定は、住民税の課税総所得金額から人的控除差等の合計額および所得税基礎控除額の所定の差額を引く**地方税上の法定判定額**によります。生命保険料の所得税・住民税控除額の差額を、この判定額からさらに差し引く変更はしません。

合成回帰例：令和8年の給与所得500万円、住民税所得控除280万円、人的控除差5万円、所得税基礎控除67万円では、法定判定額は`220万円 - 5万円 - (67万円 - 48万円) = 196万円`です。所得税側の生命保険料控除額が住民税側より大きく、所得税課税所得が191万円であっても、特例控除割合は**79.79%**です。実際の所得税の限界税率から**84.895%へ置換するのは誤り**です。この差が生じる合成ケースを自動回帰で固定しています。

一次資料：[調布市 寄附金税額控除（令和8年度以降）](https://www.city.chofu.lg.jp/030010/p014041.html)、[横浜市 寄附金税額控除の割合と人的控除差の説明](https://www.city.yokohama.lg.jp/kurashi/koseki-zei-hoken/zeikin/y-shizei/kojin-shiminzei-kenminzei/kihukin.html)。

### 令和8年の新旧一般生命保険料の境界を追加（2026-11-16）

国税庁 No.1140の新旧混在計算を再確認し、旧生命保険料の年間支払額が**60,000円以下**か**60,000円超**かで併用選択肢の可否を分けます。旧保険料60,000円、新保険料30,000円、23歳未満扶養親族あり（確認済み）の架空例では、所得税の新旧併用選択肢は上限60,000円です。一方、旧保険料が60,001円になると**新旧合算選択肢は使用しない**ため、旧単独の40,001円、新単独の30,000円を比較して40,001円を採用します。旧保険料100,000円、新保険料120,000円の例では、新単独60,000円が旧単独50,000円を上回ります。この急変は誤計算を見逃さないため、合成データの境界テストで明示しています。

出典：[国税庁 No.1140 生命保険料控除・新旧契約双方の場合](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1140.htm)。「控除を受けられることを証明する書類」等による確認が必要です。寄附限度額の独立照合が一致しても、源泉票だけでは契約区分や証明書の真実性を確定できません。
