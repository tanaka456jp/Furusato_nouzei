"use strict";
// Annual resident salary-only high-income components; no pension, special
// expense deduction, mortgage or donation estimate. Under-8.5m stays in
// the existing audited salary route. No personal identifiers.
// https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1410.htm
// https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1411.htm
// https://www.nta.go.jp/taxes/shiraberu/taxanswer/gensen/2676.htm
// https://www.nta.go.jp/users/gensen/2026kiso/index.htm
(function(root,factory){
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 else root.FurusatoSalaryAdjustment=api;
}(typeof window!=="undefined"?window:this,function(){
 const exact=(o,keys)=>o&&typeof o==="object"&&!Array.isArray(o)&&
  Object.keys(o).length===keys.length&&keys.every(k=>Object.prototype.hasOwnProperty.call(o,k));
 const amount=(n,max)=>Number.isSafeInteger(n)&&n>=0&&n<=max;
 const hold=reason=>({status:"HOLD",reason,calculation:null,donationLimitYen:null,release:"HOLD"});
 function calculate(input){
  if(!exact(input,["year","grossSalary","selfSpecialDisability","spouse","relatives","conditions"])||
     ![2025,2026].includes(input.year)||!amount(input.grossSalary,20000000)||input.grossSalary<8500000||
     typeof input.selfSpecialDisability!=="boolean"||!Array.isArray(input.relatives)||input.relatives.length>30||
     input.conditions!=="annual-resident-salary-only-adjustment-facts-reviewed")
   return hold("年分・給与収入850万円以上2,000万円以下・居住者・所得金額調整控除の条件を確認してください");
  const member=m=>amount(m.income,100000000)&&typeof m.specialDisability==="boolean"&&m.relationshipReviewed===true;
  if(input.spouse!==null&&(!exact(input.spouse,["income","specialDisability","relationshipReviewed"])||!member(input.spouse)))
   return hold("同一生計配偶者の所得・特別障害者区分を確認してください");
  for(const m of input.relatives){
   if(!exact(m,["age","income","specialDisability","relationshipReviewed"])||!member(m)||!amount(m.age,130))
    return hold("扶養親族の年齢・所得・生計同一・特別障害者区分を確認してください");
  }
  const threshold=input.year===2025?580000:620000;
  const qualifyingUnder23=input.relatives.some(m=>m.age<23&&m.income<=threshold);
  const qualifyingSpecialRelative=input.relatives.some(m=>m.specialDisability&&m.income<=threshold);
  const qualifyingSpecialSpouse=input.spouse!==null&&input.spouse.specialDisability&&input.spouse.income<=threshold;
  // These witnesses are independent of who claims the family deduction:
  // spouses can both qualify, but overlapping eligibility does not stack.
  const eligible=input.grossSalary>8500000&&(input.selfSpecialDisability||qualifyingUnder23||
   qualifyingSpecialRelative||qualifyingSpecialSpouse);
  const salaryDeductionYen=1950000;
  const before=input.grossSalary-salaryDeductionYen;
  const adjustment=eligible?Math.ceil((Math.min(10000000,input.grossSalary)-8500000)/10):0;
  return {status:"COMPONENTS_ONLY",donationLimitYen:null,release:"HOLD",calculation:{
   year:input.year,residentYear:input.year+1,grossSalaryYen:input.grossSalary,
   salaryDeductionYen,salaryIncomeBeforeAdjustmentYen:before,
   salaryAdjustmentYen:adjustment,salaryIncomeAfterAdjustmentYen:before-adjustment,
   dependentIncomeThresholdYen:threshold,eligible,qualifyingSelf:input.selfSpecialDisability,
   qualifyingUnder23,qualifyingSpecialRelative,qualifyingSpecialSpouse}};
 }
 // Shared validation for tax and source-year reconciliation. The salary
 // adjustment witnesses may include a child claimed by another spouse.
 function reconcileClaims(adj,tax){
  const result=calculate(adj);
  if(result.status!=="COMPONENTS_ONLY")return result;
  if(!tax||typeof tax!=="object")return hold("扶養親族の確認が必要です");
  const d=tax.otherDeductions?.disability;
  const special=k=>k==="special"||k==="cohabitingSpecial";
  if(!d||!Array.isArray(d.relatives)||!Array.isArray(tax.relatives)||
     d.relatives.length!==tax.relatives.length||adj.selfSpecialDisability!==(d.self==="special"))
   return hold("本人・扶養親族の特別障害者区分が一致しません");
  if((tax.spouse===null)!==(adj.spouse===null)||
     (tax.spouse!==null&&(!tax.spouse||tax.spouse.income!==adj.spouse.income||
       special(d.spouse)!==adj.spouse.specialDisability)))
   return hold("同一生計配偶者の所得・障害区分が一致しません");
  // Claimed relatives must match distinct reviewed witnesses; witnesses not
  // claimed here may be claimed by the other spouse for family deductions.
  const available=adj.relatives.slice();
  for(let i=0;i<tax.relatives.length;i++){
   const member=tax.relatives[i];
   if(!member)return hold("扶養親族の確認が必要です");
   const j=available.findIndex(x=>x.age===member.age&&x.income===member.income&&
      x.specialDisability===special(d.relatives[i]));
   if(j<0)return hold("扶養親族と所得金額調整控除の確認明細が一致しません");
   available.splice(j,1);
  }
  return result;
 }
 return Object.freeze({calculate,reconcileClaims});
}));
