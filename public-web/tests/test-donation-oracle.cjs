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
// The SHARED private GAS engine still rejects mismatched source years,
// even if a Web-only UI has gathered a prior-year review flag. Only the
// Web adapter may map 2025 reference evidence onto 2026 target-law math.
const strictInput={
 year:2026,sourceYear:2025,forecastReviewed:true,
 incomeType:"salary",filing:"one-stop",
 salaryGross:5000000,socialInsurance:750000,
 salaryIncomeReference:3560000,deductionsReference:1790000,
 acknowledgedExclusions:true
};
for(const input of [
 strictInput,{...strictInput,forecastReviewed:false},
 {...strictInput,sourceYear:2024},
 {...strictInput,sourceYear:2027},
 {...strictInput,deductionsReference:1430000},
 {...strictInput,hasMortgage:true},
 {...strictInput,forecastReviewed:"true"}
]){
 const out=engine.calculate(input);
 assert.equal(out.status,"HOLD");
 assert.equal(out.donationLimitYen,null);
}
console.log("PUBLIC_2025_2026_INDEPENDENT_ONE_STOP_DONATION_FIXTURES_SYNTHETIC_PASS; release HOLD");

 
// Fresh WEB comparison against the *actual* Excel v4.18.36 COM observations,
// not the earlier pinned GAS results. Synthetic inputs and numeric outputs only.
// Excel HEAD 0ec8b7388d6e95a6d9aefd54bcb61a4f40ad25a6
// Actions run 45285773301, job 138082615703, final 44/44 sequence:
// https://github.com/tanaka456jp/Furusato_nouzei/actions/runs/45285773301/job/138082615703
// All 41 rows were xlDone; the 7m -> 5m -> 7m control restored its values.
// Inputs are from gas/parity/cases.cjs at 347aae5756b90c05a10b2ffe6123b0ce09e3fc01,
// verified byte-identical at WEB HEAD ced2bc1c878781d69047b5f5661ee8eab7b03701.
// year, gross, social, salary income, pooled levy, assessed standard-city levy,
// 1000-yen one-stop ceiling. Pooled levy is NOT the assessed municipal levy.
const excelObserved=[
 [2025,1899999,100000,1249999,69400,69300,18000],
 [2025,1900000,100000,1250000,69500,69500,18000],
 [2025,1900001,100000,1250000,69500,69500,18000],
 [2025,2200000,100000,1460000,90500,90500,23000],
 [2025,2500000,100000,1670000,111500,111500,28000],
 [2025,3299999,1000000,2227200,77200,77100,20000],
 [2025,3300000,1000000,2230000,77500,77500,20000],
 [2025,3599999,1000000,2437200,98200,98100,25000],
 [2025,3600000,1000000,2440000,98500,98500,25000],
 [2025,4899999,1000000,3476800,202100,202000,49000],
 [2025,4900000,1000000,3480000,202500,202500,49000],
 [2025,5000000,1000000,3560000,210500,210500,51000],
 [2025,5812500,1000000,4209600,275400,275300,71000],
 [2025,6599999,1000000,4836800,338100,338000,86000],
 [2025,6600000,1000000,4840000,338500,338500,86000],
 [2025,7000000,1000000,5200000,374500,374500,109000],
 [2025,8000000,1000000,6100000,464500,464500,135000],
 [2025,8500000,1000000,6550000,509500,509500,148000],
 [2026,2190999,100000,1450999,89500,89500,23000],
 [2026,2191000,100000,1451000,89600,89500,23000],
 [2026,2192999,100000,1451000,89600,89500,23000],
 [2026,2193000,100000,1453000,89800,89700,23000],
 [2026,2195999,100000,1453000,89800,89700,23000],
 [2026,2196000,100000,1456000,90100,90000,23000],
 [2026,2199999,100000,1456000,90100,90000,23000],
 [2026,2200000,100000,1460000,90500,90500,23000],
 [2026,2200001,100000,1460000,90500,90500,23000],
 [2026,2500000,100000,1670000,111500,111500,28000],
 [2026,3299999,1000000,2227200,77200,77100,20000],
 [2026,3300000,1000000,2230000,77500,77500,20000],
 [2026,3599999,1000000,2437200,98200,98100,25000],
 [2026,3600000,1000000,2440000,98500,98500,25000],
 [2026,4899999,1000000,3476800,202100,202000,49000],
 [2026,4900000,1000000,3480000,202500,202500,49000],
 [2026,5000000,1000000,3560000,210500,210500,51000],
 [2026,5812500,1000000,4209600,275400,275300,71000],
 [2026,6599999,1000000,4836800,338100,338000,86000],
 [2026,6600000,1000000,4840000,338500,338500,86000],
 [2026,7000000,1000000,5200000,374500,374500,109000],
 [2026,8000000,1000000,6100000,464500,464500,135000],
 [2026,8500000,1000000,6550000,509500,509500,148000]
];
const currentCases=require("../../gas/parity/cases.cjs");
assert.equal(excelObserved.length,41);
assert.equal(currentCases.length,41);
// Test the exact browser-distributed script, not the historical pinned engine.
// The build runs before this test in public-web-review.yml.
const browserEnginePath=path.resolve(__dirname,"../dist/engine.js");
const builtScript=fs.readFileSync(browserEnginePath,"utf8");
assert.equal(builtScript,script,"browser engine differs from current source");
const browserContext={};
vm.runInNewContext(builtScript,browserContext,{timeout:3000,filename:"dist/engine.js"});
const webEngine=browserContext.FurusatoEngine;
const differences=[];
let pooledMatches=0,assessedMatches=0,limitMatches=0,incomeMatches=0;
for(const [i,row] of excelObserved.entries()){
 const [year,gross,social,income,pooled,assessed,limit]=row;
 const c=currentCases[i];
 assert.equal(c.id,"Y"+year+"_G"+gross);
 assert.equal(c.year,year);assert.equal(c.salaryGross,gross);
 assert.equal(c.socialInsurance,social);assert.equal(c.filing,"one-stop");
 assert.ok(pooled-assessed===0||pooled-assessed===100);
 const actual=webEngine.calculate({year,incomeType:"salary",filing:c.filing,
   salaryGross:gross,socialInsurance:social,acknowledgedExclusions:true});
 if(actual.status!=="ESTIMATE"||!actual.calculation){
   differences.push({id:c.id,status:actual.status,reasons:actual.reasons});
   continue;
 }
 const calc=actual.calculation;
 const checks=[["salaryIncome",calc.salaryIncomeYen,income],
  ["pooledLevy",calc.residentIncomeLevyYen,pooled],
  ["oneStop1000",actual.donationLimitYen,limit]];
 for(const [field,observed,expected] of checks)
   if(observed!==expected)differences.push({id:c.id,field,observed,expected});
 if(calc.salaryIncomeYen===income)incomeMatches++;
 if(calc.residentIncomeLevyYen===pooled)pooledMatches++;
 if(calc.residentIncomeLevyYen===assessed)assessedMatches++;
 if(actual.donationLimitYen===limit)limitMatches++;
}
console.log(JSON.stringify({schema:"web-excel-v41836-pooled-parity/v1",
 excelRun:45285773301,excelJob:138082615703,checked:41,
 incomeMatches,pooledMatches,assessedMatches,limitMatches,differences,
 municipalityParityCertified:false,filingParityCertified:false,release:"HOLD"}));
