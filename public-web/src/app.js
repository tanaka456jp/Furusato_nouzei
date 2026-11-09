"use strict";
/**
 * Entirely client-side public-web review calculator.
 * No fetch, XHR, cookies, storage, analytics, advertising, OCR or GAS API.
 * Engine is copied verbatim at build time from gas/Engine.gs.
 */
(function () {
  var form = document.getElementById("calculator");
  var output = document.getElementById("result");
  if (!form || !output) return;
  var flags = [
    "hasSpouse", "hasDependents", "hasLifeInsurance",
    "hasEarthquakeInsurance", "hasMortgage", "hasOtherIncome",
    "hasMedical", "hasSplitIncome", "hasIncomeAdjustment",
    "hasNonstandardConditions"
  ];
  function add(tag, parent, text, className) {
    var element = document.createElement(tag);
    if (typeof text === "string") element.textContent = text;
    if (className) element.className = className;
    parent.appendChild(element);
    return element;
  }
  function yen(amount) {
    return Number(amount).toLocaleString("ja-JP") + "円";
  }
  function getInput() {
    var get = function (name) { return form.elements.namedItem(name); };
    var input = {
      year: get("year").value,
      filing: get("filing").value,
      incomeType: "salary",
      salaryGross: get("salaryGross").value.trim(),
      socialInsurance: get("socialInsurance").value.trim(),
      salaryIncomeReference: get("salaryIncomeReference").value.trim(),
      deductionsReference: get("deductionsReference").value.trim(),
      acknowledgedExclusions: get("acknowledgedExclusions").checked
    };
    if(form.dataset.ocrYear)input.sourceYear=form.dataset.ocrYear;
    if(form.dataset.ocrReviewPending==="true")input.sourceReviewPending=true;
    flags.forEach(function (name) {
      input[name] = get(name).checked === true;
    });
    return input;
  }
  function render(result) {
    output.replaceChildren();
    output.hidden = false;
    var isEstimate = result && result.status === "ESTIMATE" &&
      Number.isSafeInteger(result.donationLimitYen) &&
      result.donationLimitYen >= 0 &&
      result.calculation && typeof result.calculation === "object";
    output.className = isEstimate ? "result" : "result hold";
    if (!isEstimate) {
      add("h3", output, "試算を停止しました（HOLD）");
      add("p", output, "条件や入力値の確認が必要です。限度額の数値は表示しません。");
      var ul = add("ul", output);
      var reasons = result && Array.isArray(result.reasons) && result.reasons.length
        ? result.reasons : ["計算結果を確認できません。再入力しても解消しない場合は利用を中止してください。"];
      reasons.slice(0, 24).forEach(function (text) { add("li", ul, String(text)); });
      return;
    }
    add("h3", output, "寄附上限額の概算（対応条件内）");
    add("p", output, yen(result.donationLimitYen), "amount");
    add("p", output, "概算であり、自己負担2,000円を必ず保証するものではありません。申告前に制度・控除・住民税額を確認してください。", "muted");
    var details = add("details", output);
    add("summary", details, "計算根拠を表示");
    var dl = add("dl", details);
    var calc = result.calculation;
    [
      ["給与所得額", calc.salaryIncomeYen],
      ["社会保険料等", calc.socialInsuranceYen],
      ["所得税の課税所得", calc.incomeTaxTaxableYen],
      ["住民税所得割の概算", calc.residentIncomeLevyYen],
      ["寄附限度額の概算", calc.donationLimitYen]
    ].forEach(function (pair) {
      if (Number.isFinite(pair[1])) {
        add("dt", dl, pair[0]);
        add("dd", dl, yen(pair[1]));
      }
    });
    add("p", details, "所得年 " + result.year +
      "年 ／ 住民税 " + result.residentYear + "年度 ／ エンジン " +
      String(result.version || "未検証"), "muted");
    var print = add("button", output, "この結果を印刷・PDF保存", "secondary");
    print.type = "button";
    print.addEventListener("click", function () { window.print(); });
  }
  function invalidateEstimate(){
    output.replaceChildren();
    output.hidden=true;
    output.className="result";
  }
  // Never continue displaying an amount calculated for previous inputs:
  // exclusions, year, income figures and filing mode can change its validity.
  form.addEventListener("input",invalidateEstimate);
  form.addEventListener("change",invalidateEstimate);
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    try {
      if (typeof FurusatoEngine === "undefined" ||
        !FurusatoEngine || typeof FurusatoEngine.calculate !== "function") {
        render({status:"HOLD",reasons:["計算エンジンを読み込めませんでした。"]});
        return;
      }
      render(FurusatoEngine.calculate(getInput()));
    } catch (_) {
      render({status:"HOLD",reasons:["計算中に異常が発生しました。目安額は表示しません。"]});
    }
  });
  form.addEventListener("reset", function () {
    delete form.dataset.ocrYear;
    delete form.dataset.ocrReviewPending;
    output.replaceChildren();
    output.hidden = true;
    output.className = "result";
  });
}());
