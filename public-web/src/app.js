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
      municipality: get("municipality").value,
      donationTrial: get("donationTrial").value.trim(),
      incomeType: "salary",
      salaryGross: get("salaryGross").value.trim(),
      socialInsurance: get("socialInsurance").value.trim(),
      salaryIncomeReference: get("salaryIncomeReference").value.trim(),
      // The previous-year/source reference is retained independently.
      // Only the explicit override becomes the working total on request.
      sourceDeductionsReference: get("deductionsReference").value.trim(),
      deductionsOverride: get("deductionsOverride").value.trim(),
      // Only an explicit override is submitted as a deduction total.
      // Otherwise the engine recomputes its supported basic/social total.
      deductionsReference: get("deductionsOverride").value.trim(),
      acknowledgedExclusions: get("acknowledgedExclusions").checked,
      forecastReviewed: get("forecastReviewed").checked
    };
    if(form.dataset.ocrYear)input.sourceYear=form.dataset.ocrYear;
    if(form.dataset.ocrOriginalGross!==undefined){
      input.sourceOriginalGross=form.dataset.ocrOriginalGross;
      input.sourceOriginalSocial=form.dataset.ocrOriginalSocial;
      input.sourceOriginalDeductions=form.dataset.ocrOriginalDeductions;
    }
    if(form.dataset.ocrSourceIndicators){
      // Strict whitelist prevents a malformed local marker from weakening HOLD.
      var recognized=["hasLifeInsurance","hasEarthquakeInsurance",
        "hasMortgage","hasIncomeAdjustment","hasDependents",
        "hasNonstandardConditions"];
      input.sourceIndicators={};
      form.dataset.ocrSourceIndicators.split(",").forEach(function(key){
        input.sourceIndicators[recognized.includes(key)?
          key:"hasNonstandardConditions"]=true;
      });
    }
    // Re-attest a previously transferred OCR source after editing figures.
    // This must NOT bypass cancellation/failed OCR: only explicit edits to
    // an already transferred source may set ocrManualReviewRequired.
    if(form.dataset.ocrReviewPending==="true"&&
       !(form.dataset.ocrManualReviewRequired==="true"&&
         get("correctedSourceReviewed").checked===true))
      input.sourceReviewPending=true;
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
  // The imported source's own basic/social totals are checked at its OWN
  // year, before it is treated as the reference for a revised target-year
  // estimate. This prevents dropping an unrecognized source deduction by
  // editing the social amount or entering a smaller manual override.
  function supportedSourceTotal(year,gross,social,total){
    if(typeof FurusatoEngine==="undefined"||!FurusatoEngine||
       typeof FurusatoEngine.salaryIncome!=="function"||
       typeof FurusatoEngine.statutoryRows!=="function")return false;
    var salary=FurusatoEngine.salaryIncome(gross,year);
    if(!Number.isSafeInteger(salary))return false;
    var rows=FurusatoEngine.statutoryRows();
    for(var i=0;i<rows.length;i++){
      var entry=rows[i];
      if(entry[0]===year&&salary<=entry[1])
        return Number.isSafeInteger(entry[2])&&entry[2]+social===total;
    }
    return false;
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
    if(input.sourceIndicators!==undefined&&
       (!input.sourceIndicators||typeof input.sourceIndicators!=="object"||
        Array.isArray(input.sourceIndicators)||
        Object.keys(input.sourceIndicators).length>0))return false;
    var year=Number(input.year),gross=strictYen(input.salaryGross);
    var social=strictYen(input.socialInsurance);
    var sourceYear=input.sourceYear===undefined?year:Number(input.sourceYear);
    if((year!==2025&&year!==2026)||
       !Number.isSafeInteger(sourceYear)||
       (sourceYear!==year&&sourceYear!==year-1)||
       (sourceYear!==year&&input.forecastReviewed!==true)||
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
    var override=input.deductionsOverride;
    if(override!==undefined&&override!==""){
      var typedTotal=strictYen(override);
      var autoTotal=calc.basicIncomeTaxDeductionYen+social;
      // The shared engine only certifies basic plus social deductions.
      // Never promote a manually typed unverified family/insurance sum
      // into a falsely certified donation amount.
      if(typedTotal===null||typedTotal!==autoTotal)return false;
    }
    var autoTotal=calc.basicIncomeTaxDeductionYen+social;
    var imported=input.sourceOriginalGross!==undefined||
                 input.sourceOriginalSocial!==undefined||
                 input.sourceOriginalDeductions!==undefined;
    if(imported){
      var originalGross=strictYen(input.sourceOriginalGross),
          originalSocial=strictYen(input.sourceOriginalSocial),
          originalTotal=strictYen(input.sourceOriginalDeductions);
      if(originalGross===null||originalSocial===null||
         originalTotal===null||!supportedSourceTotal(
           sourceYear,originalGross,originalSocial,originalTotal))
        return false;
    }else if(input.sourceDeductionsReference!==""&&
             strictYen(input.sourceDeductionsReference)!==autoTotal){
      // A freely typed "source reference" that contradicts the model
      // cannot be silently discarded as soon as override is removed.
      return false;
    }
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
  // The existing shared engine remains unchanged. A second WEB-only gate
  // validates an explicit municipality and applies its one-stop ceiling.
  function selectedReference(result,input){
    if(!canDisplayEstimate(result,input)||!["standard","designated"].includes(input.municipality)||
       !["one-stop","return"].includes(input.filing))return null;
    var engine=window.FurusatoResidentLevy;
    if(!engine||typeof engine.oneStopReference!=="function")return null;
    var calc=result.calculation;
    var local=engine.oneStopReference({year:result.year,salaryIncome:calc.salaryIncomeYen,
      socialInsurance:calc.socialInsuranceYen,municipality:input.municipality,
      conditions:"basic-only-reviewed"});
    var c=local&&local.calculation;
    if(!local||local.status!=="ESTIMATE"||!c||c.municipality!==input.municipality||
       c.residentTaxableYen!==calc.residentTaxTaxableYen||
       c.pooledComparisonYen!==calc.residentIncomeLevyYen||
       c.nationalTaxableYen!==calc.incomeTaxTaxableYen||
       !Number.isSafeInteger(c.residentIncomeLevyYen)||c.residentIncomeLevyYen<=0||
       c.residentIncomeLevyYen!==c.city.assessedYen+c.prefecture.assessedYen||
       !Number.isSafeInteger(local.donationLimitYen)||local.donationLimitYen<2000||
       local.donationLimitYen%1000!==0||
       !Number.isSafeInteger(c.exactReferenceYen)||
       local.donationLimitYen!==Math.floor(c.exactReferenceYen/1000)*1000)return null;
    // Return filing still uses the pre-existing shared conservative
    // comparison of BOTH standard jurisdictions, not a one-stop formula.
    return {amount:input.filing==="one-stop"?Math.min(result.donationLimitYen,local.donationLimitYen):result.donationLimitYen,
      residentLevy:c.residentIncomeLevyYen,exactReference:input.filing==="one-stop"?c.exactReferenceYen:null,
      basis:input.filing==="one-stop"?"自治体別ワンストップ参考":"確定申告・標準2区分の保守的参考"};
  }
  // Share the same strict display guard with the local multi-person batch.
  // The batch calculation must never use a weaker amount display policy.
  window.FurusatoEstimateGuard=Object.freeze({
    canDisplayEstimate:canDisplayEstimate,selectedReference:selectedReference
  });
  var printableInputSnapshot=null,printableResult=null;
  var overrideNotice=document.getElementById("deductionsOverrideStatus");
  function updateOverrideNotice(){
    var control=form.elements.namedItem("deductionsOverride");
    var active=!!(control&&control.value.trim());
    form.classList.toggle("deduction-override-active",active);
    if(overrideNotice)overrideNotice.hidden=!active;
  }
  function render(result,input) {
    output.replaceChildren();
    output.hidden = false;
    var selected=selectedReference(result,input);
    var isEstimate=!!selected;
    printableInputSnapshot=isEstimate?JSON.stringify(input):null;
    printableResult=isEstimate?result:null;
    output.className = isEstimate ? "result" : "result hold";
    if(input&&input.deductionsOverride){
      add("p",output,"⚠ 所得控除合計額を手入力上書き中（"+
        input.deductionsOverride+"円）。他の入力変更には自動追随しません。"+
        "源泉票額・自動算定額の両方を確認してください。","deductions-override-warning");
    }
    if (!isEstimate) {
      add("h3", output, "試算を停止しました（HOLD）");
      add("p", output, "条件や入力値の確認が必要です。限度額の数値は表示しません。");
      var ul = add("ul", output);
      var reasons = result && Array.isArray(result.reasons) && result.reasons.length
        ? result.reasons : ["計算結果を確認できません。再入力しても解消しない場合は利用を中止してください。"];
      if(input&&!["standard","designated"].includes(input.municipality))
        reasons=["課税自治体の標準税率区分を確認・選択してください。"];
      reasons.slice(0, 24).forEach(function (text) { add("li", ul, String(text)); });
      return;
    }
    add("h3", output, "寄附上限額の概算（対応条件内）");
    add("p", output, yen(selected.amount), "amount");
    add("p", output, (input.municipality==="standard"?"標準市町村":"政令指定都市")+" ／ "+selected.basis, "muted");
    add("p", output, "概算であり、自己負担2,000円を必ず保証するものではありません。申告前に制度・控除・住民税額を確認してください。", "muted");
    var details = add("details", output);
    add("summary", details, "計算根拠を表示");
    var dl = add("dl", details);
    var calc = result.calculation;
    [
      ["給与所得額", calc.salaryIncomeYen],
      ["社会保険料等", calc.socialInsuranceYen],
      ["所得控除合計（自動算定）", calc.basicIncomeTaxDeductionYen+calc.socialInsuranceYen],
      ["原票・見込額の照合値", input.sourceDeductionsReference!==""?
        strictYen(input.sourceDeductionsReference):null],
      ["所得控除合計（手入力上書き）", input.deductionsOverride!==""?
        strictYen(input.deductionsOverride):null],
      ["所得税の課税所得", calc.incomeTaxTaxableYen],
      ["住民税所得割の概算（選択自治体）", selected.residentLevy],
      ["寄附限度額の概算（千円単位）", selected.amount],
      ["ワンストップ理論参考上限（1円単位）", selected.exactReference]
    ].forEach(function (pair) {
      if (Number.isFinite(pair[1])) {
        add("dt", dl, pair[0]);
        add("dd", dl, yen(pair[1]));
      }
    });
    // Independent municipality comparison, shown only after the existing
    // source/condition guard has accepted the salary estimate. No selected
    // jurisdiction is inferred from the slip or browser location.
    if(input.filing==="one-stop"&&window.FurusatoResidentLevy&&
       typeof window.FurusatoResidentLevy.oneStopReference==="function"){
      var section=add("section",details,undefined,"municipal-comparison");
      add("h4",section,"自治体別ワンストップ参考額（比較検証）");
      add("p",section,"標準税率の2区分を比較します。主表示は選択した自治体の保守的な参考額です。実際の自治体・控除条件の確認が必要です。");
      ["standard","designated"].forEach(function(municipality){
        var local=window.FurusatoResidentLevy.oneStopReference({
          year:result.year,salaryIncome:calc.salaryIncomeYen,
          socialInsurance:calc.socialInsuranceYen,municipality:municipality,
          conditions:"basic-only-reviewed"});
        var name=municipality==="standard"?"標準市町村":"政令指定都市";
        if(local.status!=="ESTIMATE"||!local.calculation){
          add("p",section,name+"：HOLD");return;
        }
        var c=local.calculation;
        add("p",section,name+"：所得割 "+yen(c.residentIncomeLevyYen)+
          "（市町村 "+yen(c.city.assessedYen)+"・道府県 "+yen(c.prefecture.assessedYen)+
          "）、寄附参考額 "+yen(local.donationLimitYen)+
          "（千円未満切捨て）");
      });
    }
    // Filing comparison is independent of the currently chosen filing mode.
    // Only display after the existing source and municipal guards accepted.
    var filingSection=add("section",details,undefined,"filing-trial");
    add("h4",filingSection,"確定申告した場合の寄附額・自己負担比較");
    var trialEngine=window.FurusatoResidentLevy;
    var trialArgs={year:result.year,salaryIncome:calc.salaryIncomeYen,
      socialInsurance:calc.socialInsuranceYen,municipality:input.municipality,
      conditions:"basic-only-reviewed"};
    if(trialEngine&&typeof trialEngine.filingTrial==="function"&&typeof trialEngine.filingPrefix==="function"){
      var oneStop=trialEngine.oneStopReference(trialArgs);
      var prefix=trialEngine.filingPrefix(trialArgs);
      if(oneStop.status==="ESTIMATE"&&prefix.status==="ESTIMATE"){
        var trialAmount=input.donationTrial===""?oneStop.donationLimitYen:strictYen(input.donationTrial);
        var trial=trialEngine.filingTrial(trialArgs,trialAmount);
        var trialDl=add("dl",filingSection);
        [["ワンストップ参考上限",oneStop.donationLimitYen],
         ["確定申告・自己負担2,000円以内の保守的参考上限（千円刻み）",prefix.donationLimitYen]]
          .forEach(function(pair){add("dt",trialDl,pair[0]);add("dd",trialDl,yen(pair[1]));});
        if(trial.status==="ESTIMATE"){
          var t=trial.calculation;
          [["試算寄附額",t.donationYen],["所得税（寄附前）",t.nationalBefore.incomeTax],
           ["所得税（寄附後）",t.nationalAfter.incomeTax],
           ["復興特別所得税（寄附前）",t.nationalBefore.reconstruction],
           ["復興特別所得税（寄附後）",t.nationalAfter.reconstruction],
           ["住民税所得割（寄附前）",t.city.beforeYen+t.prefecture.beforeYen],
           ["住民税所得割（寄附後）",t.city.afterYen+t.prefecture.afterYen],
           ["実質自己負担見込額",t.selfPayYen],
           ["2,000円超過額",t.excessOver2000Yen]]
            .forEach(function(pair){add("dt",trialDl,pair[0]);add("dd",trialDl,yen(pair[1]));});
        }else add("p",filingSection,"任意寄附額の試算：HOLD（"+trial.reason+"）");
        add("p",filingSection,"千円刻みで最初の超過まで確認した参考値です。住民税の端数等により自己負担が2,000円未満となる試算もあります。住宅ローン控除等は未対応です。確定額ではありません。","muted");
      }else add("p",filingSection,"確定申告比較：HOLD");
    }else add("p",filingSection,"確定申告比較：HOLD");
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
       !selectedReference(printableResult,current)){
      render({status:"HOLD",reasons:[
        "印刷前に入力・原票の選択状態が変わりました。改めて試算してください。"
      ]},current);
      return false;
    }
    return true;
  }
  // Print/PDF needs the calculation basis even if the user never opened
  // the on-screen <details>. Do not permanently change the screen state.
  var printDetails=null,printDetailsWasOpen=false;
  window.addEventListener("beforeprint",function(){
    if(printableInputSnapshot!==null&&!checkPrintableSnapshot())return;
    if(printableInputSnapshot===null||!printableResult||
       output.hidden||output.className!=="result")return;
    var details=output.querySelector("details");
    if(details){
      if(printDetails!==details){
        printDetails=details;
        printDetailsWasOpen=details.open;
      }
      details.open=true;
    }
  });
  window.addEventListener("afterprint",function(){
    if(printDetails){
      printDetails.open=printDetailsWasOpen;
      printDetails=null;
      printDetailsWasOpen=false;
    }
  });
  var conditionsConfirmation=form.elements.namedItem("acknowledgedExclusions");
  // Every material input change requires a fresh exclusions/allowances review.
  // OCR transfers change inputs programmatically and revoke this separately.
  function revokeOldConditionsConfirmation(event){
    var target=event.target;
    if(!target||target===conditionsConfirmation)return;
    var name=target.name;
    if(name==="year"||name==="filing"||name==="municipality"||
       name==="salaryGross"||name==="socialInsurance"||
       name==="salaryIncomeReference"||name==="deductionsReference"||
       name==="deductionsOverride"||
       name==="forecastReviewed"||flags.includes(name)){
      if(conditionsConfirmation)conditionsConfirmation.checked=false;
      // A prior-year forecast must be re-confirmed after any change to its
      // year, amounts or tax conditions. Never clear on its own click.
      if(name!=="forecastReviewed"){
        var forecast=form.elements.namedItem("forecastReviewed");
        if(forecast)forecast.checked=false;
      }
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
  form.addEventListener("input",updateOverrideNotice);
  form.addEventListener("change",updateOverrideNotice);
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
      // The shared private GAS engine must retain its strict same-year
      // contract. This WEB-ONLY adapter forecasts using the selected
      // target-year tax law after explicit prior-year re-attestation.
      // Preserve ORIGINAL sourceYear in the displayed snapshot and guard.
      var engineInput=snapshot;
      if(snapshot.sourceYear!==undefined&&
         Number(snapshot.sourceYear)===Number(snapshot.year)-1&&
         snapshot.forecastReviewed===true){
        engineInput=Object.assign({},snapshot,{sourceYear:snapshot.year});
      }
      render(FurusatoEngine.calculate(engineInput),snapshot);
    } catch (_) {
      render({status:"HOLD",reasons:["計算中に異常が発生しました。目安額は表示しません。"]});
    }
  });
  form.addEventListener("reset", function () {
    printableInputSnapshot=null;printableResult=null;
    form.classList.remove("deduction-override-active");
    if(overrideNotice)overrideNotice.hidden=true;
    delete form.dataset.ocrYear;
    delete form.dataset.ocrOriginalGross;
    delete form.dataset.ocrOriginalSocial;
    delete form.dataset.ocrOriginalDeductions;
    delete form.dataset.ocrSourceIndicators;
    delete form.dataset.ocrReviewPending;
    delete form.dataset.ocrManualReviewRequired;
    output.replaceChildren();
    output.hidden = true;
    output.className = "result";
  });
}());
