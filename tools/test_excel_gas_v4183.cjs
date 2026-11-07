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
  calculationDiagnostics: {
    schema:"furusato-excel-calc-state-diagnostic/v1",
    baselinePendingCount:0,initialForceFullCalculation:false,
    forceFullCalculationAfterDisable:false,initialCalculationState:0,
    calculationStateAfterDisableAndCalculate:0,
    persistedToWorkbook:false,readOnly:true,stateVerdict:"XL_DONE_AFTER_DISABLE_FORCE_FULL",
    transitions:[
      {salaryGrossYen:7000000,calculationState:0,salaryIncomeYen:5200000,donationLimitYen:109000,statusText:"正常"},
      {salaryGrossYen:5000000,calculationState:0,salaryIncomeYen:3560000,donationLimitYen:51000,statusText:"正常"},
      {salaryGrossYen:7000000,calculationState:0,salaryIncomeYen:5200000,donationLimitYen:109000,statusText:"正常"}
    ]
  },
  results:cases.map(v=>{
   const e=fakeEngine().calculate(v);
   return {...v,status:"NORMAL",statusText:"正常",calcState:0,
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
assert.equal(matched.excelCalculationPendingCount,0);
assert.equal(matched.excelCalculationDoneCount,41);
assert.equal(matched.calculationStateVerdict,"DONE_41_OF_41");
assert.throws(()=>compare(fixture(),cases,fakeEngine()),/untrusted source/);
const duplicated=fixture();duplicated.results[1].id=duplicated.results[0].id;
assert.throws(()=>compare(duplicated,cases,fakeEngine(),{allowMock:true}),/repeated case/);
const missing=fixture();missing.results.pop();
assert.throws(()=>compare(missing,cases,fakeEngine(),{allowMock:true}),/exactly 41/);
const tampered=fixture();tampered.results[0].socialInsurance++;
assert.throws(()=>compare(tampered,cases,fakeEngine(),{allowMock:true}),/input changed/);
const pending=fixture();pending.results[0].calcState=1;
assert.throws(()=>compare(pending,cases,fakeEngine(),{allowMock:true}),/not xlDone/);
const oldPending=fixture();oldPending.results[0].calcState=2;
assert.throws(()=>compare(oldPending,cases,fakeEngine(),{allowMock:true}),/not xlDone/);
const oldForce=fixture();oldForce.calculationDiagnostics.initialForceFullCalculation=true;
assert.throws(()=>compare(oldForce,cases,fakeEngine(),{allowMock:true}),/verified xlDone/);
const missingCalcEvidence=fixture();delete missingCalcEvidence.calculationDiagnostics;
assert.throws(()=>compare(missingCalcEvidence,cases,fakeEngine(),{allowMock:true}),/verified xlDone/);
const changedAnchor=fixture();changedAnchor.calculationDiagnostics.transitions[1].donationLimitYen=50000;
assert.throws(()=>compare(changedAnchor,cases,fakeEngine(),{allowMock:true}),/dynamic Excel anchor/);
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
// A read-only COM diagnostic may be attached only after the 41 approved
// numerical observations; it must not alter comparison acceptance.
const fs=require("node:fs"),path=require("node:path");
const psSource=fs.readFileSync(path.join(__dirname,"run_excel_gas_41_v4183.ps1"),"utf8");
assert.ok(psSource.includes("ForceFullCalculation=$false"),"Excel full-calc flag must be probed in memory");
assert.ok(psSource.includes("persistedToWorkbook=$false"),"Diagnostic cannot persist");
assert.ok(psSource.indexOf("if($observed.Count -ne 41)") < psSource.indexOf("$book.ForceFullCalculation=$false"),
 "41 cases must be observed before changing calculation settings");
assert.ok(psSource.includes("XL_DONE_AFTER_DISABLE_FORCE_FULL"),"Require an explicit result");
assert.ok(psSource.includes("PENDING_REMAINS_AFTER_DISABLE_FORCE_FULL"),"Pending must remain distinguishable");
console.log("v4.18.3/GAS PARITY CONTRACT PASS; MOCK is not real Excel; final release HOLD");
