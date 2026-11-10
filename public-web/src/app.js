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
  function strictYen(value) {
    if (typeof value!=="string"||!/^(0|[1-9][0-9]{0,11})$/.test(value))
      return null;
    return Number(value);
  }
  // National income-tax band thresholds are different at the exact edges
  // from municipal resident special-credit bands. Keep separate auditors.
  // Source: NTA No.2260, municipal 2026 furusato special-credit tables.
  function residentSpecialRate(taxable) {
    if(taxable<=1950000)return .05;
    if(taxable<=3300000)return .10;
    if(taxable<=6950000)return .20;
    if(taxable<=9000000)return .23;
    if(taxable<=18000000)return .33;
    if(taxable<=40000000)return .40;
    return .45;
  }
  function nationalIncomeTax(taxable) {
    if(taxable<1950000)return taxable*5/100;
    if(taxable<3300000)return taxable*10/100-97500;
    if(taxable<6950000)return taxable*20/100-427500;
    if(taxable<9000000)return taxable*23/100-636000;
    if(taxable<18000000)return taxable*33/100-1536000;
    if(taxable<40000000)return taxable*40/100-2796000;
    return taxable*45/100-4796000;
  }
  // Independent display boundary: an engine result cannot bypass review
  // flags, mutate the user's inputs, or contradict its own tax arithmetic.
  // These are consistency guards, NOT an independent proof of tax law.
  function canDisplayEstimate(result,input) {
    if(!result||result.status!=="ESTIMATE"||!input||
       input.acknowledgedExclusions!==true||
       input.sourceReviewPending===true||
       flags.some(function(name){return input[name]!==false;}))
      return false;
    var year=Number(input.year),gross=strictYen(input.salaryGross);
    var social=strictYen(input.socialInsurance);
    if((year!==2025&&year!==2026)||
       (input.sourceYear!==undefined&&String(input.sourceYear)!==String(year))||
       gross===null||social===null||gross<=0||social>gross||
       result.year!==year||result.residentYear!==year+1||
       !Array.isArray(result.reasons)||result.reasons.length!==0)
      return false;
    var calc=result.calculation;
    if(!calc||typeof calc!=="object"||Array.isArray(calc))return false;
    var integers=["salaryGrossYen","salaryIncomeYen","socialInsuranceYen",
      "basicIncomeTaxDeductionYen","incomeTaxTaxableYen",
      "residentBasicDeductionYen","residentTaxTaxableYen",
      "residentIncomeLevyYen","specialCreditCapYen",
      "residentDonationIncomeCapYen","preliminaryLimitYen",
      "donationLimitYen"];
    if(integers.some(function(key){
       return !Number.isSafeInteger(calc[key])||calc[key]<0;
    }))return false;
    if(!Number.isSafeInteger(result.donationLimitYen)||
       result.donationLimitYen<0||result.donationLimitYen%1000!==0||
       calc.donationLimitYen!==result.donationLimitYen||
       calc.salaryGrossYen!==gross||calc.socialInsuranceYen!==social||
       calc.salaryIncomeYen>gross||
       calc.residentBasicDeductionYen!==430000)
      return false;
    var reference=input.salaryIncomeReference;
    if(reference!==""){
      var salaryRef=strictYen(reference);
      if(salaryRef===null||salaryRef!==calc.salaryIncomeYen)return false;
    }
    var totalReference=input.deductionsReference;
    if(totalReference!==""){
      var totalRef=strictYen(totalReference);
      if(totalRef===null||totalRef!==calc.basicIncomeTaxDeductionYen+social)
        return false;
    }
    var round1000=function(x){return Math.floor(x/1000)*1000;};
    if(calc.incomeTaxTaxableYen!==round1000(Math.max(0,
         calc.salaryIncomeYen-calc.basicIncomeTaxDeductionYen-social))||
       calc.residentTaxTaxableYen!==round1000(Math.max(0,
         calc.salaryIncomeYen-430000-social))||
       calc.incomeTaxTaxableYen<=0||calc.residentTaxTaxableYen<=0)
      return false;
    if(!Number.isSafeInteger(calc.residentSpecialRateBaseYen)||
       calc.residentSpecialRateBaseYen!==calc.incomeTaxTaxableYen||
       calc.marginalIncomeTaxRate!==residentSpecialRate(
         calc.residentSpecialRateBaseYen)||
       !Number.isSafeInteger(calc.nationalIncomeTaxYen)||
       calc.nationalIncomeTaxYen!==nationalIncomeTax(calc.incomeTaxTaxableYen)||
       !Number.isSafeInteger(calc.reconstructionIncomeTaxYen)||
       calc.reconstructionIncomeTaxYen!==
         Math.floor(calc.nationalIncomeTaxYen*21/1000)||
       !Number.isSafeInteger(calc.nationalIncomeTaxTotalYen)||
       calc.nationalIncomeTaxTotalYen!==
         calc.nationalIncomeTaxYen+calc.reconstructionIncomeTaxYen||
       !Number.isFinite(calc.denominator)||
       calc.denominator<=0||
       Math.abs(calc.denominator-(.9-calc.marginalIncomeTaxRate*1.021))>1e-10||
       calc.residentIncomeLevyYen<=0||
       calc.specialCreditCapYen!==Math.floor(calc.residentIncomeLevyYen*.2)||
       calc.residentDonationIncomeCapYen!==Math.floor(calc.salaryIncomeYen*.3)||
       calc.preliminaryLimitYen!==Math.floor(2000+
         calc.specialCreditCapYen/calc.denominator))
      return false;
    // In return-filing mode, further conservative deductions may reduce
    // the engine's proposed limit, but may never exceed this initial cap.
    return result.donationLimitYen<=round1000(Math.min(
      calc.preliminaryLimitYen,calc.residentDonationIncomeCapYen));
  }
  var printableInputSnapshot=null,printableResult=null;
  function render(result,input) {
    output.replaceChildren();
    output.hidden = false;
    var isEstimate=canDisplayEstimate(result,input);
    printableInputSnapshot=isEstimate?JSON.stringify(input):null;
    printableResult=isEstimate?result:null;
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
    print.addEventListener("click", function () {
      if(checkPrintableSnapshot())window.print();
    });
  }
  // Browsers and password/autofill managers can update .value without
  // dispatching input/change. Revalidate before BOTH the button and Ctrl+P.
  function checkPrintableSnapshot(){
    if(printableInputSnapshot===null||!printableResult)return false;
    var current=getInput();
    var selected=document.getElementById("slipFile");
    if(JSON.stringify(current)!==printableInputSnapshot||
       (selected&&selected.files&&selected.files.length>0)||
       !canDisplayEstimate(printableResult,current)){
      render({status:"HOLD",reasons:[
        "印刷前に入力・原票の選択状態が変わりました。改めて試算してください。"
      ]},current);
      return false;
    }
    return true;
  }
  window.addEventListener("beforeprint",function(){
    if(printableInputSnapshot!==null)checkPrintableSnapshot();
  });
  var conditionsConfirmation=form.elements.namedItem("acknowledgedExclusions");
  // Every material input change requires a fresh exclusions/allowances review.
  // OCR transfers change inputs programmatically and revoke this separately.
  function revokeOldConditionsConfirmation(event){
    var target=event.target;
    if(!target||target===conditionsConfirmation)return;
    var name=target.name;
    if(name==="year"||name==="filing"||
       name==="salaryGross"||name==="socialInsurance"||
       name==="salaryIncomeReference"||name==="deductionsReference"||
       flags.includes(name)){
      if(conditionsConfirmation)conditionsConfirmation.checked=false;
    }
  }
  function invalidateEstimate(){
    printableInputSnapshot=null;printableResult=null;
    output.replaceChildren();
    output.hidden=true;
    output.className="result";
  }
  // Never continue displaying an amount calculated for previous inputs:
  // exclusions, year, income figures and filing mode can change its validity.
  form.addEventListener("input",invalidateEstimate);
  form.addEventListener("change",invalidateEstimate);
  form.addEventListener("input",revokeOldConditionsConfirmation);
  form.addEventListener("change",revokeOldConditionsConfirmation);
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    try {
      if (typeof FurusatoEngine === "undefined" ||
        !FurusatoEngine || typeof FurusatoEngine.calculate !== "function") {
        render({status:"HOLD",reasons:["計算エンジンを読み込めませんでした。"]});
        return;
      }
      var snapshot=getInput();
      render(FurusatoEngine.calculate(snapshot),snapshot);
    } catch (_) {
      render({status:"HOLD",reasons:["計算中に異常が発生しました。目安額は表示しません。"]});
    }
  });
  form.addEventListener("reset", function () {
    printableInputSnapshot=null;printableResult=null;
    delete form.dataset.ocrYear;
    delete form.dataset.ocrReviewPending;
    output.replaceChildren();
    output.hidden = true;
    output.className = "result";
  });
}());
