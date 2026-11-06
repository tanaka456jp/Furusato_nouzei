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
test("source salary income required for lower wage",()=>{
  const x=tax.calculate({...base,salaryGross:"5000000",socialInsurance:"1600000"});
  assert.equal(x.status,"HOLD");assert.equal(x.donationLimitYen,null);
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
  assert.deepEqual(x.filter(r=>r[0]===2026).slice(-3).map(r=>r[3]),[290000,150000,0]);
  assert.deepEqual(x.filter(r=>r[0]===2025).slice(-3).map(r=>r[3]),[290000,150000,0]);
});
test("app front end inline script is syntactically valid",()=>{
  const html=fs.readFileSync(path.join(root,"Index.html"),"utf8");
  const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length,1);
  new vm.Script(scripts[0][1],{filename:"Index.html:inline"});
  assert.ok(html.includes("印刷・PDF保存"));
  assert.ok(html.includes("data-key=\"hasMortgage\""));
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
