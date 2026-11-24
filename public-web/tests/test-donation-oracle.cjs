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
