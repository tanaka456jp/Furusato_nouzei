"use strict";
/**
 * WEB-only resident income levy calculation (2025/2026 salary, basic
 * deduction and social insurance only). Not yet connected to the public UI.
 * Standard municipal/prefectural rates: 6/4 or 8/2.
 * Sources:
 * https://www.city.kyoto.lg.jp/gyozai/page/0000028299.html
 * https://www.city.kyoto.lg.jp/gyozai/page/0000028147.html
 * https://www.city.yurihonjo.lg.jp/1000002/1001862/1002999.html
 * https://www.city.ichikawa.lg.jp/page/3898.html
 * No nonstandard rates, other credits, family exemptions or final tax
 * assessment implied. A caller must explicitly confirm the limited scope.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 else root.FurusatoResidentLevy=api;
}(typeof window!=="undefined"?window:this,function(){
 const rates=Object.freeze({standard:[6,4,3,2],designated:[8,2,4,1]});
 function hold(reason){return {status:"HOLD",reason,calculation:null};}
 function calculate(input){
  if(!input||typeof input!=="object"||Array.isArray(input)||
     Object.keys(input).some(k=>!["year","salaryIncome","socialInsurance","municipality","conditions"].includes(k))||
     ![2025,2026].includes(input.year)||input.conditions!=="basic-only-reviewed"||
     !["standard","designated"].includes(input.municipality))
   return hold("対象年・自治体区分・適用条件を確認してください");
  const {salaryIncome,socialInsurance,municipality}=input;
  if(!Number.isSafeInteger(salaryIncome)||salaryIncome<0||salaryIncome>6550000||
     !Number.isSafeInteger(socialInsurance)||socialInsurance<0||socialInsurance>8500000)
   return hold("給与所得・社会保険料が対象外です");
  // Uniform income-levy exemption for a taxpayer with no dependants.
  // Below/at 450k salary income: do not return a positive levy.
  if(salaryIncome<=450000)return hold("住民税所得割の非課税条件を確認してください");
  const taxable=Math.floor(Math.max(0,salaryIncome-socialInsurance-430000)/1000)*1000;
  if(taxable===0)return hold("住民税課税所得がありません");
  // Statutory personal deduction difference for basic-only cases: 50k.
  // This is not the actual difference between 2025/2026 national and local basic deductions.
  const difference=50000;
  const basis=taxable<=2000000?Math.min(taxable,difference):
    Math.max(50000,difference-(taxable-2000000));
  const rate=rates[municipality];
  function part(levyRate,adjustmentRate){
   // Store integer hundredths of a yen until the final 100-yen floor.
   const gross100=taxable*levyRate;
   const adjustment100=Math.min(gross100,basis*adjustmentRate);
   const after100=gross100-adjustment100;
   const assessed=Math.floor(after100/10000)*100;
   return {ratePercent:levyRate,adjustmentRatePercent:adjustmentRate,
    grossYen:gross100/100,adjustmentYen:adjustment100/100,
    beforeRoundingYen:after100/100,assessedYen:assessed,
    referenceSpecialCapYen:assessed/5};
  }
  const city=part(rate[0],rate[2]),prefecture=part(rate[1],rate[3]);
  const assessed=city.assessedYen+prefecture.assessedYen;
  if(assessed===0)return hold("住民税所得割がありません");
  return {status:"ESTIMATE",calculation:{municipality,residentTaxableYen:taxable,
    personalDifferenceYen:difference,adjustmentBasisYen:basis,
    residentAdjustmentYen:city.adjustmentYen+prefecture.adjustmentYen,
    city,prefecture,residentIncomeLevyYen:assessed,
    pooledComparisonYen:Math.floor((city.beforeRoundingYen+prefecture.beforeRoundingYen)/100)*100,
    referenceSpecialCapYen:city.referenceSpecialCapYen+prefecture.referenceSpecialCapYen},
    donationLimitYen:null,release:"HOLD"};
 }
 // Conservative reference ceiling for one-stop only, using each local
 // special-credit cap separately. No filing or housing-credit estimate.
 // Municipal sources: https://www.city.chiba.jp/zaiseikyoku/zeimu/kazeikanri/kojinshotokuwarisanshutu.html
 // https://www.city.yokohama.lg.jp/kurashi/koseki-zei-hoken/zeikin/y-shizei/kojin-shiminzei-kenminzei/kihukin.html
 // The assessed, rounded levy is used conservatively as the cap base.
 function oneStopReference(input){
  const out=calculate(input);
  if(out.status!=="ESTIMATE")return out;
  const c=out.calculation;
  const income=input.salaryIncome;
  const basic=input.year===2025?
   (income<=1320000?950000:income<=3360000?880000:income<=4890000?680000:630000):
   (income<=4890000?1040000:670000);
  const nationalTaxable=Math.floor(Math.max(0,income-basic-input.socialInsurance)/1000)*1000;
  const specialBase=c.residentTaxableYen-50000-Math.max(0,basic-480000);
  if(nationalTaxable<=0||specialBase!==nationalTaxable)
   return hold("所得税・住民税の特例控除税率を確認してください");
  const ratePercent=specialBase<=1950000?5:specialBase<=3300000?10:20;
  // Denominator in units of 1/100000, exact integer arithmetic.
  const denominator=90000-ratePercent*1021;
  const cityShare=input.municipality==="standard"?3:4;
  const prefShare=5-cityShare;
  const cityLimit=2000+Math.floor(c.city.referenceSpecialCapYen*500000/(denominator*cityShare));
  const prefLimit=2000+Math.floor(c.prefecture.referenceSpecialCapYen*500000/(denominator*prefShare));
  const incomeCap=Math.floor(income*3/10);
  const exactReference=Math.min(cityLimit,prefLimit,incomeCap);
  if(exactReference<2000)return hold("寄附金控除の適用条件を確認してください");
  const rounded=Math.floor(exactReference/1000)*1000;
  return {status:"ESTIMATE",calculation:{...c,nationalTaxableYen:nationalTaxable,
    specialRatePercent:ratePercent,specialDenominator:denominator,
    citySpecialReferenceLimitYen:cityLimit,prefectureSpecialReferenceLimitYen:prefLimit,
    incomeCapYen:incomeCap,exactReferenceYen:exactReference,roundedReferenceYen:rounded},
    donationLimitYen:rounded,release:"HOLD"};
 }
 return Object.freeze({calculate,oneStopReference});
}));
