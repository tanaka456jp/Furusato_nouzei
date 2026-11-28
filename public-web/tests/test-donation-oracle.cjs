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


// Independent integer/rational filing audit. Recompute tax bands, local
// credits and final bills from synthetic inputs, not the production outputs.
function independentFiling(year,income,social,municipality,donation){
 const I=BigInt(income),S=BigInt(social),D=BigInt(donation);
 const basic=BigInt(year===2025?(income<=1320000?950000:income<=3360000?880000:income<=4890000?680000:630000):(income<=4890000?1040000:670000));
 const max0=n=>n>0n?n:0n;
 const floorTaxable=n=>max0(n)/1000n*1000n;
 const tax=t=>{
  // Sum marginal slices instead of the production quick deduction formula.
  const v=(t<1950000n?t:1950000n)/20n+
    (max0(t-1950000n)<1350000n?max0(t-1950000n):1350000n)/10n+
    max0(t-3300000n)/5n;
  return v+v*21n/1000n;
 };
 const nationalBefore=floorTaxable(I-S-basic);
 const nationalAfter=floorTaxable(I-S-basic-D+2000n);
 const nationalSaving=tax(nationalBefore)-tax(nationalAfter);
 const localTaxable=floorTaxable(I-S-430000n);
 const adjusted=localTaxable-50000n-max0(basic-480000n);
 const ratio=adjusted<=1950000n?84895n:adjusted<=3300000n?79790n:69580n;
 const adjustment=localTaxable<50000n?localTaxable:50000n;
 // Use exact rational units with 5,000,000 as denominator, distinct
 // from production's 500,000; compute each final levy independently.
 const shares=municipality==="standard"?[3n,2n]:[4n,1n];
 const local=shares.map(share=>{
  const before=(localTaxable*2n-adjustment)*share*50000n;
  const regular=(D-2000n)*share*100000n;
  const special=(D-2000n)*ratio*share*10n;
  const capped=special<before/5n?special:before/5n;
  const credit=(regular+capped+4999999n)/5000000n;
  const beforeBill=before/500000000n*100n;
  const afterBill=max0(before-credit*5000000n)/500000000n*100n;
  return beforeBill-afterBill;
 });
 return [nationalSaving,local[0],local[1],D-nationalSaving-local[0]-local[1]].map(Number);
}
let filingTrials=0,filingPrefixes=0;
for(const [year,gross,social,income,pooled,assessed,legacyLimit] of excelObserved){
 for(const municipality of ["standard","designated"]){
  const input={...localArgs,year,salaryIncome:income,socialInsurance:social,municipality};
  for(const donation of new Set([2000,2001,2999,3000,legacyLimit,legacyLimit+1000,Math.floor(income*.3)])){
   const actual=local.filingTrial(input,donation);
   assert.equal(actual.status,"ESTIMATE",year+"/"+gross+"/"+municipality+"/"+donation);
   const c=actual.calculation;
   const expected=independentFiling(year,income,social,municipality,donation);
   assert.deepEqual([c.nationalSavingYen,c.city.savingYen,c.prefecture.savingYen,c.selfPayYen],expected);
   assert.equal(c.excessOver2000Yen,Math.max(0,expected[3]-2000));
   assert.equal(c.within2000,expected[3]<=2000);
   filingTrials++;
  }
  let ceiling=2000,firstFailure=null;
  for(let d=3000;d<=Math.floor(income*.3);d+=1000){
   if(independentFiling(year,income,social,municipality,d)[3]>2000){firstFailure=d;break;}
   ceiling=d;
  }
  const prefix=local.filingPrefix(input);
  assert.equal(prefix.status,"ESTIMATE");
  assert.equal(prefix.donationLimitYen,ceiling);
  assert.equal(prefix.calculation.firstFailureYen,firstFailure);
  filingPrefixes++;
 }
}
for(const [municipality,donation,national,city,pref,selfPay] of [
 ["standard",3000,204,500,400,1896],
 ["standard",109000,21849,51100,34100,1951],
 ["standard",120000,24096,52100,34700,9104],
 ["designated",109000,21849,68200,17100,1851],
 ["designated",120000,24096,69400,17400,9104]
]){
 const c=local.filingTrial({...localArgs,municipality},donation).calculation;
 assert.deepEqual([c.nationalSavingYen,c.city.savingYen,c.prefecture.savingYen,c.selfPayYen],[national,city,pref,selfPay]);
}
for(const bad of [1999,-1,3000.5,"3000",1560001,NaN,Infinity]){
 const out=local.filingTrial(localArgs,bad);
 assert.equal(out.status,"HOLD");assert.equal(out.calculation,null);
}
assert.equal(local.filingTrial({...localArgs,hasMortgage:true},3000).status,"HOLD");
assert.equal(local.filingPrefix({...localArgs,municipality:""}).status,"HOLD");
console.log(JSON.stringify({schema:"web-salary-filing-trial/v1",filingTrials,filingPrefixes,
 mortgageSupported:false,actualExcelFilingCOM:false,release:"HOLD"}));


// Family component oracle: official table boundary checks for both years.
// No family-aware donation estimate may be emitted by this module.
const family=require("../src/family-deductions.js");
const baseFamily={year:2026,taxpayerIncome:5200000,spouse:null,relatives:[],
 conditions:"annual-resident-family-reviewed"};
const spouse=(income,age=40)=>({income,age,eligibilityReviewed:true});
const relative=(age,income=0,cohabitingDirectAscendant=false)=>({age,income,cohabitingDirectAscendant,eligibilityReviewed:true});
let familyCases=0;
function familyCheck(input,expected){
 const out=family.calculate({...baseFamily,...input});
 assert.equal(out.status,"COMPONENTS_ONLY");
 assert.equal(out.donationLimitYen,null);
 const c=out.calculation;
 assert.deepEqual([c.nationalFamilyDeductionYen,c.residentFamilyDeductionYen,
  c.familyAdjustmentDifferenceYen,c.familyCount],expected,JSON.stringify(input));
 assert.equal(c.ordinaryResidentIncomeLevyExemptionLimitYen,expected[3]===0?450000:350000*(expected[3]+1)+420000);
 familyCases++;
 return c;
}
for(const year of [2025,2026]){
 const threshold=year===2025?580000:620000;
 for(const [age,cohab,n,r,d] of [[15,false,0,0,0],[16,false,380000,330000,50000],
  [18,false,380000,330000,50000],[19,false,630000,450000,180000],[22,false,630000,450000,180000],
  [23,false,380000,330000,50000],[69,false,380000,330000,50000],[70,false,480000,380000,100000],[70,true,580000,450000,130000]]){
  familyCheck({year,relatives:[relative(age,threshold,cohab)]},[n,r,d,1]);
  familyCheck({year,relatives:[relative(age,threshold+1,cohab)]},
   age>=19&&age<23?[630000,450000,0,0]:[0,0,0,0]);
 }
 // Official spouse tables for each taxpayer band, including exact edges.
 for(const [income,n,r,d,en,er,ed] of [[9000000,380000,330000,50000,480000,380000,100000],
  [9000001,260000,220000,40000,320000,260000,60000],[9500000,260000,220000,40000,320000,260000,60000],
  [9500001,130000,110000,20000,160000,130000,30000],[10000000,130000,110000,20000,160000,130000,30000],
  [10000001,0,0,0,0,0,0]]){
  familyCheck({year,taxpayerIncome:income,spouse:spouse(threshold)},[n,r,d,1]);
  familyCheck({year,taxpayerIncome:income,spouse:spouse(threshold,70)},[en,er,ed,1]);
 }
 const spouseNational=[[380000,260000,130000],[360000,240000,120000],[310000,210000,110000],
  [260000,180000,90000],[210000,140000,70000],[160000,110000,60000],
  [110000,80000,40000],[60000,40000,20000],[30000,20000,10000]];
 const spouseResident=[[330000,220000,110000],[330000,220000,110000],...spouseNational.slice(2)];
 const edges=[950000,1000000,1050000,1100000,1150000,1200000,1250000,1300000,1330000];
 for(const [band,taxpayerIncome] of [9000000,9500000,10000000].entries()){
  for(let i=0;i<edges.length;i++){
   const pair=[spouseNational[i][band],spouseResident[i][band],0,0];
   const next=i===edges.length-1?[0,0,0,0]:[spouseNational[i+1][band],spouseResident[i+1][band],0,0];
   familyCheck({year,taxpayerIncome,spouse:spouse(edges[i])},pair);
   familyCheck({year,taxpayerIncome,spouse:spouse(edges[i]+1)},next);
  }
  familyCheck({year,taxpayerIncome,spouse:spouse(threshold+1,70)},
   [spouseNational[0][band],spouseResident[0][band],0,0]);
 }
 const upper=[850000,900000,950000,1000000,1050000,1100000,1150000,1200000,1230000];
 const national=[630000,610000,510000,410000,310000,210000,110000,60000,30000];
 const resident=[450000,450000,450000,410000,310000,210000,110000,60000,30000];
 for(let i=0;i<upper.length;i++){
  familyCheck({year,relatives:[relative(19,upper[i])]},[national[i],resident[i],0,0]);
  familyCheck({year,relatives:[relative(22,upper[i]+1)]},
   i===upper.length-1?[0,0,0,0]:[national[i+1],resident[i+1],0,0]);
 }
 // Independently established ordinary family combinations use the same
 // statutory amounts as tools/audit_salary_donation_limit.py (Excel audit).
 familyCheck({year,spouse:spouse(0),relatives:[relative(15),relative(16),relative(20),relative(75),relative(80,0,true)]},
  [2450000,1940000,510000,6]);
 const at=familyCheck({year,taxpayerIncome:1120000,relatives:[relative(15)]},[0,0,0,1]);
 assert.equal(at.ordinaryResidentIncomeLevyExempt,true);
 assert.equal(familyCheck({year,taxpayerIncome:1120001,relatives:[relative(15)]},[0,0,0,1]).ordinaryResidentIncomeLevyExempt,false);
}
// Same facts, different year: the 600k spouse changes from special to
// ordinary, and the 600k 20-year-old changes from special relative to dependent.
familyCheck({year:2025,spouse:spouse(600000),relatives:[relative(20,600000)]},[1010000,780000,0,0]);
familyCheck({year:2026,spouse:spouse(600000),relatives:[relative(20,600000)]},[1010000,780000,230000,2]);
for(const invalid of [{year:2024},{year:"2026"},{conditions:""},{taxpayerIncome:-1},
 {spouse:{age:40,income:0,eligibilityReviewed:false}},
 {spouse:{age:40,income:"0",eligibilityReviewed:true}},
 {relatives:[relative(69,0,true)]},{relatives:[relative(20,0.5)]},
 {relatives:[{...relative(20),eligibilityReviewed:false}]},
 {relatives:Array(31).fill(relative(20))},{hasMortgage:true}]){
 const out=family.calculate({...baseFamily,...invalid});
 assert.equal(out.status,"HOLD");assert.equal(out.calculation,null);assert.equal(out.donationLimitYen,null);
}
console.log(JSON.stringify({schema:"web-family-components/v1",familyCases,
 adjustmentDifferenceSeparated:true,actualExcelCOM:false,uiIntegrated:false,release:"HOLD"}));


// Family-aware integration: preserve the established no-family results,
// then compare family tax outcomes against independently supplied totals.
const familyTax=require("../dist/family-tax.js");
assert.equal(require("node:fs").readFileSync(require("node:path").resolve(__dirname,"../dist/family-tax.js"),"utf8"),require("node:fs").readFileSync(require("node:path").resolve(__dirname,"../src/family-tax.js"),"utf8"));
const familyTaxInput={year:2026,salaryIncome:5200000,socialInsurance:1000000,
 municipality:"standard",spouse:null,relatives:[],conditions:"salary-basic-social-family-only-reviewed"};
let familyTaxParity=0;
for(const [year,gross,social,income,pooled,assessed,legacyLimit] of excelObserved){
 for(const municipality of ["standard","designated"]){
  const input={...familyTaxInput,year,salaryIncome:income,socialInsurance:social,municipality};
  const basicInput={...localArgs,year,salaryIncome:income,socialInsurance:social,municipality};
  const actual=familyTax.calculate(input),expected=local.oneStopReference(basicInput);
  assert.equal(actual.status,"ESTIMATE");
  assert.equal(actual.donationLimitYen,expected.donationLimitYen);
  assert.equal(actual.calculation.residentIncomeLevyYen,expected.calculation.residentIncomeLevyYen);
  assert.equal(actual.calculation.nationalTaxableYen,expected.calculation.nationalTaxableYen);
  for(const d of [2000,3000,legacyLimit,legacyLimit+1000]){
   const a=familyTax.filingTrial(input,d).calculation,b=local.filingTrial(basicInput,d).calculation;
   assert.deepEqual([a.nationalSavingYen,a.residentSavingYen,a.selfPayYen],
    [b.nationalSavingYen,b.residentSavingYen,b.selfPayYen]);
  }
  assert.equal(familyTax.filingPrefix(input).donationLimitYen,local.filingPrefix(basicInput).donationLimitYen);
  familyTaxParity++;
 }
}
// Hard-coded independent arithmetic for identical family incomes of 600k.
// 2025 special deductions have zero statutory difference; 2026 ordinary
// deductions have 230k family difference. The special rate base must NOT
// be forced equal to actual national taxable income.
let familyIntegratedCases=0;
for(const [year,municipality,nat,adj,base,rate,city,pref,limit] of [
 [2025,"standard",1730000,2500,1960000,10,131100,87400,56000],
 [2025,"designated",1730000,2500,1960000,10,174800,43700,56000],
 [2026,"standard",1370000,3500,1370000,5,130500,87000,53000],
 [2026,"designated",1370000,3500,1370000,5,174000,43500,53000]
]){
 const input={...familyTaxInput,year,municipality,salaryIncome:4760000,socialInsurance:1340000,
  spouse:spouse(600000),relatives:[relative(20,600000)]};
 const out=familyTax.calculate(input);assert.equal(out.status,"ESTIMATE");
 const c=out.calculation;
 assert.deepEqual([c.nationalTaxableYen,c.adjustmentYen,c.residentSpecialBaseYen,c.specialRatePercent,
   c.city.assessedYen,c.prefecture.assessedYen,out.donationLimitYen],
  [nat,adj,base,rate,city,pref,limit]);
 assert.equal(c.residentTaxableYen,2210000);
 // Independent BigInt fiscal model, using the already established
 // expected tax bases and assessed levies, not production internals.
 function expectedTrial(d){
  const D=BigInt(d),B=D-2000n;
  const n=BigInt(nat),after=n>B?(n-B)/1000n*1000n:0n;
  const incomeTax=t=>t/20n; // all these national bases stay in 5% band
  const total=t=>incomeTax(t)+incomeTax(t)*21n/1000n;
  const ns=total(n)-total(after);
  const ratio=rate===5?84895n:79790n;
  const shares=municipality==="standard"?[3n,2n]:[4n,1n];
  const savings=shares.map((s,i)=>{
   const levy=BigInt(i?pref:city);
   const special=B*ratio*s,cap=levy*100000n;
   const credit=(B*s*10000n+(special<cap?special:cap)+499999n)/500000n;
   const remainder=levy>credit?levy-credit:0n;
   return levy-remainder/100n*100n;
  });
  return [ns,savings[0],savings[1],D-ns-savings[0]-savings[1]].map(Number);
 }
 for(const d of [2000,2001,3000,limit,limit+1000,120000]){
  const t=familyTax.filingTrial(input,d).calculation;
  assert.deepEqual([t.nationalSavingYen,t.city.savingYen,t.prefecture.savingYen,t.selfPayYen],expectedTrial(d));
 }
 let ceiling=2000;
 for(let d=3000;d<=1428000;d+=1000){
  if(expectedTrial(d)[3]>2000)break;
  ceiling=d;
 }
 assert.equal(familyTax.filingPrefix(input).donationLimitYen,ceiling);
 familyIntegratedCases++;
}
// Lower resident taxable base: adjustment uses min(personal difference,
// taxable) at <=2m, with distinct age/household and exemption effects.
const ordinaryFamily=familyTax.calculate({...familyTaxInput,salaryIncome:3560000,socialInsurance:750000,
 spouse:spouse(0),relatives:[relative(16),relative(15)]});
assert.equal(ordinaryFamily.status,"ESTIMATE");
assert.equal(ordinaryFamily.calculation.residentTaxableYen,1720000);
assert.equal(ordinaryFamily.calculation.personalDifferenceYen,150000);
assert.equal(ordinaryFamily.calculation.adjustmentYen,7500);
assert.equal(ordinaryFamily.calculation.residentIncomeLevyYen,164500);
assert.equal(ordinaryFamily.calculation.family.familyCount,3);
for(const invalid of [
 {salaryIncome:6550001},{salaryIncome:1120000,relatives:[relative(15)]},
 {salaryIncome:1200000,socialInsurance:500000},{municipality:"unknown"},
 {conditions:""},{spouse:{...spouse(0),eligibilityReviewed:false}},
 {hasMortgage:true},{socialInsurance:1000000.5}
]){
 const out=familyTax.calculate({...familyTaxInput,...invalid});
 assert.equal(out.status,"HOLD");assert.equal(out.donationLimitYen,null);
}
for(const d of [1999,1560001,"3000",3000.5]){
 assert.equal(familyTax.filingTrial(familyTaxInput,d).status,"HOLD");
}
console.log(JSON.stringify({schema:"web-family-tax-integration/v1",familyTaxParity,
 familyIntegratedCases,independentTrialOracle:true,actualExcelFamilyCOM:false,
 uiIntegrated:false,release:"HOLD"}));

// Original-year family reconciliation is independent of the target-year tax calculation.
const sourceFamily=require("../dist/family-source.js");
const source2025={year:2025,gross:6500000,salaryIncome:4760000,social:1340000,deductions:3030000,
 indicators:{hasDependents:true},spouse:spouse(600000),relatives:[relative(20,600000)],reviewed:true};
