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
assert.equal(a.appliedDeductionsYen,1670000);
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
// A verified prior-year source can become a *2026* forecast only after
// the income-tax basic deduction and all source figures are corrected.
const future=batch.fromPage(6,basic2025,2026);
assert.equal(future.sourceYear,2025);
assert.equal(future.year,2026);
future.confirmed=true;future.noExclusions=true;
batch.calculate(future,win.FurusatoEngine,guard);
assert.equal(future.status,"HOLD","prior-year forecast is not automatically approved");
batch.edit(future,"deductionsReference","1790000");
assert.equal(future.deductionsOverrideActive,true);
assert.equal(future.confirmed,false);
assert.equal(future.noExclusions,false);
assert.equal(future.candidates.deductionsReference,1790000);
future.confirmed=true;future.noExclusions=true;future.forecastReviewed=true;
batch.calculate(future,win.FurusatoEngine,guard);
assert.equal(future.status,"前年参考概算");
assert.equal(future.donationLimitYen,57000);
assert.equal(future.appliedDeductionsYen,1790000);
assert.match(batch.csv([future]),/前年参考概算/);
assert.match(batch.csv([future]),/手入力上書き・自動追随なし/);
assert.match(future.reason,/手入力上書き中/);
// A social-insurance edit cannot retroactively update the typed total.
batch.edit(future,"socialInsurance","800000");
future.confirmed=true;future.noExclusions=true;future.forecastReviewed=true;
batch.calculate(future,win.FurusatoEngine,guard);
assert.equal(future.status,"HOLD");
assert.equal(future.donationLimitYen,null);
batch.edit(future,"socialInsurance","750000");
future.confirmed=true;future.noExclusions=true;future.forecastReviewed=true;
batch.calculate(future,win.FurusatoEngine,guard);
assert.equal(future.status,"前年参考概算");
batch.edit(future,"label","架空受給者");
assert.equal(future.status,"HOLD");
assert.equal(future.donationLimitYen,null);
assert.equal(future.confirmed,false);
assert.equal(future.forecastReviewed,false);
assert.match(batch.csv([future]),/架空受給者/);
// With a clean original-source snapshot, a social edit uses the target
// year's independent basic/social deduction calculation automatically.
const autoForecast=batch.fromPage(14,basic2025,2026);
batch.edit(autoForecast,"socialInsurance","800000");
autoForecast.confirmed=true;autoForecast.noExclusions=true;autoForecast.forecastReviewed=true;
batch.calculate(autoForecast,win.FurusatoEngine,guard);
assert.equal(autoForecast.status,"前年参考概算");
assert.equal(autoForecast.appliedDeductionsYen,1840000);
assert.equal(autoForecast.originalCandidates.deductionsReference,1430000);
assert.equal(autoForecast.deductionsOverrideActive,false);
assert.match(batch.csv([autoForecast]),/1840000/);
// An original slip containing unrecognized extra deductions must never be
// silently converted into a basic/social-only estimate.
const unsupportedSource=batch.fromPage(15,{...basic2026,
 candidates:{...basic2026.candidates,deductionsReference:1800000}});
unsupportedSource.confirmed=true;unsupportedSource.noExclusions=true;
batch.calculate(unsupportedSource,win.FurusatoEngine,guard);
assert.equal(unsupportedSource.status,"HOLD");
assert.equal(unsupportedSource.donationLimitYen,null);
assert.equal(unsupportedSource.appliedDeductionsYen,null);
const patched=batch.fromPage(7,basic2026);
batch.edit(patched,"socialInsurance","");
assert.equal(patched.sourceValid,false);
patched.confirmed=true;patched.noExclusions=true;
batch.calculate(patched,win.FurusatoEngine,guard);
assert.equal(patched.donationLimitYen,null);
batch.edit(patched,"socialInsurance","1000000");
assert.equal(patched.sourceValid,true);
assert.equal(patched.confirmed,false);
batch.edit(patched,"sourceYear","2024");
assert.equal(patched.sourceValid,false);
batch.calculate(patched,win.FurusatoEngine,guard);
assert.equal(patched.status,"HOLD");
// Original source deductions cannot be waived by checkboxes or edits.
const credited=batch.fromPage(11,{
 ...basic2026,sourceIndicators:{hasMortgage:true,hasLifeInsurance:true}
});
credited.confirmed=true;credited.noExclusions=true;
batch.calculate(credited,win.FurusatoEngine,guard);
assert.equal(credited.status,"HOLD");
assert.equal(credited.donationLimitYen,null);
batch.edit(credited,"salaryGross","7000000");
assert.equal(credited.sourceIndicators.hasMortgage,true);
credited.confirmed=true;credited.noExclusions=true;
batch.calculate(credited,win.FurusatoEngine,guard);
assert.equal(credited.status,"HOLD");
assert.doesNotMatch(batch.csv([credited]),/,"109000",/);
const malformedIndicator=batch.fromPage(12,{
 ...basic2026,sourceIndicators:{unsafeField:true}
});
assert.equal(malformedIndicator.sourceIndicators.hasNonstandardConditions,true);
const supplied=batch.fromPage(8,{...basic2026,recipientName:"架空一郎"});
assert.equal(supplied.label,"架空一郎");
const incoming=batch.fromPage(9,{
 eligibleForManualTransfer:false,recipientName:"架空二郎"
},2026);
assert.equal(incoming.label,"架空二郎");
assert.equal(incoming.sourceValid,false);
// The actual 2025 source PDF may have a blank G26 insurance slot.
// All uniquely verified other numbers must survive for manual completion,
// but the row must not show a ceiling until the required field is supplied
// and confirmed explicitly.
const partial=batch.fromPage(10,{
 year:2025,eligibleForManualTransfer:false,recipientName:"架空四郎",
 candidates:{salaryGross:960000,salaryIncomeReference:310000,
  deductionsReference:1012828}
},2026);
assert.equal(partial.label,"架空四郎");
assert.equal(partial.sourceYear,2025);
assert.equal(partial.candidates.socialInsurance,undefined);
assert.equal(partial.candidates.salaryGross,960000);
assert.equal(partial.sourceValid,false);
partial.confirmed=true;partial.noExclusions=true;partial.forecastReviewed=true;
batch.calculate(partial,win.FurusatoEngine,guard);
assert.equal(partial.donationLimitYen,null);
batch.edit(partial,"socialInsurance","0");
assert.equal(partial.sourceValid,true);
assert.equal(partial.confirmed,false,"Manual fill must revoke source confirmation");
batch.calculate(partial,win.FurusatoEngine,guard);
assert.equal(partial.status,"HOLD");
dom.window.close();
console.log("PUBLIC_BATCH_PER_PAGE_LOCAL_SAFETY_SYNTHETIC_PASS; no private slips; no deploy");
