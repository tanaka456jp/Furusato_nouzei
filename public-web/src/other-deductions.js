"use strict";
// Annual 2025/2026 salary-only other deduction components. No donation
// estimate; no source-slip automatic approval. Family facts and eligibility
// (relationship, actual cohabitation, disability classification, schooling,
// marital status and no overlapping claims) must be independently reviewed.
// https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1160.htm
// https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1170.htm
// https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1171.htm
// https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1175.htm
// https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1135.htm
// https://www.nta.go.jp/users/gensen/2026kiso/index.htm
// https://www.city.kasugai.lg.jp/kurashi/zei/zei/shiminzei2/syotokusyouryaku/154119kojin.html
// https://www.city.kashiwa.lg.jp/shiminzei/kojinshiminzei/r8hikazei.html
(function(root,factory){
 if(typeof module==="object"&&module.exports)module.exports=factory(require("./family-deductions.js"));
 else root.FurusatoOtherDeductions=factory(root.FurusatoFamilyDeductions);
}(typeof window!=="undefined"?window:this,function(family){
 const exact=(o,keys)=>o&&typeof o==="object"&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.prototype.hasOwnProperty.call(o,k));
 const integer=(n,max)=>Number.isSafeInteger(n)&&n>=0&&n<=max;
 const hold=reason=>({status:"HOLD",reason,calculation:null,donationLimitYen:null,release:"HOLD"});
 const disabilityTable=Object.freeze({none:[0,0,0],ordinary:[270000,260000,10000],
  special:[400000,300000,100000],cohabitingSpecial:[750000,530000,220000]});
 const selfKinds=["none","ordinary","special"],memberKinds=[...selfKinds,"cohabitingSpecial"];
 const reliefTable=Object.freeze({none:[0,0,0],widowDivorced:[270000,260000,10000],
  widowBereaved:[270000,260000,10000],singleParentFather:[350000,300000,10000],
  singleParentMother:[350000,300000,50000]});
 const reliefKinds=Object.keys(reliefTable);
 function item(kind,tuple){return {kind,nationalYen:tuple[0],residentYen:tuple[1],adjustmentDifferenceYen:tuple[2]};}
 function calculate(input){
  if(!exact(input,["family","disability","maritalRelief","childIndex","workingStudent",
    "smallEnterpriseContributions","conditions"])||
     input.conditions!=="salary-only-adult-other-deductions-reviewed"||
     !family||!input.family||
     !integer(input.family.taxpayerIncome,8050000)||
     !integer(input.smallEnterpriseContributions,100000000)||
     typeof input.workingStudent!=="boolean"||
     !reliefKinds.includes(input.maritalRelief))
   return hold("本人所得・年分・その他所得控除の適用条件を確認してください");
  const f=family.calculate(input.family);
  if(f.status!=="COMPONENTS_ONLY")return hold(f.reason);
  const c=f.calculation,year=c.year,income=input.family.taxpayerIncome,d=input.disability;
  if(!exact(d,["self","spouse","relatives"])||!selfKinds.includes(d.self)||!memberKinds.includes(d.spouse)||
    !Array.isArray(d.relatives)||d.relatives.length!==input.family.relatives.length)
   return hold("本人・配偶者・扶養親族の障害区分を個別に確認してください");
  const threshold=c.incomeThresholdYen;
  if(d.spouse!=="none"&&(!input.family.spouse||input.family.spouse.income>threshold))
   return hold("障害者控除の配偶者は同一生計配偶者の所得要件を満たす必要があります");
  const disabilityItems=[item("self:"+d.self,disabilityTable[d.self]),item("spouse:"+d.spouse,disabilityTable[d.spouse])];
  for(let i=0;i<d.relatives.length;i++){
   const kind=d.relatives[i],member=input.family.relatives[i];
   if(!memberKinds.includes(kind)||(kind!=="none"&&member.income>threshold))
    return hold("障害者控除の扶養親族の所得要件・区分を確認してください");
   disabilityItems.push(item("relative:"+i+":"+kind,disabilityTable[kind]));
  }
  const marital=input.maritalRelief,single=marital==="singleParentFather"||marital==="singleParentMother";
  // A reviewed child index identifies a real child, not any young relative.
  // This restricted model excludes marital/spouse overlaps, missing-spouse
  // exceptions and cases where total income differs from aggregate income.
  if(marital!=="none"&&(income>5000000||input.family.spouse!==null))
   return hold("寡婦・ひとり親の本人所得または婚姻条件を確認してください");
  if(single){
   if(!integer(input.childIndex,input.family.relatives.length-1)||
      input.family.relatives[input.childIndex].income>threshold)
    return hold("ひとり親の生計同一の子・所得要件を確認してください");
  }else if(input.childIndex!==null)return hold("子の指定はひとり親控除の場合のみ可能です");
  if(marital==="widowDivorced"&&!input.family.relatives.some(m=>m.income<=threshold))
   return hold("離婚後の寡婦控除には扶養親族が必要です");
  const studentThreshold=year===2025?850000:890000;
  if(input.workingStudent&&(income===0||income>studentThreshold))
   return hold("勤労学生控除の本人所得要件を確認してください");
  const maritalItem=item(marital,reliefTable[marital]);
  const studentItem=item("workingStudent",input.workingStudent?[270000,260000,10000]:[0,0,0]);
  // Only actual deductible contributions, separately classified from social
  // insurance. The source slip's G26 may include both: never double count.
  const contributionsItem=item("smallEnterpriseContributions",[input.smallEnterpriseContributions,input.smallEnterpriseContributions,0]);
  const items=[...disabilityItems,maritalItem,studentItem,contributionsItem];
  const sum=key=>items.reduce((a,b)=>a+b[key],0);
  const specialExemptionApplicable=d.self!=="none"||marital!=="none";
  const specialExemptionLimit=1350000;
  const specialExempt=specialExemptionApplicable&&income<=specialExemptionLimit;
  return {status:"COMPONENTS_ONLY",release:"HOLD",donationLimitYen:null,calculation:{
   year,residentYear:year+1,studentIncomeThresholdYen:studentThreshold,childIncomeThresholdYen:threshold,
   disabilityItems,marital:maritalItem,student:studentItem,contributions:contributionsItem,
   nationalOtherDeductionYen:sum("nationalYen"),residentOtherDeductionYen:sum("residentYen"),
   adjustmentDifferenceYen:sum("adjustmentDifferenceYen"),
   specialResidentExemptionApplicable:specialExemptionApplicable,specialResidentExemptionLimitYen:specialExemptionLimit,
   specialResidentExempt:specialExempt,ordinaryResidentIncomeLevyExempt:c.ordinaryResidentIncomeLevyExempt,
   residentIncomeLevyExempt:specialExempt||c.ordinaryResidentIncomeLevyExempt}};
 }
 return Object.freeze({calculate});
}));
