"use strict";
/**
 * WEB-only family deduction components, annual 2025/2026 law.
 * No donation ceiling, no automatic eligibility inference or UI integration.
 * Inputs are TOTAL INCOME, not gross wages. Annual year-end assessment
 * only, not pre-effective-date death/departure returns. Resident family
 * members only; all non-income eligibility conditions and no duplicate
 * claims must be explicitly verified by the caller.
 * NTA No.1177, 1180, 1191, 1195; 2026 annual reform:
 * https://www.nta.go.jp/users/gensen/2026kiso/index.htm
 * https://www.city.nagano.nagano.jp/n062000/contents/p005573.html
 * https://www.city.nagano.nagano.jp/n062000/contents/p005567.html
 * https://www.nishi.or.jp/kurashi/shizei/kojinshiminzei/kisotishiki/juminshotoku-sa.html
 * https://www.city.fukuyama.hiroshima.jp/soshiki/shiminzei/2181.html
 */
(function(root,factory){
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 else root.FurusatoFamilyDeductions=api;
}(typeof window!=="undefined"?window:this,function(){
 const integer=(x,max)=>Number.isSafeInteger(x)&&x>=0&&x<=max;
 const exact=(o,keys)=>o&&typeof o==="object"&&!Array.isArray(o)&&
  Object.keys(o).length===keys.length&&keys.every(k=>Object.prototype.hasOwnProperty.call(o,k));
 const hold=reason=>({status:"HOLD",reason,calculation:null,donationLimitYen:null});
 const ordinary=[[38,33,5],[26,22,4],[13,11,2]];
 const elderly=[[48,38,10],[32,26,6],[16,13,3]];
 // Income upper bounds in yen; deduction amounts in ten-thousands.
 const spouseSpecial=[
  [950000,[38,26,13],[33,22,11]],
  [1000000,[36,24,12],[33,22,11]],
  [1050000,[31,21,11],[31,21,11]],
  [1100000,[26,18,9],[26,18,9]],
  [1150000,[21,14,7],[21,14,7]],
  [1200000,[16,11,6],[16,11,6]],
  [1250000,[11,8,4],[11,8,4]],
  [1300000,[6,4,2],[6,4,2]],
  [1330000,[3,2,1],[3,2,1]]
 ];
 const relativeSpecial=[
  [850000,63,45],[900000,61,45],[950000,51,45],
  [1000000,41,41],[1050000,31,31],[1100000,21,21],
  [1150000,11,11],[1200000,6,6],[1230000,3,3]
 ];
 function item(kind,values,familyCount){
  return {kind,nationalYen:values[0]*10000,residentYen:values[1]*10000,
   adjustmentDifferenceYen:values[2]*10000,familyCount};
 }
 function calculate(input){
  if(!exact(input,["year","taxpayerIncome","spouse","relatives","conditions"])||
     ![2025,2026].includes(input.year)||!integer(input.taxpayerIncome,25000000)||
     input.conditions!=="annual-resident-family-reviewed"||
     !Array.isArray(input.relatives)||input.relatives.length>30)
   return hold("年分・本人合計所得・家族の適用条件を確認してください");
  const threshold=input.year===2025?580000:620000;
  const spouse=input.spouse,items=[];
  const memberValid=m=>integer(m.age,130)&&integer(m.income,100000000)&&m.eligibilityReviewed===true;
  if(spouse!==null){
   if(!exact(spouse,["age","income","eligibilityReviewed"])||!memberValid(spouse)||spouse.age<18)
    return hold("配偶者の年齢・合計所得・適用条件が未確認です");
   const band=input.taxpayerIncome<=9000000?0:input.taxpayerIncome<=9500000?1:input.taxpayerIncome<=10000000?2:-1;
   if(spouse.income<=threshold){
    items.push(item(band<0?"same-livelihood-spouse-no-deduction":spouse.age>=70?"elderly-spouse":"spouse",
      band<0?[0,0,0]:(spouse.age>=70?elderly:ordinary)[band],1));
   }else if(band>=0&&spouse.income<=1330000){
    const row=spouseSpecial.find(r=>spouse.income<=r[0]);
    // Since 2026 resident assessment, this deduction has NO statutory
    // adjustment difference, even where the actual deductions differ.
    items.push(item("spouse-special",[row[1][band],row[2][band],0],0));
   }else items.push(item("spouse-outside-income-limit",[0,0,0],0));
  }
  for(const m of input.relatives){
   if(!exact(m,["age","income","eligibilityReviewed","cohabitingDirectAscendant"])||
      !memberValid(m)||typeof m.cohabitingDirectAscendant!=="boolean"||
      (m.cohabitingDirectAscendant&&m.age<70))
    return hold("扶養親族の年齢・合計所得・同居老親等の条件が未確認です");
   if(m.income<=threshold){
    if(m.age<16)items.push(item("under16",[0,0,0],1));
    else if(m.age>=19&&m.age<23)items.push(item("dependent-special",[63,45,18],1));
    else if(m.age>=70)items.push(item(m.cohabitingDirectAscendant?"dependent-cohabiting-elderly":"dependent-elderly",
     m.cohabitingDirectAscendant?[58,45,13]:[48,38,10],1));
    else items.push(item("dependent-general",[38,33,5],1));
   }else if(m.age>=19&&m.age<23&&m.income<=1230000){
    const row=relativeSpecial.find(r=>m.income<=r[0]);
    // Special relatives are not dependants for the ordinary exemption count.
    items.push(item("relative-special",[row[1],row[2],0],0));
   }else items.push(item("relative-outside-income-limit",[0,0,0],0));
  }
  const sum=key=>items.reduce((a,b)=>a+b[key],0);
  const familyCount=sum("familyCount");
  const exemption=familyCount===0?450000:350000*(familyCount+1)+420000;
  return {status:"COMPONENTS_ONLY",calculation:{year:input.year,residentYear:input.year+1,
   incomeThresholdYen:threshold,items,nationalFamilyDeductionYen:sum("nationalYen"),
   residentFamilyDeductionYen:sum("residentYen"),
   familyAdjustmentDifferenceYen:sum("adjustmentDifferenceYen"),
   familyCount,ordinaryResidentIncomeLevyExemptionLimitYen:exemption,
   ordinaryResidentIncomeLevyExempt:input.taxpayerIncome<=exemption},
   donationLimitYen:null,release:"HOLD"};
 }
 return Object.freeze({calculate});
}));