assert.deepEqual(sourceFamily.reconcile(source2025,engine).calculation,
 {year:2025,salaryIncomeYen:4760000,basicYen:680000,familyYen:1010000,deductionsYen:3030000});
assert.equal(sourceFamily.reconcile({...source2025,year:2026,deductions:3390000},engine).status,"RECONCILED");
assert.equal(sourceFamily.reconcile({...source2025,year:2026},engine).status,"HOLD");
for(const invalid of [{salaryIncome:4759999},{deductions:3030001},{reviewed:false},{year:2024},
 {indicators:{hasMortgage:true}},{indicators:{hasLifeInsurance:true}},{indicators:{hasNonstandardConditions:true}},
 {indicators:{hasDependents:false}},{relatives:[]},{spouse:null},{social:1340001},{gross:8500001},
 {spouse:{...spouse(600000),eligibilityReviewed:false}},{unknown:true}]){
 const held=sourceFamily.reconcile({...source2025,...invalid},engine);
 assert.equal(held.status,"HOLD",JSON.stringify(invalid));assert.equal(held.calculation,null);
}
// Even a plausible zero-deduction amount must not override a positive source flag.
assert.equal(sourceFamily.reconcile({...source2025,spouse:null,relatives:[],deductions:2020000},engine).status,"HOLD");
console.log(JSON.stringify({schema:"web-family-source-reconciliation/v1",normalCases:2,holdCases:16,
 originalYearIndependent:true,release:"HOLD"}));


// Insurance components: independent integer quarter-yen marginal-band oracle.
// Every candidate remains COMPONENTS_ONLY, never a donation estimate.
const insurance=require("../dist/insurance-deductions.js");
const premiumsZero={generalNew:0,generalOld:0,medicalNew:0,pensionNew:0,pensionOld:0,earthquake:0,longTermOld:0};
const insBase={year:2026,family:{...baseFamily},premiums:premiumsZero,
 conditions:"eligible-net-premiums-and-contract-selection-reviewed"};
let insuranceCases=0;
function insCheck(year,relatives,premiums,expected,sp=null){
 const result=insurance.calculate({...insBase,year,family:{...baseFamily,year,relatives,spouse:sp},
  premiums:{...premiumsZero,...premiums}});
 assert.equal(result.status,"COMPONENTS_ONLY");
 assert.equal(result.donationLimitYen,null);
 const c=result.calculation;
 assert.deepEqual([c.national.lifeYen,c.resident.lifeYen,c.national.earthquakeYen,c.resident.earthquakeYen],expected,
  JSON.stringify({year,relatives,premiums,sp}));
 assert.equal(c.national.totalYen,expected[0]+expected[2]);
 assert.equal(c.resident.totalYen,expected[1]+expected[3]);
 assert.equal(c.adjustmentDifferenceYen,0);
 insuranceCases++;return c;
}
function progressive(n,a,b,c){
 const v=BigInt(n),A=BigInt(a),B=BigInt(b),C=BigInt(c);
 const min=(x,y)=>x<y?x:y,max0=x=>x>0n?x:0n;
 return Number((4n*min(v,A)+2n*min(max0(v-A),B-A)+min(max0(v-B),C-B)+3n)/4n);
}
const nStd=n=>progressive(n,20000,40000,80000);
const nEnhanced=n=>progressive(n,30000,60000,120000);
const nLegacy=n=>progressive(n,25000,50000,100000);
const rStd=n=>progressive(n,12000,32000,56000);
const rLegacy=n=>progressive(n,15000,40000,70000);
const edges=[0,1,12000,15000,20000,25000,30000,32000,40000,50000,56000,60000,70000,80000,100000,120000];
const boundary=[...new Set(edges.flatMap(x=>[Math.max(0,x-1),x,x+1]))];
for(const year of [2025,2026]){
 for(const amount of boundary){
  const child=[relative(15,0)];
  insCheck(year,child,{generalNew:amount},[year===2026?nEnhanced(amount):nStd(amount),rStd(amount),0,0]);
  insCheck(year,[],{generalNew:amount},[nStd(amount),rStd(amount),0,0]);
  insCheck(year,child,{generalOld:amount},[nLegacy(amount),rLegacy(amount),0,0]);
  insCheck(year,child,{medicalNew:amount},[nStd(amount),rStd(amount),0,0]);
  insCheck(year,child,{pensionNew:amount},[nStd(amount),rStd(amount),0,0]);
  insCheck(year,child,{pensionOld:amount},[nLegacy(amount),rLegacy(amount),0,0]);
 }
 for(const [a,b] of [[1,1],[20001,25001],[80000,60000],[80000,60001],[120000,100000],
  [0,100000],[120000,0],[30001,15001],[80000,46001]]){
  const child=[relative(15,0)];
  const n=year===2026?nEnhanced(a):nStd(a);
  const r=rStd(a),o=nLegacy(b),ro=rLegacy(b);
  const cap=year===2026?60000:40000;
  insCheck(year,child,{generalNew:a,generalOld:b},
   [Math.max(n,o,Math.min(cap,n+o)),Math.max(r,ro,Math.min(28000,r+ro)),0,0]);
  insCheck(year,child,{pensionNew:a,pensionOld:b},
   [Math.max(nStd(a),o,Math.min(40000,nStd(a)+o)),Math.max(r,ro,Math.min(28000,r+ro)),0,0]);
 }
 for(const a of [0,1,4999,5000,5001,9999,10000,10001,14999,15000,15001,19999,20000,20001,49999,50000,50001]){
  const oldNational=a<=10000?a:Math.min(15000,Math.ceil((a+10000)/2));
  const oldResident=a<=5000?a:Math.min(10000,Math.ceil((a+5000)/2));
  insCheck(year,[],{earthquake:a},[0,0,Math.min(50000,a),Math.min(25000,Math.ceil(a/2))]);
  insCheck(year,[],{longTermOld:a},[0,0,oldNational,oldResident]);
  insCheck(year,[],{earthquake:40000,longTermOld:a},[0,0,Math.min(50000,40000+oldNational),Math.min(25000,20000+oldResident)]);
 }
}
for(const [age,income,eligible] of [[0,0,true],[15,620000,true],[16,620000,true],[22,620000,true],
 [22,620001,false],[22,1230000,false],[23,0,false],[70,0,false]]){
 const c=insCheck(2026,[relative(age,income)],{generalNew:120000},[eligible?60000:40000,28000,0,0]);
 assert.equal(c.eligibleUnder23,eligible);assert.equal(c.enhancedGeneral,eligible);
}
insCheck(2026,[],{generalNew:120000},[40000,28000,0,0],spouse(0,22));
insCheck(2025,[relative(20,600000)],{generalNew:120000},[40000,28000,0,0]);
insCheck(2026,[relative(20,600000)],{generalNew:120000},[60000,28000,0,0]);
for(const year of [2025,2026]){
 insCheck(year,[relative(15)],Object.fromEntries(Object.keys(premiumsZero).map(k=>[k,200000])),
  [120000,70000,50000,25000]);
}
for(const invalid of [{year:2027},{year:"2026"},{conditions:""},
 {premiums:{...premiumsZero,generalNew:-1}},{premiums:{...premiumsZero,earthquake:1.5}},
 {premiums:{...premiumsZero,generalOld:"10000"}},{premiums:{generalNew:10000}},
 {premiums:{...premiumsZero,duplicateDualContract:true}},
 {family:{...baseFamily,year:2025}},{family:{...baseFamily,conditions:""}},
 {family:{...baseFamily,relatives:[{...relative(15),eligibilityReviewed:false}]}},
 {hasMortgage:true}]){
 const held=insurance.calculate({...insBase,...invalid});
 assert.equal(held.status,"HOLD");assert.equal(held.calculation,null);
 assert.equal(held.donationLimitYen,null);
}
// NTA 41-15-5-1: shared-child eligibility is separate from family deductions.
const sharedFamily={...baseFamily,year:2026,spouse:null,relatives:[]};
const sharedInsurance={...insBase,year:2026,family:sharedFamily,premiums:{...premiumsZero,generalNew:120000,otherClaimUnder23:true}};
const shared=insurance.calculate(sharedInsurance);
assert.equal(shared.status,"COMPONENTS_ONLY");
assert.equal(shared.calculation.national.lifeYen,60000);
assert.equal(shared.calculation.resident.lifeYen,28000);
for(const bad of [
 {...sharedInsurance,year:2025,family:{...sharedFamily,year:2025}},
 {...sharedInsurance,premiums:{...sharedInsurance.premiums,otherClaimUnder23:"true"}},
 {...sharedInsurance,premiums:{...sharedInsurance.premiums,otherClaimUnder23:false}},
 {...sharedInsurance,premiums:{...sharedInsurance.premiums,generalNew:0}}
])assert.equal(insurance.calculate(bad).status,"HOLD");
console.log(JSON.stringify({schema:"web-insurance-deductions/v1",insuranceCases,
 independentBoundaryOracle:true,uiIntegrated:false,actualExcelCOM:false,release:"HOLD"}));


// Combined tax model: separately hand-calculated national and local
// insurance deductions, statutory personal difference, municipal rounding.
// Source household facts stay constant; 2026 U23 eligibility changes.
let insuranceTaxCases=0,insuranceTaxTrials=0,insuranceZeroParity=0;
const insuranceTaxInput={...familyTaxInput,conditions:"salary-basic-social-family-insurance-only-reviewed",
 premiums:{...premiumsZero,generalNew:120000,earthquake:50000},
 salaryIncome:4760000,socialInsurance:1340000,spouse:spouse(600000),relatives:[relative(20,600000)]};
for(const [year,municipality,nDed,nTax,adj,base,cityRaw,prefRaw,city,pref,limit,prefixLimit,expected60] of [
 [2025,"standard",3120000,1640000,2500,1907000,12792000,8528000,127900,85200,52000,2000,[2961,29100,19300,8639]],
 [2025,"designated",3120000,1640000,2500,1907000,17056000,4264000,170500,42600,52000,2000,[2961,38700,9700,8639]],
 [2026,"standard",3500000,1260000,6150,1317000,12573000,8382000,125700,83800,51000,10000,[2961,28600,19100,9339]],
 [2026,"designated",3500000,1260000,6150,1317000,16764000,4191000,167600,41900,51000,10000,[2961,38200,9600,9239]]
]){
 const input={...insuranceTaxInput,year,municipality};
 const result=familyTax.calculate(input),c=result.calculation;
 assert.equal(result.status,"ESTIMATE");
 assert.deepEqual([c.nationalDeductionsYen,c.nationalTaxableYen,c.residentDeductionsYen,c.residentTaxableYen,
  c.adjustmentYen,c.residentSpecialBaseYen,c.specialRatePercent,c.city.assessedYen,c.prefecture.assessedYen,
  result.donationLimitYen],
  [nDed,nTax,2603000,2157000,adj,base,5,city,pref,limit]);
 assert.deepEqual([c.insurance.national.totalYen,c.insurance.resident.totalYen,c.personalDifferenceYen],
  [year===2026?110000:90000,53000,year===2026?280000:50000]);
 assert.deepEqual([c.city.beforeRounding100,c.prefecture.beforeRounding100],[cityRaw,prefRaw]);
 // BigInt reference uses pre-computed national/municipal tax bases,
 // independent of the production family/insurance components.
 function expectedTrial(d){
  const D=BigInt(d),B=D-2000n,n=BigInt(nTax);
  const after=n>B?(n-B)/1000n*1000n:0n;
  const tax=x=>x/20n+(x/20n)*21n/1000n;
  const ns=tax(n)-tax(after);
  const shares=municipality==="standard"?[3n,2n]:[4n,1n];
  const savings=shares.map((s,i)=>{
   const levy=BigInt(i?prefRaw:cityRaw),assessed=BigInt(i?pref:city);
   const a=B*84895n*s,cap=levy*1000n;
   const credit=(B*s*10000n+(a<cap?a:cap)+499999n)/500000n;
   const remainder=levy>credit*100n?levy-credit*100n:0n;
   return assessed-remainder/10000n*100n;
  });
  return [ns,...savings,D-ns-savings[0]-savings[1]].map(Number);
 }
 assert.deepEqual(expectedTrial(60000),expected60);
 for(const d of [2000,2001,2999,3000,limit,limit+1000,60000,120000,1428000]){
  const t=familyTax.filingTrial(input,d).calculation;
  assert.deepEqual([t.nationalSavingYen,t.city.savingYen,t.prefecture.savingYen,t.selfPayYen],expectedTrial(d));
  insuranceTaxTrials++;
 }
 let ceiling=2000;
 for(let d=3000;d<=1428000;d+=1000){
  if(expectedTrial(d)[3]>2000)break;
  ceiling=d;
 }
 assert.equal(ceiling,prefixLimit);
 assert.equal(familyTax.filingPrefix(input).donationLimitYen,ceiling);
 insuranceTaxCases++;
}
// With all premiums zero, every pre-existing observed Excel salary case
// must remain unchanged for both municipal categories and both filing paths.
for(const [year,gross,social,income,pooled,assessed,legacyLimit] of excelObserved){
 for(const municipality of ["standard","designated"]){
  const baseline={...familyTaxInput,year,salaryIncome:income,socialInsurance:social,municipality};
  const extended={...baseline,conditions:"salary-basic-social-family-insurance-only-reviewed",premiums:{...premiumsZero}};
  const a=familyTax.calculate(baseline),b=familyTax.calculate(extended);
  assert.equal(b.status,a.status);
  const {insurance:unused,...rest}=b.calculation;
  assert.deepEqual(rest,a.calculation);
  assert.equal(a.donationLimitYen,b.donationLimitYen);
  assert.deepEqual(familyTax.filingTrial(extended,3000),familyTax.filingTrial(baseline,3000));
  assert.deepEqual(familyTax.filingPrefix(extended),familyTax.filingPrefix(baseline));
  insuranceZeroParity++;
 }
}
// Explicit review marker and complete, exact premium fields are mandatory.
for(const invalid of [
 {conditions:"salary-basic-social-family-only-reviewed"},
 {premiums:undefined},{premiums:{...premiumsZero,generalNew:-1}},
 {premiums:{...premiumsZero,earthquake:0.5}},
 {premiums:{...premiumsZero,unknown:0}},
 {relatives:[{...relative(20),eligibilityReviewed:false}]},
 {hasMortgage:true}
]){
 const input={...insuranceTaxInput,...invalid};
 assert.equal(familyTax.calculate(input).status,"HOLD");
 assert.equal(familyTax.filingTrial(input,3000).status,"HOLD");
 assert.equal(familyTax.filingPrefix(input).status,"HOLD");
}
console.log(JSON.stringify({schema:"web-insurance-tax-integration/v1",insuranceTaxCases,insuranceTaxTrials,
 insuranceZeroParity,independentTrialOracle:true,actualExcelInsuranceCOM:false,uiIntegrated:false,release:"HOLD"}));


// Original-year insurance review must use original-year U23 eligibility,
// independently of the forecast, and preserve positive OCR indicators.
const insuredSource={...source2025,deductions:3120000,
 indicators:{hasDependents:true,hasLifeInsurance:true,hasEarthquakeInsurance:true},
 premiums:{...premiumsZero,generalNew:120000,earthquake:50000},insuranceReviewed:true};
assert.deepEqual(sourceFamily.reconcile(insuredSource,engine).calculation,
 {year:2025,salaryIncomeYen:4760000,basicYen:680000,familyYen:1010000,deductionsYen:3120000,
  lifeYen:40000,earthquakeYen:50000,insuranceYen:90000,enhancedGeneral:false});
assert.deepEqual(sourceFamily.reconcile({...insuredSource,year:2026,deductions:3500000},engine).calculation,
 {year:2026,salaryIncomeYen:4760000,basicYen:1040000,familyYen:1010000,deductionsYen:3500000,
  lifeYen:60000,earthquakeYen:50000,insuranceYen:110000,enhancedGeneral:true});
for(const patch of [
 {insuranceReviewed:false},{insuranceReviewed:undefined},{deductions:3140000},
 {year:2026,deductions:3480000},{premiums:{...premiumsZero}},
 {premiums:{...premiumsZero,earthquake:50000},deductions:3080000},
 {premiums:{...premiumsZero,generalNew:120000},deductions:3070000},
 {indicators:{hasMortgage:true}},{indicators:{hasLifeInsurance:false}},
 {premiums:{...insuredSource.premiums,generalNew:"120000"}}
]){
 assert.equal(sourceFamily.reconcile({...insuredSource,...patch},engine).status,"HOLD");
}
const {premiums:unusedPremiums,insuranceReviewed:unusedReview,...missingInsurance}=insuredSource;
assert.equal(sourceFamily.reconcile(missingInsurance,engine).status,"HOLD");
console.log(JSON.stringify({schema:"web-insurance-source-reconciliation/v1",normalCases:2,holdCases:11,
 sourceYearIndependent:true,release:"HOLD"}));


// Other deduction components: independent literal tax table, no UI use yet.
const otherDeductions=require("../dist/other-deductions.js");
assert.equal(fs.readFileSync(path.resolve(__dirname,"../dist/other-deductions.js"),"utf8"),
 fs.readFileSync(path.resolve(__dirname,"../src/other-deductions.js"),"utf8"));
const otherBase={family:{...baseFamily},disability:{self:"none",spouse:"none",relatives:[]},
 maritalRelief:"none",childIndex:null,workingStudent:false,smallEnterpriseContributions:0,
 conditions:"salary-only-adult-other-deductions-reviewed"};
