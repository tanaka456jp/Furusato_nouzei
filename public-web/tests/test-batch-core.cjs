"use strict";
/** Synthetic-only local multi-slip regression. NEVER use real tax documents. */
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const {JSDOM}=require("../../gas/node_modules/jsdom");
const batch=require("../src/batch-core.js");
const root=path.resolve(__dirname,"../dist");
const dom=new JSDOM(fs.readFileSync(path.join(root,"index.html"),"utf8"),
 {url:"https://offline-review.invalid/",runScripts:"outside-only"});
const win=dom.window;
win.eval(fs.readFileSync(path.join(root,"engine.js"),"utf8"));
win.eval(fs.readFileSync(path.join(root,"app.js"),"utf8"));
const guard=win.FurusatoEstimateGuard?.canDisplayEstimate;
assert.equal(typeof guard,"function");
assert.equal(batch.MAX_ROWS,20);
const basic2026={year:2026,eligibleForManualTransfer:true,candidates:{
 salaryGross:7000000,salaryIncomeReference:5200000,
 deductionsReference:1670000,socialInsurance:1000000
}};
const basic2025={year:2025,eligibleForManualTransfer:true,candidates:{
 salaryGross:5000000,salaryIncomeReference:3560000,
 deductionsReference:1430000,socialInsurance:750000
}};
const a=batch.fromPage(1,basic2026);
const b=batch.fromPage(2,basic2025);
const c=batch.fromPage(3,{eligibleForManualTransfer:false});
assert.equal(a.sourceValid,true);
assert.equal(b.sourceValid,true);
assert.equal(c.sourceValid,false);
assert.equal(a.candidates.personalName,undefined);
assert.equal(a.label,"");
batch.calculate(a,win.FurusatoEngine,guard);
assert.equal(a.status,"HOLD","OCR alone must never automatically calculate");
a.confirmed=true;
batch.calculate(a,win.FurusatoEngine,guard);
assert.equal(a.status,"HOLD","unsupported-condition check must be explicit");
a.noExclusions=true;
batch.calculate(a,win.FurusatoEngine,guard);
assert.equal(a.status,"概算");
assert.equal(a.donationLimitYen,109000);
b.confirmed=true;b.noExclusions=true;
batch.calculate(b,win.FurusatoEngine,guard);
assert.equal(b.status,"概算");
assert.equal(b.donationLimitYen,61000);
batch.calculate(c,win.FurusatoEngine,guard);
assert.equal(c.status,"HOLD");
assert.equal(c.donationLimitYen,null);
const exported=batch.csv([a,b,c]);
assert.ok(exported.startsWith("\ufeff"));
assert.match(exported,/109000/);
assert.match(exported,/61000/);
assert.match(exported,/HOLD/);
assert.equal(exported.split("\r\n").length,5);
assert.doesNotMatch(exported,/personalName|employer|address/);
const weird=batch.fromPage(4,{...basic2026,candidates:{
 ...basic2026.candidates,personalName:"SYNTHETIC_PERSON_NAME",
 employer:"SYNTHETIC_EMPLOYER"
}});
assert.equal(weird.candidates.personalName,undefined);
weird.label='=HYPERLINK("https://not-sent.invalid","unsafe")';
weird.confirmed=true;weird.noExclusions=true;
batch.calculate(weird,win.FurusatoEngine,guard);
const line=batch.csv([weird]);
assert.ok(line.includes("'=HYPERLINK("),"manual label must be escaped for Excel");
assert.ok(!line.includes("SYNTHETIC_PERSON_NAME"));
assert.ok(!line.includes("SYNTHETIC_EMPLOYER"));
for(const invalid of [
 {eligibleForManualTransfer:true,year:2024,candidates:basic2026.candidates},
 {eligibleForManualTransfer:true,year:2026,candidates:{...basic2026.candidates,salaryGross:"7000000"}},
 {eligibleForManualTransfer:true,year:2026,candidates:{...basic2026.candidates,socialInsurance:Infinity}}
]){
 const r=batch.fromPage(8,invalid);
 assert.equal(r.status,"HOLD");
 assert.equal(r.sourceValid,false);
}
assert.throws(()=>batch.csv(Array.from({length:21},(_,n)=>
 batch.holdRow(n+1,"not-a-candidate"))),/BATCH_CSV_ROWS_INVALID/);
const oldAmount=a.donationLimitYen;
a.confirmed=false;
batch.calculate(a,win.FurusatoEngine,guard);
assert.equal(a.donationLimitYen,null);
assert.notEqual(a.donationLimitYen,oldAmount);
b.year=2026;
batch.calculate(b,win.FurusatoEngine,guard);
assert.equal(b.status,"HOLD","2025 slip must not calculate using 2026 year");
// Internal tax engine and UI guard are not bypassed even if an engine emits
// an unverified number. No synthetic test can attest real source accuracy.
const invented={calculate:()=>({status:"ESTIMATE",donationLimitYen:999999})};
const x=batch.fromPage(5,basic2026);x.confirmed=true;x.noExclusions=true;
batch.calculate(x,invented,guard);
assert.equal(x.status,"HOLD");
assert.equal(x.donationLimitYen,null);
dom.window.close();
console.log("PUBLIC_BATCH_PER_PAGE_LOCAL_SAFETY_SYNTHETIC_PASS; no private slips; no deploy");
