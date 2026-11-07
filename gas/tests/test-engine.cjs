"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname,"..");
const context = {module:{exports:{}}, console, Math, Number, String, Infinity};
vm.runInNewContext(fs.readFileSync(path.join(root,"Engine.gs"),"utf8"),context,{filename:"Engine.gs"});
const tax=context.module.exports;
let count=0;
function test(label,fn){try{fn();count++;process.stdout.write("PASS "+label+"\n");}catch(e){process.stderr.write("FAIL "+label+" "+e.stack+"\n");process.exitCode=1;}}
const base={
  year:"2026",incomeType:"salary",filing:"one-stop",
  salaryGross:"7000000",socialInsurance:"1000000",
  salaryIncomeReference:"",deductionsReference:"",
  acknowledgedExclusions:true
};
test("2026 standard wage 7m reproduces reviewed Excel reference 109,000",()=>{
  const x=tax.calculate(base);
  assert.equal(x.status,"ESTIMATE");assert.equal(x.donationLimitYen,109000);
  assert.equal(x.calculation.salaryIncomeYen,5200000);
  assert.equal(x.calculation.basicIncomeTaxDeductionYen,670000);
  assert.equal(x.calculation.incomeTaxTaxableYen,3530000);
  assert.equal(x.calculation.residentIncomeLevyYen,374500);
  assert.equal(x.calculation.marginalIncomeTaxRate,.20);
  assert.equal(x.residentYear,2027);
});
test("2025 standard wage 7m has different income-tax basic deduction",()=>{
  const x=tax.calculate({...base,year:2025});
  assert.equal(x.status,"ESTIMATE");assert.equal(x.calculation.basicIncomeTaxDeductionYen,630000);
  assert.equal(x.residentYear,2026);
});
test("2027 is unapproved and fails closed",()=>{
  const x=tax.calculate({...base,year:2027});
  assert.equal(x.status,"HOLD");assert.equal(x.donationLimitYen,null);
});
test("salary income is calculated automatically from the statutory table at 5m",()=>{
  const x=tax.calculate({...base,salaryGross:"5000000",socialInsurance:"1000000"});
  assert.equal(x.status,"ESTIMATE");
  assert.equal(x.calculation.salaryIncomeYen,3560000);
  assert.equal(x.calculation.basicIncomeTaxDeductionYen,1040000);
  assert.equal(x.calculation.incomeTaxTaxableYen,1520000);
  assert.equal(x.donationLimitYen,51000);
});
test("2026 low salary 2m now uses 740k minimum allowance",()=>{
  const x=tax.calculate({...base,salaryGross:"2000000",socialInsurance:"100000"});
  assert.equal(x.status,"ESTIMATE");
  assert.equal(x.calculation.salaryIncomeYen,1260000);
  assert.equal(x.calculation.incomeTaxTaxableYen,120000);
  assert.equal(x.donationLimitYen,18000);
});
test("2025 salary 1.8m uses the 650k minimum allowance",()=>{
  const x=tax.calculate({...base,year:2025,salaryGross:"1800000",socialInsurance:"50000"});
  assert.equal(x.status,"ESTIMATE");
  assert.equal(x.calculation.salaryIncomeYen,1150000);
  assert.equal(x.calculation.basicIncomeTaxDeductionYen,950000);
});
test("statutory salary table boundaries and statutory quarter-rounding",()=>{
  const x=tax.salaryIncome;
  assert.equal(x(1899999,2025),1249999);
  assert.equal(x(1900000,2025),1250000);
  assert.equal(x(1900001,2025),1250000);
  assert.equal(x(2199999,2026),1456000);
  assert.equal(x(2200000,2026),1460000);
  assert.equal(x(2200001,2026),1460000);
  assert.equal(x(3599999,2026),2437200);
  assert.equal(x(3600000,2026),2440000);
  assert.equal(x(5000000,2026),3560000);
  assert.equal(x(5812500,2026),4209600);
  assert.equal(x(6599999,2026),4836800);
  assert.equal(x(6600000,2026),4840000);
  assert.equal(x(7000000,2026),5200000);
  assert.equal(x(7000000,2025),5200000);
  assert.equal(x(5000000,2027),null);
});
test("2026 low-salary special bands reproduce NTA Q3-1 edge values",()=>{
  const x=tax.salaryIncome;
  // 2026 Q3-1: ordinary 740k allowance, plus three short ranges
  const cases=[
    [0,0],[690999,0],[691000,0],[740999,0],[741000,1000],
    [2190999,1450999],[2191000,1451000],[2192999,1451000],
    [2193000,1453000],[2195999,1453000],
    [2196000,1456000],[2199999,1456000],[2200000,1460000]
  ];
  for(const [gross,expected] of cases)assert.equal(x(gross,2026),expected,"2026 gross="+gross);
});
test("2026 NTA special salary bands remain correct despite Excel v4.18.2 discrepancy",()=>{
  // 2026 NTA No.1410 note (2): fixed salary income within three narrow bands.
  // The officially released Excel v4.18.2 presently differs here (issue #4);
  // never change GAS to match that legacy Excel formula.
  const cases=[
    [2192999,1451000,89600,23000],
    [2195999,1453000,89800,23000],
    [2199999,1456000,90100,23000]
  ];
  for(const [gross,salary,levy,limit] of cases){
    const r=tax.calculate({...base,year:2026,salaryGross:String(gross),socialInsurance:"100000"});
    assert.equal(r.status,"ESTIMATE","gross="+gross);
    assert.equal(r.calculation.salaryIncomeYen,salary,"NTA special salary income gross="+gross);
    assert.equal(r.calculation.residentIncomeLevyYen,levy,"resident levy gross="+gross);
    assert.equal(r.donationLimitYen,limit,"donation limit gross="+gross);
  }
});
test("2025 minimum allowance remains 650k at lower salary edges",()=>{
  const x=tax.salaryIncome;
  for(const [gross,expected] of [[0,0],[649999,0],[650000,0],
    [650001,1],[1899999,1249999],[1900000,1250000]]) {
    assert.equal(x(gross,2025),expected,"2025 gross="+gross);
  }
});
test("low-salary slip amounts require exact statutory match",()=>{
  const ok=tax.calculate({...base,salaryGross:2193000, salaryIncomeReference:1453000,socialInsurance:100000});
  assert.equal(ok.status,"ESTIMATE");
  const wrong=tax.calculate({...base,salaryGross:2193000,salaryIncomeReference:1451000,socialInsurance:100000});
  assert.equal(wrong.status,"HOLD");
  assert.equal(wrong.donationLimitYen,null);
});
test("salary income supplied by the slip must match independently calculated salary income",()=>{
  const x=tax.calculate({...base,salaryGross:"5000000",salaryIncomeReference:"3560001",socialInsurance:"1000000"});
  assert.equal(x.status,"HOLD");
  assert.equal(x.donationLimitYen,null);
  const mismatch=tax.calculate({...base,salaryGross:"5000000",salaryIncomeReference:"3560400",socialInsurance:"1000000"});
  assert.equal(mismatch.status,"HOLD");assert.equal(mismatch.donationLimitYen,null);
});
test("one-yen source error at 4.89m basic deduction boundary is HOLD",()=>{
  // 6,655,556 * 90% - 1,100,000 => 4,890,000 after rounding.
  // Accepting a +1 yen source override would incorrectly change
  // the 2026 basic deduction from 1,040,000 to 670,000.
  const correct=tax.calculate({...base,salaryGross:6655556,salaryIncomeReference:4890000});
  assert.equal(correct.status,"ESTIMATE");
  assert.equal(correct.calculation.basicIncomeTaxDeductionYen,1040000);
  const incorrect=tax.calculate({...base,salaryGross:6655556,salaryIncomeReference:4890001});
  assert.equal(incorrect.status,"HOLD");
  assert.equal(incorrect.donationLimitYen,null);
});
test("resident-tax special rate bracket derives from resident tax, not copied income tax",()=>{
  const x=tax.calculate(base);
  assert.equal(x.status,"ESTIMATE");
  assert.equal(x.calculation.residentTaxTaxableYen,3770000);
  assert.equal(x.calculation.residentHumanDeductionDifferenceYen,50000);
  assert.equal(x.calculation.residentBasicExcessDeductionYen,190000);
  assert.equal(x.calculation.residentSpecialRateBaseYen,3530000);
  assert.equal(x.calculation.incomeTaxTaxableYen,3530000);
  const last=tax.calculate({...base,year:2025});
  assert.equal(last.status,"ESTIMATE");
  assert.equal(last.calculation.residentBasicExcessDeductionYen,150000);
  assert.equal(last.calculation.residentSpecialRateBaseYen,last.calculation.incomeTaxTaxableYen);
});
test("low salary source slip cannot bypass the statutory minimum salary deduction",()=>{
  for(const [year,gross,reference] of [
    [2026,2000000,1350000],
    [2025,1800000,1200000],
    [2026,600000,10000]
  ]) {
    const x=tax.calculate({...base,year,salaryGross:gross,salaryIncomeReference:reference,socialInsurance:0});
    assert.equal(x.status,"HOLD");
    assert.ok(x.reasons.some(r=>r.includes("最低保障額")));
  }
});
test("special-relative 2026 slip must not be silently estimated",()=>{
  const x=tax.calculate({...base,salaryGross:"5000000",salaryIncomeReference:"3560000",
    socialInsurance:"1600000",deductionsReference:"3956000",hasDependents:true});
  assert.equal(x.status,"HOLD");assert.equal(x.donationLimitYen,null);
});
test("all unsupported scenarios are fail-closed",()=>{
  ["hasSpouse","hasDependents","hasLifeInsurance","hasEarthquakeInsurance","hasMortgage",
   "hasOtherIncome","hasMedical","hasSplitIncome","hasIncomeAdjustment","sourceReviewPending"]
   .forEach(k=>{const x=tax.calculate({...base,[k]:true});assert.equal(x.status,"HOLD",k);assert.equal(x.donationLimitYen,null);});
});
test("unacknowledged exclusions, wrong income type and filing fail closed",()=>{
  for(const invalid of [{acknowledgedExclusions:false},{incomeType:"mixed"},{filing:"unknown"}]){
    const x=tax.calculate({...base,...invalid});assert.equal(x.status,"HOLD");assert.equal(x.donationLimitYen,null);
  }
});
test("zero, negative, fractional and scientific-notation amounts fail",()=>{
  for(const invalid of ["","-1","1.5","1e7","9999999999999"]){
    const x=tax.calculate({...base,salaryGross:invalid});assert.equal(x.status,"HOLD",invalid);
  }
});
test("reference withholding income contradiction fails",()=>{
  const x=tax.calculate({...base,salaryIncomeReference:"5000000"});assert.equal(x.status,"HOLD");
});
test("optional source deductions contradiction fails",()=>{
  const x=tax.calculate({...base,deductionsReference:"3956000"});assert.equal(x.status,"HOLD");
});
test("script does not create approved or final amount state",()=>{
  const x=tax.calculate(base);
  assert.equal(x.status,"ESTIMATE");
  assert.equal(x.schema,"furusato-gas-result/v1");
  assert.ok(x.notice.includes("保証ではありません"));
});
test("2025 and 2026 masters have nine bands each and are immutable outputs",()=>{
  const x=tax.statutoryRows();
  assert.equal(x.length,19);
  assert.equal(x.filter(r=>r[0]===2025).length,9);
  assert.equal(x.filter(r=>r[0]===2026).length,9);
  assert.deepEqual(x.filter(r=>r[0]===2026).slice(-3).map(r=>r[3]).join(","),"290000,150000,0");
  assert.deepEqual(x.filter(r=>r[0]===2025).slice(-3).map(r=>r[3]).join(","),"290000,150000,0");
});
test("app front end inline script is syntactically valid",()=>{
  const html=fs.readFileSync(path.join(root,"Index.html"),"utf8");
  const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length,1);
  new vm.Script(scripts[0][1],{filename:"Index.html:inline"});
  assert.ok(html.includes("印刷・PDF保存"));
  assert.ok(html.includes("data-key=\"hasMortgage\""));
});
test("source YEAR mismatch blocks even an otherwise supported salary model",()=>{
  const result=tax.calculate({...base,sourceYear:2025});
  assert.equal(result.status,"HOLD");
  assert.ok(result.reasons.some(r=>r.includes("所得年")));
});
test("malformed source-review flags never default to safe false",()=>{
  for(const val of ["false","true",0,1,null,[],{}]){
    const x=tax.calculate({...base,sourceReviewPending:val});
    assert.equal(x.status,"HOLD","invalid flag "+String(val));
    assert.equal(x.donationLimitYen,null);
  }
});
test("none of the unsupported flags may contain malformed values",()=>{
  for(const key of ["hasMortgage","hasDependents","hasLifeInsurance"]){
    const result=tax.calculate({...base,[key]:"no"});
    assert.equal(result.status,"HOLD",key);
  }
});
test("source G46 basic deduction must agree with selected income year",()=>{
  const hold=tax.calculate({...base,sourceBasicReference:630000});
  assert.equal(hold.status,"HOLD");
  assert.ok(hold.reasons.some(x=>x.includes("源泉徴収票の基礎控除額")));
  const pass=tax.calculate({...base,sourceBasicReference:670000});
  assert.equal(pass.status,"ESTIMATE");
  assert.equal(pass.donationLimitYen,109000);
  const lastYear=tax.calculate({...base,year:2025,sourceBasicReference:630000});
  assert.equal(lastYear.status,"ESTIMATE");
});
test("imported source flags are never waived by user unticking UI checkboxes",()=>{
  const imported={...base,hasMortgage:false,hasDependents:false,
    sourceIndicators:{hasMortgage:true,hasDependents:true}};
  const r=tax.calculate(imported);
  assert.equal(r.status,"HOLD");
  assert.equal(r.donationLimitYen,null);
  assert.ok(r.reasons.some(x=>x.includes("hasMortgage")));
  assert.ok(r.reasons.some(x=>x.includes("hasDependents")));
});
test("malformed imported-source indicators are rejected rather than ignored",()=>{
  for (const sourceIndicators of [null,"none",[],{hasMortgage:"false"},{bogus:true}]) {
    const r=tax.calculate({...base,sourceIndicators});
    assert.equal(r.status,"HOLD");
    assert.equal(r.donationLimitYen,null);
  }
});
test("GAS entrypoint does not collect or persist source documents",()=>{
  const code=fs.readFileSync(path.join(root,"Code.gs"),"utf8");
  assert.ok(code.includes("function doGet()"));
  assert.ok(code.includes("function runFurusatoSimulation(input)"));
  assert.ok(!code.includes("DriveApp.createFile"));
  assert.ok(!code.includes("PropertiesService.getUserProperties"));
});
process.stdout.write("RESULT "+count+" cases passed"+(process.exitCode?" with failures":"")+"\n");
if(process.exitCode)process.exit(process.exitCode);