let otherCases=0,otherHoldCases=0;
function otherCheck(input,expected){
 const result=otherDeductions.calculate(input);
 assert.equal(result.status,"COMPONENTS_ONLY",JSON.stringify(input));
 assert.equal(result.donationLimitYen,null);assert.equal(result.release,"HOLD");
 const c=result.calculation;
 assert.deepEqual([c.nationalOtherDeductionYen,c.residentOtherDeductionYen,c.adjustmentDifferenceYen],expected);
 otherCases++;return c;
}
function otherHold(input){
 const result=otherDeductions.calculate(input);
 assert.equal(result.status,"HOLD",JSON.stringify(input));assert.equal(result.calculation,null);
 assert.equal(result.donationLimitYen,null);otherHoldCases++;
}
for(const year of [2025,2026]){
 const threshold=year===2025?580000:620000;
 const studentLimit=year===2025?850000:890000;
 const b={...otherBase,family:{...baseFamily,year}};
 const table=[["none",[0,0,0]],["ordinary",[270000,260000,10000]],
  ["special",[400000,300000,100000]],["cohabitingSpecial",[750000,530000,220000]]];
 for(const [kind,expected] of table){
  if(kind!=="cohabitingSpecial"){
   otherCheck({...b,disability:{...b.disability,self:kind}},expected);
   for(const n of [1349999,1350000,1350001]){
    const c=otherCheck({...b,family:{...b.family,taxpayerIncome:n},
     disability:{...b.disability,self:kind}},expected);
    assert.equal(c.specialResidentExempt,kind!=="none"&&n<=1350000);
    assert.equal(c.residentIncomeLevyExempt,kind!=="none"&&n<=1350000);
   }
  }
  for(const income of [threshold-1,threshold,threshold+1]){
   const sp={...b,family:{...b.family,spouse:spouse(income)},disability:{...b.disability,spouse:kind}};
   if(kind!=="none"&&income>threshold)otherHold(sp);else otherCheck(sp,expected);
   // Under-16 relatives may qualify for disability even though no ordinary
   // income deduction is available; special-relative-only claims may not.
   for(const age of [0,15,16,20,70]){
    const rel={...b,family:{...b.family,relatives:[relative(age,income)]},
      disability:{...b.disability,relatives:[kind]}};
    if(kind!=="none"&&income>threshold)otherHold(rel);else otherCheck(rel,expected);
   }
  }
 }
 for(const n of [1349999,1350000,1350001,4999999,5000000,5000001]){
  for(const [maritalRelief,difference] of [["singleParentFather",10000],["singleParentMother",50000]]){
   for(const childIncome of [threshold,threshold+1]){
    const q={...b,family:{...b.family,taxpayerIncome:n,relatives:[relative(15,childIncome)]},
     disability:{...b.disability,relatives:["none"]},maritalRelief,childIndex:0};
    if(n>5000000||childIncome>threshold)otherHold(q);
    else{
     const c=otherCheck(q,[350000,300000,difference]);assert.equal(c.specialResidentExempt,n<=1350000);
    }
   }
  }
  const widow={...b,family:{...b.family,taxpayerIncome:n},maritalRelief:"widowBereaved"};
  if(n>5000000)otherHold(widow);else otherCheck(widow,[270000,260000,10000]);
 }
 const divorced={...b,family:{...b.family,taxpayerIncome:5000000,relatives:[relative(70,threshold)]},
  disability:{...b.disability,relatives:["none"]},maritalRelief:"widowDivorced"};
 otherCheck(divorced,[270000,260000,10000]);
 otherHold({...divorced,family:{...divorced.family,relatives:[relative(70,threshold+1)]}});
 for(const n of [0,1,studentLimit-1,studentLimit,studentLimit+1]){
  const q={...b,family:{...b.family,taxpayerIncome:n},workingStudent:true};
  if(n===0||n>studentLimit)otherHold(q);else otherCheck(q,[270000,260000,10000]);
 }
 otherCheck({...b,smallEnterpriseContributions:276000},[276000,276000,0]);
 // 27 + 40 + 75 + 27 + 30 (contributions) in ten-thousand yen;
 // use different disability categories, a bereaved widow and no spouse.
 const mixed={...b,family:{...b.family,taxpayerIncome:4800000,relatives:[relative(20),relative(70)]},
  disability:{self:"ordinary",spouse:"none",relatives:["special","cohabitingSpecial"]},
  maritalRelief:"widowBereaved",smallEnterpriseContributions:300000};
 otherCheck(mixed,[1990000,1650000,340000]);
 for(const q of [
  {...b,conditions:""},{...b,smallEnterpriseContributions:-1},
  {...b,smallEnterpriseContributions:1.5},{...b,smallEnterpriseContributions:"276000"},
  {...b,disability:{...b.disability,self:"cohabitingSpecial"}},
  {...b,disability:{...b.disability,spouse:"ordinary"}},
  {...b,disability:{...b.disability,relatives:["ordinary"]}},
  {...b,maritalRelief:"widowDivorced",family:{...b.family,taxpayerIncome:5000000}},
  {...b,maritalRelief:"singleParentFather",childIndex:0,family:{...b.family,taxpayerIncome:5000000}},
  {...b,childIndex:0},{...b,workingStudent:"true"},
  {...b,maritalRelief:"widowBereaved",family:{...b.family,taxpayerIncome:4500000,spouse:spouse(0)}},
  {...b,unknown:true},{...b,family:{...b.family,conditions:""}}
 ])otherHold(q);
}
// Explicit year boundary: same student income and same child income,
// but eligible only in 2026 under the new thresholds.
otherHold({...otherBase,family:{...baseFamily,year:2025,taxpayerIncome:870000},workingStudent:true});
otherCheck({...otherBase,family:{...baseFamily,year:2026,taxpayerIncome:870000},workingStudent:true},[270000,260000,10000]);
console.log(JSON.stringify({schema:"web-other-deductions/v1",otherCases,otherHoldCases,
 independentLiteralTables:true,uiIntegrated:false,actualExcelCOM:false,release:"HOLD"}));

 
// Other deduction integration: independent synthetic annual salary cases.
// G25 is a subset of G26. Splitting it must not change combined deduction.
const integratedOther={disability:{self:"special",spouse:"none",relatives:["ordinary"]},
 maritalRelief:"singleParentFather",childIndex:0,workingStudent:false,smallEnterpriseContributions:120000};
const integratedOtherInput={year:2025,salaryIncome:4000000,socialAndContributions:800000,
 municipality:"standard",spouse:null,relatives:[relative(15)],conditions:"salary-basic-social-family-insurance-other-only-reviewed",
 premiums:{...premiumsZero,generalNew:120000,earthquake:50000},otherDeductions:integratedOther};
let integratedOtherCases=0,integratedOtherTrials=0;
for(const year of [2025,2026])for(const municipality of ["standard","designated"]){
 const input={...integratedOtherInput,year,municipality};
 const result=familyTax.calculate(input);assert.equal(result.status,"ESTIMATE",result.reason);
 const c=result.calculation;
 const nTax=year===2025?1410000:1030000;
 const specialBase=year===2025?1487000:1127000;
 const raw=municipality==="standard"?[10632000,7088000]:[14176000,3544000];
 const assessed=municipality==="standard"?[106300,70800]:[141700,35400];
 const shares=municipality==="standard"?[3n,2n]:[4n,1n];
 assert.deepEqual([c.socialInsuranceOnlyYen,c.socialAndContributionsYen,
  c.other.nationalOtherDeductionYen,c.other.residentOtherDeductionYen,c.other.adjustmentDifferenceYen],
  [680000,800000,1140000,980000,120000]);
 assert.deepEqual([c.nationalDeductionsYen,c.residentDeductionsYen,c.nationalTaxableYen,c.residentTaxableYen,
  c.personalDifferenceYen,c.adjustmentYen,c.residentSpecialBaseYen,c.specialRatePercent],
  [4000000-nTax,2143000,nTax,1857000,170000,8500,specialBase,5]);
 assert.deepEqual([c.city.beforeRounding100,c.prefecture.beforeRounding100],raw);
 assert.deepEqual([c.city.assessedYen,c.prefecture.assessedYen],assessed);
 const limits=shares.map((share,i)=>2000n+BigInt(assessed[i])*100000n/(84895n*share));
 const limit=Math.floor(Math.min(...limits.map(Number))/1000)*1000;
 assert.equal(result.donationLimitYen,limit);
 function oracle(d){
  const base=BigInt(d)-2000n,n=BigInt(nTax);
  const after=n>base?(n-base)/1000n*1000n:0n;
  const tax=x=>x/20n+(x/20n)*21n/1000n;
  const ns=tax(n)-tax(after);
  const local=shares.map((share,i)=>{
   const a=base*84895n*share,cap=BigInt(raw[i])*1000n;
   const credit=(base*share*10000n+(a<cap?a:cap)+499999n)/500000n;
   const remaining=BigInt(raw[i])-credit*100n;
   return BigInt(assessed[i])-(remaining>0n?remaining/10000n*100n:0n);
  });
  return [ns,...local,BigInt(d)-ns-local[0]-local[1]].map(Number);
 }
 for(const d of [2000,2001,3000,limit,limit+1000,60000,120000,1200000]){
  const out=familyTax.filingTrial(input,d);assert.equal(out.status,"ESTIMATE");
  const a=out.calculation;
  assert.deepEqual([a.nationalSavingYen,a.city.savingYen,a.prefecture.savingYen,a.selfPayYen],oracle(d));
  integratedOtherTrials++;
 }
 let ceiling=2000;
 for(let d=3000;d<=1200000;d+=1000){if(oracle(d)[3]>2000)break;ceiling=d;}
 assert.equal(familyTax.filingPrefix(input).donationLimitYen,ceiling);
 const splitZero={...input,otherDeductions:{...integratedOther,smallEnterpriseContributions:0}};
 assert.equal(familyTax.calculate(splitZero).donationLimitYen,result.donationLimitYen);
 assert.deepEqual(familyTax.filingTrial(splitZero,60000),familyTax.filingTrial(input,60000));
 integratedOtherCases++;
}
// Zero-other parity on the earlier insurance cases, including both methods.
for(const year of [2025,2026])for(const municipality of ["standard","designated"]){
 const baseline={...insuranceTaxInput,year,municipality};
 const {socialInsurance,...rest}=baseline;
 const extended={...rest,socialAndContributions:socialInsurance,
  conditions:"salary-basic-social-family-insurance-other-only-reviewed",
  otherDeductions:{disability:{self:"none",spouse:"none",relatives:["none"]},
   maritalRelief:"none",childIndex:null,workingStudent:false,smallEnterpriseContributions:0}};
 const a=familyTax.calculate(baseline),b=familyTax.calculate(extended);
 assert.equal(a.status,"ESTIMATE");assert.equal(b.status,a.status);
 const {other:unusedOther,socialInsuranceOnlyYen:unusedSocial,socialAndContributionsYen:unusedTotal,...same}=b.calculation;
 assert.deepEqual(same,a.calculation);
 assert.deepEqual(familyTax.filingTrial(extended,60000),familyTax.filingTrial(baseline,60000));
 assert.deepEqual(familyTax.filingPrefix(extended),familyTax.filingPrefix(baseline));
 integratedOtherCases++;
}
for(const change of [
 {socialInsurance:800000},
 {socialAndContributions:119999},
 {otherDeductions:undefined},
 {otherDeductions:{...integratedOther,smallEnterpriseContributions:-1}},
 {otherDeductions:{...integratedOther,smallEnterpriseContributions:800001}},
 {otherDeductions:{...integratedOther,conditions:"unreviewed"}},
 {otherDeductions:{...integratedOther,disability:{...integratedOther.disability,self:"cohabitingSpecial"}}},
 {otherDeductions:{...integratedOther,workingStudent:true}},
 {salaryIncome:5000001},
 {salaryIncome:1350000}
]){
 const input={...integratedOtherInput,...change};
 for(const result of [familyTax.calculate(input),familyTax.filingTrial(input,3000),familyTax.filingPrefix(input)]){
  assert.equal(result.status,"HOLD");assert.equal(result.donationLimitYen,null);
 }
}
console.log(JSON.stringify({schema:"web-other-tax-integration/v1",integratedOtherCases,integratedOtherTrials,holdCases:10,release:"HOLD"}));

 
// Medical deduction components only; separate mutually exclusive routes.
const medicalDeductions=require("../dist/medical-deductions.js");
assert.equal(fs.readFileSync(path.resolve(__dirname,"../dist/medical-deductions.js"),"utf8"),
 fs.readFileSync(path.resolve(__dirname,"../src/medical-deductions.js"),"utf8"));
const medicalGroup=(paidYen,reimbursedYen=0)=>({paidYen,reimbursedYen,eligibilityReviewed:true});
const medicalBase={year:2025,salaryIncome:3000000,method:"ordinary",groups:[],
 conditions:"annual-salary-only-eligible-paid-expenses-compensation-reviewed"};
let medicalCases=0,medicalHoldCases=0;
for(const year of [2025,2026]){
 const b={...medicalBase,year};
 for(const [income,groups,threshold,net,applied,ignored,deduction] of [
  [3000000,[],100000,0,0,0,0],
  [3000000,[medicalGroup(99999)],100000,99999,0,0,0],
  [3000000,[medicalGroup(100000)],100000,100000,0,0,0],
  [3000000,[medicalGroup(100001)],100000,100001,0,0,1],
  [1200000,[medicalGroup(90000)],60000,90000,0,0,30000],
  [1999980,[medicalGroup(100000)],99999,100000,0,0,1],
  [2000000,[medicalGroup(100001)],100000,100001,0,0,1],
  [0,[medicalGroup(10000)],0,10000,0,0,10000],
  [3000000,[medicalGroup(80000,120000),medicalGroup(180000,20000)],100000,160000,100000,40000,60000],
  [3000000,[medicalGroup(100000,1000000),medicalGroup(300000)],100000,300000,100000,900000,200000],
  [3000000,[medicalGroup(2099999)],100000,2099999,0,0,1999999],
  [3000000,[medicalGroup(2100000)],100000,2100000,0,0,2000000],
  [3000000,[medicalGroup(3000000)],100000,3000000,0,0,2000000]
 ]){
  const x=medicalDeductions.calculate({...b,salaryIncome:income,groups});
  assert.equal(x.status,"COMPONENTS_ONLY",x.reason);const c=x.calculation;
  assert.deepEqual([c.thresholdYen,c.netEligibleYen,c.reimbursementAppliedYen,c.excessReimbursementIgnoredYen,
   c.nationalDeductionYen,c.residentDeductionYen,c.adjustmentDifferenceYen,c.requiresFilingToClaim,
   c.oneStopAllowedWhenClaimed,x.donationLimitYen,x.release],
   [threshold,net,applied,ignored,deduction,deduction,0,true,false,null,"HOLD"]);
  medicalCases++;
 }
 for(const [groups,net,deduction] of [
  [[medicalGroup(11999)],11999,0],[[medicalGroup(12000)],12000,0],
  [[medicalGroup(12001)],12001,1],[[medicalGroup(99999)],99999,87999],
  [[medicalGroup(100000)],100000,88000],[[medicalGroup(200000)],200000,88000],
  [[medicalGroup(5000,9000),medicalGroup(30000,1000)],29000,17000]
 ]){
  const x=medicalDeductions.calculate({...b,method:"selfMedication",healthMeasureReviewed:true,groups});
  assert.equal(x.status,"COMPONENTS_ONLY",x.reason);const c=x.calculation;
  assert.deepEqual([c.thresholdYen,c.capYen,c.netEligibleYen,c.nationalDeductionYen,c.residentDeductionYen,
   c.adjustmentDifferenceYen,c.requiresFilingToClaim,c.oneStopAllowedWhenClaimed,x.donationLimitYen],
   [12000,88000,net,deduction,deduction,0,true,false,null]);
  medicalCases++;
 }
}
for(const change of [
 {year:2027},{salaryIncome:-1},{salaryIncome:1999999},{salaryIncome:"3000000"},
 {method:"both"},{method:"selfMedication"},{method:"selfMedication",healthMeasureReviewed:false},
 {healthMeasureReviewed:true},{groups:[medicalGroup(-1)]},{groups:[medicalGroup(0,-1)]},
 {groups:[medicalGroup(1.5)]},{groups:[{...medicalGroup(10000),eligibilityReviewed:false}]},
 {groups:[{...medicalGroup(10000),name:"fictional"}]},{groups:null},
 {conditions:"unreviewed"},{ordinaryAndSelf:true}
]){
 const x=medicalDeductions.calculate({...medicalBase,...change});
 assert.equal(x.status,"HOLD");assert.equal(x.calculation,null);assert.equal(x.donationLimitYen,null);
 medicalHoldCases++;
}
console.log(JSON.stringify({schema:"web-medical-deductions/v1",medicalCases,medicalHoldCases,
 independentLiteralCases:true,uiIntegrated:false,donationIntegrated:false,release:"HOLD"}));

// Medical filing integration: two deduction routes, both tax years,
// both municipalities, independent BigInt oracle with fixed tax bases.
const medicalFilingInput={...integratedOtherInput,
 conditions:"salary-basic-social-family-insurance-other-medical-filing-reviewed",
 medicalDeductions:{method:"ordinary",groups:[medicalGroup(100000,1000000),medicalGroup(300000)],
  conditions:medicalBase.conditions}};
