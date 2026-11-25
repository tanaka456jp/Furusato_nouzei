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
  var premiumKeys=["generalNew","generalOld","medicalNew","pensionNew","pensionOld","earthquake","longTermOld"];
  function readInsurance(prefix,reviewName){
    var premiums={};
    premiumKeys.forEach(function(key){premiums[key]=form.elements.namedItem(prefix+"Insurance_"+key).value.trim();});
    return {premiums:premiums,reviewed:form.elements.namedItem(reviewName).checked===true};
  }
  function insuranceActive(details){return details.reviewed||premiumKeys.some(function(k){return details.premiums[k]!=="";});}
  function parsePremiums(details){
    var values={};
    premiumKeys.forEach(function(k){values[k]=details.premiums[k]===""?0:strictYen(details.premiums[k]);});
    return values;
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
      var recognized=["hasSpouse","hasLifeInsurance","hasEarthquakeInsurance",
        "hasMortgage","hasIncomeAdjustment","hasDependents",
        "hasNonstandardConditions"];
      input.sourceIndicators={};
      form.dataset.ocrSourceIndicators.split(",").forEach(function(key){
        input.sourceIndicators[recognized.includes(key)?
          key:"hasNonstandardConditions"]=true;
      });
    }
    if(form.dataset.ocrSpouseIncome!==undefined)input.sourceSpouseIncomeHint=strictYen(form.dataset.ocrSpouseIncome);
    if(form.dataset.ocrInsuranceDeductionHints!==undefined){
      try{input.sourceInsuranceDeductionHints=JSON.parse(form.dataset.ocrInsuranceDeductionHints);}
      catch(_){input.sourceInsuranceDeductionHints=null;}
    }
    if(form.dataset.ocrFamilyCountHints!==undefined){
      try{input.sourceFamilyCountHints=JSON.parse(form.dataset.ocrFamilyCountHints);}
      catch(_){input.sourceFamilyCountHints=null;}
    }
    // Re-attest a previously transferred OCR source after editing figures.
    // This must NOT bypass cancellation/failed OCR: only explicit edits to
    // an already transferred source may set ocrManualReviewRequired.
    if(form.dataset.ocrReviewPending==="true"&&
       !(form.dataset.ocrManualReviewRequired==="true"&&
         get("correctedSourceReviewed").checked===true))
      input.sourceReviewPending=true;
    flags.forEach(function (name) {
      input[name] = name==="hasMedical"?false:get(name).checked === true;
    });
    var spouseAge=get("familySpouseAge").value.trim(),spouseIncome=get("familySpouseIncome").value.trim();
    var relatives=Array.from(document.querySelectorAll("#familyRelatives .family-relative")).map(function(row){
      return {age:row.querySelector('[data-family="age"]').value.trim(),
        income:row.querySelector('[data-family="income"]').value.trim(),
        cohabiting:row.querySelector('[data-family="cohabiting"]').checked===true};
    });
    if(input.hasSpouse||input.hasDependents||spouseAge!==""||spouseIncome!==""||relatives.length||get("familyReviewed").checked)
      input.familyDetails={spouseAge:spouseAge,spouseIncome:spouseIncome,relatives:relatives,reviewed:get("familyReviewed").checked};
    var sourceAge=get("sourceSpouseAge").value.trim(),sourceIncome=get("sourceSpouseIncome").value.trim();
    var sourceRelatives=Array.from(document.querySelectorAll("#sourceFamilyRelatives .family-relative")).map(function(row){
      return {age:row.querySelector('[data-family="age"]').value.trim(),income:row.querySelector('[data-family="income"]').value.trim(),
        cohabiting:row.querySelector('[data-family="cohabiting"]').checked===true};
    });
    if(sourceAge!==""||sourceIncome!==""||sourceRelatives.length||get("sourceFamilyReviewed").checked){
      input.sourceFamily={spouseAge:sourceAge,spouseIncome:sourceIncome,relatives:sourceRelatives,
        reviewed:get("sourceFamilyReviewed").checked,originalIncome:form.dataset.ocrOriginalIncome};
      if(!input.familyDetails)input.familyDetails={spouseAge:spouseAge,spouseIncome:spouseIncome,relatives:relatives,reviewed:get("familyReviewed").checked};
    }
    var targetInsurance=readInsurance("target","insuranceReviewed"),sourceInsurance=readInsurance("source","sourceInsuranceReviewed");
    if(insuranceActive(targetInsurance)||input.hasLifeInsurance||input.hasEarthquakeInsurance)input.insuranceDetails=targetInsurance;
    if(insuranceActive(sourceInsurance))input.sourceInsurance=sourceInsurance;
    if(input.insuranceDetails||input.sourceInsurance){
      if(!input.familyDetails)input.familyDetails={spouseAge:spouseAge,spouseIncome:spouseIncome,relatives:relatives,reviewed:get("familyReviewed").checked};
    }
    function readOther(prefix,reviewName,container){
      return {self:get(prefix+"Other_self").value,spouse:get(prefix+"Other_spouse").value,
        marital:get(prefix+"Other_marital").value,child:get(prefix+"Other_child").value.trim(),
        contribution:get(prefix+"Other_contribution").value.trim(),student:get(prefix+"Other_student").checked===true,
        reviewed:get(reviewName).checked===true,
        relatives:Array.from(document.querySelectorAll(container+' [data-other-disability]')).map(function(c){return c.value;})};
    }
    function activeOther(o){return o.reviewed||o.self!=="none"||o.spouse!=="none"||o.marital!=="none"||
      o.child!==""||o.contribution!==""||o.student||o.relatives.some(function(v){return v!=="none";});}
    var other=readOther("target","otherReviewed","#familyRelatives");
    var sourceOther=readOther("source","sourceOtherReviewed","#sourceFamilyRelatives");
    if(activeOther(other))input.otherDetails=other;
    if(activeOther(sourceOther))input.sourceOtherDetails=sourceOther;
    var med=get("medicalNetPaidYen").value.trim();
    if(med!==""&&med!=="0"){input.hasMedical=true;input.medicalDetails={amount:med};}
    var mortgage={applied:get("mortgageSourceApplied").value.trim(),possible:get("mortgageSourcePossible").value.trim(),
      moveInYear:get("mortgageMoveInYear").value.trim(),capClass:get("mortgageCapClass").value,reviewed:get("mortgageReviewed").checked===true};
    if(input.hasMortgage||input.sourceIndicators?.hasMortgage||mortgage.applied!==""||mortgage.possible!==""||
       mortgage.moveInYear!==""||mortgage.capClass!==""||mortgage.reviewed){
      input.hasMortgage=true;input.mortgageDetails=mortgage;
    }
    function readAdjustment(reviewName,container){
      return {reviewed:get(reviewName).checked===true,
        extras:Array.from(document.querySelectorAll(container+" .adjustment-relative")).map(function(row){
          return {age:row.querySelector('[data-adjustment="age"]').value.trim(),income:row.querySelector('[data-adjustment="income"]').value.trim(),
            special:row.querySelector('[data-adjustment="special"]').checked===true};})};
    }
    var adjustment=readAdjustment("adjustmentReviewed","#adjustmentRelatives");
    var sourceAdjustment=readAdjustment("sourceAdjustmentReviewed","#sourceAdjustmentRelatives");
    sourceAdjustment.basic=get("sourceAdjustment_basic").value.trim();
    sourceAdjustment.amount=get("sourceAdjustment_amount").value.trim();
    if(strictYen(input.sourceOriginalGross)>8500000||sourceAdjustment.reviewed||sourceAdjustment.extras.length||
       sourceAdjustment.basic!==""||sourceAdjustment.amount!=="")input.sourceAdjustmentDetails=sourceAdjustment;
    if(strictYen(input.salaryGross)>8500000||adjustment.reviewed||adjustment.extras.length)input.adjustmentDetails=adjustment;
    if(input.otherDetails||input.sourceOtherDetails||input.medicalDetails||input.mortgageDetails||input.adjustmentDetails||input.sourceAdjustmentDetails){
      if(!input.familyDetails)input.familyDetails={spouseAge:spouseAge,spouseIncome:spouseIncome,relatives:relatives,reviewed:!!(input.medicalDetails||input.mortgageDetails)&&!input.otherDetails&&!input.sourceOtherDetails&&!input.adjustmentDetails&&!input.sourceAdjustmentDetails};
    }
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
  // The family route is deliberately separate from the basic-only engine.
  // Imported family sources require independently reviewed original-year facts.
  // Never mask OCR flags or clear the original source.
  function familyEstimate(input){
    var fail=function(reason){return {status:"HOLD",reasons:[reason]};};
    var f=input.familyDetails,year=Number(input.year),gross=strictYen(input.salaryGross),social=strictYen(input.socialInsurance);
    var file=document.getElementById("slipFile");
    if(!f||!f.reviewed||!input.acknowledgedExclusions)
      return fail(input.mortgageDetails?"住宅借入金等特別控除・家族明細・適用条件を確認してください。":"家族明細と適用条件を確認してください。");
    if(input.sourceReviewPending||(form.dataset.ocrReviewPending==="true"&&
       !(form.dataset.ocrManualReviewRequired==="true"&&form.elements.namedItem("correctedSourceReviewed").checked))||
       (file&&file.files&&file.files.length))
      return fail("原票読取・手修正の再確認が必要です。");
    var imported=input.sourceYear!==undefined||input.sourceIndicators!==undefined||
       input.sourceOriginalGross!==undefined||input.sourceOriginalSocial!==undefined||
       input.sourceOriginalDeductions!==undefined;
    var original=null,ip=input.insuranceDetails,si=input.sourceInsurance,od=input.otherDetails,so=input.sourceOtherDetails,md=input.medicalDetails,hd=input.mortgageDetails;
    var housing=null,housingSource=null;
    if(hd&&(!imported||hd.reviewed!==true))return fail("住宅借入金等特別控除（住宅ローン控除）は原票を取り込み、控除額・入居年・継続適用を確認してください。");
    var ad=input.adjustmentDetails,high=gross!==null&&gross>8500000;
    if((ad&&!high)||(high&&(!ad||!ad.reviewed||!od||!od.reviewed||!ip||!ip.reviewed)))
      return fail("高額給与の所得金額調整控除・その他所得控除・保険料を確認してください。");
    var sa=input.sourceAdjustmentDetails,sourceGross=strictYen(input.sourceOriginalGross),sourceHigh=sourceGross!==null&&sourceGross>8500000;
    if((sa&&!sourceHigh)||(sourceHigh&&(!sa||!sa.reviewed||!so||!so.reviewed||!si||!si.reviewed)))
      return fail("原票年分の高額給与・G46・G47・その他所得控除・保険料の確認が必要です。");
    if(md&&(!input.hasMedical||input.filing!=="return"||strictYen(md.amount)===null||strictYen(md.amount)<1||strictYen(md.amount)>100000000000))
      return fail("補填後の対象医療費支払額を正しく入力し、確定申告方式を選択してください。");
    if(so&&!imported)return fail("原票が取り込まれていません。原票のその他所得控除明細をクリアしてください。");
    if(imported&&(od||so)&&(!od||!so||!so.reviewed||!si||!si.reviewed))return fail("原票年分・試算年分のその他所得控除と保険料明細の確認が必要です。");
    if(od&&(!od.reviewed||!ip||ip.reviewed!==true))
      return fail("その他所得控除・保険料明細（該当なしを含む）の確認が必要です。");
    var targetPremiums=ip?parsePremiums(ip):null,sourcePremiums=si?parsePremiums(si):null;
    if((ip&&ip.reviewed!==true)||(si&&si.reviewed!==true))return fail("保険料明細・適用区分を確認してください。");
    if(si&&!imported)return fail("原票が取り込まれていません。原票保険料明細をクリアしてください。");
    if(ip){
      var life= premiumKeys.slice(0,5).some(function(k){return targetPremiums[k]>0;});
      var earth=targetPremiums.earthquake>0||targetPremiums.longTermOld>0;
      if(life!==input.hasLifeInsurance||earth!==input.hasEarthquakeInsurance)
        return fail("生命保険料・地震保険料のチェックと支払保険料明細が一致しません。");
    }
    var parseSpouse=function(age,income){return age===""&&income===""?null:
      {age:strictYen(age),income:strictYen(income),eligibilityReviewed:true};};
    var parseRelatives=function(rows){return rows.map(function(m){return {age:strictYen(m.age),income:strictYen(m.income),
      cohabitingDirectAscendant:m.cohabiting,eligibilityReviewed:true};});};
    function parseOther(o,total,relatives){
      var child=o.child===""?null:strictYen(o.child);
      var contribution=o.contribution===""?0:strictYen(o.contribution);
      if(total===null||!o.reviewed||(o.child!==""&&(child===null||child<1))||contribution===null||
         contribution>total||o.relatives.length!==relatives.length)return null;
      return {disability:{self:o.self,spouse:o.spouse,relatives:o.relatives},
        maritalRelief:o.marital,childIndex:child===null?null:child-1,workingStudent:o.student,
        smallEnterpriseContributions:contribution};
    }
    function buildAdjustment(y,g,details,other,spouse,relatives,premiums){
      var special=function(k){return k==="special"||k==="cohabitingSpecial";};
      var threshold=y===2025?580000:620000;
      var extras=details.extras.map(function(m){return {age:strictYen(m.age),income:strictYen(m.income),specialDisability:m.special,relationshipReviewed:true};});
      if(extras.some(function(m){return m.age===null||m.income===null||m.income>threshold||!(m.age<23||m.specialDisability);}))return null;
      // Enhanced general-life premium rule with independently claimed U23
      // witnesses is not yet audited; fail closed for both years' routes.
      if(y===2026&&premiums.generalNew>0&&extras.some(function(m){return m.age<23;})&&
         !relatives.some(function(m){return m.age<23&&m.income<=threshold;}))return null;
      return {year:y,grossSalary:g,selfSpecialDisability:other.disability.self==="special",
        spouse:spouse?{income:spouse.income,specialDisability:special(other.disability.spouse),relationshipReviewed:true}:null,
        relatives:relatives.map(function(m,i){return {age:m.age,income:m.income,specialDisability:special(other.disability.relatives[i]),relationshipReviewed:true};}).concat(extras),
        conditions:"annual-resident-salary-only-adjustment-facts-reviewed"};
    }
    var targetOther=od?parseOther(od,social,f.relatives):null;
    if(od&&!targetOther)return fail("その他所得控除の子の番号・掛金・親族明細を確認してください。");
    if(imported){
      var sourceYear=Number(input.sourceYear),sf=input.sourceFamily;
      if(!sf&&(md||hd)&&!si&&!so&&!sourceHigh&&Object.keys(input.sourceIndicators||{}).every(k=>k==="hasMortgage"&&!!hd))
        sf={spouseAge:"",spouseIncome:"",relatives:[],reviewed:true,originalIncome:form.dataset.ocrOriginalIncome};
      if(!sf||sf.reviewed!==true||![2025,2026].includes(sourceYear)||
         (sourceYear!==year&&sourceYear!==year-1)||(sourceYear!==year&&input.forecastReviewed!==true)||
         !window.FurusatoFamilySource)
        return fail("原票年分の家族明細・翌年見込額の確認が必要です。");
      var sourceOther=so?parseOther(so,strictYen(input.sourceOriginalSocial),sf.relatives):null;
      if(so&&!sourceOther)return fail("原票年分のその他所得控除の明細を確認してください。");
      var sourceSpouse=parseSpouse(sf.spouseAge,sf.spouseIncome),sourceRelatives=parseRelatives(sf.relatives);
      var indicators=Object.assign({},input.sourceIndicators||{}),sourceFacts=null;
      if(hd)delete indicators.hasMortgage; // credit reconciliation is required below
      if(sourceHigh){
        sourceFacts=buildAdjustment(sourceYear,sourceGross,sa,sourceOther,sourceSpouse,sourceRelatives,sourcePremiums);
        if(!sourceFacts||strictYen(sa.basic)===null||strictYen(sa.amount)===null)
          return fail("原票年分のG46・G47・所得金額調整控除の親族明細を確認してください。");
        // Preserve the positive G47 OCR evidence in the engine's vocabulary.
        // All other flags, including unresolved conditions, remain untouched.
        if(indicators.hasIncomeAdjustment===true){delete indicators.hasIncomeAdjustment;indicators.hasSalaryAdjustment=true;}
        if(sourceYear===year&&(!high||JSON.stringify(ad.extras)!==JSON.stringify(sa.extras)))
          return fail("同一年分の所得金額調整控除の確認明細が一致しません。");
      }else if(sourceYear===year&&high)
        return fail("同一年分の高額給与区分が原票と一致しません。");
      original=window.FurusatoFamilySource.reconcile({year:sourceYear,
        gross:strictYen(input.sourceOriginalGross),salaryIncome:strictYen(sf.originalIncome),
        social:strictYen(input.sourceOriginalSocial),deductions:strictYen(input.sourceOriginalDeductions),
        indicators:indicators,
        ...(input.sourceFamilyCountHints!==undefined?{countHints:input.sourceFamilyCountHints}:{}),
        ...(input.sourceSpouseIncomeHint!==undefined?{spouseIncomeHint:input.sourceSpouseIncomeHint}:{}),
        ...(input.sourceInsuranceDeductionHints!==undefined?{insuranceDeductionHints:input.sourceInsuranceDeductionHints}:{}),
        spouse:sourceSpouse,relatives:sourceRelatives,
        reviewed:sf.reviewed,...(si?{premiums:sourcePremiums,insuranceReviewed:true}:{}),
        ...(so?{otherDeductions:sourceOther,otherReviewed:true,sourceContributionYen:sourceOther.smallEnterpriseContributions}:{}),
        ...(sourceHigh?{adjustmentFacts:sourceFacts,sourceBasicYen:strictYen(sa.basic),sourceAdjustmentYen:strictYen(sa.amount),adjustmentReviewed:true}:{})},FurusatoEngine);
      if(original.status!=="RECONCILED")return fail(original.reason);
      if(hd){
        var applied=strictYen(hd.applied),possible=hd.possible===""?null:strictYen(hd.possible),moveInYear=strictYen(hd.moveInYear);
        if(applied===null||(hd.possible!==""&&possible===null)||moveInYear===null||year-moveInYear>=13||
           !window.FurusatoFamilyTax||typeof window.FurusatoFamilyTax.reconcileMortgageSource!=="function")
          return fail("住宅ローン控除の原票記載額・入居年・適用継続を確認してください。");
        var hr=window.FurusatoFamilyTax.reconcileMortgageSource({year:sourceYear,salaryIncome:original.calculation.salaryIncomeYen,
          deductions:original.calculation.deductionsYen,moveInYear:moveInYear,capClass:hd.capClass,appliedYen:applied,possibleYen:possible,reviewed:true});
        if(hr.status!=="RECONCILED")return fail(hr.reason);
        housingSource=hr.calculation;
        housing={moveInYear:moveInYear,capClass:hd.capClass,possibleYen:housingSource.possibleYen,eligibilityReviewed:true};
      }
      if(sourceYear===year&&(
        JSON.stringify(parseSpouse(sf.spouseAge,sf.spouseIncome))!==JSON.stringify(parseSpouse(f.spouseAge,f.spouseIncome))||
        JSON.stringify(parseRelatives(sf.relatives))!==JSON.stringify(parseRelatives(f.relatives))))
        return fail("同一年分の原票家族明細と試算明細が一致しません。");
      if(sourceYear===year&&(od||so)&&JSON.stringify(targetOther)!==JSON.stringify(sourceOther))
        return fail("同一年分の原票と試算のその他所得控除明細が一致しません。");
      if(sourceYear===year&&(ip||si)&&premiumKeys.some(function(k){return (sourcePremiums?sourcePremiums[k]:0)!==(targetPremiums?targetPremiums[k]:0);}))
        return fail("同一年分の原票保険料明細と試算明細が一致しません。");
    }else if(input.sourceFamily)return fail("原票が取り込まれていません。原票年分の入力をクリアしてください。");
    if(flags.some(function(k){return !["hasSpouse","hasDependents","hasLifeInsurance","hasEarthquakeInsurance"].includes(k)&&!(k==="hasMedical"&&md)&&!(k==="hasMortgage"&&hd&&housing)&&!(k==="hasIncomeAdjustment"&&high)&&input[k]!==false;})||
       ![2025,2026].includes(year)||!["one-stop","return"].includes(input.filing)||
       !["standard","designated"].includes(input.municipality)||gross===null||gross<=0||gross>20000000||
       social===null||social>gross||typeof FurusatoEngine.salaryIncome!=="function")
      return fail("給与・自治体・申告方式・未対応控除等を確認してください。");
    if((!input.hasSpouse&&(f.spouseAge!==""||f.spouseIncome!==""))||
       input.hasDependents!==(f.relatives.length>0)||(!imported&&!input.hasSpouse&&!input.hasDependents&&!ip&&!od&&!md))
      return fail("配偶者・扶養親族のチェックと明細が一致しません。");
    var income=high?null:FurusatoEngine.salaryIncome(gross,year);
    var engine=window.FurusatoFamilyTax;
    if(!engine||typeof engine.calculate!=="function")return fail("家族税額計算機能を読み込めません。");
    var args={year:year,salaryIncome:income,socialInsurance:social,municipality:input.municipality,
      spouse:input.hasSpouse?{age:strictYen(f.spouseAge),income:strictYen(f.spouseIncome),eligibilityReviewed:true}:null,
      relatives:f.relatives.map(function(m){return {age:strictYen(m.age),income:strictYen(m.income),
        cohabitingDirectAscendant:m.cohabiting,eligibilityReviewed:true};}),
      conditions:ip?"salary-basic-social-family-insurance-only-reviewed":"salary-basic-social-family-only-reviewed",
      ...(ip?{premiums:targetPremiums}:{})};
    if(od){
      var contribution=targetOther.smallEnterpriseContributions;
      delete args.socialInsurance;
      args.socialAndContributions=social;
      args.conditions="salary-basic-social-family-insurance-other-only-reviewed";
      args.otherDeductions=targetOther;
    }
    if(md)args.medicalNetPaidYen=strictYen(md.amount);
    var request=null,adjustmentResult=null;
    if(high){
      var adjustment=buildAdjustment(year,gross,ad,targetOther,args.spouse,args.relatives,targetPremiums);
      if(!adjustment)return fail("所得金額調整控除の親族明細・保険料特例の併用条件を確認してください。");
      if(!window.FurusatoSalaryAdjustment)return fail("所得金額調整控除の計算機能を読み込めません。");
      adjustmentResult=window.FurusatoSalaryAdjustment.calculate(adjustment);
      if(adjustmentResult.status!=="COMPONENTS_ONLY")return fail(adjustmentResult.reason);
      if(adjustmentResult.calculation.eligible!==input.hasIncomeAdjustment)
        return fail("所得金額調整控除のチェックと確認明細が一致しません。");
      income=adjustmentResult.calculation.salaryIncomeAfterAdjustmentYen;
      delete args.year;delete args.salaryIncome;
      request={adjustment:adjustment,tax:args};
    }
    if(input.salaryIncomeReference!==""&&strictYen(input.salaryIncomeReference)!==income)
      return fail("給与所得控除後の金額が一致しません。");
    var result=high?(md?engine.highSalaryMedicalFilingCalculation(request):engine.highSalaryCalculate(request)):
      (md?engine.medicalFilingCalculation(args):engine.calculate(args));
    if(result.status!=="ESTIMATE"&&!high&&!md&&!hd&&!od&&typeof engine.calculateNoTax==="function"){
      var classified=engine.calculateNoTax(args);
      if(classified.status==="NO_TAX")result=classified;
    }
    var noTax=result.status==="NO_TAX";
    if(result.status!=="ESTIMATE"&&!noTax)return fail(result.reason||"家族控除を確認できません。");
    var c=result.calculation;
    if(!c||c.year!==year||c.municipality!==input.municipality||
       (!!c.other!==!!od)||(!!c.medical!==!!md)||(!!c.salaryAdjustment!==high)||
       (high&&JSON.stringify(c.salaryAdjustment)!==JSON.stringify(adjustmentResult.calculation))||
       (md&&(c.filingOnly!==true||c.oneStopAllowed!==false||result.donationLimitYen!==null||c.medical.nationalDeductionYen!==c.medical.residentDeductionYen||c.medical.method!=="ordinaryNet"||c.medical.netEligibleYen!==strictYen(md.amount)||c.medical.thresholdYen!==Math.min(100000,Math.floor(income/20))||c.medical.nationalDeductionYen!==Math.min(2000000,Math.max(0,strictYen(md.amount)-Math.min(100000,Math.floor(income/20))))))||
       (od&&(c.socialAndContributionsYen!==social||c.socialInsuranceOnlyYen!==social-contribution||c.other.contributions.nationalYen!==contribution))||
       c.nationalDeductionsYen!==c.nationalBasicYen+social+c.family.nationalFamilyDeductionYen+(c.insurance?.national.totalYen??0)+(od?c.other.nationalOtherDeductionYen-contribution:0)+(md?c.medical.nationalDeductionYen:0)||
       c.residentDeductionsYen!==430000+social+c.family.residentFamilyDeductionYen+(c.insurance?.resident.totalYen??0)+(od?c.other.residentOtherDeductionYen-contribution:0)+(md?c.medical.residentDeductionYen:0)||
       (!!c.insurance!==!!ip)||
       c.nationalTaxableYen!==Math.floor(Math.max(0,income-c.nationalDeductionsYen)/1000)*1000||
       c.residentTaxableYen!==Math.floor(Math.max(0,income-c.residentDeductionsYen)/1000)*1000||
       (noTax?(c.nationalTaxableYen!==0||c.residentTaxableYen!==0||result.donationLimitYen!==null||high||md||hd||od):
         c.residentIncomeLevyYen!==c.city.assessedYen+c.prefecture.assessedYen)||
       (!noTax&&!md&&(!Number.isSafeInteger(result.donationLimitYen)||result.donationLimitYen<2000||
       result.donationLimitYen!==Math.floor(c.exactReferenceYen/1000)*1000)))
      return fail("家族税額の整合性を確認できません。");
    if((input.deductionsOverride!==""&&strictYen(input.deductionsOverride)!==c.nationalDeductionsYen)||
       (input.sourceDeductionsReference!==""&&(md?
         strictYen(input.sourceDeductionsReference)!==(original?original.calculation.deductionsYen:c.nationalDeductionsYen-c.medical.nationalDeductionYen):
         (strictYen(input.sourceDeductionsReference)!==c.nationalDeductionsYen&&
          (!original||strictYen(input.sourceDeductionsReference)!==original.calculation.deductionsYen)))))
      return fail("所得控除合計と家族控除の自動計算が一致しません。");
    if(noTax)return {status:"NO_TAX",familyMode:true,donationLimitYen:null};
    var prefix=high?engine.highSalaryFilingPrefix(request):engine.filingPrefix(args);
    if(prefix.status!=="ESTIMATE"||!Number.isSafeInteger(prefix.donationLimitYen)||prefix.donationLimitYen<2000)
      return fail("確定申告参考上限を確認できません。");
    var trialAmount=input.donationTrial===""?(md?prefix.donationLimitYen:result.donationLimitYen):strictYen(input.donationTrial);
    var trial=high?engine.highSalaryFilingTrial(request,trialAmount):engine.filingTrial(args,trialAmount);
    if(hd){
      var requestFor=function(filing){return {tax:high?request:args,housing:housing,filing:filing};};
      var hp=engine.mortgagePrefix(requestFor("return")),op=md?null:engine.mortgagePrefix(requestFor("one-stop"));
      var validPrefix=function(p){return p?.status==="COMPONENTS_ONLY"&&p.donationLimitYen===null&&
        Number.isSafeInteger(p.calculation?.conservativePrefixYen)&&p.calculation.conservativePrefixYen>=2000&&
        p.calculation.conservativePrefixYen%1000===0&&p.calculation.atPrefix?.within2000===true&&
        p.calculation.atPrefix.donationYen===p.calculation.conservativePrefixYen&&p.calculation.atPrefix.housingPossibleYen===housing.possibleYen;};
      if(!validPrefix(hp)||(!md&&!validPrefix(op)))return fail("住宅ローン控除と寄附控除の併用計算を確認できません。");
      var oneLimit=op?.calculation.conservativePrefixYen??null,filingLimit=hp.calculation.conservativePrefixYen;
      var limit=input.filing==="return"?filingLimit:oneLimit,baseline=hp.calculation.atPrefix.before;
      if(!Number.isSafeInteger(baseline?.nationalHousingYen)||baseline.nationalHousingYen<0||
         !Number.isSafeInteger(baseline?.residentHousingYen)||baseline.residentHousingYen<0||
         baseline.nationalHousingYen+baseline.residentHousingYen>housing.possibleYen)return fail("住宅ローン控除額の整合性不一致");
      var ht=engine.mortgageTrial(requestFor("return"),input.donationTrial===""?limit:strictYen(input.donationTrial));
      return {status:"ESTIMATE",familyMode:true,calculation:c,oneStop:oneLimit,filing:filingLimit,amount:limit,
        trial:ht,income:income,social:social,sourceReconciliation:original.calculation,
        housing:{source:housingSource,baseline:baseline,forecast:original.calculation.year!==year}};
    }
    return {status:"ESTIMATE",familyMode:true,calculation:c,oneStop:result.donationLimitYen,
      filing:prefix.donationLimitYen,amount:input.filing==="return"?prefix.donationLimitYen:result.donationLimitYen,
      trial:trial,income:income,social:social,sourceReconciliation:original?original.calculation:null};
  }
  var printableInputSnapshot=null,printableResult=null;
  function renderFamily(result,input){
    if(result.status!=="ESTIMATE"){render(result,input);return;}
    output.replaceChildren();output.hidden=false;output.className="result";
    printableInputSnapshot=JSON.stringify(input);printableResult=result;
    add("h3",output,result.sourceReconciliation?"寄附上限額の概算（家族控除・原票照合済）":"寄附上限額の概算（家族控除・手入力検証）");
    if(result.sourceReconciliation)add("p",output,"参照源泉票："+result.sourceReconciliation.year+"年分 ／ 試算対象："+input.year+"年分","muted");
    add("p",output,yen(result.amount),"amount");
    add("p",output,"所得年 "+input.year+"年 ／ 住民税 "+(Number(input.year)+1)+"年度 ／ "+
      (input.municipality==="standard"?"標準市町村":"政令指定都市")+" ／ "+
      (input.filing==="return"?"確定申告参考":"ワンストップ参考"),"muted");
    add("p",output,"限定条件の参考値です。自己負担2,000円を保証するものではありません。","muted");
    var details=add("details",output);add("summary",details,"家族控除・税額の計算根拠");
    var dl=add("dl",details),c=result.calculation;
    var pairs=[["給与所得",result.income],["社会保険料等",result.social],
      ["所得税家族控除",c.family.nationalFamilyDeductionYen],["住民税家族控除",c.family.residentFamilyDeductionYen],
      ["所得控除合計（自動算定）",c.nationalDeductionsYen],["住民税所得控除合計",c.residentDeductionsYen],
      ["所得税課税所得",c.nationalTaxableYen],["住民税課税所得",c.residentTaxableYen],
      ["人的控除差",c.personalDifferenceYen],["調整控除額",c.adjustmentYen],
      ["特例控除割合判定基礎",c.residentSpecialBaseYen],["住民税所得割",c.residentIncomeLevyYen],
      ["確定申告参考上限（千円刻み）",result.filing]];
    if(!c.medical)pairs.splice(pairs.length-1,0,["ワンストップ参考上限",result.oneStop]);
    if(c.medical){
      add("p",details,"医療費控除を申告するためワンストップ特例は利用できません。すべてのふるさと納税を確定申告に含めてください。","muted");
      add("p",details,"通常の医療費控除：補填後の対象医療費と対象年の合計所得金額から自動計算。","muted");
      pairs.push(["補填後の医療費支払額",c.medical.netEligibleYen],["医療費控除の足切額",c.medical.thresholdYen],["医療費控除額（所得税・住民税）",c.medical.nationalDeductionYen]);
    }
    if(result.housing){
      var hs=result.housing;
      pairs.push(["原票住宅ローン控除額（照合済）",hs.source.appliedYen],["試算住宅ローン控除可能額",hs.source.possibleYen],["寄附前所得税住宅ローン控除",hs.baseline.nationalHousingYen],["寄附前住民税住宅ローン控除",hs.baseline.residentHousingYen]);
      if(hs.forecast)add("p",details,"住宅ローン残高の変動は考慮していません。","muted");
    }
    if(c.salaryAdjustment){
      pairs.push(["給与収入",c.salaryAdjustment.grossSalaryYen],["給与所得控除",c.salaryAdjustment.salaryDeductionYen],
        ["所得金額調整控除前の給与所得",c.salaryAdjustment.salaryIncomeBeforeAdjustmentYen],["所得金額調整控除",c.salaryAdjustment.salaryAdjustmentYen],
        ["所得金額調整控除後の給与所得",c.salaryAdjustment.salaryIncomeAfterAdjustmentYen]);
    }
    if(c.insurance){
      add("p",details,"23歳未満の扶養親族に係る新一般生命保険料控除特例："+(c.insurance.enhancedGeneral?"適用":"対象外"),"muted");
      pairs.push(["生命保険料控除（所得税）",c.insurance.national.lifeYen],["生命保険料控除（住民税）",c.insurance.resident.lifeYen],
        ["地震保険料控除（所得税）",c.insurance.national.earthquakeYen],["地震保険料控除（住民税）",c.insurance.resident.earthquakeYen]);
    }
    if(c.other){
      pairs.push(["社会保険料（内書き掛金を除く）",c.socialInsuranceOnlyYen],["小規模企業共済等掛金（内書き）",c.other.contributions.nationalYen],
        ["その他所得控除（所得税・掛金含む）",c.other.nationalOtherDeductionYen],["その他所得控除（住民税・掛金含む）",c.other.residentOtherDeductionYen]);
      add("p",details,"社会保険料等の内書き掛金は二重控除していません。","muted");
    }
    if(result.sourceReconciliation){
      pairs.push(["原票年の所得控除合計（照合済）",result.sourceReconciliation.deductionsYen]);
      if(result.sourceReconciliation.salaryAdjustment)pairs.push(["原票年の給与所得（照合済）",result.sourceReconciliation.salaryIncomeYen],["原票年の基礎控除額（G46・照合済）",result.sourceReconciliation.basicYen],["原票年の所得金額調整控除額（G47・照合済）",result.sourceReconciliation.sourceAdjustmentYen]);
      if(result.sourceReconciliation.otherYen!==undefined)pairs.push(["原票年のその他所得控除（掛金含む・照合済）",result.sourceReconciliation.otherYen],["原票年の内書き掛金（照合済）",result.sourceReconciliation.sourceContributionYen]);
      if(result.sourceReconciliation.insuranceYen!==undefined)pairs.push(["原票年の保険料控除合計（照合済）",result.sourceReconciliation.insuranceYen]);
    }
    pairs.forEach(function(p){add("dt",dl,p[0]);add("dd",dl,yen(p[1]));});
    var trial=add("section",details,undefined,"filing-trial");add("h4",trial,"確定申告した場合の寄附額・自己負担比較");
    if(result.housing&&result.trial.status==="COMPONENTS_ONLY"){
      var mt=result.trial.calculation,mdl=add("dl",trial);
      [["試算寄附額",mt.donationYen],["所得税・復興特別所得税（寄附前）",mt.before.nationalTaxYen],["所得税・復興特別所得税（寄附後）",mt.after.nationalTaxYen],
       ["住民税所得割（寄附前）",mt.localBefore.reduce((x,y)=>x+y,0)],["住民税所得割（寄附後）",mt.localAfter.reduce((x,y)=>x+y.assessedYen,0)],
       ["所得税住宅ローン控除（寄附後）",mt.after.nationalHousingYen],["住民税住宅ローン控除（寄附後）",mt.after.residentHousingYen],
       ["実質自己負担見込額",mt.selfPayYen],["2,000円超過額",mt.excessOver2000Yen]].forEach(function(p){add("dt",mdl,p[0]);add("dd",mdl,yen(p[1]));});
    }else if(result.trial.status==="ESTIMATE"){
      var t=result.trial.calculation,tdl=add("dl",trial);
      [["試算寄附額",t.donationYen],["所得税（寄附前）",t.nationalBefore.incomeTax],
       ["所得税（寄附後）",t.nationalAfter.incomeTax],["復興特別所得税（寄附前）",t.nationalBefore.reconstruction],
       ["復興特別所得税（寄附後）",t.nationalAfter.reconstruction],
       ["住民税所得割（寄附前）",t.city.beforeYen+t.prefecture.beforeYen],
       ["住民税所得割（寄附後）",t.city.afterYen+t.prefecture.afterYen],
       ["実質自己負担見込額",t.selfPayYen],["2,000円超過額",t.excessOver2000Yen]]
       .forEach(function(p){add("dt",tdl,p[0]);add("dd",tdl,yen(p[1]));});
    }else add("p",trial,"任意寄附額の試算：HOLD");
    var print=add("button",output,"この結果を印刷・PDF保存","secondary");print.type="button";
    print.addEventListener("click",function(){if(checkPrintableSnapshot())window.print();});
  }
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
    var noTax=result?.status==="NO_TAX"&&result.donationLimitYen===null;
    if(!noTax&&input&&!input.familyDetails&&window.FurusatoFamilyTax?.classifyBasicNoTax){
      noTax=window.FurusatoFamilyTax.classifyBasicNoTax(result,input,FurusatoEngine).status==="NO_TAX";
    }
    if(noTax){
      printableInputSnapshot=JSON.stringify(input);printableResult={noTax:true};
      output.className="result";
      add("h3",output,"控除余地なし（課税所得ゼロ）");
      add("p",output,"確認した試算条件では所得税・住民税所得割の課税所得がともに0円です。寄附による税負担の軽減は見込まれません。");
      add("p",output,"寄附自体は可能です。限度額の数値は表示しません。所得・控除条件が変わる場合は再試算してください。","muted");
      var noTaxPrint=add("button",output,"この判定を印刷・PDF保存","secondary");
      noTaxPrint.type="button";noTaxPrint.addEventListener("click",function(){if(checkPrintableSnapshot())window.print();});
      return;
    }
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
       !(printableResult.noTax===true||(printableResult.familyMode?JSON.stringify(familyEstimate(current))===JSON.stringify(printableResult):selectedReference(printableResult,current)))){
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
    var familyChanged=target.hasAttribute("data-family")||["familySpouseAge","familySpouseIncome","sourceSpouseAge","sourceSpouseIncome"].includes(name);
    if(["familyReviewed","sourceFamilyReviewed","forecastReviewed","insuranceReviewed","sourceInsuranceReviewed","otherReviewed","sourceOtherReviewed","adjustmentReviewed","sourceAdjustmentReviewed","mortgageReviewed"].includes(name)){
      conditionsConfirmation.checked=false;return;
    }
    if(familyChanged||/^sourceAdjustment_/.test(name)||target.hasAttribute("data-adjustment")||target.hasAttribute("data-medical")||/^medical/.test(name)||/^mortgage/.test(name)||target.hasAttribute("data-other-disability")||/^(target|source)Other_/.test(name)||/^(target|source)Insurance_/.test(name)||name==="familyReviewed"||name==="year"||name==="filing"||name==="municipality"||
       name==="salaryGross"||name==="socialInsurance"||
       name==="salaryIncomeReference"||name==="deductionsReference"||
       name==="deductionsOverride"||
       name==="forecastReviewed"||flags.includes(name)){
      if(conditionsConfirmation)conditionsConfirmation.checked=false;
      form.elements.namedItem("familyReviewed").checked=false;
      form.elements.namedItem("sourceFamilyReviewed").checked=false;
      form.elements.namedItem("insuranceReviewed").checked=false;
      form.elements.namedItem("sourceInsuranceReviewed").checked=false;
      form.elements.namedItem("otherReviewed").checked=false;
      form.elements.namedItem("sourceOtherReviewed").checked=false;
      form.elements.namedItem("adjustmentReviewed").checked=false;
      form.elements.namedItem("sourceAdjustmentReviewed").checked=false;
      form.elements.namedItem("mortgageReviewed").checked=false;
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
  var familyRows=document.getElementById("familyRelatives");
  var sourceFamilyRows=document.getElementById("sourceFamilyRelatives");
  function revokeFamily(){
    ["familyReviewed","sourceFamilyReviewed","forecastReviewed","insuranceReviewed","sourceInsuranceReviewed","otherReviewed","sourceOtherReviewed","adjustmentReviewed","sourceAdjustmentReviewed","mortgageReviewed"].forEach(function(name){form.elements.namedItem(name).checked=false;});
    conditionsConfirmation.checked=false;invalidateEstimate();
  }
  function resetSourceFamily(){
    document.getElementById("familyCopyStatus").textContent="";
    delete form.dataset.ocrFamilyCountHints;delete form.dataset.ocrSpouseIncome;
    delete form.dataset.ocrInsuranceDeductionHints;
    var insuranceHintNote=document.getElementById("sourceInsuranceDeductionHints");if(insuranceHintNote)insuranceHintNote.textContent="";
    document.getElementById("sourceFamilyCountHints").textContent="";
    document.getElementById("premiumCopyStatus").textContent="";
    form.elements.namedItem("medicalNetPaidYen").value="";
    ["mortgageSourceApplied","mortgageSourcePossible","mortgageMoveInYear","mortgageCapClass"].forEach(function(name){form.elements.namedItem(name).value="";});
    sourceFamilyRows.replaceChildren();sourceAdjustmentRows.replaceChildren();
    ["sourceAdjustment_basic","sourceAdjustment_amount"].forEach(function(name){form.elements.namedItem(name).value="";});
    ["sourceSpouseAge","sourceSpouseIncome"].forEach(function(name){form.elements.namedItem(name).value="";});
    premiumKeys.forEach(function(k){form.elements.namedItem("sourceInsurance_"+k).value="";});
    ["self","spouse","marital"].forEach(function(k){form.elements.namedItem("sourceOther_"+k).value="none";});
    ["child","contribution"].forEach(function(k){form.elements.namedItem("sourceOther_"+k).value="";});
    form.elements.namedItem("sourceOther_student").checked=false;
    revokeFamily();
  }
  form.addEventListener("family-source-reset",resetSourceFamily);
  function addFamilyRow(container){
    if(container.children.length>=30)return;
    var row=add("fieldset",container,undefined,"family-relative");
    add("legend",row,"扶養親族・特定親族");
    ["age","income"].forEach(function(key){
      var label=add("label",row,key==="age"?"年齢":"合計所得（円）");
      var input=add("input",label);input.type="text";input.inputMode="numeric";input.autocomplete="off";
      input.maxLength=key==="age"?3:12;input.setAttribute("data-family",key);
    });
    var cohab=add("label",row,undefined,"confirm");
    var check=add("input",cohab);check.type="checkbox";check.setAttribute("data-family","cohabiting");
    cohab.appendChild(document.createTextNode(" 同居老親等（70歳以上の直系尊属・要件確認済）"));
    if(container===familyRows||container===sourceFamilyRows){
      var disabilityLabel=add("label",row,"その他所得控除：障害区分");
      var select=add("select",disabilityLabel);select.setAttribute("data-other-disability","");
      [["none","該当なし"],["ordinary","障害者"],["special","特別障害者"],["cohabitingSpecial","同居特別障害者"]].forEach(function(pair){
        var option=add("option",select,pair[1]);option.value=pair[0];
      });
    }
    var remove=add("button",row,"この親族を削除","secondary");remove.type="button";
    remove.addEventListener("click",function(){row.remove();revokeFamily();});
    revokeFamily();
  }
  var adjustmentRows=document.getElementById("adjustmentRelatives");
  var sourceAdjustmentRows=document.getElementById("sourceAdjustmentRelatives");
  function addAdjustmentRow(container){
    if(container.children.length>=30)return;
    var row=add("fieldset",container,undefined,"adjustment-relative");
    add("legend",row,"所得金額調整控除のみの親族");
    [["age","年齢"],["income","合計所得（円）"]].forEach(function(pair){
      var label=add("label",row,pair[1]),control=add("input",label);
      control.type="text";control.inputMode="numeric";control.autocomplete="off";control.maxLength=pair[0]==="age"?3:12;
      control.setAttribute("data-adjustment",pair[0]);
    });
    var label=add("label",row,undefined,"confirm"),special=add("input",label);
    special.type="checkbox";special.setAttribute("data-adjustment","special");
    label.appendChild(document.createTextNode(" 特別障害者"));
    var remove=add("button",row,"この親族を削除","secondary");remove.type="button";
    remove.addEventListener("click",function(){row.remove();revokeFamily();});
    revokeFamily();
  }
  document.getElementById("adjustmentAdd").addEventListener("click",function(){addAdjustmentRow(adjustmentRows);});
  document.getElementById("sourceAdjustmentAdd").addEventListener("click",function(){addAdjustmentRow(sourceAdjustmentRows);});
  document.getElementById("copySourceFamily").addEventListener("click",function(){
    const input=getInput(),source=input.sourceFamily,sy=Number(input.sourceYear),year=Number(input.year),delta=year-sy;
    const status=document.getElementById("familyCopyStatus"),get=k=>form.elements.namedItem(k);
    const fail=()=>{status.textContent="原票年の家族明細を正しく入力してください。障害・その他所得控除や所得金額調整控除の追加親族がある場合は個別入力してください。";};
    if(!source||input.sourceReviewPending||![2025,2026].includes(sy)||![2025,2026].includes(year)||![0,1].includes(delta)||
       input.otherDetails||input.sourceOtherDetails||sourceAdjustmentRows.children.length||adjustmentRows.children.length)return fail();
    const spousePresent=source.spouseAge!==""||source.spouseIncome!=="";
    if(!spousePresent&&!source.relatives.length&&!source.reviewed)return fail();
    const members=[...(spousePresent?[{age:source.spouseAge,income:source.spouseIncome}]:[]),...source.relatives];
    if(members.some(m=>strictYen(m.age)===null||strictYen(m.income)===null||strictYen(m.age)+delta>130||strictYen(m.income)>100000000||(m.cohabiting&&strictYen(m.age)<70)))return fail();
    get("familySpouseAge").value=spousePresent?String(strictYen(source.spouseAge)+delta):"";
    get("familySpouseIncome").value=spousePresent?source.spouseIncome:"";
    familyRows.replaceChildren();
    for(const m of source.relatives){
      addFamilyRow(familyRows);
      const row=familyRows.lastElementChild;
      row.querySelector('[data-family="age"]').value=String(strictYen(m.age)+delta);
      row.querySelector('[data-family="income"]').value=m.income;
      row.querySelector('[data-family="cohabiting"]').checked=m.cohabiting;
    }
    get("hasSpouse").checked=spousePresent;get("hasDependents").checked=source.relatives.length>0;
    revokeFamily();document.getElementById("familyPanelFold").open=true;
    status.textContent="家族明細をコピーしました。試算年の所得・家族構成・適用条件を再確認してください。";
  });
  document.getElementById("copySourcePremiums").addEventListener("click",function(){
    var sourceYear=Number(form.dataset.ocrYear),year=Number(form.elements.namedItem("year").value);
    var values=premiumKeys.map(function(k){return form.elements.namedItem("sourceInsurance_"+k).value.trim();});
    var note=document.getElementById("premiumCopyStatus");
    if(![2025,2026].includes(sourceYear)||(year!==sourceYear&&year!==sourceYear+1)||
       form.dataset.ocrReviewPending==="true"||
       !values.some(v=>v!=="")||values.some(v=>v!==""&&(strictYen(v)===null||strictYen(v)>100000000))){
      note.textContent="原票年の年間保険料と参照年分を正しく確認してください。";return;
    }
    premiumKeys.forEach(function(k,i){form.elements.namedItem("targetInsurance_"+k).value=values[i];});
    form.elements.namedItem("hasLifeInsurance").checked=values.slice(0,5).some(v=>Number(v)>0);
    form.elements.namedItem("hasEarthquakeInsurance").checked=values.slice(5).some(v=>Number(v)>0);
    revokeFamily();revealRelevantPanels();note.textContent="原票年の年間保険料を試算年へコピーしました。変更があれば訂正し、再確認してください。";
  });
  // Presentation only: collapsing a panel never disables or clears its inputs.
  var optionalPanelIds=["familyPanelFold","sourceFamilyPanelFold","targetInsurancePanelFold","targetOtherPanelFold","salaryAdjustmentPanelFold","sourceAdjustmentPanelFold","sourceOtherPanelFold","sourceInsurancePanelFold","mortgagePanel"];
  function openOptional(id){document.getElementById(id).open=true;}
  function revealRelevantPanels(){
    var get=function(k){return form.elements.namedItem(k);};
    var flags=(form.dataset.ocrSourceIndicators||"").split(",");
    var imported=!!form.dataset.ocrYear;
    var sourceHigh=Number(form.dataset.ocrOriginalGross)>8500000,targetHigh=strictYen(get("salaryGross").value.trim())>8500000;
    var family=get("hasSpouse").checked||get("hasDependents").checked||flags.includes("hasDependents")||flags.includes("hasSpouse");
    var insurance=get("hasLifeInsurance").checked||get("hasEarthquakeInsurance").checked||
      flags.includes("hasLifeInsurance")||flags.includes("hasEarthquakeInsurance");
    if(family||targetHigh||sourceHigh)openOptional("familyPanelFold");
    if(insurance||targetHigh||sourceHigh)openOptional("targetInsurancePanelFold");
    if(targetHigh||sourceHigh){openOptional("targetOtherPanelFold");}
    if(targetHigh||get("hasIncomeAdjustment").checked)openOptional("salaryAdjustmentPanelFold");
    if(imported&&(family||insurance||sourceHigh||targetHigh))openOptional("sourceFamilyPanelFold");
    if(imported&&(insurance||sourceHigh||targetHigh))openOptional("sourceInsurancePanelFold");
    if(imported&&(sourceHigh||targetHigh))openOptional("sourceOtherPanelFold");
    if(imported&&sourceHigh)openOptional("sourceAdjustmentPanelFold");
    if(get("hasMortgage").checked||flags.includes("hasMortgage"))openOptional("mortgagePanel");
  }
  form.addEventListener("change",function(event){
    if(["hasSpouse","hasDependents","hasLifeInsurance","hasEarthquakeInsurance","hasMortgage","hasIncomeAdjustment","salaryGross"].includes(event.target.name))revealRelevantPanels();
  });
  form.addEventListener("ocr-source-transferred",revealRelevantPanels);
  form.addEventListener("ocr-source-transferred",function(){
    var insuranceNote=document.getElementById("sourceInsuranceDeductionHints");
    if(insuranceNote){
      insuranceNote.textContent="";
      try{
        var ih=JSON.parse(form.dataset.ocrInsuranceDeductionHints||"{}");
        var iparts=[["sourceLifeDeductionHint","生命保険料控除額"],["sourceEarthDeductionHint","地震保険料控除額"]].filter(([k])=>Number.isSafeInteger(ih[k])&&ih[k]>0).map(([k,l])=>l+"："+yen(ih[k]));
        if(iparts.length)insuranceNote.textContent="原票の控除額候補："+iparts.join("／")+"。年間支払保険料ではありません。入力した年間保険料から算出した原票年の控除額と照合します。";
      }catch(_){insuranceNote.textContent="原票の保険料控除額候補を確認してください。";}
    }
    var note=document.getElementById("sourceFamilyCountHints"),labels={"familySpecificCount":"特定扶養親族","familyElderlyCount":"老人扶養親族","familyOtherCount":"その他の控除対象扶養親族","familySpecialRelativeCount":"特定親族","familyUnder16Count":"16歳未満の扶養親族"};
    note.textContent="";
    if(!form.dataset.ocrFamilyCountHints)return;
    try{
      var hints=JSON.parse(form.dataset.ocrFamilyCountHints);
      var parts=Object.keys(labels).filter(k=>Number.isSafeInteger(hints[k])&&hints[k]>0&&hints[k]<=30).map(k=>labels[k]+"："+hints[k]+"人");
      if(parts.length){note.textContent="原票年の人数候補："+parts.join("／")+"。原票年の明細と照合します。未読取欄は0人と断定しません。";openOptional("sourceFamilyPanelFold");}
    }catch(_){note.textContent="原票の扶養人数候補を確認してください。";}
  });
  var basicConfirm=document.getElementById("confirmBasicForecast");
  function updateBasicForecast(){
    var source=Number(form.dataset.ocrYear),target=Number(form.elements.namedItem("year").value);
    basicConfirm.hidden=!([2025,2026].includes(source)&&target===source+1);
  }
  basicConfirm.addEventListener("click",function(){
    updateBasicForecast();
    var snapshot=getInput();
    if(basicConfirm.hidden||snapshot.sourceReviewPending||
       strictYen(snapshot.salaryGross)===null||strictYen(snapshot.socialInsurance)===null||
       !["standard","designated"].includes(snapshot.municipality))return;
    form.elements.namedItem("forecastReviewed").checked=true;
    conditionsConfirmation.checked=true;invalidateEstimate();
    document.getElementById("basicForecastStatus").textContent="基本確認済み。該当する個別控除は別途確認してください。";
  });
  form.addEventListener("ocr-source-transferred",updateBasicForecast);
  form.addEventListener("family-source-reset",function(){basicConfirm.hidden=true;document.getElementById("basicForecastStatus").textContent="";});
  form.elements.namedItem("year").addEventListener("change",updateBasicForecast);
  for(const event of ["input","change"])form.addEventListener(event,function(){document.getElementById("basicForecastStatus").textContent="";});
  updateBasicForecast();
  form.elements.namedItem("salaryGross").addEventListener("input",function(){if(strictYen(this.value.trim())>8500000)revealRelevantPanels();});
  form.elements.namedItem("medicalNetPaidYen").addEventListener("input",function(){
    var n=strictYen(this.value.trim());
    if(n!==null&&n>0&&n<=100000000000)form.elements.namedItem("filing").value="return";
  });
  document.getElementById("familyAdd").addEventListener("click",function(){addFamilyRow(familyRows);});
  document.getElementById("sourceFamilyAdd").addEventListener("click",function(){addFamilyRow(sourceFamilyRows);});
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    try {
      if (typeof FurusatoEngine === "undefined" ||
        !FurusatoEngine || typeof FurusatoEngine.calculate !== "function") {
        render({status:"HOLD",reasons:["計算エンジンを読み込めませんでした。"]});
        return;
      }
      var snapshot=getInput();
      if(snapshot.familyDetails){renderFamily(familyEstimate(snapshot),snapshot);return;}
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
    optionalPanelIds.forEach(function(id){document.getElementById(id).open=false;});
    document.getElementById("familyCopyStatus").textContent="";
    basicConfirm.hidden=true;document.getElementById("basicForecastStatus").textContent="";
    document.getElementById("premiumCopyStatus").textContent="";
    familyRows.replaceChildren();sourceFamilyRows.replaceChildren();adjustmentRows.replaceChildren();sourceAdjustmentRows.replaceChildren();
    form.classList.remove("deduction-override-active");
    if(overrideNotice)overrideNotice.hidden=true;
    delete form.dataset.ocrYear;
    delete form.dataset.ocrFamilyCountHints;delete form.dataset.ocrSpouseIncome;
    delete form.dataset.ocrInsuranceDeductionHints;
    var insuranceHintNote=document.getElementById("sourceInsuranceDeductionHints");if(insuranceHintNote)insuranceHintNote.textContent="";
    document.getElementById("sourceFamilyCountHints").textContent="";
    delete form.dataset.ocrOriginalGross;
    delete form.dataset.ocrOriginalIncome;
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