assert.deepEqual(differences,[],"current browser engine differs from real Excel observations");
assert.equal(assessedMatches,24,"municipal rounding gap changed; review separate assessed-levy test");
// Do not treat agreement in this limited sample as approval of other deductions,
// exact 1-yen ceilings, municipal rounding, or physical device acceptance.


// WEB-only municipality calculation: test actual Excel assessed amounts,
// not the old combined levy. Independent rational/integer test expression
// is also applied to designated-city cases (not Excel COM evidence).
const local=require("../src/resident-levy.js");
const localArgs={year:2026,salaryIncome:5200000,socialInsurance:1000000,
 municipality:"standard",conditions:"basic-only-reviewed"};
let standardMatches=0,designatedOracleMatches=0;
for(const [year,gross,social,income,pooled,assessed] of excelObserved){
 const args={...localArgs,year,salaryIncome:income,socialInsurance:social};
 const standard=local.calculate(args);
 assert.equal(standard.status,"ESTIMATE");
 assert.equal(standard.calculation.residentIncomeLevyYen,assessed,"Excel assessed standard city: "+year+"/"+gross);
 assert.equal(standard.calculation.pooledComparisonYen,pooled);
 assert.equal(standard.donationLimitYen,null);
 standardMatches++;
 const designated=local.calculate({...args,municipality:"designated"});
 assert.equal(designated.status,"ESTIMATE");
 const taxable=Math.trunc((income-social-430000)/1000)*1000;
 // All Excel comparison cases exceed 50,000 of local taxable income.
 assert.ok(taxable>=50000);
 const before=(taxable/10)-2500;
 const city=Math.floor(before*4/500)*100;
 const prefecture=Math.floor(before/500)*100;
 assert.equal(designated.calculation.city.assessedYen,city);
 assert.equal(designated.calculation.prefecture.assessedYen,prefecture);
 assert.equal(designated.calculation.residentIncomeLevyYen,city+prefecture);
 designatedOracleMatches++;
}
for(const year of [2025,2026]){
 for(const [municipality,expectedCity,expectedPref,expectedAdjustment] of [
  ["standard",1400,900,2350],["designated",1800,400,2350]
 ]){
  const out=local.calculate({...localArgs,year,municipality,socialInsurance:4723000});
  assert.equal(out.status,"ESTIMATE");
  assert.equal(out.calculation.residentTaxableYen,47000);
  assert.equal(out.calculation.residentAdjustmentYen,expectedAdjustment);
  assert.equal(out.calculation.city.assessedYen,expectedCity);
  assert.equal(out.calculation.prefecture.assessedYen,expectedPref);
  assert.equal(out.calculation.referenceSpecialCapYen,(expectedCity+expectedPref)/5);
 }
 // 100-yen separation boundary from the Excel tax scope.
 const out=local.calculate({...localArgs,year,socialInsurance:999000});
 assert.equal(out.calculation.pooledComparisonYen,374600);
 assert.equal(out.calculation.residentIncomeLevyYen,374500);
}
for(const changed of [{municipality:""},{municipality:"unknown"},{municipality:"toString"},
 {conditions:""},{conditions:true},{year:2024},{year:"2026"},{salaryIncome:450000},
 {salaryIncome:6550001},{socialInsurance:-1},{socialInsurance:1.5},
 {socialInsurance:5200000},{hasMortgage:true}]){
 const out=local.calculate({...localArgs,...changed});
 assert.equal(out.status,"HOLD",JSON.stringify(changed));
 assert.equal(out.calculation,null);
}
console.log(JSON.stringify({schema:"web-resident-levy-v1",standardMatches,
 designatedOracleMatches,lowAdjustmentCases:4,municipalRoundingCases:2,
 actualDesignatedExcelCOM:false,uiIntegrated:false,release:"HOLD"}));


