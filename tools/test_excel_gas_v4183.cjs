"use strict";
const assert = require("node:assert/strict");
const {compare, PINNED_GAS_SHA, SCHEMA} = require("./compare_excel_gas_v4183.cjs");
const salary2025 = [1899999,1900000,1900001,2200000,2500000,3299999,3300000,
  3599999,3600000,4899999,4900000,5000000,5812500,6599999,6600000,7000000,8000000,8500000];
const salary2026 = [2190999,2191000,2192999,2193000,2195999,2196000,
  2199999,2200000,2200001,2500000,3299999,3300000,3599999,3600000,
  4899999,4900000,5000000,5812500,6599999,6600000,7000000,8000000,8500000];
const cases = [...salary2025.map(g => ({id:"Y2025_G"+g,year:2025,salaryGross:g,
  socialInsurance:g>=3000000?1000000:100000,filing:"one-stop"})),
 ...salary2026.map(g => ({id:"Y2026_G"+g,year:2026,salaryGross:g,
  socialInsurance:g>=3000000?1000000:100000,filing:"one-stop"}))];
const nta = {"Y2026_G2192999":1451000,"Y2026_G2195999":1453000,
  "Y2026_G2199999":1456000};
function fakeEngine(){
 return {calculate(v){
   const id="Y"+v.year+"_G"+v.salaryGross;
   return {status:"ESTIMATE",donationLimitYen:id==="Y2026_G7000000"?109000:v.salaryGross-1000000,
     calculation:{salaryIncomeYen:nta[id]??v.salaryGross-750000,
       residentIncomeLevyYen:Math.floor(v.salaryGross/10)}};
 }};
}
function fixture(source="MOCK"){
 return {schema:SCHEMA,source,gasCommitSha:PINNED_GAS_SHA,
  workbookSha256:"e".repeat(64),gasEngineSha256:"f".repeat(64),
  readOnly:true,macrosDisabled:true,dynamicABA:true,officialExcelSource:false,
  results:cases.map(v=>{
   const e=fakeEngine().calculate(v);
   return {...v,status:"NORMAL",statusText:"正常",calcState:2,
    donationLimitYen:e.donationLimitYen,
    salaryIncomeYen:e.calculation.salaryIncomeYen,
    residentIncomeLevyYen:e.calculation.residentIncomeLevyYen};
  })};
}
const matched=compare(fixture(),cases,fakeEngine(),{allowMock:true});
assert.equal(matched.checked,41);
assert.equal(matched.matched,41);
assert.equal(matched.numericVerdict,"MATCH_41_OF_41");
assert.equal(matched.releaseVerdict,"HOLD");
assert.equal(matched.actualExcelCOM,false,"mock fixture cannot prove real Excel");
assert.equal(matched.excelCalculationPendingCount,41);
assert.throws(()=>compare(fixture(),cases,fakeEngine()),/untrusted source/);
const duplicated=fixture();duplicated.results[1].id=duplicated.results[0].id;
assert.throws(()=>compare(duplicated,cases,fakeEngine(),{allowMock:true}),/repeated case/);
const missing=fixture();missing.results.pop();
assert.throws(()=>compare(missing,cases,fakeEngine(),{allowMock:true}),/exactly 41/);
const tampered=fixture();tampered.results[0].socialInsurance++;
assert.throws(()=>compare(tampered,cases,fakeEngine(),{allowMock:true}),/input changed/);
const pending=fixture();pending.results[0].calcState=1;
assert.throws(()=>compare(pending,cases,fakeEngine(),{allowMock:true}),/still running/);
const wrongBand=fixture();wrongBand.results.find(r=>r.id==="Y2026_G2192999").salaryIncomeYen++;
assert.throws(()=>compare(wrongBand,cases,fakeEngine(),{allowMock:true}),/violates 2026 NTA/);
const mismatch=fixture();mismatch.results[0].residentIncomeLevyYen++;
const diff=compare(mismatch,cases,fakeEngine(),{allowMock:true});
assert.equal(diff.mismatchCount,1);
assert.equal(diff.allNumericMatch,false);
assert.equal(diff.releaseVerdict,"HOLD");
assert.deepEqual(diff.differences[0].fields,["residentIncomeLevyYen"]);
const status=fixture();status.results[0].status="HOLD";
assert.throws(()=>compare(status,cases,fakeEngine(),{allowMock:true}),/Excel HOLD/);
const noAba=fixture();noAba.dynamicABA=false;
assert.throws(()=>compare(noAba,cases,fakeEngine(),{allowMock:true}),/untrusted source/);
const bogusSource=fixture();bogusSource.source="EXCEL_COM_V4_18_3_REVIEW";
assert.throws(()=>compare(bogusSource,cases,fakeEngine(),{allowMock:true}),/untrusted source/);
console.log("v4.18.3/GAS PARITY CONTRACT PASS; MOCK is not real Excel; final release HOLD");
