"use strict";
/**
 * Independent, hand-tabulated one-stop donation examples: only synthetic
 * salary/social amounts. Expected yen values were derived separately from:
 * NTA No.1199 (2025/2026 basic), No.1410 (salary), No.1155 (donations),
 * and Otsu City's published resident-special-credit rate table (2026).
 * These examples do NOT certify all municipality/return/credit cases.
 */
const assert=require("node:assert/strict");
const fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const script=fs.readFileSync(path.resolve(__dirname,"../../gas/Engine.gs"),"utf8");
const context={module:{exports:{}}};
vm.runInNewContext(script,context,{timeout:3000,filename:"Engine.gs"});
const engine=context.FurusatoEngine;
assert.ok(engine&&typeof engine.calculate==="function");
// year, gross, social, salary income, income-tax basic,
// income-tax taxable, resident-income levy, one-stop ceiling.
// All cases assume one salary, no relatives, insurance, mortgages or
// other deductions; no truth figures originate from a person's document.
const cases=[
 [2025,3000000,450000,2020000, 880000, 690000,111500, 28000],
 [2026,3000000,450000,2020000,1040000, 530000,111500, 28000],
 [2025,5000000,750000,3560000, 680000,2130000,235500, 61000],
 [2026,5000000,750000,3560000,1040000,1770000,235500, 57000],
 [2025,7000000,1000000,5200000,630000,3570000,374500,109000],
 [2026,7000000,1000000,5200000,670000,3530000,374500,109000],
 [2025,8500000,1200000,6550000,630000,4720000,489500,142000],
 [2026,8500000,1200000,6550000,670000,4680000,489500,142000],
 [2025,2200000,350000,1460000,880000, 230000, 65500, 17000],
 [2026,2200000,350000,1460000,1040000, 70000, 65500, 17000]
];
for(const [year,gross,social,income,basic,taxable,levy,limit] of cases){
 const args={year,incomeType:"salary",filing:"one-stop",
  salaryGross:gross,socialInsurance:social,
  acknowledgedExclusions:true};
 const out=engine.calculate(args);
 const tag=year+" gross="+gross+" social="+social;
 assert.equal(out.status,"ESTIMATE",tag+" "+out.reasons?.join("/"));
 assert.equal(out.year,year,tag);
 assert.equal(out.residentYear,year+1,tag);
 assert.equal(out.calculation.salaryIncomeYen,income,tag);
 assert.equal(out.calculation.basicIncomeTaxDeductionYen,basic,tag);
 assert.equal(out.calculation.incomeTaxTaxableYen,taxable,tag);
 assert.equal(out.calculation.residentIncomeLevyYen,levy,tag);
 assert.equal(out.donationLimitYen,limit,tag);
 assert.equal(out.calculation.donationLimitYen,limit,tag);
 for(const unsupported of ["hasDependents","hasMortgage","hasLifeInsurance"]){
  const held=engine.calculate({...args,[unsupported]:true});
  assert.equal(held.status,"HOLD",tag+" "+unsupported);
  assert.equal(held.donationLimitYen,null,tag+" "+unsupported);
 }
}
// Unverified source amounts, income year, and no confirmation cannot be
// promoted to a ceiling just because an expected example is valid.
for(const args of [
 {year:2026,sourceYear:2025},
 {year:2026,acknowledgedExclusions:false},
 {year:2026,sourceReviewPending:true},
 {year:2026,deductionsReference:999999}
]){
 const value=engine.calculate({incomeType:"salary",filing:"one-stop",
  salaryGross:5000000,socialInsurance:750000,
  acknowledgedExclusions:true,...args});
 assert.equal(value.status,"HOLD");
 assert.equal(value.donationLimitYen,null);
}
console.log("PUBLIC_2025_2026_INDEPENDENT_ONE_STOP_DONATION_FIXTURES_SYNTHETIC_PASS; release HOLD");
