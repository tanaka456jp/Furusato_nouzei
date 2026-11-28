"use strict";
// Annual salary-only medical deduction components, not a donation estimate.
// https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1120.htm
// https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1129.htm
// https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1131.htm
// https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1155.htm
// Groups are independently reviewed, disjoint compensation purposes,
// NOT aggregate payments minus all insurance receipts. No identifiers.
(function(root,factory){
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 else root.FurusatoMedicalDeductions=api;
}(typeof window!=="undefined"?window:this,function(){
 const exact=(o,keys)=>o&&typeof o==="object"&&!Array.isArray(o)&&
  Object.keys(o).length===keys.length&&keys.every(k=>Object.prototype.hasOwnProperty.call(o,k));
 const valid=(n,max)=>Number.isSafeInteger(n)&&n>=0&&n<=max;
 const hold=reason=>({status:"HOLD",reason,calculation:null,donationLimitYen:null,release:"HOLD"});
 function calculate(input){
  const self=input?.method==="selfMedication";
  const keys=["year","salaryIncome","method","groups","conditions"];
  if(self)keys.push("healthMeasureReviewed");
  if(!exact(input,keys)||![2025,2026].includes(input.year)||!valid(input.salaryIncome,18050000)||
     !["ordinary","selfMedication"].includes(input.method)||
     input.conditions!=="annual-salary-only-eligible-paid-expenses-compensation-reviewed"||
     !Array.isArray(input.groups)||input.groups.length>1000||
     (self&&input.healthMeasureReviewed!==true))
   return hold("対象年・医療費控除の選択・対象費用・補填金・適用条件を確認してください");
  let paid=0,received=0,applied=0;
  for(const group of input.groups){
   if(!exact(group,["paidYen","reimbursedYen","eligibilityReviewed"])||
      !valid(group.paidYen,100000000)||!valid(group.reimbursedYen,100000000)||
      group.eligibilityReviewed!==true)
    return hold("支払年・対象費用・補填対象の対応を確認してください");
   paid+=group.paidYen;received+=group.reimbursedYen;
   applied+=Math.min(group.paidYen,group.reimbursedYen);
  }
  // Fractional-yen 5% thresholds remain HOLD pending an exact rounding audit.
  if(!self&&input.salaryIncome<2000000&&input.salaryIncome%20!==0)
   return hold("医療費控除の5%足切額の1円未満端数は個別確認してください");
  const threshold=self?12000:Math.min(100000,input.salaryIncome/20);
  const cap=self?88000:2000000;
  const net=paid-applied;
  const deduction=Math.min(cap,Math.max(0,net-threshold));
  return {status:"COMPONENTS_ONLY",donationLimitYen:null,release:"HOLD",calculation:{
   year:input.year,residentYear:input.year+1,method:input.method,paidYen:paid,
   reimbursementReceivedYen:received,reimbursementAppliedYen:applied,
   excessReimbursementIgnoredYen:received-applied,netEligibleYen:net,
   thresholdYen:threshold,capYen:cap,nationalDeductionYen:deduction,
   residentDeductionYen:deduction,adjustmentDifferenceYen:0,
   requiresFilingToClaim:true,oneStopAllowedWhenClaimed:false}};
 }
 // The UI receives a single already-net amount, never gross medical expenses.
 // NTA No.1120; Toyonaka individual resident tax deduction guidance:
 // https://www.city.toyonaka.osaka.jp/kurashi/sizei/kojin/gimusyatokeisan/syotokukoujyo.html
 // Round the resulting positive deduction up to yen (equivalently floor 5%).
 function calculateNet(input){
  if(!exact(input,["year","salaryIncome","netEligibleYen"])||
     ![2025,2026].includes(input.year)||!valid(input.salaryIncome,18050000)||
     !valid(input.netEligibleYen,100000000000))
   return hold("補填後の対象医療費支払額と合計所得金額を確認してください");
  // Use exact twentieths of a yen, not floating 5% arithmetic. The
  // positive deduction is rounded UP; display the equivalent whole-yen
  // threshold. For integer other deductions, flooring the exact taxable
  // income to 1,000 yen gives the same result as rounding the deduction up.
  // The grouped research path retains its independent fractional HOLD.
  const threshold20=Math.min(2000000,input.salaryIncome);
  const threshold=Math.floor(threshold20/20);
  const positive20=Math.max(0,input.netEligibleYen*20-threshold20);
  const deduction=Math.min(2000000,Math.floor((positive20+19)/20));
  return {status:"COMPONENTS_ONLY",donationLimitYen:null,release:"HOLD",calculation:{
   method:"ordinaryNet",netEligibleYen:input.netEligibleYen,thresholdYen:threshold,
   nationalDeductionYen:deduction,residentDeductionYen:deduction,
   requiresFilingToClaim:deduction>0,oneStopAllowedWhenClaimed:false}};
 }
 return Object.freeze({calculate,calculateNet});
}));
