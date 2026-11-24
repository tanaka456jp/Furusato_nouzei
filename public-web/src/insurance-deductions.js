"use strict";
// Annual insurance deduction components only; no donation ceiling.
// Sources: NTA No.1140, No.1145, R8 year-end adjustment;
// https://www.nta.go.jp/users/gensen/nencho/index/shikata.htm
// https://www.nissay.co.jp/keiyaku/oshirase/hokenryokojo/keisan.html
// https://www.city.sapporo.jp/citytax/syurui/shiminzei/kojin_zeigaku.html
// https://www.city.funabashi.lg.jp/kurashi/zei/007/003/p000874.html
(function(root,factory){
 if(typeof module==="object"&&module.exports)module.exports=factory(require("./family-deductions.js"));
 else root.FurusatoInsuranceDeductions=factory(root.FurusatoFamilyDeductions);
}(typeof window!=="undefined"?window:this,function(family){
 const keys=["generalNew","generalOld","medicalNew","pensionNew","pensionOld","earthquake","longTermOld"];
 const exact=(o,k)=>o&&typeof o==="object"&&!Array.isArray(o)&&
  Object.keys(o).length===k.length&&k.every(x=>Object.prototype.hasOwnProperty.call(o,x));
 const hold=reason=>({status:"HOLD",reason,calculation:null,donationLimitYen:null,release:"HOLD"});
 const valid=n=>Number.isSafeInteger(n)&&n>=0&&n<=100000000;
 // All table slopes use exact binary fractions; round each component UP
 // to the whole yen as in the annual deduction declaration.
 function curve(n,a,b,c,offset2,offset4,cap){
  return n<=a?n:n<=b?Math.ceil(n/2+offset2):n<=c?Math.ceil(n/4+offset4):cap;
 }
 const nNew=n=>curve(n,20000,40000,80000,10000,20000,40000);
 const nSpecial=n=>curve(n,30000,60000,120000,15000,30000,60000);
 const nOld=n=>curve(n,25000,50000,100000,12500,25000,50000);
 const rNew=n=>curve(n,12000,32000,56000,6000,14000,28000);
 const rOld=n=>curve(n,15000,40000,70000,7500,17500,35000);
 function choose(newYen,oldYen,combinedCap){
  const combined=Math.min(combinedCap,newYen+oldYen);
  const amount=Math.max(newYen,oldYen,combined);
  return {newYen,oldYen,combinedYen:combined,amountYen:amount,
   method:amount===0?"none":amount===newYen?"new":amount===oldYen?"old":"combined"};
 }
 function calculate(input){
  if(!exact(input,["year","family","premiums","conditions"])||![2025,2026].includes(input.year)||
    input.conditions!=="eligible-net-premiums-and-contract-selection-reviewed"||
    !exact(input.premiums,keys)||!keys.every(k=>valid(input.premiums[k]))||
    !input.family||input.family.year!==input.year||!family)
   return hold("年分・保険料の区分・控除証明書・家族条件を確認してください");
  // Household must be separately reviewed, even if there are no relatives.
  const f=family.calculate(input.family);
  if(f.status!=="COMPONENTS_ONLY")return hold("扶養親族の適用条件を確認してください");
  const p=input.premiums;
  // Under-16 dependants qualify; spouse and special-relative-only claims
  // do not. Do not infer eligibility from the number of dependants.
  const eligible=input.family.relatives.some(m=>m.age<23&&m.income<=f.calculation.incomeThresholdYen);
  const enhanced=input.year===2026&&eligible;
  const nationalGeneral=choose((enhanced?nSpecial:nNew)(p.generalNew),nOld(p.generalOld),enhanced?60000:40000);
  const nationalPension=choose(nNew(p.pensionNew),nOld(p.pensionOld),40000);
  const nationalMedical=nNew(p.medicalNew);
  const residentGeneral=choose(rNew(p.generalNew),rOld(p.generalOld),28000);
  const residentPension=choose(rNew(p.pensionNew),rOld(p.pensionOld),28000);
  const residentMedical=rNew(p.medicalNew);
  const nationalLife=Math.min(120000,nationalGeneral.amountYen+nationalPension.amountYen+nationalMedical);
  const residentLife=Math.min(70000,residentGeneral.amountYen+residentPension.amountYen+residentMedical);
  // Inputs must already exclude the non-selected portion of a dual-use
  // earthquake/old-long-term contract. Never optimize from aggregate
  // amounts when the contract-level eligibility or selection is unknown.
  const nationalEarth=Math.min(50000,p.earthquake);
  const nationalLong=p.longTermOld<=10000?p.longTermOld:Math.min(15000,Math.ceil(p.longTermOld/2+5000));
  const residentEarth=Math.min(25000,Math.ceil(p.earthquake/2));
  const residentLong=p.longTermOld<=5000?p.longTermOld:Math.min(10000,Math.ceil(p.longTermOld/2+2500));
  const nationalEarthTotal=Math.min(50000,nationalEarth+nationalLong);
  const residentEarthTotal=Math.min(25000,residentEarth+residentLong);
  return {status:"COMPONENTS_ONLY",donationLimitYen:null,release:"HOLD",calculation:{
   year:input.year,residentYear:input.year+1,eligibleUnder23:eligible,enhancedGeneral:enhanced,
   national:{general:nationalGeneral,pension:nationalPension,medicalYen:nationalMedical,
    lifeYen:nationalLife,earthquakeOnlyYen:nationalEarth,longTermOldYen:nationalLong,earthquakeYen:nationalEarthTotal,
    totalYen:nationalLife+nationalEarthTotal},
   resident:{general:residentGeneral,pension:residentPension,medicalYen:residentMedical,
    lifeYen:residentLife,earthquakeOnlyYen:residentEarth,longTermOldYen:residentLong,earthquakeYen:residentEarthTotal,
    totalYen:residentLife+residentEarthTotal},
   adjustmentDifferenceYen:0}};
 }
 return Object.freeze({calculate});
}));
