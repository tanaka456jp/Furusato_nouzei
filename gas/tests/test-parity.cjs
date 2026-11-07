"use strict";
const assert=require("node:assert/strict");
const cases=require("../parity/cases.cjs");
const {validate,compare,OFFICIAL_ZIP_SHA}=require("../parity/compare-excel.cjs");
const fake={calculate(input){
 const gross=Number(input.salaryGross);
 return {status:"ESTIMATE",donationLimitYen:gross-1000000,
  calculation:{salaryIncomeYen:gross-120000,residentIncomeLevyYen:Math.floor(gross/10)}};
}};
function fixture(source="MOCK"){return {schema:"furusato-excel-oracle/v1",source,
 releaseTag:"v4.18.2",releaseZipSha256:OFFICIAL_ZIP_SHA,excelWorkbookSha256:"f".repeat(64),
 calculationProvider:"EXCEL_COM",macrosDisabled:true,
 results:cases.map(x=>({...x,status:"NORMAL",donationLimitYen:x.salaryGross-1000000,
  salaryIncomeYen:x.salaryGross-120000,residentIncomeLevyYen:Math.floor(x.salaryGross/10)}))};}
assert.equal(cases.length,41);
assert.throws(()=>validate(fixture()),/independently/);
const mock=compare(fixture(),fake,{allowMock:true});
assert.equal(mock.checked,41);assert.equal(mock.mismatchCount,0);
assert.equal(mock.verdict,"HOLD");assert.equal(mock.verification,"MOCK_CONTRACT_ONLY");
const missing=fixture();missing.results.pop();
assert.throws(()=>validate(missing,{allowMock:true}),/case count/);
const forged=fixture("OFFICIAL_RELEASE");forged.releaseZipSha256="0".repeat(64);
assert.throws(()=>validate(forged),/SHA mismatch/);
const tamper=fixture();tamper.results[0].socialInsurance++;
assert.throws(()=>validate(tamper,{allowMock:true}),/input mismatch/);
const duplicate=fixture();duplicate.results[1].id=duplicate.results[0].id;
assert.throws(()=>validate(duplicate,{allowMock:true}),/duplicate case/);
const leak=fixture();leak.results[0].status="HOLD";
assert.throws(()=>validate(leak,{allowMock:true}),/must not contain/);
const mismatch=fixture();mismatch.results[0].donationLimitYen+=1000;
const delta=compare(mismatch,fake,{allowMock:true});
assert.equal(delta.verdict,"HOLD");assert.equal(delta.mismatchCount,1);
assert.deepEqual(delta.mismatches[0].fields,["donationLimitYen"]);
const noIncome=fixture();delete noIncome.results[0].salaryIncomeYen;
assert.throws(()=>validate(noIncome,{allowMock:true}),/missing\/invalid Excel salary income/);
const noLevy=fixture();delete noLevy.results[0].residentIncomeLevyYen;
assert.throws(()=>validate(noLevy,{allowMock:true}),/missing\/invalid Excel resident levy/);
const income=fixture();income.results[0].salaryIncomeYen++;
assert.deepEqual(compare(income,fake,{allowMock:true}).mismatches[0].fields,["salaryIncomeYen"]);
const status=fixture();status.results[0].status="HOLD";status.results[0].donationLimitYen=null;
status.results[0].salaryIncomeYen=null;status.results[0].residentIncomeLevyYen=null;
assert.deepEqual(compare(status,fake,{allowMock:true}).mismatches[0].fields,["status"]);
console.log("PARITY CONTRACT PASS (41 mock rows, provenance and mismatches fail closed). Real Excel NOT tested.");