let medicalIntegratedCases=0,medicalIntegratedTrials=0,medicalFilingHoldCases=0;
for(const year of [2025,2026])for(const municipality of ["standard","designated"])
 for(const method of ["ordinary","selfMedication"]){
 const medicalDeductions=method==="ordinary"?medicalFilingInput.medicalDeductions:
  {method,groups:[medicalGroup(150000)],conditions:medicalBase.conditions,healthMeasureReviewed:true};
 const input={...medicalFilingInput,year,municipality,medicalDeductions};
 const deduction=method==="ordinary"?200000:88000;
 const nTax=(year===2025?1410000:1030000)-deduction;
 const localTax=1857000-deduction;
 const specialBase=(year===2025?1487000:1127000)-deduction;
 const shares=municipality==="standard"?[3n,2n]:[4n,1n];
 const raw=method==="ordinary"?
  (municipality==="standard"?[9432000,6288000]:[12576000,3144000]):
  (municipality==="standard"?[10104000,6736000]:[13472000,3368000]);
 const assessed=raw.map(x=>Math.floor(x/10000)*100);
 function oracle(d){
  const base=BigInt(d)-2000n,n=BigInt(nTax);
  const after=n>base?(n-base)/1000n*1000n:0n;
  const tax=x=>x/20n+(x/20n)*21n/1000n;
  const ns=tax(n)-tax(after);
  const local=shares.map((share,i)=>{
   const a=base*84895n*share,cap=BigInt(raw[i])*1000n;
   const credit=(base*share*10000n+(a<cap?a:cap)+499999n)/500000n;
   const remaining=BigInt(raw[i])-credit*100n;
   return BigInt(assessed[i])-(remaining>0n?remaining/10000n*100n:0n);
  });
  return [ns,...local,BigInt(d)-ns-local[0]-local[1]].map(Number);
 }
 const blocked=familyTax.calculate(input);assert.equal(blocked.status,"HOLD");assert.equal(blocked.donationLimitYen,null);
 for(const d of [2000,2001,2999,3000,30000,40000,50000,60000,120000,1200000]){
  const out=familyTax.filingTrial(input,d);assert.equal(out.status,"ESTIMATE",out.reason);const c=out.calculation;
  assert.deepEqual([c.nationalBefore.taxable,c.residentTaxableYen,c.nationalDeductionsYen,c.residentDeductionsYen,
   c.personalDifferenceYen,c.adjustmentYen,c.residentSpecialBaseYen,c.specialRatePercent,c.medical.nationalDeductionYen,
   c.medical.residentDeductionYen,c.filingOnly,c.oneStopAllowed],
   [nTax,localTax,4000000-nTax,4000000-localTax,170000,8500,specialBase,5,deduction,deduction,true,false]);
  assert.deepEqual([c.city.beforeYen,c.prefecture.beforeYen],assessed);
  assert.deepEqual([c.nationalSavingYen,c.city.savingYen,c.prefecture.savingYen,c.selfPayYen],oracle(d));
  medicalIntegratedTrials++;
 }
 let ceiling=2000,firstFailure=null;
 for(let d=3000;d<=1200000;d+=1000){if(oracle(d)[3]>2000){firstFailure=d;break;}ceiling=d;}
 const prefix=familyTax.filingPrefix(input);assert.equal(prefix.status,"ESTIMATE");
 assert.equal(prefix.donationLimitYen,ceiling);
 assert.deepEqual([prefix.calculation.firstFailureYen,prefix.calculation.filingOnly,prefix.calculation.oneStopAllowed],
  [firstFailure,true,false]);
 medicalIntegratedCases++;
}
// Zero deduction is still filing-only but all monetary calculations match.
const zeroMedical={...medicalFilingInput,medicalDeductions:{...medicalFilingInput.medicalDeductions,groups:[]}};
const normalTrial=familyTax.filingTrial(integratedOtherInput,40000);
const zeroTrial=familyTax.filingTrial(zeroMedical,40000);
assert.equal(zeroTrial.status,"ESTIMATE");assert.equal(zeroTrial.calculation.medical.nationalDeductionYen,0);
for(const k of ["nationalBefore","nationalAfter","city","prefecture","nationalSavingYen","residentSavingYen","selfPayYen"])
 assert.deepEqual(zeroTrial.calculation[k],normalTrial.calculation[k]);
assert.equal(familyTax.filingPrefix(zeroMedical).donationLimitYen,familyTax.filingPrefix(integratedOtherInput).donationLimitYen);
assert.equal(familyTax.calculate(zeroMedical).status,"HOLD");
for(const change of [
 {conditions:"salary-basic-social-family-insurance-other-only-reviewed"},
 {medicalDeductions:null},{medicalDeductions:undefined},
 {medicalDeductions:{...medicalFilingInput.medicalDeductions,method:"both"}},
 {medicalDeductions:{...medicalFilingInput.medicalDeductions,method:"selfMedication"}},
 {medicalDeductions:{...medicalFilingInput.medicalDeductions,year:2026}},
 {medicalDeductions:{...medicalFilingInput.medicalDeductions,salaryIncome:4000000}},
 {medicalDeductions:{...medicalFilingInput.medicalDeductions,groups:[medicalGroup(-1)]}},
 {medicalDeductions:{...medicalFilingInput.medicalDeductions,conditions:"unreviewed"}},
 {medicalDeductions:{...medicalFilingInput.medicalDeductions,groups:[medicalGroup(3000000)]}},
 {otherDeductions:{...integratedOther,smallEnterpriseContributions:800001}},
 {salaryIncome:1999999},{hasMortgage:true}
]){
 const input={...medicalFilingInput,...change};
 for(const result of [familyTax.calculate(input),familyTax.filingTrial(input,3000),familyTax.filingPrefix(input)]){
  assert.equal(result.status,"HOLD");assert.equal(result.donationLimitYen,null);assert.equal(result.calculation,null);
 }
 medicalFilingHoldCases++;
}
for(const d of [1999,1200001,3000.5,"3000"]){
 const result=familyTax.filingTrial(medicalFilingInput,d);assert.equal(result.status,"HOLD");assert.equal(result.calculation,null);
}
console.log(JSON.stringify({schema:"web-medical-tax-integration/v1",medicalIntegratedCases,medicalIntegratedTrials,
 medicalFilingHoldCases,zeroMedicalParity:true,oneStopBlocked:true,uiIntegrated:false,actualExcelCOM:false,release:"HOLD"}));

// High salary adjustment: independent annual facts, not a family deduction claim.
const salaryAdjustment=require("../dist/salary-adjustment.js");
assert.equal(fs.readFileSync(path.resolve(__dirname,"../dist/salary-adjustment.js"),"utf8"),
 fs.readFileSync(path.resolve(__dirname,"../src/salary-adjustment.js"),"utf8"));
const adjMember=(age,income,specialDisability=false)=>({age,income,specialDisability,relationshipReviewed:true});
const adjSpouse=(income,specialDisability)=>({income,specialDisability,relationshipReviewed:true});
const adjBase={year:2025,grossSalary:9000000,selfSpecialDisability:false,spouse:null,relatives:[],
 conditions:"annual-resident-salary-only-adjustment-facts-reviewed"};
let salaryAdjustmentCases=0,salaryAdjustmentHoldCases=0;
for(const year of [2025,2026]){
 const threshold=year===2025?580000:620000;
 const base={...adjBase,year};
 for(const [gross,before,adj] of [
  [8500000,6550000,0],[8500001,6550001,1],[8500010,6550010,1],
  [8500011,6550011,2],[9000000,7050000,50000],
  [9999999,8049999,150000],[10000000,8050000,150000],
  [10000001,8050001,150000],[20000000,18050000,150000]
 ]){
  for(const qualify of [false,true]){
   const result=salaryAdjustment.calculate({...base,grossSalary:gross,selfSpecialDisability:qualify});
   assert.equal(result.status,"COMPONENTS_ONLY",result.reason);const c=result.calculation;
   assert.deepEqual([c.salaryDeductionYen,c.salaryIncomeBeforeAdjustmentYen,c.salaryAdjustmentYen,
    c.salaryIncomeAfterAdjustmentYen,c.eligible,result.donationLimitYen],
    [1950000,before,qualify?adj:0,before-(qualify?adj:0),qualify&&gross>8500000,null]);
   salaryAdjustmentCases++;
  }
 }
 for(const [change,expected] of [
  [{relatives:[adjMember(0,0)]},true],
  [{relatives:[adjMember(22,threshold)]},true],
  [{relatives:[adjMember(22,threshold+1)]},false],
  [{relatives:[adjMember(23,threshold)]},false],
  [{relatives:[adjMember(23,threshold,true)]},true],
  [{relatives:[adjMember(80,threshold+1,true)]},false],
  [{relatives:[adjMember(80,threshold,true)]},true],
  [{spouse:adjSpouse(threshold,true)},true],
  [{spouse:adjSpouse(threshold+1,true)},false],
  [{spouse:adjSpouse(threshold,false)},false],
  [{selfSpecialDisability:true,spouse:adjSpouse(0,true),relatives:[adjMember(22,0,true)]},true]
 ]){
  const result=salaryAdjustment.calculate({...base,...change});assert.equal(result.status,"COMPONENTS_ONLY");
  assert.equal(result.calculation.eligible,expected);
  assert.equal(result.calculation.salaryAdjustmentYen,expected?50000:0);
  assert.equal(result.calculation.salaryIncomeAfterAdjustmentYen,expected?7000000:7050000);
  salaryAdjustmentCases++;
 }
}
for(const change of [
 {year:2024},{year:2027},{grossSalary:8499999},{grossSalary:20000001},{grossSalary:9000000.5},
 {grossSalary:"9000000"},{selfSpecialDisability:1},{spouse:{...adjSpouse(0,true),relationshipReviewed:false}},
 {spouse:adjSpouse(-1,true)},{spouse:undefined},{relatives:null},
 {relatives:[adjMember(-1,0)]},{relatives:[adjMember(131,0)]},
 {relatives:[{...adjMember(20,0),relationshipReviewed:false}]},
 {relatives:[{...adjMember(20,0),name:"fictional"}]},
 {conditions:"unreviewed"},{pensionIncome:100000},{adjustmentYen:100000}
]){
 const result=salaryAdjustment.calculate({...adjBase,...change});
 assert.equal(result.status,"HOLD");assert.equal(result.calculation,null);assert.equal(result.donationLimitYen,null);
 salaryAdjustmentHoldCases++;
}
// Under the 2026 threshold the same anonymous family facts may newly qualify.
const thresholdCase={...adjBase,relatives:[adjMember(22,600000)]};
assert.equal(salaryAdjustment.calculate(thresholdCase).calculation.salaryAdjustmentYen,0);
assert.equal(salaryAdjustment.calculate({...thresholdCase,year:2026}).calculation.salaryAdjustmentYen,50000);
// Current low-income and high-income unsupported paths cannot acquire an
// estimate by injecting the component into the old public calculation.
assert.equal(familyTax.calculate({...familyTaxInput,salaryIncome:7000000}).status,"HOLD");
assert.equal(familyTax.calculate({...familyTaxInput,salaryAdjustmentYen:50000}).status,"HOLD");
console.log(JSON.stringify({schema:"web-salary-adjustment/v1",salaryAdjustmentCases,salaryAdjustmentHoldCases,
 independentLiteralCases:true,donationIntegrated:false,uiIntegrated:false,release:"HOLD"}));

// High salary integration: the salary adjustment is derived from gross and
// independent eligibility, not an externally supplied adjusted income.
const highTax={socialAndContributions:800000,municipality:"standard",spouse:null,relatives:[],
 conditions:"salary-basic-social-family-insurance-other-only-reviewed",premiums:{...premiumsZero},
 otherDeductions:{disability:{self:"none",spouse:"none",relatives:[]},
  maritalRelief:"none",childIndex:null,workingStudent:false,smallEnterpriseContributions:100000}};
const highBase={adjustment:{...adjBase,relatives:[adjMember(10,0)]},tax:highTax};
let highCases=0,highTrials=0,highHoldCases=0;
for(const year of [2025,2026])for(const municipality of ["standard","designated"]){
 for(const [gross,qualifies,income,social] of [
  [8500000,true,6550000,800000],[8500001,true,6550000,800000],
  [8500001,false,6550001,800000],[9000000,true,7000000,800000],
  [9000000,false,7050000,800000],[10000000,true,7900000,800000],
  [10000000,false,8050000,0],[10000000,false,8050000,480000],
  [10000000,false,8050000,480001],[10000000,false,8050000,520000],
  [10000000,false,8050000,520001]
 ]){
  const input={adjustment:{...adjBase,year,grossSalary:gross,relatives:qualifies?[adjMember(10,0)]:[]},
   tax:{...highTax,municipality,socialAndContributions:social,
    otherDeductions:{...highTax.otherDeductions,smallEnterpriseContributions:Math.min(100000,social)}}};
  const basic=income<=6550000?(year===2025?630000:670000):(year===2025?580000:620000);
  const nDed=basic+social,rDed=430000+social;
  const nTax=Math.floor((income-nDed)/1000)*1000,rTax=Math.floor((income-rDed)/1000)*1000;
  const specialBase=rTax-50000-(basic-480000),rate=specialBase<=6950000?20:23;
  const ratio=BigInt(90000-rate*1021),shares=municipality==="standard"?[3n,2n]:[4n,1n];
  const raw=shares.map(s=>BigInt(rTax)*s*2n-50000n*s);
  const assessed=raw.map(x=>x/10000n*100n);
  const tax=x=>{
   const national=x<=1950000n?x*5n/100n:x<=3300000n?x*10n/100n-97500n:
    x<=6950000n?x*20n/100n-427500n:x*23n/100n-636000n;
   return national+national*21n/1000n;
  };
  const result=familyTax.highSalaryCalculate(input);assert.equal(result.status,"ESTIMATE",result.reason);
  const c=result.calculation;
  assert.deepEqual([c.salaryAdjustment.salaryIncomeAfterAdjustmentYen,c.nationalBasicYen,c.nationalDeductionsYen,
   c.residentDeductionsYen,c.nationalTaxableYen,c.residentTaxableYen,c.residentSpecialBaseYen,
   c.specialRatePercent,c.nationalBefore.total,c.adjustmentYen,c.city.assessedYen,c.prefecture.assessedYen],
   [income,basic,nDed,rDed,nTax,rTax,specialBase,rate,Number(tax(BigInt(nTax))),2500,...assessed.map(Number)]);
  const limits=shares.map((s,i)=>2000n+assessed[i]*100000n/(ratio*s));
  assert.equal(result.donationLimitYen,Math.floor(Math.min(...limits.map(Number))/1000)*1000);
  function oracle(d){
   const base=BigInt(d)-2000n;
   // Use the unfloored national base; odd gross and social amounts matter.
   const afterBase=BigInt(income-nDed)-base;
   const after=afterBase>0n?afterBase/1000n*1000n:0n;
   const ns=tax(BigInt(nTax))-tax(after);
   const local=shares.map((s,i)=>{
    const a=base*ratio*s,cap=raw[i]*1000n;
    const credit=(base*s*10000n+(a<cap?a:cap)+499999n)/500000n;
    const remaining=raw[i]-credit*100n;
    return assessed[i]-(remaining>0n?remaining/10000n*100n:0n);
   });
   return [ns,...local,BigInt(d)-ns-local[0]-local[1]].map(Number);
  }
  for(const d of [2000,2001,2999,3000,100000,result.donationLimitYen,result.donationLimitYen+1000,300000]){
   const a=familyTax.highSalaryFilingTrial(input,d);assert.equal(a.status,"ESTIMATE",a.reason);
   const x=a.calculation;
   assert.deepEqual([x.nationalSavingYen,x.city.savingYen,x.prefecture.savingYen,x.selfPayYen],oracle(d));
   highTrials++;
  }
  let ceiling=2000;
  for(let d=3000;d<=Math.floor(income*3/10);d+=1000){if(oracle(d)[3]>2000)break;ceiling=d;}
  assert.equal(familyTax.highSalaryFilingPrefix(input).donationLimitYen,ceiling);
  highCases++;
 }
}
// A claimed dependent is only a subset of the adjustment witnesses.
// An unclaimed child can still qualify the taxpayer for salary adjustment.
const claimed={...highBase,tax:{...highTax,relatives:[relative(10,0)],
 otherDeductions:{...highTax.otherDeductions,disability:{self:"none",spouse:"none",relatives:["none"]}}}};
assert.equal(familyTax.highSalaryCalculate(claimed).status,"ESTIMATE");
assert.equal(familyTax.highSalaryCalculate(highBase).calculation.salaryAdjustment.salaryAdjustmentYen,50000);
const highMedical={...highBase,tax:{...highTax,
 conditions:"salary-basic-social-family-insurance-other-medical-filing-reviewed",
 medicalDeductions:{method:"ordinary",groups:[medicalGroup(200000)],conditions:medicalBase.conditions}}};
assert.equal(familyTax.highSalaryCalculate(highMedical).status,"HOLD");
assert.equal(familyTax.highSalaryFilingTrial(highMedical,100000).calculation.medical.nationalDeductionYen,100000);
assert.equal(familyTax.highSalaryFilingPrefix(highMedical).calculation.oneStopAllowed,false);
for(const bad of [
 {...highBase,adjustment:{...highBase.adjustment,grossSalary:20000001}},
 {...highBase,adjustment:{...highBase.adjustment,grossSalary:8499999}},
 {...highBase,tax:{...highTax,salaryIncome:7000000}},
 {...highBase,tax:{...highTax,year:2026}},
 {...highBase,adjustment:{...highBase.adjustment,selfSpecialDisability:true}},
 {...highBase,tax:{...highTax,spouse:spouse(0)}},
 {...claimed,adjustment:{...claimed.adjustment,relatives:[]}},
 {...claimed,tax:{...claimed.tax,relatives:[relative(10,0),relative(10,0)],
  otherDeductions:{...claimed.tax.otherDeductions,disability:{self:"none",spouse:"none",relatives:["none","none"]}}}},
 {...highBase,tax:{...highTax,otherDeductions:{...highTax.otherDeductions,smallEnterpriseContributions:800001}}},
 {...highBase,adjustment:{...highBase.adjustment,conditions:"unreviewed"}},
 {...highBase,tax:{...highTax,hasMortgage:true}},
 {...highBase,tax:{...highTax,conditions:"salary-basic-social-family-only-reviewed"}}
]){
 for(const result of [familyTax.highSalaryCalculate(bad),familyTax.highSalaryFilingTrial(bad,3000),familyTax.highSalaryFilingPrefix(bad)]){
  assert.equal(result.status,"HOLD");assert.equal(result.donationLimitYen,null);assert.equal(result.calculation,null);
 }
 highHoldCases++;
}
assert.equal(familyTax.calculate({...familyTaxInput,salaryIncome:7000000}).status,"HOLD");
console.log(JSON.stringify({schema:"web-high-salary-tax-integration/v1",highCases,highTrials,highHoldCases,
 independentBigInt:true,highGrossMaxTested:10000000,uiIntegrated:false,actualExcelCOM:false,release:"HOLD"}));

