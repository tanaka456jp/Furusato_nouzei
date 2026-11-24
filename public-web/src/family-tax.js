"use strict";
/**
 * Salary-only + explicitly reviewed resident family, WEB review only.
 * Income tax taxable and local special credit base must remain distinct.
 * Optional explicitly reviewed insurance premiums; no UI approval,
 * source inference, mortgage or other credits.
 * https://www.city.sapporo.jp/s024/4654.html
 * https://www.city.chofu.lg.jp/030010/p014041.html
 * https://www.city.chofu.lg.jp/030010/p014042.html
 * https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1155.htm
 */
(function(root,factory){
 if(typeof module==="object"&&module.exports)module.exports=factory(require("./family-deductions.js"),require("./insurance-deductions.js"));
 else root.FurusatoFamilyTax=factory(root.FurusatoFamilyDeductions,root.FurusatoInsuranceDeductions);
}(typeof window!=="undefined"?window:this,function(family,insurance){
 const valid=(n,max)=>Number.isSafeInteger(n)&&n>=0&&n<=max;
 const hold=reason=>({status:"HOLD",reason,calculation:null,donationLimitYen:null,release:"HOLD"});
 const floor1000=n=>Math.floor(Math.max(0,n)/1000)*1000;
 const basic=(year,income)=>year===2025?
  (income<=1320000?950000:income<=3360000?880000:income<=4890000?680000:630000):
  (income<=4890000?1040000:670000);
 function national(taxable){
  const incomeTax=taxable<=1950000?taxable*5/100:
   taxable<=3300000?taxable*10/100-97500:taxable*20/100-427500;
  const reconstruction=Math.floor(incomeTax*21/1000);
  return {taxable,incomeTax,reconstruction,total:incomeTax+reconstruction};
 }
 function calculate(input){
  const keys=["year","salaryIncome","socialInsurance","municipality","spouse","relatives","conditions"];
  const withInsurance=input?.conditions==="salary-basic-social-family-insurance-only-reviewed";
  if(withInsurance)keys.push("premiums");
  if(!input||typeof input!=="object"||Array.isArray(input)||
    Object.keys(input).length!==keys.length||!keys.every(k=>Object.prototype.hasOwnProperty.call(input,k))||
    ![2025,2026].includes(input.year)||!valid(input.salaryIncome,6550000)||
    !valid(input.socialInsurance,8500000)||!["standard","designated"].includes(input.municipality)||
    (!withInsurance&&input.conditions!=="salary-basic-social-family-only-reviewed")||!family||
    typeof family.calculate!=="function")
    return hold("給与所得・家族・自治体・追加控除等の適用条件を確認してください");
  const household={year:input.year,taxpayerIncome:input.salaryIncome,
    spouse:input.spouse,relatives:input.relatives,conditions:"annual-resident-family-reviewed"};
  const f=family.calculate(household);
  if(f.status!=="COMPONENTS_ONLY")return hold(f.reason||"家族控除が未確認です");
  const c=f.calculation;
  if(c.ordinaryResidentIncomeLevyExempt)return hold("住民税所得割非課税のため寄附上限試算対象外です");
  const income=input.salaryIncome;
  const nationalBasic=basic(input.year,income);
  let insuranceDetails=null;
  if(withInsurance){
   if(!insurance||typeof insurance.calculate!=="function")return hold("保険料控除の計算機能を利用できません");
   const result=insurance.calculate({year:input.year,family:household,premiums:input.premiums,
     conditions:"eligible-net-premiums-and-contract-selection-reviewed"});
   if(result.status!=="COMPONENTS_ONLY")return hold(result.reason||"保険料控除を確認できません");
   insuranceDetails=result.calculation;
  }
  const nationalDeductions=nationalBasic+input.socialInsurance+c.nationalFamilyDeductionYen+(insuranceDetails?.national.totalYen??0);
  const residentDeductions=430000+input.socialInsurance+c.residentFamilyDeductionYen+(insuranceDetails?.resident.totalYen??0);
  const nationalTaxable=floor1000(income-nationalDeductions);
  const localTaxable=floor1000(income-residentDeductions);
  if(nationalTaxable===0||localTaxable===0)return hold("所得税または住民税の課税所得がないケースは個別確認してください");
  // Insurance deduction differences are not personal deduction differences.
  // Keep the statutory municipal special-rate base separate from actual national taxable.
  const difference=50000+c.familyAdjustmentDifferenceYen;
  const adjustmentBasis=localTaxable<=2000000?Math.min(localTaxable,difference):
   Math.max(50000,difference-(localTaxable-2000000));
  const specialBase=localTaxable-difference-Math.max(0,nationalBasic-480000);
  if(specialBase<0)return hold("特例控除割合の適用区分を個別確認してください");
  const specialRate=specialBase<=1950000?5:specialBase<=3300000?10:20;
  const ratio=90000-specialRate*1021;
  const share=input.municipality==="standard"?3:4;
  function part(s){
   const gross100=localTaxable*s*2;
   const adjustment100=Math.min(gross100,adjustmentBasis*s);
   const after100=gross100-adjustment100;
   const assessed=Math.floor(after100/10000)*100;
   const cap=assessed/5;
   return {share:s,grossYen:gross100/100,adjustmentYen:adjustment100/100,
    beforeRounding100:after100,assessedYen:assessed,conservativeSpecialCapYen:cap,
    referenceLimitYen:2000+Math.floor(cap*500000/(ratio*s))};
  }
  const city=part(share),prefecture=part(5-share);
  const levy=city.assessedYen+prefecture.assessedYen;
  if(levy<=0)return hold("住民税所得割がありません");
  const incomeCap=Math.floor(income*3/10);
  const exactReference=Math.min(city.referenceLimitYen,prefecture.referenceLimitYen,incomeCap);
  const rounded=Math.floor(exactReference/1000)*1000;
  if(rounded<2000)return hold("寄附控除の参考上限を確認できません");
  return {status:"ESTIMATE",donationLimitYen:rounded,release:"HOLD",calculation:{
   year:input.year,residentYear:input.year+1,municipality:input.municipality,
   family:c,...(withInsurance?{insurance:insuranceDetails}:{}),nationalBasicYen:nationalBasic,nationalDeductionsYen:nationalDeductions,
   residentDeductionsYen:residentDeductions,nationalTaxableYen:nationalTaxable,
   residentTaxableYen:localTaxable,nationalBefore:national(nationalTaxable),
   personalDifferenceYen:difference,adjustmentBasisYen:adjustmentBasis,
   adjustmentYen:city.adjustmentYen+prefecture.adjustmentYen,
   residentSpecialBaseYen:specialBase,specialRatePercent:specialRate,specialDenominator:ratio,
   city,prefecture,residentIncomeLevyYen:levy,incomeCapYen:incomeCap,
   exactReferenceYen:exactReference,roundedReferenceYen:rounded}};
 }
 function trialFromCalculation(c,income,donation){
  if(!valid(donation,c.incomeCapYen)||donation<2000)
   return hold("試算寄附額は2,000円以上・給与所得の30%以内の整数で入力してください");
  const base=donation-2000;
  const after=national(floor1000(income-c.nationalDeductionsYen-base));
  function part(p){
   // Follow the existing filing model: unrounded levy for the special
   // cap, combined basic + special rounded up, final levy floored to 100.
   const special=Math.min(p.beforeRounding100*1000,base*c.specialDenominator*p.share);
   const regular=base*p.share*10000;
   const credit=Math.floor((regular+special+499999)/500000);
   const afterYen=Math.max(0,Math.floor((p.beforeRounding100-credit*100)/10000))*100;
   return {beforeYen:p.assessedYen,afterYen,creditYen:credit,savingYen:p.assessedYen-afterYen};
  }
  const city=part(c.city),prefecture=part(c.prefecture);
  const nationalSaving=c.nationalBefore.total-after.total;
  const residentSaving=city.savingYen+prefecture.savingYen;
  const selfPay=donation-nationalSaving-residentSaving;
  return {status:"ESTIMATE",release:"HOLD",calculation:{donationYen:donation,
   nationalBefore:c.nationalBefore,nationalAfter:after,city,prefecture,
   nationalSavingYen:nationalSaving,residentSavingYen:residentSaving,selfPayYen:selfPay,
   excessOver2000Yen:Math.max(0,selfPay-2000),within2000:selfPay<=2000}};
 }
 function filingTrial(input,donation){
  const ref=calculate(input);
  return ref.status==="ESTIMATE"?trialFromCalculation(ref.calculation,input.salaryIncome,donation):ref;
 }
 function filingPrefix(input){
  const ref=calculate(input);
  if(ref.status!=="ESTIMATE")return ref;
  let ceiling=2000,firstFailure=null;
  for(let d=3000;d<=ref.calculation.incomeCapYen;d+=1000){
   const trial=trialFromCalculation(ref.calculation,input.salaryIncome,d);
   if(trial.status!=="ESTIMATE")return trial;
   if(!trial.calculation.within2000){firstFailure=d;break;}
   ceiling=d;
  }
  return {status:"ESTIMATE",donationLimitYen:ceiling,release:"HOLD",
    calculation:{firstFailureYen:firstFailure,stopOnFirstFailure:true}};
 }
 return Object.freeze({calculate,filingTrial,filingPrefix});
}));
