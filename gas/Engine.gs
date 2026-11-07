/**
 * Furusato GAS MVP 0.1.7 — pure, deterministic, no SpreadsheetApp dependency.
 * Scope: 2025/2026, one salary source, no family/insurance/mortgage/other income.
 * All unsupported cases fail closed. This is a pre-release ESTIMATE, never an assessment.
 * Source: NTA No.1155, No.1199, No.1410, No.2260 (see README).
 * The compiled source tables are deliberate: a user-edited spreadsheet is not a law update.
 */
var FurusatoEngine = (function () {
  "use strict";
  var VERSION = "gas-mvp-0.1.7";
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
    // NTA statutory table: income tax, salary deduction after year-end
    // adjustment. 2025: ¥1.9m–6.6m, 2026: ¥2.2m–6.6m.
    // The true table, NOT a naïve 30%/20% formula, rounds down
    // gross/4 to the nearest ¥1,000 before applying the coefficient.
    // 2026 special short bands are stated in NTA 2026 Tax Reform Q&A,
    // Q3-1 (May 2026). The discontinuous short bands around ¥2.191m
    // must NOT be approximated by gross minus the ¥740k minimum.
    // 2025 uses the ordinary ¥650k minimum at low incomes.
    if (year !== 2025 && year !== 2026) return null;
    if (year === 2025 && gross < 1900000)
      return Math.max(0,gross-650000);
    if (year === 2026 && gross < 2200000) {
      if (gross < 741000) return 0;
      if (gross < 2191000) return gross-740000;
      if (gross < 2193000) return 1451000;
      if (gross < 2196000) return 1453000;
      return 1456000;
    }
    if (gross < 6600000) {
      var quarter = Math.floor(gross / 4000) * 1000;
      return gross < 3600000
        ? Math.round(quarter * 2.8 - 80000)
        : Math.round(quarter * 3.2 - 440000);
    }
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
    if (input.mode === "separate") return FurusatoSeparateTax.calculate(input, basic, VERSION);
    var reasons = [];
    var year = Number(input.year);
    if (year !== 2025 && year !== 2026) reasons.push("2025年・2026年以外は税制マスタ未承認です");
    if (input.incomeType !== "salary") reasons.push("給与所得のみが初期版の対応範囲です");
    if (input.filing !== "one-stop" && input.filing !== "return") reasons.push("申告方式を選択してください");
    if (input.acknowledgedExclusions !== true) reasons.push("控除・扶養の該当有無を確認してください");
    UNSUPPORTED.forEach(function (pair) {
      if (input[pair[0]] === true) reasons.push(pair[1]);
      else if (typeof input[pair[0]] !== "undefined" && input[pair[0]] !== false)
        reasons.push("確認項目の値が不正です: " + pair[0]);
    });
    // Keep evidence of deductions detected in an imported source separate from
    // editable wizard checkboxes. Unchecking a UI flag cannot erase a source fact.
    if (typeof input.sourceIndicators !== "undefined") {
      var indicators = input.sourceIndicators;
      var known = UNSUPPORTED.map(function(x){return x[0];});
      if (!indicators || typeof indicators !== "object" || Array.isArray(indicators))
        reasons.push("源泉徴収票の控除情報が不正です");
      else Object.keys(indicators).forEach(function (flag) {
        if (known.indexOf(flag) < 0 || indicators[flag] !== true)
          reasons.push("源泉徴収票の控除情報が不正です");
        else
          reasons.push("源泉徴収票で検出した控除・扶養は未対応です: " + flag);
      });
    }
    if (typeof input.sourceYear !== "undefined" &&
        (String(input.sourceYear) !== String(input.year))) {
      reasons.push("取込んだ源泉徴収票と選択した所得年が一致しません");
    }
    var gross = money(input.salaryGross, "給与支払金額", true, reasons);
    var social = money(input.socialInsurance, "社会保険料等の金額", true, reasons);
    var reference = money(input.salaryIncomeReference, "給与所得控除後の金額", false, reasons);
    var totalReference = money(input.deductionsReference, "所得控除合計額", false, reasons);
    var basicReference = money(input.sourceBasicReference, "源泉徴収票の基礎控除額", false, reasons);
    if (gross !== null && gross === 0) reasons.push("給与支払金額は0円では計算できません");
    if (gross !== null && social !== null && social > gross) reasons.push("社会保険料が給与支払金額を超えています");
    if (gross !== null && reference !== null && reference > gross) reasons.push("給与所得控除後の金額が支払金額を超えています");
    // Even in low salary bands whose exact table is not yet integrated,
    // the amount after salary deduction cannot exceed gross minus the
    // statutory minimum salary deduction (2025: 650k, 2026: 740k).
    var minSalaryDeduction = year === 2026 ? 740000 : (year === 2025 ? 650000 : null);
    if (gross !== null && reference !== null && minSalaryDeduction !== null &&
        reference > Math.max(0,gross-minSalaryDeduction))
      reasons.push("給与所得控除後の金額が法定の給与所得控除最低保障額と一致しません");
    if (gross !== null && gross > 8500000) reasons.push("給与850万円超は所得金額調整控除の判定が必要なため初期版では停止します");
    var income = gross === null ? null : salaryIncome(gross, year);
    if (reference !== null) {
      if (income !== null && reference !== income)
        reasons.push("原票の給与所得額と自動計算額が一致しません");
      income=reference;
    } else if (gross !== null && income === null) {
      reasons.push("この所得年の給与所得額は未承認のため試算できません");
    }
    if (income !== null && income < 0) reasons.push("給与所得が不正です");
    var incomeBasic = year in BASIC && income !== null ? basic(year,income) : null;
    if (incomeBasic !== null && basicReference !== null &&
        basicReference !== incomeBasic)
      reasons.push("源泉徴収票の基礎控除額が選択年分の法定控除額と一致しません");
    if (incomeBasic !== null && social !== null && totalReference !== null &&
        totalReference !== incomeBasic + social)
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
    // Resident-tax special-credit bracket is determined using the
    // *resident-tax* taxable income minus (1) statutory 50k personal
    // deduction difference and (2) the excess income-tax basic deduction
    // over 480k (2025/2026 law). In the supported basic-only case this
    // equals the income-tax taxable income; calculate separately so an
    // accidental future divergence fails closed instead of silently passing.
    var specialRateBase = residentTaxable - 50000 -
      Math.max(0, incomeBasic - 480000);
    var bracketIncome = floor1000(Math.max(0,specialRateBase));
    if (specialRateBase <= 0 || bracketIncome !== taxableIncome)
      return result("HOLD",["住民税特例控除の税率判定額と所得税課税所得が一致しません"],{year:year});
    var rate = marginal(bracketIncome);
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
      residentSpecialRateBaseYen:bracketIncome,
      residentHumanDeductionDifferenceYen:50000,
      residentBasicExcessDeductionYen:Math.max(0,incomeBasic-480000),
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
  return {calculate:calculate,statutoryRows:statutoryRows,salaryIncome:salaryIncome,version:VERSION};
}());
if (typeof module !== "undefined" && module.exports) module.exports=FurusatoEngine;