// Above 10m gross through 20m. Literal spouse bands and independent
// municipal/national bases, including the 33% transition and adjustment.
{
 let upperCases=0,upperTrials=0,upperHoldCases=0;
 const cases=[
 // gross, child witness, adjusted salary income, spouse age/income,
 // expected national/resident spouse deduction, statutory personal difference
 [10000001,false,8050001,null,0,0,0,0],
 [10950000,false,9000000,40,0,380000,330000,50000],
 [10950001,false,9000001,40,0,260000,220000,40000],
 [11450000,false,9500000,40,0,260000,220000,40000],
 [11450001,false,9500001,40,0,130000,110000,20000],
 [11950000,false,10000000,40,0,130000,110000,20000],
 [11950001,false,10000001,40,0,0,0,0],
 [11100000,true,9000000,40,0,380000,330000,50000],
 [12100000,true,10000000,40,0,130000,110000,20000],
 [12100001,true,10000001,40,0,0,0,0],
 [10950000,false,9000000,75,0,480000,380000,100000],
 [10950001,false,9000001,75,0,320000,260000,60000],
 [11450001,false,9500001,75,0,160000,130000,30000],
 [11950001,false,10000001,75,0,0,0,0],
 [10950000,false,9000000,40,800000,380000,330000,0],
 [10950001,false,9000001,40,800000,260000,220000,0],
 [11450001,false,9500001,40,800000,130000,110000,0],
 [11950001,false,10000001,40,800000,0,0,0],
 [11530000,false,9580000,null,0,0,0,0],
 [11531000,false,9581000,null,0,0,0,0],
 [11570000,false,9620000,null,0,0,0,0],
 [11571000,false,9621000,null,0,0,0,0],
 [15000000,true,12900000,null,0,0,0,0],
 [20000000,true,17900000,40,0,0,0,0],
 [20000000,false,18050000,null,0,0,0,0]
 ];
 for(const year of [2025,2026])for(const municipality of ["standard","designated"])
 for(const [gross,child,income,age,spIncome,nSp,rSp,spDiff] of cases){
  const social=gross>=15000000?1800000:0;
  const input={adjustment:{...adjBase,year,grossSalary:gross,
   spouse:age===null?null:adjSpouse(spIncome,false),relatives:child?[adjMember(10,0)]:[]},
   tax:{...highTax,municipality,spouse:age===null?null:spouse(spIncome,age),socialAndContributions:social,
    otherDeductions:{...highTax.otherDeductions,smallEnterpriseContributions:Math.min(100000,social)}}};
  const basic=year===2025?580000:620000;
  const nDed=basic+social+nSp,rDed=430000+social+rSp;
  const nTax=Math.floor((income-nDed)/1000)*1000,rTax=Math.floor((income-rDed)/1000)*1000;
  const diff=50000+spDiff,specialBase=rTax-diff-(basic-480000);
  const rate=specialBase<=6950000?20:specialBase<=9000000?23:33;
  const shares=municipality==="standard"?[3n,2n]:[4n,1n],ratio=BigInt(90000-rate*1021);
  const raw=shares.map(s=>BigInt(rTax)*s*2n-50000n*s),assessed=raw.map(v=>v/10000n*100n);
  // Marginal band sum, not the production quick-deduction formula.
  function tax(x){
   let left=x,sum=0n;
   for(const [width,pct] of [[1950000n,5n],[1350000n,10n],[3650000n,20n],[2050000n,23n],[9000000n,33n]]){
    const slice=left<width?left:width;sum+=slice*pct/100n;left-=slice;
   }
   assert.equal(left,0n);return sum+sum*21n/1000n;
  }
  const result=familyTax.highSalaryCalculate(input);assert.equal(result.status,"ESTIMATE",result.reason);
  const c=result.calculation;
  assert.deepEqual([c.salaryAdjustment.salaryIncomeAfterAdjustmentYen,c.nationalBasicYen,
   c.family.nationalFamilyDeductionYen,c.family.residentFamilyDeductionYen,c.personalDifferenceYen,
   c.nationalDeductionsYen,c.residentDeductionsYen,c.nationalTaxableYen,c.residentTaxableYen,
   c.nationalBefore.total,c.residentSpecialBaseYen,c.specialRatePercent,c.adjustmentYen,
   c.city.assessedYen,c.prefecture.assessedYen],
   [income,basic,nSp,rSp,diff,nDed,rDed,nTax,rTax,Number(tax(BigInt(nTax))),specialBase,rate,2500,...assessed.map(Number)]);
  const caps=shares.map((s,i)=>2000n+assessed[i]*100000n/(ratio*s));
  const limit=Math.floor(Math.min(...caps.map(Number))/1000)*1000;
  assert.equal(result.donationLimitYen,limit);
  function oracle(d){
   const base=BigInt(d)-2000n;
   const remaining=BigInt(income-nDed)-base;
   const after=remaining>0n?remaining/1000n*1000n:0n;
   const ns=tax(BigInt(nTax))-tax(after);
   const local=shares.map((s,i)=>{
    const special=base*ratio*s,cap=raw[i]*1000n;
    const credit=(base*s*10000n+(special<cap?special:cap)+499999n)/500000n;
    const rest=raw[i]-credit*100n;
    return assessed[i]-(rest>0n?rest/10000n*100n:0n);
   });
   return [ns,...local,BigInt(d)-ns-local[0]-local[1]].map(Number);
  }
  for(const d of [2000,2001,3000,100000,limit,limit+1000,600000,Math.floor(income*3/10)]){
   const a=familyTax.highSalaryFilingTrial(input,d);assert.equal(a.status,"ESTIMATE",a.reason);
   const x=a.calculation;
   assert.deepEqual([x.nationalSavingYen,x.city.savingYen,x.prefecture.savingYen,x.selfPayYen],oracle(d));
   upperTrials++;
  }
  let ceiling=2000;
  for(let d=3000;d<=Math.floor(income*3/10);d+=1000){if(oracle(d)[3]>2000)break;ceiling=d;}
  assert.equal(familyTax.highSalaryFilingPrefix(input).donationLimitYen,ceiling);
  upperCases++;
 }
 const upper={adjustment:{...adjBase,grossSalary:20000000},tax:{...highTax,socialAndContributions:1800000}};
 const med={...upper,tax:{...upper.tax,conditions:"salary-basic-social-family-insurance-other-medical-filing-reviewed",
  medicalDeductions:{method:"ordinary",groups:[medicalGroup(450000,50000)],conditions:medicalBase.conditions}}};
 assert.equal(familyTax.highSalaryCalculate(med).status,"HOLD");
 const trial=familyTax.highSalaryFilingTrial(med,300000);assert.equal(trial.status,"ESTIMATE",trial.reason);
 assert.equal(trial.calculation.medical.nationalDeductionYen,300000);
 assert.equal(trial.calculation.nationalBefore.taxable,15370000);
 assert.equal(trial.calculation.oneStopAllowed,false);
 for(const bad of [
  {...upper,adjustment:{...upper.adjustment,grossSalary:20000001}},
  {...upper,adjustment:{...upper.adjustment,year:2027}},
  {...upper,tax:{...upper.tax,otherIncome:1000}},
  {...upper,tax:{...upper.tax,otherDeductions:{...highTax.otherDeductions,maritalRelief:"widowBereaved"}}},
  {...upper,tax:{...upper.tax,otherDeductions:{...highTax.otherDeductions,workingStudent:true}}},
  {...upper,tax:{...upper.tax,otherDeductions:{...highTax.otherDeductions,smallEnterpriseContributions:1800001}}}
 ]){
  for(const result of [familyTax.highSalaryCalculate(bad),familyTax.highSalaryFilingTrial(bad,3000),familyTax.highSalaryFilingPrefix(bad)]){
   assert.equal(result.status,"HOLD");assert.equal(result.donationLimitYen,null);assert.equal(result.calculation,null);
  }
  upperHoldCases++;
 }
 console.log(JSON.stringify({schema:"web-upper-salary-tax-integration/v1",upperCases,upperTrials,upperHoldCases,
  independentMarginalBandOracle:true,highGrossMax:20000000,maxApplicableRate:33,uiIntegrated:false,actualExcelCOM:false,release:"HOLD"}));
}

// Original-year other deductions: no medical expense deduction or mortgage
// is allowed into a year-end withholding slip's deduction reconciliation.
{
 const source={...insuredSource,sourceContributionYen:240000,otherReviewed:true,
  otherDeductions:{disability:{self:"ordinary",spouse:"none",relatives:["none"]},
   maritalRelief:"none",childIndex:null,workingStudent:false,smallEnterpriseContributions:240000},
  indicators:{...insuredSource.indicators,hasDisability:true,hasSmallEnterpriseContributions:true}};
 let sourceOtherCases=0,sourceOtherHoldCases=0;
 for(const [year,total,basic,life] of [[2025,3390000,680000,40000],[2026,3770000,1040000,60000]]){
  const input={...source,year,deductions:total};
  const result=sourceFamily.reconcile(input,engine);assert.equal(result.status,"RECONCILED",result.reason);
  assert.deepEqual(result.calculation,{year,salaryIncomeYen:4760000,basicYen:basic,familyYen:1010000,
   deductionsYen:total,socialInsuranceOnlyYen:1100000,sourceContributionYen:240000,
   otherYen:510000,otherWithoutContributionsYen:270000,
   lifeYen:life,earthquakeYen:50000,insuranceYen:life+50000,enhancedGeneral:year===2026});
  // Removing G25 from the reviewed combined social amount's breakdown
  // must not alter the total, when the source no longer indicates G25.
  const {hasSmallEnterpriseContributions:unused,...indicators}=input.indicators;
  const zero={...input,indicators,sourceContributionYen:0,
   otherDeductions:{...input.otherDeductions,smallEnterpriseContributions:0}};
  const z=sourceFamily.reconcile(zero,engine);assert.equal(z.status,"RECONCILED");
  assert.equal(z.calculation.deductionsYen,total);
  assert.equal(z.calculation.socialInsuranceOnlyYen,1340000);
  sourceOtherCases+=2;
 }
 const validSource={...source,deductions:3390000};
 for(const patch of [
  {otherReviewed:false},{otherReviewed:undefined},{sourceContributionYen:240001},
  {sourceContributionYen:-1},{sourceContributionYen:1340001},
  {otherDeductions:{...source.otherDeductions,smallEnterpriseContributions:240001}},
  {otherDeductions:{...source.otherDeductions,unknown:true}},
  {deductions:3630000},{deductions:3390001},{year:2026},
  {medicalDeductions:{method:"ordinary"}},{indicators:{hasMortgage:true}},
  {indicators:{...source.indicators,hasWidow:true}},
  {indicators:{...source.indicators,hasSingleParent:true}},
  {indicators:{...source.indicators,hasWorkingStudent:true}},
  {sourceContributionYen:0,otherDeductions:{...source.otherDeductions,smallEnterpriseContributions:0}},
  {otherDeductions:{...source.otherDeductions,disability:{self:"none",spouse:"none",relatives:["none"]}},deductions:3120000},
  {insuranceReviewed:false},{premiums:undefined},{gross:8500001}
 ]){
  const result=sourceFamily.reconcile({...validSource,...patch},engine);
  assert.equal(result.status,"HOLD",JSON.stringify(patch));assert.equal(result.calculation,null);
  sourceOtherHoldCases++;
 }
 console.log(JSON.stringify({schema:"web-other-source-reconciliation/v1",sourceOtherCases,sourceOtherHoldCases,
  g25IncludedInG26:true,originalYearIndependent:true,uiIntegrated:false,release:"HOLD"}));
}

// High salary source-year reconciliation: independent G04/G05/G46/G47,
// G25 inside G26, verified family facts, no forecast inputs.
{
 const highSource={year:2025,gross:9000000,salaryIncome:7000000,social:1000000,deductions:1960000,
  indicators:{hasSpouse:true,hasDependents:true,hasSalaryAdjustment:true,hasSmallEnterpriseContributions:true},
  spouse:spouse(0),relatives:[relative(10,0)],reviewed:true,premiums:{...premiumsZero},insuranceReviewed:true,
  otherDeductions:{disability:{self:"none",spouse:"none",relatives:["none"]},
   maritalRelief:"none",childIndex:null,workingStudent:false,smallEnterpriseContributions:120000},
  otherReviewed:true,sourceContributionYen:120000,sourceAdjustmentYen:50000,sourceBasicYen:580000,
  adjustmentReviewed:true,adjustmentFacts:{...adjBase,spouse:adjSpouse(0,false),relatives:[adjMember(10,0)]}};
 let highSourceCases=0,highSourceHoldCases=0;
 for(const year of [2025,2026]){
  const basic=year===2025?580000:620000;
  const input={...highSource,year,sourceBasicYen:basic,deductions:basic+1380000,
   adjustmentFacts:{...highSource.adjustmentFacts,year}};
  const result=sourceFamily.reconcile(input,engine);assert.equal(result.status,"RECONCILED",result.reason);
  const c=result.calculation;
  assert.deepEqual([c.year,c.salaryIncomeYen,c.basicYen,c.familyYen,c.deductionsYen,c.sourceAdjustmentYen,
   c.salaryAdjustment.salaryIncomeBeforeAdjustmentYen,c.socialInsuranceOnlyYen,c.otherYen],
   [year,7000000,basic,380000,basic+1380000,50000,7050000,880000,120000]);
  highSourceCases++;
  // The same family income may qualify in 2026 but not 2025. No claimed
  // family deduction here, because the witness may be claimed elsewhere.
  const qualifies=year===2026,base=qualifies?670000:580000;
  const boundary={...input,gross:8500001,salaryIncome:qualifies?6550000:6550001,
   spouse:null,relatives:[],indicators:qualifies?{hasSalaryAdjustment:true}:{},
   sourceAdjustmentYen:qualifies?1:0,sourceBasicYen:base,deductions:base+1000000,
   otherDeductions:{...input.otherDeductions,disability:{self:"none",spouse:"none",relatives:[]}},
   adjustmentFacts:{...adjBase,year,grossSalary:8500001,relatives:[adjMember(10,600000)]}};
  const b=sourceFamily.reconcile(boundary,engine);assert.equal(b.status,"RECONCILED",b.reason);
  assert.equal(b.calculation.salaryIncomeYen,boundary.salaryIncome);
  highSourceCases++;
  const upper={...boundary,gross:20000000,salaryIncome:17900000,sourceAdjustmentYen:150000,
   sourceBasicYen:basic,deductions:basic+1000000,indicators:{hasSalaryAdjustment:true},
   adjustmentFacts:{...boundary.adjustmentFacts,grossSalary:20000000,relatives:[adjMember(10,0)]}};
  assert.equal(sourceFamily.reconcile(upper,engine).status,"RECONCILED");
  highSourceCases++;
 }
 for(const patch of [
  {adjustmentReviewed:false},{sourceAdjustmentYen:49999},{sourceAdjustmentYen:50001},
  {sourceAdjustmentYen:150001},{sourceBasicYen:630000},{sourceBasicYen:undefined},
  {salaryIncome:7050000},{salaryIncome:6999999},{deductions:2080000},
  {year:2026},{gross:9000001},{adjustmentFacts:{...highSource.adjustmentFacts,year:2026}},
  {adjustmentFacts:{...highSource.adjustmentFacts,grossSalary:9000001}},
  {adjustmentFacts:{...highSource.adjustmentFacts,relatives:[]}},
  {adjustmentFacts:{...highSource.adjustmentFacts,selfSpecialDisability:true}},
  {adjustmentFacts:{...highSource.adjustmentFacts,spouse:adjSpouse(0,true)}},
  {adjustmentFacts:{...highSource.adjustmentFacts,conditions:"unreviewed"}},
  {sourceContributionYen:120001},{indicators:{hasMortgage:true}},
  {medicalDeductions:{method:"ordinary"}},{gross:20000001}
 ]){
  const result=sourceFamily.reconcile({...highSource,...patch},engine);
  assert.equal(result.status,"HOLD",JSON.stringify(patch));assert.equal(result.calculation,null);
  highSourceHoldCases++;
 }
 console.log(JSON.stringify({schema:"web-high-salary-source-reconciliation/v1",highSourceCases,highSourceHoldCases,
  g04g05g46g47Reviewed:true,g25IncludedInG26:true,sourceYearIndependent:true,uiIntegrated:false,release:"HOLD"}));
}

 // Separate rational oracle for continuing mortgage interaction. This is
 // an independent calculation of synthetic amounts, NOT Excel COM evidence.
 // NTA 1155, 1210; Yokohama city R8 tax credits:
 // https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1155.htm
 // https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1210.htm
 // https://www.city.yokohama.lg.jp/kurashi/koseki-zei-hoken/zeikin/y-shizei/kojin-shiminzei-kenminzei/kojin-shiminzei-shosai/zeigakukoujoR8.html
 {
 const ft=require("../src/family-tax.js");
 const min=(a,b)=>a<b?a:b,max=(a,b)=>a>b?a:b;
 const ceil=(a,b)=>(a+b-1n)/b;
 const down=n=>max(0n,n)/1000n*1000n;
 function taxSlices(t){
  let value=0n,lower=0n;
  for(const [upper,rate] of [[1950000n,5n],[3300000n,10n],[6950000n,20n],[9000000n,23n],[18000000n,33n]]){
   value+=max(0n,min(t,upper)-lower)*rate/100n;lower=upper;
  }
  return value;
 }
 // income, social, national basic (independently tabulated), medical net.
 const inputs=[
  [2025,2020000,450000,880000,0],
  [2026,2020000,450000,1040000,0],
  [2025,3560000,750000,680000,0],
  [2026,3560000,750000,1040000,0],
  [2025,5200000,1000000,630000,0],
  [2026,5200000,1000000,670000,0],
  [2026,5200000,1000000,670000,300000]
 ];
 function independentMortgage(input,housing,mode,donation){
  const [year,income,social,basic,medicalNet]=input;
  const I=BigInt(income),S=BigInt(social),B=BigInt(basic),D=BigInt(donation)-2000n;
  const M=medicalNet===0?0n:min(2000000n,max(0n,BigInt(medicalNet)-min(100000n,I/20n)));
  const localTaxable=down(I-S-430000n-M);
  const specialBase=localTaxable-50000n-max(0n,B-480000n);
  const ratio=specialBase<=1950000n?84895n:specialBase<=3300000n?79790n:69580n;
  const rates=housing.capClass==="transitional7"?[7n,136500n]:[5n,97500n];
  const shares= housing.municipality==="standard"?[3n,2n]:[4n,1n];
  const potential=BigInt(housing.possibleYen);
  function state(d){
   const taxable=down(I-S-B-M-d),ordinary=taxSlices(taxable);
   if(ordinary===0n)return null;
   const credit=min(ordinary,potential),remainder=ordinary-credit;
   const housingCap=min(rates[1],(taxable+(housing.moveInYear<=2025?max(0n,B-480000n):0n))*rates[0]/100n);
   return {nationalCredit:credit,residentCredit:min(potential-credit,housingCap),housingCap,finalTax:remainder+remainder*21n/1000n};
  }
  const before=state(0n),after=state(mode==="return"?D:0n);
  if(!before||!after)return null;
  function bills(st,d,oneStop){
   return shares.map(share=>{
    // Independent rational units: 5,000,000 * ratio per yen.
    const unit=5000000n*ratio;
    const adjusted=(localTaxable*2n-min(localTaxable,50000n))*share*50000n*ratio;
    const baseCredit=d*share*100000n*ratio;
    const special=min(d*share*ratio*10n*ratio,adjusted/5n);
    // Independent integer arithmetic with two distinct whole-yen ceilings.
    const donationCredit=ceil(baseCredit+special,unit)+
     (oneStop?ceil(special*(90000n-ratio),unit*ratio):0n);
    const housingCredit=st.residentCredit*share*unit/5n;
    return max(0n,adjusted-housingCredit-donationCredit*unit)/(unit*100n)*100n;
   });
  }
  const beforeBills=bills(before,0n,false),afterBills=bills(after,D,mode==="one-stop");
  const ns=before.finalTax-after.finalTax,rs=beforeBills[0]+beforeBills[1]-afterBills[0]-afterBills[1];
  return [before.nationalCredit,before.residentCredit,before.housingCap,after.nationalCredit,after.residentCredit,after.housingCap,ns,rs,BigInt(donation)-ns-rs,...beforeBills,...afterBills].map(Number);
 }
 let trials=0,holds=0;
 for(const input of inputs){
  const [year,income,social,basic,medicalNet]=input;
  for(const municipality of ["standard","designated"])
  for(const [moveInYear,capClass] of [[2020,"standard5"],[2020,"transitional7"],[2026,"standard5"]])
  for(const possibleYen of [10000,70000,180000,300000,500000])
  for(const filing of ["one-stop","return"]){
   if(moveInYear>year||(moveInYear===year&&filing==="one-stop")||(medicalNet&&filing==="one-stop"))continue;
   const housing={moveInYear,capClass,possibleYen,eligibilityReviewed:true};
   const tax={year,salaryIncome:income,socialInsurance:social,municipality,spouse:null,relatives:[],conditions:"salary-basic-social-family-only-reviewed",...(medicalNet?{medicalNetPaidYen:medicalNet}:{})};
   for(const donation of [2000,3000,17000,50000,100000,200000]){
    const out=ft.mortgageTrial({tax,housing,filing},donation);
    const expected=independentMortgage(input,{...housing,municipality},filing,donation);
    if(!expected){assert.equal(out.status,"HOLD");assert.equal(out.donationLimitYen,null);holds++;continue;}
    assert.equal(out.status,"COMPONENTS_ONLY",JSON.stringify({input,housing,filing,donation}));
    assert.equal(out.donationLimitYen,null);
    const c=out.calculation;
    const actual=[c.before.nationalHousingYen,c.before.residentHousingYen,c.before.localCapYen,c.after.nationalHousingYen,c.after.residentHousingYen,c.after.localCapYen,c.nationalSavingYen,c.residentSavingYen,c.selfPayYen,...c.localBefore,...c.localAfter.map(x=>x.assessedYen)];
    assert.deepEqual(actual,expected,JSON.stringify({input,housing,filing,donation,municipality}));
    trials++;
   }
  }
 }
 console.log(JSON.stringify({schema:"web-mortgage-independent-rational-oracle/v1",trials,holds,excelCOM:false,release:"HOLD"}));
 }