// Separate special-credit caps must each be respected, not just their sum.
// The exact theoretical reference is NOT a final assessed self-pay guarantee.
let checkedMunicipalReferences=0;
for(const [year,gross,social,income,pooled,assessed,legacyLimit] of excelObserved){
 for(const municipality of ["standard","designated"]){
  const input={...localArgs,year,salaryIncome:income,socialInsurance:social,municipality};
  const out=local.oneStopReference(input);
  assert.equal(out.status,"ESTIMATE",year+"/"+gross+"/"+municipality);
  const c=out.calculation;
  const cityShare=municipality==="standard"?3n:4n;
  // Independently test both constraints with integer inequalities, rather
  // than duplicate the production division and floor formula.
  const base=BigInt(c.exactReferenceYen-2000);
  const d=BigInt(c.specialDenominator);
  const cityBudget=BigInt(c.city.assessedYen)*100000n;
  const prefBudget=BigInt(c.prefecture.assessedYen)*100000n;
  assert.ok(base*d*cityShare<=cityBudget);
  assert.ok(base*d*(5n-cityShare)<=prefBudget);
  const next=base+1n;
  assert.ok(next*d*cityShare>cityBudget||next*d*(5n-cityShare)>prefBudget||
    c.exactReferenceYen===Math.floor(income*.3));
  assert.equal(out.donationLimitYen,Math.floor(c.exactReferenceYen/1000)*1000);
  assert.ok(out.donationLimitYen<=legacyLimit);
  checkedMunicipalReferences++;
 }
}
// Low national taxable income is still HOLD despite a positive local levy.
assert.equal(local.oneStopReference({...localArgs,socialInsurance:4723000}).status,"HOLD");
assert.equal(local.oneStopReference({...localArgs,municipality:"unknown"}).status,"HOLD");
// Explicitly reject unsupported modes/credits rather than silently ignore them.
for(const extra of [{filing:"return"},{hasMortgage:true},{residentCredit:1}]){
 const held=local.oneStopReference({...localArgs,...extra});
 assert.equal(held.status,"HOLD");
 assert.equal(held.calculation,null);
}
console.log(JSON.stringify({schema:"web-municipal-one-stop-reference/v1",
 checkedMunicipalReferences,individualCaps:true,exactReferenceOnly:true,
 filingSupported:false,release:"HOLD"}));
