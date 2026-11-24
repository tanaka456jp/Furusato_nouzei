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
 return Object.freeze({calculate});
}));