// Cross-version regression against successful Windows Excel assertions,
// not a new Excel execution. Synthetic cases transcribed from
// tools/verify_excel.ps1 at 0ec8b7388d6e95a6d9aefd54bcb61a4f40ad25a6.
// Run 45285773301 / job 138082615703 completed successfully and logged
// family-mortgage-donation-matrix-pass and both
// insurance-cross-tax-independent-compare-{2025,2026}-pass.
// https://github.com/tanaka456jp/Furusato_nouzei/actions/runs/45285773301/job/138082615703
// For age bands that Excel supplies as counts, representative ages are
// used, with zero income, domestic eligible relatives; no actual tax data.
// Mortgage prefix is a component-level conservative reference, not a
// standalone UI estimate. Never promote this test to release approval.
{
 const base={salaryIncome:5200000,socialInsurance:1000000,municipality:"standard",conditions:"salary-basic-social-family-only-reviewed",spouse:null,relatives:[]};
 let matched=0;
 for(const [year,kind,ded,levy,lim,nat,house] of [
 [2025,0,1630000,374500,109000,286500,13500],
 [2025,1,2010000,341500,87000,221500,78500],
 [2025,2,2390000,308500,79000,183500,97500],
 [2025,3,2640000,296500,76000,158500,97500],
 [2026,0,1670000,374500,109000,278500,21500],
 [2026,1,2050000,341500,87000,217500,82500],
 [2026,2,2430000,308500,79000,179500,97500],
 [2026,3,2680000,296500,76000,154500,97500]
 ]){
  const input={...base,year,spouse:kind?spouse(0):null,relatives:kind===2?[relative(16),relative(14),relative(12)]:kind===3?[relative(20)]:[]};
  const out=familyTax.calculate(input);
  assert.equal(out.status,"ESTIMATE");
  const mortgage=familyTax.mortgagePrefix({tax:input,housing:{moveInYear:2024,capClass:"standard5",possibleYen:300000,eligibilityReviewed:true},filing:"one-stop"});
  assert.equal(mortgage.status,"COMPONENTS_ONLY");
  assert.equal(mortgage.donationLimitYen,null);
  assert.deepEqual([out.calculation.nationalDeductionsYen,out.calculation.residentIncomeLevyYen,mortgage.calculation.conservativePrefixYen,mortgage.calculation.atPrefix.before.preCreditIncomeTaxYen,mortgage.calculation.atPrefix.before.residentHousingYen],[ded,levy,lim,nat,house],year+"/"+kind);
  matched++;
 }
 for(const [year,under,life,pension,earth,ded,levy,lim,lifed,earthd] of [
 [2025,0,50000,50000,10902,1705902,368500,107000,65000,10902],
 [2026,1,120000,0,0,1730000,371600,108000,60000,0]
 ]){
  const input={...base,year,relatives:under?[relative(14)]:[],conditions:"salary-basic-social-family-insurance-only-reviewed",premiums:{generalNew:life,generalOld:0,medicalNew:0,pensionNew:pension,pensionOld:0,earthquake:earth,longTermOld:0}};
  const out=familyTax.calculate(input);
  assert.equal(out.status,"ESTIMATE");
  assert.deepEqual([out.calculation.nationalDeductionsYen,out.calculation.residentIncomeLevyYen,out.donationLimitYen,out.calculation.insurance.national.lifeYen,out.calculation.insurance.national.earthquakeYen],[ded,levy,lim,lifed,earthd],String(year));
  matched++;
 }
 assert.equal(matched,10);
 console.log(JSON.stringify({schema:"web-excel-v41836-additional-deduction-regression/v1",matched,excelEvidenceRun:45285773301,excelEvidenceJob:138082615703,excelNewExecution:false,release:"HOLD"}));
}

// Existing Windows COM evidence, NOT a new Excel execution:
// tools/verify_excel.ps1 @ 0ec8b7388d6e95a6d9aefd54bcb61a4f40ad25a6
// https://github.com/tanaka456jp/Furusato_nouzei/actions/runs/45285773301/job/138082615703
// QA_STAGE under23-salary-adjustment-yen-boundaries-pass and
// prior-year-projection-independent-resident-compare-pass.
// Synthetic data only; representative age 14 for the under-16 count.
{
 let adjustmentCases=0,projectionCases=0;
 for(const year of [2025,2026])for(const [gross,expected] of [
  [8500000,0],[8500001,1],[8500009,1],[8500010,1],
  [8500011,2],[9000001,50001],[9999999,150000],[10000001,150000]
 ]){
  const input={year,grossSalary:gross,selfSpecialDisability:false,spouse:null,relatives:[],conditions:"annual-resident-salary-only-adjustment-facts-reviewed"};
  const control=salaryAdjustment.calculate(input);
  const child=salaryAdjustment.calculate({...input,relatives:[adjMember(14,0)]});
  assert.equal(control.status,"COMPONENTS_ONLY");
  assert.equal(child.status,"COMPONENTS_ONLY");
  assert.equal(control.calculation.salaryIncomeAfterAdjustmentYen-child.calculation.salaryIncomeAfterAdjustmentYen,expected);
  assert.equal(child.calculation.salaryAdjustmentYen,expected);
  assert.equal(Number.isInteger(child.calculation.salaryIncomeAfterAdjustmentYen),true);
  assert.equal(child.donationLimitYen,null);
  adjustmentCases++;
 }
 for(const [under,old,oldLife,newLife,earth,lifePaid,pensionPaid,earthPaid,nd,rl,re,rd,rt,levy,limit] of [
  [false,1705902,65000,65000,10902,50000,50000,10902,1745902,53000,5451,1488451,3711000,368500,107000],
  [true,1670000,40000,60000,0,120000,0,0,1730000,28000,0,1458000,3742000,371600,108000]
 ]){
  const relatives=under?[relative(14)]:[];
  const premiums={...premiumsZero,generalNew:lifePaid,pensionNew:pensionPaid,earthquake:earthPaid};
  const original={year:2025,gross:7000000,salaryIncome:5200000,social:1000000,deductions:old,
   indicators:{hasLifeInsurance:true,...(under?{hasDependents:true}:{}),...(earth?{hasEarthquakeInsurance:true}:{})},
   spouse:null,relatives,reviewed:true,premiums,insuranceReviewed:true};
  const historical=sourceFamily.reconcile(original,engine);
  assert.equal(historical.status,"RECONCILED");
  assert.deepEqual([historical.calculation.deductionsYen,historical.calculation.lifeYen,historical.calculation.earthquakeYen],[old,oldLife,earth]);
  const forecast=familyTax.calculate({year:2026,salaryIncome:5200000,socialInsurance:1000000,municipality:"designated",spouse:null,
   relatives:relatives.map(x=>({...x,age:x.age+1})),conditions:"salary-basic-social-family-insurance-only-reviewed",premiums});
  assert.equal(forecast.status,"ESTIMATE");
  const c=forecast.calculation;
  assert.deepEqual([c.nationalDeductionsYen,c.insurance.national.lifeYen,c.insurance.national.earthquakeYen,c.insurance.resident.lifeYen,c.insurance.resident.earthquakeYen,c.residentDeductionsYen,c.residentTaxableYen,c.residentIncomeLevyYen,forecast.donationLimitYen],[nd,newLife,earth,rl,re,rd,rt,levy,limit]);
  assert.equal(sourceFamily.reconcile({...original,deductions:nd},engine).status,"HOLD");
  projectionCases++;
 }
 assert.equal(adjustmentCases,16);
 assert.equal(projectionCases,2);
 console.log(JSON.stringify({schema:"web-excel-v41836-adjustment-projection-regression/v1",adjustmentCases,projectionCases,excelEvidenceJob:138082615703,excelNewExecution:false,release:"HOLD"}));
}
// Independent medical deduction evidence; NOT Excel COM evidence.
// NTA No.1000 worked example and No.1120 ordinary medical deduction:
// https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1000.htm
// https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1120.htm
// Only exact integer 5% thresholds here; fractional-yen rounding is
// deliberately not certified by these examples.
{
 let medicalCases=0;
 for(const year of [2025,2026])for(const [income,net,threshold,ded] of [
  [4360000,440000,100000,340000],
  [1000000,49999,50000,0],[1000000,50000,50000,0],[1000000,50001,50000,1],
  [1999980,300000,99999,200001],[2000000,300000,100000,200000],
  [5200000,2099999,100000,1999999],[5200000,2100000,100000,2000000],
  [5200000,2100001,100000,2000000]
 ]){
  const out=medicalDeductions.calculateNet({year,salaryIncome:income,netEligibleYen:net});
  assert.equal(out.status,"COMPONENTS_ONLY");
  assert.deepEqual([out.calculation.thresholdYen,out.calculation.nationalDeductionYen,out.calculation.residentDeductionYen],[threshold,ded,ded]);
  assert.equal(out.calculation.requiresFilingToClaim,ded>0);
  assert.equal(out.donationLimitYen,null);
  medicalCases++;
 }
 assert.equal(medicalCases,18);
 console.log(JSON.stringify({schema:"web-medical-nta-example-and-boundaries/v1",medicalCases,excelCOM:false,fractionalYenCertified:false,release:"HOLD"}));
}

// Multi-deduction cross-boundary audit: independently tabulated household
// and insurance deductions + progressive integer tax slices.
// NTA No.1411, 1140, 1180, 1120, 2260; Otsu resident special-credit table;
// Yokohama resident mortgage credit (continuing 2024 occupancy).
// https://www.city.otsu.lg.jp/soshiki/005/1215/g/shimin/koujo/28359.html
// https://www.city.yokohama.lg.jp/kurashi/koseki-zei-hoken/zeikin/y-shizei/kojin-shiminzei-kenminzei/kojin-shiminzei-shosai/zeigakukoujoR8.html
// Synthetic only. Tests the documented conservative prefix and existing
// resident rounding model, not new Excel evidence or legal certification.
{
 const min=(a,b)=>a<b?a:b,max=(a,b)=>a>b?a:b;
 const floorTax=x=>max(0n,x)/1000n*1000n;
 const bands=[[1950000n,5n],[3300000n,10n],[6950000n,20n],[9000000n,23n],[18000000n,33n]];
 function ordinary(x){
  let start=0n,result=0n;
  for(const [end,rate] of bands){
   result+=max(0n,min(x,end)-start)*rate/100n;
   start=end;
  }
  return result;
 }
 let scenarios=0,filingTrials=0,mortgageTrials=0,prefixes=0,holdCases=0;
 for(const year of [2025,2026])
 for(const municipality of ["standard","designated"])
 for(const [boundary,gross,income] of [[1950000,9000000,7000000],[3300000,9000000,7000000],[6950000,12000000,9900000],[9000000,15000000,12900000]])
 for(const delta of [-1000,0,1000]){
  // 20-year-old qualifying dependent: 630k national/450k local,
  // 180k personal difference. General new 120k + care 40k:
  // national life 70k/90k, resident life 52k. Earthquake 20k/10k.
  // 300k net medical -> 200k deduction. No spouse or other income.
  const basic=year===2025?580000:620000;
  const life=year===2025?70000:90000;
  const nationalNonSocial=basic+630000+life+20000+200000;
  const residentNonSocial=430000+450000+52000+10000+200000;
  const localTaxable=boundary+delta+230000+basic-480000;
  const social=income-residentNonSocial-localTaxable;
  const nationalDed=social+nationalNonSocial,residentDed=social+residentNonSocial;
  const nationalTaxable=floorTax(BigInt(income-nationalDed));
  const specialBase=boundary+delta;
  const rate=bands.find(([end])=>BigInt(specialBase)<=end)[1];
  const ratio=90000n-rate*1021n;
  const shares=municipality==="standard"?[3n,2n]:[4n,1n];
  // All cases have local taxable above 2.18m, so the adjustment
  // credit is 2,500 yen (5% of the 50,000 floor).
  // Use 100ths of yen for the unrounded municipal/prefectural levy.
  const raw=shares.map(s=>BigInt(localTaxable)*s*2n-50000n*s);
  const bills=raw.map(v=>v/10000n*100n);
  const input={
   adjustment:{year,grossSalary:gross,selfSpecialDisability:false,spouse:null,relatives:[adjMember(20,0)],conditions:"annual-resident-salary-only-adjustment-facts-reviewed"},
   tax:{socialAndContributions:social,municipality,spouse:null,relatives:[relative(20)],
    conditions:"salary-basic-social-family-insurance-other-only-reviewed",
    premiums:{...premiumsZero,generalNew:120000,medicalNew:40000,earthquake:20000},
    otherDeductions:{disability:{self:"none",spouse:"none",relatives:["none"]},maritalRelief:"none",childIndex:null,workingStudent:false,smallEnterpriseContributions:0},
    medicalNetPaidYen:300000}
  };
  const c=familyTax.highSalaryMedicalFilingCalculation(input);
  assert.equal(c.status,"ESTIMATE",c.reason);
  assert.equal(c.donationLimitYen,null);
  assert.deepEqual([c.calculation.salaryAdjustment.salaryIncomeAfterAdjustmentYen,c.calculation.nationalDeductionsYen,c.calculation.residentDeductionsYen,c.calculation.nationalTaxableYen,c.calculation.residentTaxableYen,c.calculation.residentSpecialBaseYen,c.calculation.specialRatePercent,c.calculation.city.assessedYen,c.calculation.prefecture.assessedYen],
   [income,nationalDed,residentDed,Number(nationalTaxable),localTaxable,specialBase,Number(rate),...bills.map(Number)]);
  assert.equal(familyTax.highSalaryCalculate(input).status,"HOLD");
  holdCases++;
  // Mortgage interaction: use progressive slices rather than the
  // production quick-deduction table, and rational municipal credits.
  function state(d,potential){
   const taxable=floorTax(BigInt(income-nationalDed)-d);
   const tax=ordinary(taxable);
   const applied=min(tax,potential);
   const rest=tax-applied;
   const localCap=min(97500n,(taxable+BigInt(basic-480000))*5n/100n);
   return {applied,local:min(potential-applied,localCap),cap:localCap,total:rest+rest*21n/1000n};
  }
  function localBills(d,st){
   return shares.map((s,i)=>{
    // regular credit = 2% * share; special = (90%-rate*1.021)*share/5
    // cap = 20% of unrounded post-adjustment levy.
    const creditNumerator=d*s*10000n+min(d*s*ratio,raw[i]*1000n);
    const credit=(creditNumerator+499999n)/500000n;
    return max(0n,raw[i]-st.local*s*20n-credit*100n)/10000n*100n;
   });
  }
  function oracle(d,potential){
   const D=BigInt(d)-2000n,before=state(0n,potential),after=state(D,potential);
   const b=localBills(0n,before),a=localBills(D,after);
   const ns=before.total-after.total,rs=b[0]+b[1]-a[0]-a[1];
   return {before,after,b,a,ns,rs,self:BigInt(d)-ns-rs};
  }
  const nominal=Math.floor(Math.min(...shares.map((s,i)=>Number(2000n+bills[i]*100000n/(ratio*s))))/1000)*1000;
  for(const d of [2000,3000,nominal,nominal+1000]){
   const expected=oracle(d,0n);
   const trial=familyTax.highSalaryFilingTrial(input,d);
   assert.equal(trial.status,"ESTIMATE",trial.reason);
   assert.deepEqual([trial.calculation.nationalSavingYen,trial.calculation.residentSavingYen,trial.calculation.selfPayYen],[expected.ns,expected.rs,expected.self].map(Number));
   filingTrials++;
  }
  let filingCeiling=2000;
  for(let d=3000;d<=Math.floor(income*3/10);d+=1000){if(oracle(d,0n).self>2000n)break;filingCeiling=d;}
  assert.equal(familyTax.highSalaryFilingPrefix(input).donationLimitYen,filingCeiling);
  prefixes++;
  for(const potential of [30000,300000,600000]){
   const housing={moveInYear:2024,capClass:"standard5",possibleYen:potential,eligibilityReviewed:true};
   const request={tax:input,housing,filing:"return"};
   assert.equal(familyTax.mortgageTrial({...request,filing:"one-stop"},3000).status,"HOLD");
   holdCases++;
   for(const d of [2000,3000,nominal,nominal+1000]){
    const e=oracle(d,BigInt(potential)),trial=familyTax.mortgageTrial(request,d);
    assert.equal(trial.status,"COMPONENTS_ONLY",trial.reason);
    assert.equal(trial.donationLimitYen,null);
    const x=trial.calculation;
    assert.deepEqual([x.before.nationalHousingYen,x.before.residentHousingYen,x.before.localCapYen,x.after.nationalHousingYen,x.after.residentHousingYen,x.after.localCapYen,x.nationalSavingYen,x.residentSavingYen,x.selfPayYen,...x.localBefore,...x.localAfter.map(v=>v.assessedYen)],
     [e.before.applied,e.before.local,e.before.cap,e.after.applied,e.after.local,e.after.cap,e.ns,e.rs,e.self,...e.b,...e.a].map(Number));
    mortgageTrials++;
   }
   let ceiling=2000;
   for(let d=3000;d<=nominal;d+=1000){if(oracle(d,BigInt(potential)).self>2000n)break;ceiling=d;}
   const prefix=familyTax.mortgagePrefix(request);
   assert.equal(prefix.status,"COMPONENTS_ONLY",prefix.reason);
   assert.equal(prefix.donationLimitYen,null);
   assert.equal(prefix.calculation.conservativePrefixYen,ceiling);
   prefixes++;
  }
  scenarios++;
 }
 assert.deepEqual([scenarios,filingTrials,mortgageTrials,prefixes,holdCases],[48,192,576,192,192]);
 console.log(JSON.stringify({schema:"web-combined-high-salary-tax-boundary-audit/v1",scenarios,filingTrials,mortgageTrials,prefixes,holdCases,excelCOM:false,release:"HOLD"}));
}

