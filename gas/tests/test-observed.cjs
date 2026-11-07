"use strict";
const assert=require("node:assert/strict"),cases=require("../parity/cases.cjs");
const {compare}=require("../parity/compare-observed.cjs");
function mk(){
 return {schema:"furusato-excel-oracle/v1",source:"OBSERVED_GLOBAL_PENDING",
  releaseTag:"v4.18.2",
  releaseZipSha256:"f534882f56461ea23a75474f24e68ad364d557091609c994341c179e9a655f25",
  excelWorkbookSha256:"f".repeat(64),calculationProvider:"EXCEL_COM",macrosDisabled:true,
  results:cases.map(c=>({...c,status:"NORMAL",statusText:"正常",calcState:2,
   donationLimitYen:c.id==="Y2026_G7000000"?109000:c.salaryGross-100000,
   salaryIncomeYen:c.salaryGross-1000000,residentIncomeLevyYen:Math.floor(c.salaryGross/10)}))};
}
const fake={calculate:i=>({status:"ESTIMATE",
 donationLimitYen:i.salaryGross-100000,
 calculation:{salaryIncomeYen:i.salaryGross-1000000,residentIncomeLevyYen:Math.floor(i.salaryGross/10)}})};
let x=compare(mk(),fake);
assert.equal(x.verdict,"HOLD");
assert.equal(x.checked,41);
assert.equal(x.globalPendingCount,41);
const wrong=mk();wrong.results[0].calcState=1;
assert.throws(()=>compare(wrong,fake),/calculation still running/);
const duplicate=mk();duplicate.results[1].id=duplicate.results[0].id;
assert.throws(()=>compare(duplicate,fake),/repeated case/);
const allCached=mk();allCached.results.forEach(r=>r.salaryIncomeYen=5200000);
assert.throws(()=>compare(allCached,fake),/did not respond/);
const leak=mk();leak.results[0].status="HOLD";leak.results[0].statusText="未確認";
assert.throws(()=>compare(leak,fake),/HOLD leaked/);
const untrusted=mk();untrusted.source="OFFICIAL_RELEASE";
assert.throws(()=>compare(untrusted,fake),/untrusted/);
console.log("OBSERVED-41 CONTRACT PASS; result always HOLD even when values respond.");
