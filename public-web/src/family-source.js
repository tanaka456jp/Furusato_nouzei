"use strict";
// Source-year reconciliation only. No inference from current-year household,
// no tax credits, no personal identifiers, no network or storage.
(function(root,factory){
 if(typeof module==="object"&&module.exports)module.exports=factory(require("./family-deductions.js"));
 else root.FurusatoFamilySource=factory(root.FurusatoFamilyDeductions);
}(typeof window!=="undefined"?window:this,function(family){
 const amount=(n,max)=>Number.isSafeInteger(n)&&n>=0&&n<=max;
 const hold=reason=>({status:"HOLD",reason,calculation:null});
 function reconcile(input,salaryEngine){
  const keys=["year","gross","salaryIncome","social","deductions","indicators","spouse","relatives","reviewed"];
  if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).length!==keys.length||
     !keys.every(k=>Object.prototype.hasOwnProperty.call(input,k))||
     ![2025,2026].includes(input.year)||!amount(input.gross,8500000)||input.gross===0||
     !amount(input.salaryIncome,6550000)||!amount(input.social,input.gross)||
     !amount(input.deductions,100000000)||input.reviewed!==true||
     !input.indicators||typeof input.indicators!=="object"||Array.isArray(input.indicators)||
     Object.entries(input.indicators).some(([k,v])=>!["hasSpouse","hasDependents"].includes(k)||v!==true)||
     !salaryEngine||typeof salaryEngine.salaryIncome!=="function"||
     typeof salaryEngine.statutoryRows!=="function"||!family)
   return hold("原票年分・4金額・家族明細・その他控除の確認が必要です");
  const salary=salaryEngine.salaryIncome(input.gross,input.year);
  if(salary!==input.salaryIncome)return hold("原票の給与所得控除後の金額が一致しません");
  const basicRow=salaryEngine.statutoryRows().find(row=>row[0]===input.year&&salary<=row[1]);
  if(!basicRow||!amount(basicRow[2],1040000))return hold("原票年分の基礎控除を確認できません");
  const f=family.calculate({year:input.year,taxpayerIncome:salary,spouse:input.spouse,
    relatives:input.relatives,conditions:"annual-resident-family-reviewed"});
  if(f.status!=="COMPONENTS_ONLY")return hold(f.reason);
  const c=f.calculation;
  if(input.indicators.hasSpouse&&!c.items.some(x=>["spouse","elderly-spouse","spouse-special"].includes(x.kind)))
   return hold("原票の配偶者控除の検出結果と明細が一致しません");
  if(input.indicators.hasDependents&&!c.items.some(x=>x.kind==="relative-special"||x.kind==="under16"||x.kind.startsWith("dependent-")))
   return hold("原票の扶養・特定親族の検出結果と明細が一致しません");
  const total=basicRow[2]+input.social+c.nationalFamilyDeductionYen;
  if(total!==input.deductions)return hold("原票年分の所得控除合計が一致しません。未対応控除の可能性があります");
  return {status:"RECONCILED",calculation:{year:input.year,salaryIncomeYen:salary,basicYen:basicRow[2],
    familyYen:c.nationalFamilyDeductionYen,deductionsYen:total}};
 }
 return Object.freeze({reconcile});
}));
