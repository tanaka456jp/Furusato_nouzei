"use strict";
// Source-year reconciliation only. No inference from current-year household,
// no tax credits, no personal identifiers, no network or storage.
(function(root,factory){
 if(typeof module==="object"&&module.exports)module.exports=factory(require("./family-deductions.js"),require("./insurance-deductions.js"),require("./other-deductions.js"));
 else root.FurusatoFamilySource=factory(root.FurusatoFamilyDeductions,root.FurusatoInsuranceDeductions,root.FurusatoOtherDeductions);
}(typeof window!=="undefined"?window:this,function(family,insurance,other){
 const amount=(n,max)=>Number.isSafeInteger(n)&&n>=0&&n<=max;
 const hold=reason=>({status:"HOLD",reason,calculation:null});
 function reconcile(input,salaryEngine){
  const keys=["year","gross","salaryIncome","social","deductions","indicators","spouse","relatives","reviewed"];
  const withInsurance=!!input&&Object.prototype.hasOwnProperty.call(input,"premiums");
  if(withInsurance)keys.push("premiums","insuranceReviewed");
  const withOther=!!input&&Object.prototype.hasOwnProperty.call(input,"otherDeductions");
  if(withOther)keys.push("otherDeductions","otherReviewed","sourceContributionYen");
  const allowed=withInsurance?["hasSpouse","hasDependents","hasLifeInsurance","hasEarthquakeInsurance"]:["hasSpouse","hasDependents"];
  if(withOther)allowed.push("hasDisability","hasWidow","hasSingleParent","hasWorkingStudent","hasSmallEnterpriseContributions");
  if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).length!==keys.length||
     !keys.every(k=>Object.prototype.hasOwnProperty.call(input,k))||
     ![2025,2026].includes(input.year)||!amount(input.gross,8500000)||input.gross===0||
     !amount(input.salaryIncome,6550000)||!amount(input.social,input.gross)||
     !amount(input.deductions,100000000)||input.reviewed!==true||
     !input.indicators||typeof input.indicators!=="object"||Array.isArray(input.indicators)||
     Object.entries(input.indicators).some(([k,v])=>!allowed.includes(k)||v!==true)||
     (withInsurance&&(input.insuranceReviewed!==true||!insurance||typeof insurance.calculate!=="function"))||
     (withOther&&(!withInsurance||input.otherReviewed!==true||!amount(input.sourceContributionYen,input.social)||
       !other||typeof other.calculate!=="function"))||
     !salaryEngine||typeof salaryEngine.salaryIncome!=="function"||
     typeof salaryEngine.statutoryRows!=="function"||!family)
   return hold("原票年分・4金額・家族明細・その他控除の確認が必要です");
  const salary=salaryEngine.salaryIncome(input.gross,input.year);
  if(salary!==input.salaryIncome)return hold("原票の給与所得控除後の金額が一致しません");
  const basicRow=salaryEngine.statutoryRows().find(row=>row[0]===input.year&&salary<=row[1]);
  if(!basicRow||!amount(basicRow[2],1040000))return hold("原票年分の基礎控除を確認できません");
  const household={year:input.year,taxpayerIncome:salary,spouse:input.spouse,
    relatives:input.relatives,conditions:"annual-resident-family-reviewed"};
  const f=family.calculate(household);
  if(f.status!=="COMPONENTS_ONLY")return hold(f.reason);
  const c=f.calculation;
  if(input.indicators.hasSpouse&&!c.items.some(x=>["spouse","elderly-spouse","spouse-special"].includes(x.kind)))
   return hold("原票の配偶者控除の検出結果と明細が一致しません");
  if(input.indicators.hasDependents&&!c.items.some(x=>x.kind==="relative-special"||x.kind==="under16"||x.kind.startsWith("dependent-")))
   return hold("原票の扶養・特定親族の検出結果と明細が一致しません");
  let insuranceDetails=null;
  if(withInsurance){
   const result=insurance.calculate({year:input.year,family:household,premiums:input.premiums,
    conditions:"eligible-net-premiums-and-contract-selection-reviewed"});
   if(result.status!=="COMPONENTS_ONLY")return hold(result.reason);
   insuranceDetails=result.calculation;
   if((input.indicators.hasLifeInsurance&&insuranceDetails.national.lifeYen===0)||
      (input.indicators.hasEarthquakeInsurance&&insuranceDetails.national.earthquakeYen===0))
    return hold("原票で検出した保険料控除と入力明細が一致しません");
  }
  let otherDetails=null;
  if(withOther){
   const o=input.otherDeductions;
   const oKeys=["disability","maritalRelief","childIndex","workingStudent","smallEnterpriseContributions"];
   if(!o||typeof o!=="object"||Array.isArray(o)||Object.keys(o).length!==oKeys.length||
      !oKeys.every(k=>Object.prototype.hasOwnProperty.call(o,k))||
      o.smallEnterpriseContributions!==input.sourceContributionYen)
    return hold("原票のG25内書き掛金とその他所得控除の明細を確認してください");
   const result=other.calculate({...o,family:household,conditions:"salary-only-adult-other-deductions-reviewed"});
   if(result.status!=="COMPONENTS_ONLY")return hold(result.reason);
   otherDetails=result.calculation;
   const flags=input.indicators;
   if((flags.hasDisability&&!otherDetails.disabilityItems.some(i=>i.nationalYen>0))||
      (flags.hasWidow&&!["widowDivorced","widowBereaved"].includes(o.maritalRelief))||
      (flags.hasSingleParent&&!["singleParentFather","singleParentMother"].includes(o.maritalRelief))||
      (flags.hasWorkingStudent&&!o.workingStudent)||
      (flags.hasSmallEnterpriseContributions&&input.sourceContributionYen===0))
    return hold("原票で検出したその他所得控除と確認明細が一致しません");
  }
  // G26 already includes G25. Count the latter exactly once.
  const socialOnly=input.social-(withOther?input.sourceContributionYen:0);
  const total=basicRow[2]+socialOnly+c.nationalFamilyDeductionYen+
   (insuranceDetails?.national.totalYen??0)+(otherDetails?.nationalOtherDeductionYen??0);
  if(total!==input.deductions)return hold("原票年分の所得控除合計が一致しません。未対応控除の可能性があります");
  return {status:"RECONCILED",calculation:{year:input.year,salaryIncomeYen:salary,basicYen:basicRow[2],
    familyYen:c.nationalFamilyDeductionYen,deductionsYen:total,
    ...(withOther?{socialInsuranceOnlyYen:socialOnly,sourceContributionYen:input.sourceContributionYen,
      otherYen:otherDetails.nationalOtherDeductionYen,otherWithoutContributionsYen:otherDetails.nationalOtherDeductionYen-input.sourceContributionYen}:{}),
    ...(withInsurance?{lifeYen:insuranceDetails.national.lifeYen,earthquakeYen:insuranceDetails.national.earthquakeYen,
      insuranceYen:insuranceDetails.national.totalYen,enhancedGeneral:insuranceDetails.enhancedGeneral}:{})}};
 }
 return Object.freeze({reconcile});
}));
