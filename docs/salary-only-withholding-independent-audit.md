# 年末調整済み・給与所得のみ：源泉徴収票からの独立検算（住民税決定通知書不要）

**運用決定：住民税決定通知書は入手・利用しません。** 寄附を行った**同一年の確定した給与所得・控除**を基に、法令から住民税所得割額とふるさと納税の寄附上限を独立に計算し、Excelと照合します。

税額は（原票G05や源泉税額をそのまま住民税額と置かず）次の順序で独立に検算します。

1. 源泉徴収票G04「支払金額」、G05「給与所得控除後の金額」（所得金額調整控除後を含む）、G06「所得控除額合計」、G08「源泉徴収税額」、G26社会保険料を取得。給与収入660万円以上の単純ケースは国税庁1410の給与所得表でG05を再計算。**660万円未満は所得税法別表第五の年分別給与所得表と照合し、早見算式で代用しない**。
2. 家族構成・年齢・配偶者所得・居住自治体・年末調整済み・他所得なし等を原票や本人確認により確定。所得税の基礎控除・配偶者・扶養等と社会保険料控除を独立合算しG06と照合。G06の内訳に未対応控除があれば安全停止（現行の厳密な給与-only検算v1では、生命保険料控除・地震保険料控除・住宅ローン控除・所得金額調整控除は**未対応**）。
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