// Independently tabulated adjustment-credit edges: Chofu city (R8 onward)
// https://www.city.chofu.lg.jp/030010/p014042.html
// Special-rate table: Ichikawa city (2026-07-29)
// https://www.city.ichikawa.lg.jp/page/3898.html
// One ordinary qualifying 20-year-old dependent (national 630k/local 450k)
// plus 120k new general life premiums (national 40k/60k, local 28k).
// Personal difference 50k + 180k; life insurance is NOT a personal deduction.
{
 const rows=[
  [1999000,230000,11500],[2000000,230000,11500],
  [2001000,229000,11450],[2179000,51000,2550],
  [2180000,50000,2500],[2181000,50000,2500]
 ];
 let cases=0;
 for(const year of [2025,2026])for(const municipality of ["standard","designated"]){
  const basic=year===2025?630000:670000;
  const life=year===2025?40000:60000;
  const shift=year===2025?380000:420000; // 230k + basic excess over 480k
  const edgeRows=[...rows,[1950000+shift-1000,50000,2500],[1950000+shift,50000,2500],[1950000+shift+1000,50000,2500],
   [3300000+shift-1000,50000,2500],[3300000+shift,50000,2500],[3300000+shift+1000,50000,2500]];
  for(const [taxable,basis,credit] of edgeRows){
   const income=5200000,social=income-908000-taxable;
   const args={year,salaryIncome:income,socialInsurance:social,municipality,spouse:null,
    relatives:[{age:20,income:0,eligibilityReviewed:true,cohabitingDirectAscendant:false}],
    conditions:"salary-basic-social-family-insurance-only-reviewed",
    premiums:{generalNew:120000,generalOld:0,medicalNew:0,pensionNew:0,pensionOld:0,earthquake:0,longTermOld:0}};
   const result=familyTax.calculate(args),c=result.calculation;
   assert.equal(result.status,"ESTIMATE",result.reason);
   const rateBase=taxable-shift;
   // Published municipal percentages, with inclusive upper boundaries.
   const [rate,ratio]=rateBase<=1950000?[5,84895]:rateBase<=3300000?[10,79790]:[20,69580];
   const shares=municipality==="standard"?[3,2]:[4,1];
   const bills=shares.map(q=>Number((BigInt(taxable)*BigInt(q)*2n-BigInt(basis)*BigInt(q))/10000n*100n));
   const limits=bills.map((bill,j)=>2000n+BigInt(bill)*100000n/(BigInt(ratio)*BigInt(shares[j])));
   const exact=limits.reduce((x,y)=>x<y?x:y,1560000n);
   assert.deepEqual([c.residentTaxableYen,c.nationalTaxableYen,c.personalDifferenceYen,c.adjustmentBasisYen,c.adjustmentYen,c.residentSpecialBaseYen,c.specialRatePercent,c.specialDenominator,c.city.assessedYen,c.prefecture.assessedYen,c.exactReferenceYen,result.donationLimitYen],
    [taxable,income-social-basic-630000-life,230000,basis,credit,rateBase,rate,ratio,...bills,Number(exact),Number(exact/1000n*1000n)]);
   cases++;
  }
 }
 assert.equal(cases,48);
 console.log("PUBLIC_FAMILY_ADJUSTMENT_CREDIT_AND_SPECIAL_RATE_EDGES_48_PASS; synthetic independent arithmetic; release HOLD");
}

// Independent rational arithmetic for dense one-yen boundaries, including
// non-monotone self-pay from tax-base and final levy rounding.
// NTA No.2260, No.1000; Oamishirasato city combined local-credit rounding.
// Annual liability difference before withholding/prepayments, NOT cash refund.
{
 const cases=[
  [2025,5200000,1000000,630000],[2026,5200000,1000000,670000],
  [2025,3560000,750000,680000],[2026,3560000,750000,1040000],
  [2025,4760000,1340000,680000],[2026,4760000,1340000,1040000]
 ];
 const min=(a,b)=>a<b?a:b,max=(a,b)=>a>b?a:b;
 const floor1000=n=>max(0n,n)/1000n*1000n;
 const national=n=>{
  const tax=(min(n,1950000n)*5n+max(0n,min(n,3300000n)-1950000n)*10n+max(0n,n-3300000n)*20n)/100n;
  return tax+tax*21n/1000n;
 };
 function oracle(income,social,basic,municipality,donation){
  const I=BigInt(income),S=BigInt(social),B=BigInt(basic),D=BigInt(donation),v=D-2000n;
  const local=floor1000(I-S-430000n),base=local-50000n-(B-480000n),rate=base<=1950000n?5n:base<=3300000n?10n:20n;
  const ratio=90000n-rate*1021n,adj=min(local,50000n);
  const parts=(municipality==="standard"?[3n,2n]:[4n,1n]).map(q=>{
   // 5,000,000 units/yen. Apply the cap to UNROUNDED assessed levy.
   const raw=(2n*local-adj)*q*50000n;
   const credit=(v*q*100000n+min(v*q*ratio*10n,raw/5n)+4999999n)/5000000n;
   const before=raw/500000000n*100n,after=max(0n,raw-credit*5000000n)/500000000n*100n;
   return {credit:Number(credit),before:Number(before),after:Number(after),saving:Number(before-after)};
  });
  const ns=national(floor1000(I-S-B))-national(floor1000(I-S-B-v));
  const self=Number(D-ns)-parts.reduce((a,b)=>a+b.saving,0);
  return {parts,ns:Number(ns),self};
 }
 let trials=0,nonMonotone=0,thresholds=0;
 for(const [year,income,social,basic] of cases)for(const municipality of ["standard","designated"]){
  const input={year,salaryIncome:income,socialInsurance:social,municipality,conditions:"basic-only-reviewed"};
  const familyInput={...input,conditions:"salary-basic-social-family-only-reviewed",spouse:null,relatives:[]};
  const ref=local.oneStopReference(input);
  assert.equal(ref.status,"ESTIMATE");
  const cap=ref.calculation.exactReferenceYen;
  const sample=new Set();
  for(const center of [2000,3000,4000,cap,Math.floor(cap/1000)*1000,Math.floor(cap/1000)*1000+1000])
   for(let d=Math.max(2000,center-15);d<=center+15;d++)sample.add(d);
  let previous=null;
  for(const d of [...sample].sort((a,b)=>a-b)){
   const expected=oracle(income,social,basic,municipality,d);
   for(const result of [local.filingTrial(input,d),familyTax.filingTrial(familyInput,d)]){
    assert.equal(result.status,"ESTIMATE",result.reason);
    const c=result.calculation;
    assert.deepEqual([c.nationalSavingYen,c.city.creditYen,c.prefecture.creditYen,c.city.afterYen,c.prefecture.afterYen,c.selfPayYen,c.within2000,c.excessOver2000Yen],
     [expected.ns,...expected.parts.map(p=>p.credit),...expected.parts.map(p=>p.after),expected.self,expected.self<=2000,Math.max(0,expected.self-2000)]);
   }
   if(previous&&d===previous.d+1&&previous.self>2000&&expected.self<=2000)nonMonotone++;
   if(expected.self===1999||expected.self===2000||expected.self===2001)thresholds++;
   previous={d,self:expected.self};trials++;
  }
 }
 assert.ok(nonMonotone>0,"rounding can restore the <=2000 condition");
 assert.ok(thresholds>0);
 console.log(JSON.stringify({schema:"web-filing-dense-yen-edges/v1",trials,nonMonotone,thresholds,actualCashRefundCertified:false,release:"HOLD"}));
}


// Cross-source gross-wage examples (not another model's calculated output).
// Reviewed 2026-11-28: NTA No.1410/1190/1800 and Fukuoka City's
// 2026-08-06 FY2027 resident-tax reform Q&A. Family inputs are INCOME,
// not gross wages. These cases deliberately compose salary conversion,
// family classification, statutory adjustment difference and insurance.
{
 const rows=[
  // year, gross, income, spouse-kind, child-kind, child national,
  // child local, child statutory difference, family count, life national
  [2025,1229999,579999,"spouse","dependent-special",630000,450000,180000,1,40000],
  [2025,1230000,580000,"spouse","dependent-special",630000,450000,180000,1,40000],
  [2025,1230001,580001,"spouse-special","relative-special",630000,450000,0,0,40000],
  [2025,1360000,710000,"spouse-special","relative-special",630000,450000,0,0,40000],
  [2025,1600000,950000,"spouse-special","relative-special",510000,450000,0,0,40000],
  [2026,1359999,619999,"spouse","dependent-special",630000,450000,180000,1,60000],
  [2026,1360000,620000,"spouse","dependent-special",630000,450000,180000,1,60000],
  [2026,1360001,620001,"spouse-special","relative-special",630000,450000,0,0,40000],
  [2026,1600000,860000,"spouse-special","relative-special",610000,450000,0,0,40000]
 ];
 let grossCases=0;
 for(const [year,gross,income,spKind,chKind,n,r,d,count,life] of rows){
  const actualIncome=engine.salaryIncome(gross,year);
  assert.equal(actualIncome,income,"Gross/income conversion "+year+"/"+gross);
  const sp=family.calculate({...baseFamily,year,spouse:spouse(actualIncome)});
  assert.equal(sp.status,"COMPONENTS_ONLY");
  assert.equal(sp.calculation.items[0].kind,spKind);
  assert.equal(sp.calculation.familyCount,count);
  assert.deepEqual([sp.calculation.nationalFamilyDeductionYen,sp.calculation.residentFamilyDeductionYen,sp.calculation.familyAdjustmentDifferenceYen],[380000,330000,count?50000:0]);
  const rel=[relative(20,actualIncome)];
  const child=familyCheck({year,relatives:rel},[n,r,d,count]);
  assert.equal(child.items[0].kind,chKind);
  const premium=insCheck(year,rel,{generalNew:120000},[life,28000,0,0]);
  assert.equal(premium.enhancedGeneral,year===2026&&count===1);
  grossCases++;
 }
 // Municipal Q&A's single-resident non-taxable income threshold.
 // Do not generalize this to all local flat-rate exemption rules.
 let exemptionCases=0;
 for(const [year,gross,income,exempt] of [
  [2025,1099999,449999,true],[2025,1100000,450000,true],[2025,1100001,450001,false],
  [2026,1189999,449999,true],[2026,1190000,450000,true],[2026,1190001,450001,false]
 ]){
  assert.equal(engine.salaryIncome(gross,year),income);
  const c=familyCheck({year,taxpayerIncome:income},[0,0,0,0]);
  assert.equal(c.ordinaryResidentIncomeLevyExempt,exempt);
  exemptionCases++;
 }
 // NTA / municipal statutory student income limits, expressed in wages.
 let studentCases=0;
 for(const [year,gross,income,eligible] of [
  [2025,1499999,849999,true],[2025,1500000,850000,true],[2025,1500001,850001,false],
  [2026,1629999,889999,true],[2026,1630000,890000,true],[2026,1630001,890001,false]
 ]){
  assert.equal(engine.salaryIncome(gross,year),income);
  const input={...otherBase,family:{...baseFamily,year,taxpayerIncome:income},workingStudent:true};
  if(eligible)otherCheck(input,[270000,260000,10000]);else otherHold(input);
  studentCases++;
 }
 console.log(JSON.stringify({schema:"web-annual-family-gross-source-cross-check/v1",grossCases,exemptionCases,studentCases,source:"NTA / Fukuoka FY2027 Q&A",syntheticOnly:true,release:"HOLD"}));
}

 
// Independent ordinary income-levy exemption cliff audit.
// Osaka city and Imizu city: after-credit levy relief avoids leaving income
// net of levy below the ordinary exemption threshold. We deliberately
// HOLD potentially affected cases until the post-credit model is audited.
// Three reviewed children under 16: exemption threshold 1,820,000;
// no dependent deduction, only 430,000 local basic deduction.
// At 1,971,599 and 1,971,600 the unrounded levy is 151,600;
// the excess income is respectively 151,599 and 151,600.
{
 const reason="住民税所得割の非課税限度額付近の調整措置";
 let holds=0,accepted=0;
 for(const year of [2025,2026])for(const municipality of ["standard","designated"]){
  const b={year,municipality,socialInsurance:0,conditions:"basic-only-reviewed"};
  for(const salaryIncome of [451000,451049]){
   const out=local.calculate({...b,salaryIncome});
   assert.equal(out.status,"HOLD");assert.match(out.reason,new RegExp(reason));
   assert.equal(out.calculation,null);assert.equal(out.donationLimitYen,null);holds++;
  }
  for(const salaryIncome of [451050,451051,452000]){
   const out=local.calculate({...b,salaryIncome});
   assert.equal(out.status,"ESTIMATE");assert.equal(out.donationLimitYen,null);accepted++;
  }
  const f={year,municipality,socialInsurance:0,spouse:null,
   relatives:[relative(5),relative(8),relative(12)],
   conditions:"salary-basic-social-family-only-reviewed"};
  for(const salaryIncome of [1820001,1971000,1971599]){
   const q={...f,salaryIncome};
   for(const out of [familyTax.calculate(q),familyTax.filingTrial(q,3000),familyTax.filingPrefix(q)]){
    assert.equal(out.status,"HOLD");assert.match(out.reason,new RegExp(reason));
    assert.equal(out.calculation,null);assert.equal(out.donationLimitYen,null);holds++;
   }
  }
  for(const salaryIncome of [1971600,1971601,1972000]){
   const out=familyTax.calculate({...f,salaryIncome});
   assert.equal(out.status,"ESTIMATE",out.reason);
   assert.equal(out.calculation.family.ordinaryResidentIncomeLevyExemptionLimitYen,1820000);
   assert.equal(out.calculation.residentTaxableYen,salaryIncome<1972000?1541000:1542000);
   accepted++;
  }
 }
 assert.deepEqual([holds,accepted],[44,24]);
 console.log(JSON.stringify({schema:"web-income-levy-exemption-cliff-guard/v1",holds,accepted,postCreditReliefCertified:false,release:"HOLD"}));
}


