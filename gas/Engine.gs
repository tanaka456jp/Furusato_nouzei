/**
 * Furusato GAS MVP 0.1.0 — pure, deterministic, no SpreadsheetApp dependency.
 * Scope: 2025/2026, one salary source, no family/insurance/mortgage/other income.
 * All unsupported cases fail closed. This is a pre-release ESTIMATE, never an assessment.
 * Source: NTA No.1155, No.1199, No.1410, No.2260 (see README).
 * The compiled source tables are deliberate: a user-edited spreadsheet is not a law update.
 */
var FurusatoEngine = (function () {
  "use strict";
  var VERSION = "gas-mvp-0.1.0";
  var TAX_REVISION = "2026-11-05-bundled";
  var BASIC = {
    2025: [[1320000,950000],[3360000,880000],[4890000,680000],
           [6550000,630000],[23500000,580000],[24000000,480000],
           [24500000,320000],[25000000,160000],[Infinity,0]],
    2026: [[1320000,1040000],[3360000,1040000],[4890000,1040000],
           [6550000,670000],[23500000,620000],[24000000,480000],
           [24500000,320000],[25000000,160000],[Infinity,0]]
  };
  var RATES = [[1950000,.05],[3300000,.10],[6950000,.20],
               [9000000,.23],[18000000,.33],[40000000,.40],[Infinity,.45]];
  var UNSUPPORTED = [
    ["hasSpouse","配偶者控除・配偶者特別控除は実額照合未完了"],
    ["hasDependents","扶養控除・特定親族・年少扶養の住民税影響は未検証"],
    ["hasLifeInsurance","生命保険料控除の所得税・住民税差額は未検証"],
    ["hasEarthquakeInsurance","地震保険料控除の所得税・住民税差額は未検証"],
    ["hasMortgage","住宅借入金等特別控除の住民税への影響は未検証"],
    ["hasOtherIncome","公的年金・事業・不動産・雑所得の配分は未検証"],
    ["hasMedical","医療費・寄附金以外の所得控除は未検証"],
    ["hasSplitIncome","申告分離課税の寄附控除配分は未検証"],
    ["hasIncomeAdjustment","所得金額調整控除がある場合は実額照合が必要"],
    ["sourceReviewPending","原票の読取結果が未確認です"]
  ];
  function money(value, name, required, reasons) {
    if ((value === "" || value === null || typeof value === "undefined") && !required) return null;
    var s = typeof value === "number" ? String(value) : String(value === null ? "" : value).trim();
    if (!/^(0|[1-9][0-9]{0,11})$/.test(s)) {
      reasons.push(name + "は0以上の整数（円）で入力してください");
      return null;
    }
    var n = Number(s);
    if (!Number.isSafeInteger(n) || n > 1000000000000) {
      reasons.push(name + "が許容範囲外です");
      return null;
    }
    return n;
  }
  function floor1000(n) { return Math.floor(n / 1000) * 1000; }
  function floor100(n) { return Math.floor(n / 100) * 100; }
  function basic(year, totalIncome) {
    for (var i=0;i<BASIC[year].length;i++) {
      if (totalIncome <= BASIC[year][i][0]) return BASIC[year][i][1];
    }
    return 0;
  }
  function marginal(taxableIncome) {
    for (var i=0;i<RATES.length;i++) {
      if (taxableIncome <= RATES[i][0]) return RATES[i][1];
    }
    return .45;
  }
  function salaryIncome(gross, year) {
    // Below 6.6m the actual year-end table must be used from the source slip.
    if (gross <= 6600000) return null;
    var allowance = gross <= 8500000 ? gross * .1 + 1100000 : 1950000;
    return Math.max(0, Math.floor(gross - allowance));
  }
  function result(status, reasons, info) {
    var output = {
      schema: "furusato-gas-result/v1",
      version: VERSION, taxRevision: TAX_REVISION,
      status: status, reasons: reasons, year: info.year,
      residentYear: info.year ? info.year + 1 : null,
      donationLimitYen: null, calculation: null,
      notice: "税務申告書や寄附上限額の保証ではありません。税制・自治体・控除状況の確認が必要です。",
      sourceLinks: [
        "https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1155.htm",
        "https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1199.htm",
        "https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1410.htm",
        "https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2260.htm"
      ]
    };
    return output;
  }
  function calculate(payload) {
    var input = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
    var reasons = [];
    var year = Number(input.year);
    if (year !== 2025 && year !== 2026) reasons.push("2025年・2026年以外は税制マスタ未承認です");
    if (input.incomeType !== "salary") reasons.push("給与所得のみが初期版の対応範囲です");
    if (input.filing !== "one-stop" && input.filing !== "return") reasons.push("申告方式を選択してください");
    if (input.acknowledgedExclusions !== true) reasons.push("控除・扶養の該当有無を確認してください");
    UNSUPPORTED.forEach(function (pair) { if (input[pair[0]] === true) reasons.push(pair[1]); });
    var gross = money(input.salaryGross, "給与支払金額", true, reasons);
    var social = money(input.socialInsurance, "社会保険料等の金額", true, reasons);
    var reference = money(input.salaryIncomeReference, "給与所得控除後の金額", false, reasons);
    var totalReference = money(input.deductionsReference, "所得控除合計額", false, reasons);
    if (gross !== null && gross === 0) reasons.push("給与支払金額は0円では計算できません");
    if (gross !== null && social !== null && social > gross) reasons.push("社会保険料が給与支払金額を超えています");
    if (gross !== null && reference !== null && reference > gross) reasons.push("給与所得控除後の金額が支払金額を超えています");
    if (gross !== null && gross > 8500000) reasons.push("給与850万円超は所得金額調整控除の判定が必要なため初期版では停止します");
    var income = gross === null ? null : salaryIncome(gross, year);
    if (reference !== null) {
      if (income !== null && Math.abs(reference-income)>1)
        reasons.push("原票の給与所得額と自動計算額が一致しません");
      income=reference;
    } else if (gross !== null && gross <= 6600000) {
      reasons.push("給与660万円以下は年末調整の給与所得金額表による原票額を入力してください");
    }
    if (income !== null && income < 0) reasons.push("給与所得が不正です");
    var incomeBasic = year in BASIC && income !== null ? basic(year,income) : null;
    if (incomeBasic !== null && social !== null && totalReference !== null &&
        Math.abs(totalReference - incomeBasic - social)>1)
      reasons.push("源泉徴収票の所得控除合計と基礎控除・社会保険料の合計が一致しません");
    if (reasons.length) return result("HOLD", reasons, {year:year in BASIC?year:null});
    var taxableIncome = floor1000(Math.max(0,income-incomeBasic-social));
    var residentTaxable = floor1000(Math.max(0,income-430000-social));
    if (taxableIncome <= 0 || residentTaxable <= 0)
      return result("HOLD", ["課税所得がゼロのため、初期版では寄附限度額を判定しません"], {year:year});
    // 10% standard resident income levy, ordinary taxpayer; adjustment credit ¥2,500
    // is a conservative audited assumption for this narrowly scoped standard case.
    var adjustment = 2500;
    var residentLevy = floor100(Math.max(0,residentTaxable*.1-adjustment));
    if (residentLevy<=0) return result("HOLD",["住民税所得割がゼロです"],{year:year});
    var rate = marginal(taxableIncome);
    var denominator = .9 - rate * 1.021;
    if (denominator<=0) return result("HOLD",["特例控除割合を判定できません"],{year:year});
    var specialCap = Math.floor(residentLevy*.2);
    var computed = 2000 + specialCap/denominator;
    var residentIncomeCap = Math.floor(income*.3);
    var deductibleMax = Math.min(computed,residentIncomeCap);
    var donationLimit = floor1000(Math.max(0,deductibleMax));
    var response = result("ESTIMATE",[],{year:year});
    response.donationLimitYen = donationLimit;
    response.calculation = {
      salaryGrossYen:gross, salaryIncomeYen:income, socialInsuranceYen:social,
      basicIncomeTaxDeductionYen:incomeBasic, residentBasicDeductionYen:430000,
      incomeTaxTaxableYen:taxableIncome, marginalIncomeTaxRate:rate,
      residentTaxTaxableYen:residentTaxable, residentIncomeTaxBeforeAdjustmentYen:residentTaxable*.1,
      residentAdjustmentYen:adjustment, residentIncomeLevyYen:residentLevy,
      specialCreditCapYen:specialCap, reconstructionMultiplier:1.021,
      denominator:denominator, preliminaryLimitYen:Math.floor(computed),
      residentDonationIncomeCapYen:residentIncomeCap, donationLimitYen:donationLimit,
      rounding:"安全側の1,000円未満切捨て"
    };
    return response;
  }
  function statutoryRows() {
    var rows=[["所得年","総所得金額上限","所得税基礎控除","住民税基礎控除","参照版"]];
    [2025,2026].forEach(function(year) {
      BASIC[year].forEach(function(row,i) {
        var residentBasic = i < 6 ? 430000 : (i === 6 ? 290000 : (i === 7 ? 150000 : 0));
        rows.push([year,row[0]===Infinity?"上限なし":row[0],row[1],residentBasic,TAX_REVISION]);
      });
    });
    return rows;
  }
  return {calculate:calculate,statutoryRows:statutoryRows,version:VERSION};
}());
if (typeof module !== "undefined" && module.exports) module.exports=FurusatoEngine;