// 分離課税の検証版。共通仕様 taxdata/separate-tax-v1.json。
// 給与ウィザードとは独立した、確定申告用の確認済み金額を受け付ける。
var FurusatoSeparateTax = (function () {
  "use strict";
  var buckets = [
    ["ordinary", 0, 60, 40],
    ["shortLand", 30, 54, 36],
    ["longLand", 15, 30, 20],
    ["listedDividend", 15, 30, 20],
    ["generalStock", 15, 30, 20],
    ["listedStock", 15, 30, 20],
    ["futures", 15, 30, 20]
  ];
  var brackets = [
    [1950000, 5, 0], [3300000, 10, 97500], [6950000, 20, 427500],
    [9000000, 23, 636000], [18000000, 33, 1536000],
    [40000000, 40, 2796000], [Infinity, 45, 4796000]
  ];
  var maximumIncome = 23500000;
  var gridMaximum = 1100000;
  var inputKeys = ["mode", "year", "filing", "conditions", "nationalDeductions",
    "residentDeductions", "personalDifference", "donation"].concat(buckets.map(function (b) { return b[0]; }));

  function hold(code, category, reason, field, action) {
    return {
      status: "HOLD", donationLimitYen: null, calculation: null,
      stop: {
        code: code, category: category, reason: reason, field: field, automatic: false,
        action: action, resume: "詳細設定の「再計算」",
        recalculates: "所得控除配分、所得税等、住民税所得割、寄附の負担額を再計算",
        storage: "画面内の入力を保持。ブラウザを閉じると消えます。",
        unverified: "所得税等・住民税所得割・寄附目安額"
      }
    };
  }

  function allocate(income, deductions) {
    var remaining = deductions;
    var rows = buckets.map(function (bucket) {
      var amount = income[bucket[0]];
      var applied = Math.min(remaining, amount);
      remaining -= applied;
      return {kind: bucket[0], applied: applied,
        taxable: Math.floor((amount - applied) / 1000) * 1000};
    });
    return {rows: rows, unused: remaining};
  }

  function national(income, deductions) {
    var allocation = allocate(income, deductions);
    var ordinary = allocation.rows[0].taxable;
    var bracket = brackets.find(function (b) { return ordinary <= b[0]; });
    var base = ordinary * bracket[1] / 100 - bracket[2];
    allocation.rows.slice(1).forEach(function (row, i) {
      base += row.taxable * buckets[i + 1][1] / 100;
    });
    var reconstruction = Math.floor(base * 21 / 1000);
    return {allocation: allocation, base: base, reconstruction: reconstruction, annual: base + reconstruction};
  }

  function resident(income, deductions, personalDifference, nationalBasic) {
    var allocation = allocate(income, deductions);
    var ordinary = allocation.rows[0].taxable;
    var adjustmentBase = ordinary <= 2000000
      ? Math.min(ordinary, personalDifference)
      : Math.max(50000, personalDifference - (ordinary - 2000000));
    var levy = [2, 3].map(function (index) {
      var tax = allocation.rows.reduce(function (total, row, i) {
        return total + row.taxable * buckets[i][index] / 1000;
      }, 0);
      // Keep thousandths of one yen until the final assessed tax rounding.
      return Math.max(0, tax * 1000 - adjustmentBase * (index === 2 ? 30 : 20));
    });
    var adjustedOrdinary = ordinary - personalDifference - Math.max(0, nationalBasic - 480000);
    var ratio = ordinary > 0 && adjustedOrdinary >= 0
      ? 90000 - brackets.find(function (b) { return adjustedOrdinary <= b[0]; })[1] * 1021
      : (income.shortLand > 0 ? 59370 : 74685);
    return {allocation: allocation, levy: levy, ratio: ratio, adjustedOrdinary: adjustedOrdinary};
  }

  function donationResult(input, before, local, total, donation) {
    var incomeDeduction = Math.max(0, Math.min(donation, Math.floor(total * 4 / 10)) - 2000);
    var after = national(input, input.nationalDeductions + incomeDeduction);
    var basicBaseTenths = Math.max(0, Math.min(donation * 10, total * 3) - 20000);
    var eligibleSpecial = Math.max(0, donation - 2000);
    var localAfter = local.levy.map(function (levy, index) {
      var share = index === 0 ? 3 : 2;
      // 5,000,000 units per yen. Apply each jurisdiction's cap before
      // rounding the sum of its basic and special credits up to a yen.
      var special = Math.min(levy * 1000, eligibleSpecial * local.ratio * share * 10);
      var basic = basicBaseTenths * share * 10000;
      var credit = Math.ceil((basic + special) / 5000000);
      return Math.max(0, Math.floor((levy - credit * 1000) / 100000)) * 100;
    });
    var nationalRelief = before.annual - after.annual;
    var residentRelief = local.levy.reduce(function (sum, levy, index) {
      return sum + Math.floor(levy / 100000) * 100 - localAfter[index];
    }, 0);
    return {donation: donation, incomeDeduction: incomeDeduction, nationalAfter: after,
      residentAfter: localAfter, nationalRelief: nationalRelief, residentRelief: residentRelief,
      netCost: donation - nationalRelief - residentRelief};
  }

  function calculate(input, basicDeduction, version) {
    if (input.filing !== "return") {
      return hold("SAFE-TAX-012", "CONFIG_REQUIRED", "申告分離課税は確定申告で試算します。",
        "申告方式", "「確定申告」を選択してください。");
    }
    if (input.conditions !== "reviewed" || Object.keys(input).some(function (key) { return inputKeys.indexOf(key) < 0; })) {
      return hold("SAFE-TAX-013", "UNSUPPORTED_TAX_CASE", "標準条件の照合が済んでいないか、未対応条件があります。",
        "適用条件", "所得・控除と適用条件を照合してください。特例が該当するときは個別計算に切り替えてください。");
    }
    var fields = inputKeys.slice(4);
    var invalid = fields.find(function (key) {
      return !Number.isSafeInteger(input[key]) || input[key] < 0 || input[key] > 100000000;
    });
    if ((input.year !== 2025 && input.year !== 2026) || invalid) {
      return hold("SAFE-TAX-011", "CONFIG_REQUIRED", "対象年または金額を確認してください。",
        invalid || "所得年", "2025年または2026年を選び、空欄を含む全金額を0以上の整数で入力してください。");
    }
    var total = buckets.reduce(function (sum, bucket) { return sum + input[bucket[0]]; }, 0);
    var basic = basicDeduction(input.year, total);
    if (total < 1000000 || total > maximumIncome || total === input.ordinary ||
        (input.listedDividend > 0 && total - input.ordinary > input.listedDividend)) {
      return hold("SAFE-TAX-014", "UNSUPPORTED_TAX_CASE", "検証範囲外の所得額または所得区分の組合せです。",
        "各所得額", "合計所得100万〜2,350万円の申告分離案件を入力してください。申告分離配当と他の分離所得の併用は個別確認です。");
    }
    if (input.nationalDeductions < basic || input.residentDeductions < 430000 || input.personalDifference < 50000) {
      return hold("SAFE-TAX-015", "CALCULATION_MISMATCH", "入力した控除額に法定の基礎控除等が含まれていません。",
        "税目別控除・法定人的控除差", "基礎控除を含む税目別の控除合計と法定人的控除差を確認してください。");
    }
    var before = national(input, input.nationalDeductions);
    var local = resident(input, input.residentDeductions, input.personalDifference, basic);
    var limit = 0;
    // Rounding breaks monotonicity. Check every ¥1,000 candidate in the
    // proven range documented in the common tax audit.
    for (var amount = 3000; amount <= gridMaximum; amount += 1000) {
      if (donationResult(input, before, local, total, amount).netCost <= 2000) limit = amount;
    }
    return {
      status: "ESTIMATE", version: version, year: input.year, residentYear: input.year + 1,
      donationLimitYen: limit,
      calculation: {total: total, nationalBasic: basic, nationalBefore: before,
        residentBefore: local, atInput: donationResult(input, before, local, total, input.donation),
        atLimit: donationResult(input, before, local, total, limit)}
    };
  }
  return {calculate: calculate};
}());