// Separate post-credit relief research: fixed exact ratios; no final
// assessment, no one-stop credit and no product ceiling.
// Independent expected fractions use published combined cap and residual
// proportions, including unequal residuals caused by local tax credits.
{
 const relief=require("../src/income-levy-relief.js");
 const stage="after-ordinary-credits-before-relief-and-one-stop";
 const frac=(numerator,denominator=1)=>({numerator:String(numerator),denominator:String(denominator)});
 let exactCases=0,invalidCases=0,propertyCases=0;
 for(const year of [2025,2026]){
  const b={year,incomeYen:1900000,familyCount:3,cityAfterCredits100:9000000,prefectureAfterCredits100:6000000,stage};
  const rows=[
   [b,70000,48000,1,32000,1,42000,1,28000,1],
   [{...b,cityAfterCredits100:5000000,prefectureAfterCredits100:4000000},10000,400000,9,320000,9,50000,9,40000,9],
   [{...b,cityAfterCredits100:4800000,prefectureAfterCredits100:3200000},0,48000,1,32000,1,0,1,0,1],
   [{...b,cityAfterCredits100:8000001,prefectureAfterCredits100:0},0.01,80000,1,0,1,1,100,0,1],
   [{...b,cityAfterCredits100:0,prefectureAfterCredits100:0},0,0,1,0,1,0,1,0,1],
   [{...b,incomeYen:1820001,cityAfterCredits100:100,prefectureAfterCredits100:200},2,1,3,2,3,2,3,4,3],
   [{...b,incomeYen:1900000,cityAfterCredits100:12000000,prefectureAfterCredits100:3000000},70000,64000,1,16000,1,56000,1,14000,1]
  ];
  for(const [q,total,cn,cd,pn,pd,crn,crd,prn,prd] of rows){
   const out=relief.calculate(q);assert.equal(out.status,"COMPONENTS_ONLY");assert.equal(out.donationLimitYen,null);
   const c=out.calculation;assert.equal(c.residentYear,year+1);assert.equal(c.thresholdYen,1820000);
   assert.deepEqual(c.totalReliefYen,total===0.01?frac(1,100):frac(total));
   assert.deepEqual(c.city.remainingYen,frac(cn,cd));assert.deepEqual(c.prefecture.remainingYen,frac(pn,pd));
   assert.deepEqual(c.city.reliefYen,frac(crn,crd));assert.deepEqual(c.prefecture.reliefYen,frac(prn,prd));
   assert.equal(c.finalRoundingCertified,false);assert.equal(c.oneStopCreditApplied,false);exactCases++;
  }
  for(const q of [{...b,incomeYen:1820000},{...b,incomeYen:1819999},{...b,stage:"after-one-stop"},{...b,stage:"before-housing"},
   {...b,cityAfterCredits100:-1},{...b,prefectureAfterCredits100:0.5},{...b,familyCount:32},{...b,year:2027},{...b,extra:true}]){
   const out=relief.calculate(q);assert.equal(out.status,"HOLD");assert.equal(out.calculation,null);assert.equal(out.donationLimitYen,null);invalidCases++;
  }
  // Independent identity: each residual has equal proportional reduction;
  // combined residual never exceeds the income gap or original levy.
  for(const gap of [1,49,50,51,100,1000,80000])for(const city of [0,1,99,100,150001,9000000])for(const pref of [0,1,101,500003,6000000]){
   const q={...b,incomeYen:1820000+gap,cityAfterCredits100:city,prefectureAfterCredits100:pref};
   const c=relief.calculate(q).calculation;assert.ok(c);
   const asPair=f=>[BigInt(f.numerator),BigInt(f.denominator)];
   const [x,xd]=asPair(c.city.remainingYen),[y,yd]=asPair(c.prefecture.remainingYen);
   const combined=Math.min((city+pref),gap*100);
   assert.equal((x*yd+y*xd)*100n,BigInt(combined)*xd*yd);
   assert.equal(x*yd*BigInt(pref),y*xd*BigInt(city));
   assert.ok(x*100n<=BigInt(city)*xd&&y*100n<=BigInt(pref)*yd);
   propertyCases++;
  }
 }
 assert.deepEqual([exactCases,invalidCases,propertyCases],[14,18,420]);
 console.log(JSON.stringify({schema:"web-income-levy-relief-rational-research/v1",exactCases,invalidCases,propertyCases,finalRoundingCertified:false,uiIntegrated:false,release:"HOLD"}));
}


// Independent fixed cases for the displacement of income-levy relief by
// ordinary donation/housing credits and subsequent one-stop credit.
// Inputs are hypothetical post-credit states, not computed donation credits.
{
 const relief=require("../src/income-levy-relief.js");
 const state=(city,pref,cityOneStop=0,prefOneStop=0)=>({
  cityAfterCredits100:city*100,prefectureAfterCredits100:pref*100,
  cityOneStop100:cityOneStop*100,prefectureOneStop100:prefOneStop*100});
 let cases=0,holds=0;
 for(const year of [2025,2026]){
  const b={year,incomeYen:1900000,familyCount:3,filing:"return",before:state(90000,60000),after:state(90000,60000)};
  for(const [filing,after,city,pref,saving] of [
   ["return",state(60000,40000),48000,32000,0],
   ["return",state(36000,24000),36000,24000,20000],
   ["return",state(50000,40000),44400,35500,100],
   ["return",state(0,0),0,0,80000],
   ["one-stop",state(60000,40000,6000,4000),42000,28000,10000],
   ["one-stop",state(60000,40000,49000,33000),0,0,80000],
   ["one-stop",state(36000,24000,1,1),35900,23900,20200],
   ["one-stop",state(50000,40000,44,55),44400,35500,100]
  ]){
   const out=relief.compare({...b,filing,after});assert.equal(out.status,"COMPONENTS_ONLY");assert.equal(out.donationLimitYen,null);
   const c=out.calculation;assert.deepEqual([c.before.cityYen,c.before.prefectureYen,c.before.totalYen],[48000,32000,80000]);
   assert.deepEqual([c.after.cityYen,c.after.prefectureYen,c.residentSavingYen],[city,pref,saving]);
   assert.equal(c.intermediateRoundingCertified,false);assert.equal(c.upstreamCreditsCertified,false);cases++;
  }
  for(const changed of [{filing:"return",after:state(60000,40000,1,0)},{filing:"unknown"},{before:state(90000,60000,1,0)},
   {after:state(-1,0)},{after:{...b.after,cityOneStop100:0.1}},{incomeYen:1820000},{after:{...b.after,extra:1}}]){
   const out=relief.compare({...b,...changed});assert.equal(out.status,"HOLD");assert.equal(out.calculation,null);assert.equal(out.donationLimitYen,null);holds++;
  }
 }
 assert.deepEqual([cases,holds],[16,14]);
 console.log(JSON.stringify({schema:"web-income-levy-relief-post-credit-comparison/v1",cases,holds,uiIntegrated:false,intermediateRoundingCertified:false,release:"HOLD"}));
}


// Official Oamishirasato STEP4/5 source example: keep the published
// adjusted levies and statutory rate as inputs (not a 2025/26 salary
// example), and separately verify current-year near-threshold scenarios.
// Fixed expected values for synthetic relief cases independently computed
// with Python Fraction and per-municipality final 100-yen floors.
{
 const relief=require("../src/income-levy-relief.js");
 let published=0,combined=0,rejections=0,product=0;
 for(const year of [2025,2026]){
  const official={year,incomeYen:3560000,familyCount:1,municipality:"standard",specialRatePercent:10,donationYen:100000,
   housingBeforeYen:0,housingAfterYen:0,cityAdjusted100:12240000,prefectureAdjusted100:8160000,filing:"one-stop"};
  const o=relief.compareCredits(official);
  assert.equal(o.status,"COMPONENTS_ONLY");
  assert.deepEqual(o.calculation.parts.map(p=>[p.ordinaryDonationCreditYen,p.applicationSpecialCreditYen]),[[30360,3133],[20240,2089]]);
  published++;
  for(const [municipality,levies,baseBills,rows] of [
   ["standard",[8670000,5780000],[48000,32000],[
    [3000,0,0,"return",[570,380],[0,0],[48000,32000],0],
    [3000,0,0,"one-stop",[570,380],[31,21],[47900,31900],200],
    [20000,0,0,"return",[10249,6833],[0,0],[48000,31900],100],
    [20000,0,0,"one-stop",[10249,6833],[552,368],[47400,31600],1000],
    [36000,30000,33000,"return",[19359,12906],[0,0],[47500,31600],900],
    [36000,30000,30000,"one-stop",[19359,12906],[1042,695],[46900,31300],1800],
    [50000,50000,50000,"one-stop",[20220,13480],[1043,696],[35400,23600],21000]
   ]],
   ["designated",[11560000,2890000],[64000,16000],[
    [3000,0,0,"return",[760,190],[0,0],[64000,16000],0],
    [3000,0,0,"one-stop",[760,190],[41,11],[63900,15900],200],
    [20000,0,0,"return",[13665,3417],[0,0],[64000,15900],100],
    [20000,0,0,"one-stop",[13665,3417],[736,184],[63200,15800],1000],
    [36000,30000,33000,"return",[25812,6453],[0,0],[63300,15800],900],
    [36000,30000,30000,"one-stop",[25812,6453],[1389,348],[62600,15600],1800],
    [50000,50000,50000,"one-stop",[26960,6740],[1391,348],[47200,11800],21000]
   ]]
  ]){
   const b={year,incomeYen:1900000,familyCount:3,municipality,specialRatePercent:5,donationYen:3000,
    housingBeforeYen:0,housingAfterYen:0,cityAdjusted100:levies[0],prefectureAdjusted100:levies[1],filing:"return"};
   for(const [donationYen,housingBeforeYen,housingAfterYen,filing,ordinary,extra,bills,saving] of rows){
    const out=relief.compareCredits({...b,donationYen,housingBeforeYen,housingAfterYen,filing});
    assert.equal(out.status,"COMPONENTS_ONLY");assert.equal(out.donationLimitYen,null);
    const c=out.calculation;
    assert.deepEqual(c.parts.map(p=>p.ordinaryDonationCreditYen),ordinary);
    assert.deepEqual(c.parts.map(p=>p.applicationSpecialCreditYen),extra);
    assert.deepEqual([c.before.cityYen,c.before.prefectureYen],baseBills);
    assert.deepEqual([c.after.cityYen,c.after.prefectureYen,c.residentSavingYen],[...bills,saving]);
    assert.equal(c.upstreamHousingCertified,false);combined++;
   }
   for(const patch of [{specialRatePercent:6},{donationYen:1999},{donationYen:570001},{housingAfterYen:136501},
    {filing:"one-stop",housingAfterYen:1},{cityAdjusted100:0.5},{incomeYen:1820000},{extra:true}]){
    const out=relief.compareCredits({...b,...patch});assert.equal(out.status,"HOLD");assert.equal(out.calculation,null);assert.equal(out.donationLimitYen,null);rejections++;
   }
  }
  // Product mortgage path: 166-yen excess donation, separate rounding
  // reduces city bill by an additional 100 yen versus old pooled ceiling.
  // Housing credit wholly national (10,000 yen), so adjusted local levies
  // 224,700/149,800 are unchanged before the donation.
  const tax={year,salaryIncome:5200000,socialInsurance:1000000,municipality:"standard",spouse:null,relatives:[],
   conditions:"salary-basic-social-family-only-reviewed"};
  const housing={moveInYear:2024,capClass:"standard5",possibleYen:10000,eligibilityReviewed:true};
  const out=familyTax.mortgageTrial({tax,housing,filing:"one-stop"},2166);
  assert.equal(out.status,"COMPONENTS_ONLY");assert.equal(out.donationLimitYen,null);
  assert.deepEqual(out.calculation.localBefore,[224700,149800]);
  assert.deepEqual(out.calculation.localAfter.map(p=>[p.assessedYen,p.ordinaryDonationCreditYen,p.applicationSpecialCreditYen]),[[224500,80,21],[149700,53,14]]);
  assert.equal(out.calculation.selfPayYen,1866);product++;
 }
 assert.deepEqual([published,combined,rejections,product],[2,28,32,2]);
 console.log(JSON.stringify({schema:"web-relief-credit-bridge-and-rounding/v1",published,combined,rejections,product,upstreamHousingCertified:false,reliefUiIntegrated:false,release:"HOLD"}));
}


// Integration audit: real reviewed-family/tax engine -> national housing
// -> municipal donation credits -> proportional relief -> actual net cost.
// Synthetic inputs only. Fixed expected rows independently calculated using
// Python fractions and statutory integer national-tax/100-yen local floors.
// Existing product API must still reject relief-boundary inputs.
{
 const cases=[
  [2025,"standard",3000,10000,"one-stop",0,0,48000,32000,47900,31900,0,200,2800],
  [2025,"standard",20000,10000,"return",0,0,48000,32000,48000,31900,919,100,18981],
  [2025,"standard",36000,100000,"return",49000,50700,48000,32000,36900,24600,0,18500,17500],
  [2025,"standard",36000,100000,"one-stop",49000,49000,48000,32000,36800,24500,0,18700,17300],
  [2025,"standard",50000,160000,"one-stop",71000,71000,44100,29400,22800,15200,0,35500,14500],
  [2025,"designated",3000,10000,"one-stop",0,0,64000,16000,63900,15900,0,200,2800],
  [2025,"designated",20000,10000,"return",0,0,64000,16000,64000,15900,919,100,18981],
  [2025,"designated",36000,100000,"return",49000,50700,64000,16000,49200,12300,0,18500,17500],
  [2025,"designated",36000,100000,"one-stop",49000,49000,64000,16000,49100,12200,0,18700,17300],
  [2025,"designated",50000,160000,"one-stop",71000,71000,58800,14700,30400,7600,0,35500,14500],
  [2026,"standard",3000,10000,"one-stop",0,0,48000,32000,47900,31900,0,200,2800],
  [2026,"standard",20000,10000,"return",0,0,48000,32000,48000,31900,919,100,18981],
  [2026,"standard",36000,100000,"return",57000,58700,48000,32000,32100,21400,0,26500,9500],
  [2026,"standard",36000,100000,"one-stop",57000,57000,48000,32000,32000,21300,0,26700,9300],
  [2026,"standard",50000,160000,"one-stop",71000,71000,44100,29400,22800,15200,0,35500,14500],
  [2026,"designated",3000,10000,"one-stop",0,0,64000,16000,63900,15900,0,200,2800],
  [2026,"designated",20000,10000,"return",0,0,64000,16000,64000,15900,919,100,18981],
  [2026,"designated",36000,100000,"return",57000,58700,64000,16000,42800,10700,0,26500,9500],
  [2026,"designated",36000,100000,"one-stop",57000,57000,64000,16000,42700,10600,0,26700,9300],
  [2026,"designated",50000,160000,"one-stop",71000,71000,58800,14700,30400,7600,0,35500,14500]
 ];
 let integrated=0,productHolds=0,invalid=0,unaffected=0;
 for(const [year,municipality,donation,possibleYen,filing,hb,ha,cb,pb,ca,pa,ns,rs,self] of cases){
  const tax={year,municipality,salaryIncome:1900000,socialInsurance:0,spouse:null,relatives:[relative(5),relative(8),relative(12)],
   conditions:"salary-basic-social-family-only-reviewed"};
  const housing={moveInYear:2024,capClass:"standard5",possibleYen,eligibilityReviewed:true};
  const request={tax,housing,filing};
  const t=familyTax.mortgageReliefResearchTrial(request,donation);
  assert.equal(t.status,"COMPONENTS_ONLY",t.reason);assert.equal(t.donationLimitYen,null);
  const c=t.calculation;assert.equal(c.researchOnly,true);assert.equal(c.intermediateRoundingCertified,false);
  assert.deepEqual([c.before.residentHousingYen,c.after.residentHousingYen,...c.localBefore,...c.localAfter.map(x=>x.assessedYen),c.nationalSavingYen,c.residentSavingYen,c.selfPayYen],[hb,ha,cb,pb,ca,pa,ns,rs,self]);
  integrated++;
  for(const p of [familyTax.calculate(tax),familyTax.mortgageTrial(request,donation),familyTax.mortgagePrefix(request)]){
   assert.equal(p.status,"HOLD");assert.equal(p.calculation,null);assert.equal(p.donationLimitYen,null);productHolds++;
  }
  for(const q of [{...request,tax:{...tax,salaryIncome:1820000}},{...request,housing:{...housing,eligibilityReviewed:false}}]){
   const result=familyTax.mortgageReliefResearchTrial(q,donation);
   assert.equal(result.status,"HOLD");assert.equal(result.donationLimitYen,null);invalid++;
  }
  const normal={...request,tax:{...tax,salaryIncome:5200000,socialInsurance:1000000,relatives:[]}};
  const a=familyTax.mortgageTrial(normal,donation),b=familyTax.mortgageReliefResearchTrial(normal,donation);
  assert.equal(a.status,"COMPONENTS_ONLY");assert.equal(b.status,"COMPONENTS_ONLY");
  for(const k of ["localBefore","localAfter","nationalSavingYen","residentSavingYen","selfPayYen"])
   assert.deepEqual(a.calculation[k],b.calculation[k],k);
  unaffected++;
 }
 assert.deepEqual([integrated,productHolds,invalid,unaffected],[20,60,40,20]);
 // A browser evaluation has no CommonJS research dependency or entry.
 const vm=require("node:vm"),fs=require("node:fs"),path=require("node:path");
 const sandbox={window:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../src/family-tax.js"),"utf8"),sandbox);
 assert.equal(typeof sandbox.window.FurusatoFamilyTax.mortgageReliefResearchTrial,"undefined");
 console.log(JSON.stringify({schema:"web-mortgage-relief-integrated-research/v1",integrated,productHolds,invalid,unaffected,browserResearchEntry:false,release:"HOLD"}));
}
