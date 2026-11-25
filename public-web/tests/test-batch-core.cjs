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
win.eval(fs.readFileSync(path.join(root,"resident-levy.js"),"utf8"));
win.eval(fs.readFileSync(path.join(root,"app.js"),"utf8"));
const guard=win.FurusatoEstimateGuard?.canDisplayEstimate;
const selected=win.FurusatoEstimateGuard?.selectedReference;
const fixture=(...args)=>{const row=batch.fromPage(...args);row.municipality="standard";return row;};
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
const a=fixture(1,basic2026);
const b=fixture(2,basic2025);
const c=fixture(3,{eligibleForManualTransfer:false});
assert.equal(a.sourceValid,true);
assert.equal(b.sourceValid,true);
assert.equal(c.sourceValid,false);
assert.equal(a.candidates.personalName,undefined);
assert.equal(a.label,"");
batch.calculate(a,win.FurusatoEngine,guard,selected,win.FurusatoResidentLevy);
assert.equal(a.status,"HOLD","OCR alone must never automatically calculate");
a.confirmed=true;
batch.calculate(a,win.FurusatoEngine,guard,selected,win.FurusatoResidentLevy);
assert.equal(a.status,"HOLD","unsupported-condition check must be explicit");
a.noExclusions=true;
batch.calculate(a,win.FurusatoEngine,guard,selected,win.FurusatoResidentLevy);
assert.equal(a.status,"概算");
assert.equal(a.donationLimitYen,109000);
assert.equal(a.appliedDeductionsYen,1670000);
b.confirmed=true;b.noExclusions=true;
batch.calculate(b,win.FurusatoEngine,guard,selected,win.FurusatoResidentLevy);
assert.equal(b.status,"概算");
assert.equal(b.donationLimitYen,61000);
batch.calculate(c,win.FurusatoEngine,guard,selected,win.FurusatoResidentLevy);
assert.equal(c.status,"HOLD");
assert.equal(c.donationLimitYen,null);
const exported=batch.csv([a,b,c]);
assert.ok(exported.startsWith("\ufeff"));
assert.match(exported,/109000/);
assert.match(exported,/61000/);
assert.match(exported,/HOLD/);
assert.equal(exported.split("\r\n").length,5);
assert.doesNotMatch(exported,/personalName|employer|address/);
const weird=fixture(4,{...basic2026,candidates:{
 ...basic2026.candidates,personalName:"SYNTHETIC_PERSON_NAME",
 employer:"SYNTHETIC_EMPLOYER"
}});
assert.equal(weird.candidates.personalName,undefined);
weird.label='=HYPERLINK("https://not-sent.invalid","unsafe")';
weird.confirmed=true;weird.noExclusions=true;
batch.calculate(weird,win.FurusatoEngine,guard,selected,win.FurusatoResidentLevy);
const line=batch.csv([weird]);
assert.ok(line.includes("'=HYPERLINK("),"manual label must be escaped for Excel");
assert.ok(!line.includes("SYNTHETIC_PERSON_NAME"));
assert.ok(!line.includes("SYNTHETIC_EMPLOYER"));
for(const invalid of [
 {eligibleForManualTransfer:true,year:2024,candidates:basic2026.candidates},
 {eligibleForManualTransfer:true,year:2026,candidates:{...basic2026.candidates,salaryGross:"7000000"}},
 {eligibleForManualTransfer:true,year:2026,candidates:{...basic2026.candidates,socialInsurance:Infinity}}
]){
 const r=fixture(8,invalid);
 assert.equal(r.status,"HOLD");
 assert.equal(r.sourceValid,false);
}
assert.throws(()=>batch.csv(Array.from({length:21},(_,n)=>
 batch.holdRow(n+1,"not-a-candidate"))),/BATCH_CSV_ROWS_INVALID/);
const oldAmount=a.donationLimitYen;
a.confirmed=false;
batch.calculate(a,win.FurusatoEngine,guard,selected,win.FurusatoResidentLevy);
assert.equal(a.donationLimitYen,null);
assert.notEqual(a.donationLimitYen,oldAmount);
b.year=2026;
batch.calculate(b,win.FurusatoEngine,guard,selected,win.FurusatoResidentLevy);
assert.equal(b.status,"HOLD","2025 slip must not calculate using 2026 year");
// Internal tax engine and UI guard are not bypassed even if an engine emits
// an unverified number. No synthetic test can attest real source accuracy.
const invented={calculate:()=>({status:"ESTIMATE",donationLimitYen:999999})};
const x=fixture(5,basic2026);x.confirmed=true;x.noExclusions=true;
batch.calculate(x,invented,guard,selected,win.FurusatoResidentLevy);
assert.equal(x.status,"HOLD");
assert.equal(x.donationLimitYen,null);
// A verified prior-year source can become a *2026* forecast only after
// the income-tax basic deduction and all source figures are corrected.
const future=fixture(6,basic2025,2026);
assert.equal(future.sourceYear,2025);
assert.equal(future.year,2026);
future.confirmed=true;future.noExclusions=true;
batch.calculate(future,win.FurusatoEngine,guard,selected,win.FurusatoResidentLevy);
assert.equal(future.status,"HOLD","prior-year forecast is not automatically approved");
batch.edit(future,"deductionsReference","1790000");
assert.equal(future.deductionsOverrideActive,true);
assert.equal(future.confirmed,false);
assert.equal(future.noExclusions,false);
assert.equal(future.candidates.deductionsReference,1790000);
future.confirmed=true;future.noExclusions=true;future.forecastReviewed=true;
batch.calculate(future,win.FurusatoEngine,guard,selected,win.FurusatoResidentLevy);
assert.equal(future.status,"前年参考概算");
assert.equal(future.donationLimitYen,57000);
assert.equal(future.appliedDeductionsYen,1790000);
assert.match(batch.csv([future]),/前年参考概算/);
assert.match(batch.csv([future]),/手入力上書き・自動追随なし/);
assert.match(future.reason,/手入力上書き中/);
// A social-insurance edit cannot retroactively update the typed total.
batch.edit(future,"socialInsurance","800000");
future.confirmed=true;future.noExclusions=true;future.forecastReviewed=true;
batch.calculate(future,win.FurusatoEngine,guard,selected,win.FurusatoResidentLevy);
assert.equal(future.status,"HOLD");
assert.equal(future.donationLimitYen,null);
batch.edit(future,"socialInsurance","750000");
future.confirmed=true;future.noExclusions=true;future.forecastReviewed=true;
batch.calculate(future,win.FurusatoEngine,guard,selected,win.FurusatoResidentLevy);
assert.equal(future.status,"前年参考概算");
batch.edit(future,"label","架空受給者");
assert.equal(future.status,"HOLD");
assert.equal(future.donationLimitYen,null);
assert.equal(future.confirmed,false);
assert.equal(future.forecastReviewed,false);
assert.match(batch.csv([future]),/架空受給者/);
// With a clean original-source snapshot, a social edit uses the target
// year's independent basic/social deduction calculation automatically.
const autoForecast=fixture(14,basic2025,2026);
batch.edit(autoForecast,"socialInsurance","800000");
autoForecast.confirmed=true;autoForecast.noExclusions=true;autoForecast.forecastReviewed=true;
batch.calculate(autoForecast,win.FurusatoEngine,guard,selected,win.FurusatoResidentLevy);
assert.equal(autoForecast.status,"前年参考概算");
assert.equal(autoForecast.appliedDeductionsYen,1840000);
assert.equal(autoForecast.originalCandidates.deductionsReference,1430000);
assert.equal(autoForecast.deductionsOverrideActive,false);
assert.match(batch.csv([autoForecast]),/1840000/);
// An original slip containing unrecognized extra deductions must never be
// silently converted into a basic/social-only estimate.
const unsupportedSource=fixture(15,{...basic2026,
 candidates:{...basic2026.candidates,deductionsReference:1800000}});
unsupportedSource.confirmed=true;unsupportedSource.noExclusions=true;
batch.calculate(unsupportedSource,win.FurusatoEngine,guard,selected,win.FurusatoResidentLevy);
assert.equal(unsupportedSource.status,"HOLD");
assert.equal(unsupportedSource.donationLimitYen,null);
assert.equal(unsupportedSource.appliedDeductionsYen,null);
const patched=fixture(7,basic2026);
batch.edit(patched,"socialInsurance","");
assert.equal(patched.sourceValid,false);
patched.confirmed=true;patched.noExclusions=true;
batch.calculate(patched,win.FurusatoEngine,guard,selected,win.FurusatoResidentLevy);
assert.equal(patched.donationLimitYen,null);
batch.edit(patched,"socialInsurance","1000000");
assert.equal(patched.sourceValid,true);
assert.equal(patched.confirmed,false);
batch.edit(patched,"sourceYear","2024");
assert.equal(patched.sourceValid,false);
batch.calculate(patched,win.FurusatoEngine,guard,selected,win.FurusatoResidentLevy);
assert.equal(patched.status,"HOLD");
// Original source deductions cannot be waived by checkboxes or edits.
const credited=fixture(11,{
 ...basic2026,sourceIndicators:{hasMortgage:true,hasLifeInsurance:true}
});
credited.confirmed=true;credited.noExclusions=true;
batch.calculate(credited,win.FurusatoEngine,guard,selected,win.FurusatoResidentLevy);
assert.equal(credited.status,"HOLD");
assert.equal(credited.donationLimitYen,null);
batch.edit(credited,"salaryGross","7000000");
assert.equal(credited.sourceIndicators.hasMortgage,true);
credited.confirmed=true;credited.noExclusions=true;
batch.calculate(credited,win.FurusatoEngine,guard,selected,win.FurusatoResidentLevy);
assert.equal(credited.status,"HOLD");
assert.doesNotMatch(batch.csv([credited]),/,"109000",/);
const malformedIndicator=fixture(12,{
 ...basic2026,sourceIndicators:{unsafeField:true}
});
assert.equal(malformedIndicator.sourceIndicators.hasNonstandardConditions,true);
const supplied=fixture(8,{...basic2026,recipientName:"架空一郎"});
assert.equal(supplied.label,"架空一郎");
const incoming=fixture(9,{
 eligibleForManualTransfer:false,recipientName:"架空二郎"
},2026);
assert.equal(incoming.label,"架空二郎");
assert.equal(incoming.sourceValid,false);
// The actual 2025 source PDF may have a blank G26 insurance slot.
// All uniquely verified other numbers must survive for manual completion,
// but the row must not show a ceiling until the required field is supplied
// and confirmed explicitly.
const partial=fixture(10,{
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
batch.calculate(partial,win.FurusatoEngine,guard,selected,win.FurusatoResidentLevy);
assert.equal(partial.donationLimitYen,null);
batch.edit(partial,"socialInsurance","0");
assert.equal(partial.sourceValid,true);
assert.equal(partial.confirmed,false,"Manual fill must revoke source confirmation");
batch.calculate(partial,win.FurusatoEngine,guard,selected,win.FurusatoResidentLevy);
assert.equal(partial.status,"HOLD");
// A stale calculated deduction total must not leak into CSV after confirmation is revoked.
const stale=fixture(20,basic2026);
stale.confirmed=true;stale.noExclusions=true;
batch.calculate(stale,win.FurusatoEngine,guard,selected,win.FurusatoResidentLevy);
assert.equal(stale.status,"概算");
assert.equal(stale.appliedDeductionsYen,1670000);
// Source input and computed total can be equal. Verify the actual columns,
 // not absence of a string anywhere in the CSV. Both computed outputs and
 // their status must be masked when ANY required confirmation is revoked.
const columns=row=>batch.csv([row]).split("\r\n")[1].split(",").map(x=>x.slice(1,-1));
assert.equal(columns(stale)[6],"1670000");
assert.equal(columns(stale)[7],"1670000");
assert.equal(columns(stale)[11],"109000");
for(const revoke of [
 row=>{row.confirmed=false;},
 row=>{row.noExclusions=false;},
 row=>{row.sourceIndicators.hasMortgage=true;},
 row=>{row.sourceValid=false;},
 row=>{row.filing="invalid";},
 row=>{row.filing="return";},
 row=>{row.municipality="designated";},
 row=>{row.municipality="";},
 row=>{row.appliedDeductionsYen=null;},
 row=>{row.trialInput="120000";},
 row=>{row.candidates.socialInsurance=1000001;},
 row=>{row.year=2025;}
]){
 const candidate=fixture(20,basic2026);
 candidate.confirmed=true;candidate.noExclusions=true;
 batch.calculate(candidate,win.FurusatoEngine,guard,selected,win.FurusatoResidentLevy);
 assert.equal(batch.canOutputEstimate(candidate),true);
 revoke(candidate);
 const values=columns(candidate);
 assert.equal(batch.canOutputEstimate(candidate),false);
 assert.equal(values[7],"","unconfirmed calculation details must not export");
 assert.equal(values[11],"","unconfirmed ceiling must not export");
 assert.equal(values[12],"HOLD");
 assert.equal(values[15],"","stale resident levy must not export");
 assert.equal(values[16],"","stale calculation basis must not export");
 for(const i of [17,18,20,21,22])assert.equal(values[i],"","stale comparison must not export");
 assert.equal(values[23],"HOLD");
}
stale.confirmed=false;
assert.equal(columns(stale)[6],"1670000","original input remains visible for review");
const staleForecast=fixture(20,basic2025,2026);
staleForecast.confirmed=true;staleForecast.noExclusions=true;staleForecast.forecastReviewed=true;
batch.calculate(staleForecast,win.FurusatoEngine,guard,selected,win.FurusatoResidentLevy);
assert.equal(batch.canOutputEstimate(staleForecast),true);
staleForecast.forecastReviewed=false;
assert.equal(columns(staleForecast)[7],"");
assert.equal(columns(staleForecast)[11],"");
assert.equal(columns(staleForecast)[12],"HOLD");

const unknown=batch.fromPage(1,basic2026);
unknown.confirmed=true;unknown.noExclusions=true;
batch.calculate(unknown,win.FurusatoEngine,guard,selected,win.FurusatoResidentLevy);
assert.equal(unknown.status,"HOLD");assert.equal(unknown.donationLimitYen,null);
batch.edit(unknown,"municipality","designated");
assert.equal(unknown.confirmed,false);
unknown.confirmed=true;unknown.noExclusions=true;
batch.calculate(unknown,win.FurusatoEngine,guard,selected,win.FurusatoResidentLevy);
assert.equal(unknown.donationLimitYen,109000);
assert.equal(unknown.residentLevyYen,374500);
assert.equal(columns(unknown)[14],"政令指定都市");
assert.equal(columns(unknown)[15],"374500");
assert.equal(columns(unknown)[16],"自治体別ワンストップ参考");
batch.edit(unknown,"municipality","standard");
assert.equal(unknown.residentLevyYen,null);
assert.equal(columns(unknown)[15],"");
const trialRow=fixture(1,basic2026);
trialRow.confirmed=true;trialRow.noExclusions=true;
batch.calculate(trialRow,win.FurusatoEngine,guard,selected,win.FurusatoResidentLevy);
assert.deepEqual(columns(trialRow).slice(17,24),["109000","109000","","109000","1951","0","確定申告参考"]);
batch.edit(trialRow,"trialInput","120000");
assert.equal(trialRow.confirmed,true);
assert.equal(trialRow.noExclusions,true);
assert.equal(batch.outputComparison(trialRow),null);
batch.calculate(trialRow,win.FurusatoEngine,guard,selected,win.FurusatoResidentLevy);
assert.deepEqual(columns(trialRow).slice(17,24),["109000","109000","120000","120000","9104","7104","確定申告参考"]);
batch.edit(trialRow,"trialInput","1999");
batch.calculate(trialRow,win.FurusatoEngine,guard,selected,win.FurusatoResidentLevy);
assert.deepEqual(columns(trialRow).slice(17,24),["109000","109000","1999","","","","HOLD"]);
batch.edit(trialRow,"trialInput","=1+1");
batch.calculate(trialRow,win.FurusatoEngine,guard,selected,win.FurusatoResidentLevy);
assert.equal(columns(trialRow)[19],"'=1+1");
assert.equal(columns(trialRow)[21],"");
const familyTax=require("../dist/family-tax.js"),familySource=require("../dist/family-source.js");
const familyReview={year:2025,eligibleForManualTransfer:true,sourceIndicators:{hasDependents:true},
 candidates:{salaryGross:6500000,salaryIncomeReference:4760000,socialInsurance:1340000,deductionsReference:3030000}};
const familyRow=fixture(1,familyReview,2026);
const runFamily=r=>batch.calculate(r,win.FurusatoEngine,guard,selected,win.FurusatoResidentLevy,familyTax,familySource);
const attest=r=>{r.confirmed=true;r.noExclusions=true;r.forecastReviewed=true;r.familyReviewed=true;};
batch.edit(familyRow,"familySourceText","S,40,600000\nR,20,600000,0");
batch.edit(familyRow,"familyTargetText","S,41,600000\nR,21,600000,0");
attest(familyRow);familyRow.familyReviewed=false;runFamily(familyRow);
assert.equal(familyRow.status,"HOLD");
attest(familyRow);runFamily(familyRow);
assert.equal(familyRow.status,"前年参考概算");assert.equal(familyRow.donationLimitYen,53000);
assert.equal(familyRow.appliedDeductionsYen,3390000);
assert.equal(batch.canOutputEstimate(familyRow),true);
assert.deepEqual(columns(familyRow).slice(24,27),["3030000","1010000","780000"]);
assert.doesNotMatch(batch.csv([familyRow]),/S,40|R,20/);
for(const mutate of [
 r=>{r.familyReviewed=false;},r=>{r.familySourceText="なし";},
 r=>{r.familyTargetText="なし";},r=>{r.sourceYear=2026;},
 r=>{r.sourceIndicators.hasMortgage=true;}
]){
 const r=fixture(2,familyReview,2026);
 batch.edit(r,"familySourceText","S,40,600000\nR,20,600000,0");
 batch.edit(r,"familyTargetText","S,41,600000\nR,21,600000,0");
 attest(r);runFamily(r);assert.equal(batch.canOutputEstimate(r),true);
 mutate(r);assert.equal(batch.canOutputEstimate(r),false);
 assert.deepEqual(columns(r).slice(24,27),["","",""]);
}
batch.edit(familyRow,"familySourceText","S,40,600000");
attest(familyRow);runFamily(familyRow);assert.equal(familyRow.status,"HOLD");
assert.equal(familyRow.donationLimitYen,null);
batch.edit(familyRow,"familySourceText","S,40,600000\nR,20,600000,0");
batch.edit(familyRow,"familyTargetText","S,41,600000\nR,21,600000,0");
batch.edit(familyRow,"deductionsReference","3030000");
attest(familyRow);runFamily(familyRow);assert.equal(familyRow.status,"HOLD");
batch.edit(familyRow,"deductionsReference","3390000");
attest(familyRow);runFamily(familyRow);assert.equal(familyRow.donationLimitYen,53000);
batch.edit(familyRow,"trialInput","120000");runFamily(familyRow);
assert.equal(familyRow.comparison.trial.donation,120000);
assert.equal(familyRow.familyReviewed,true);
// Insurance and family source-year audit: the same premiums receive
// different national deductions in 2025 and 2026.
const insuredReview={...familyReview,sourceIndicators:{hasDependents:true,hasLifeInsurance:true,hasEarthquakeInsurance:true},
 candidates:{...familyReview.candidates,deductionsReference:3120000}};
function insuredFixture(){
 const r=fixture(1,insuredReview,2026);
 batch.edit(r,"familySourceText","S,40,600000\nR,20,600000,0");
 batch.edit(r,"familyTargetText","S,41,600000\nR,21,600000,0");
 for(const prefix of ["source","target"]){
  batch.edit(r,prefix+"Insurance_generalNew","120000");
  batch.edit(r,prefix+"Insurance_earthquake","50000");
 }
 attest(r);r.insuranceReviewed=true;
 return r;
}
const insuredRow=insuredFixture();
insuredRow.insuranceReviewed=false;runFamily(insuredRow);assert.equal(insuredRow.status,"HOLD");
insuredRow.insuranceReviewed=true;runFamily(insuredRow);
assert.equal(insuredRow.donationLimitYen,51000);
assert.equal(insuredRow.appliedDeductionsYen,3500000);
assert.equal(batch.canOutputEstimate(insuredRow),true);
assert.deepEqual(columns(insuredRow).slice(24,27),["3120000","1010000","780000"]);
assert.deepEqual(columns(insuredRow).slice(27,33),["90000","60000","28000","50000","25000","適用"]);
assert.equal(insuredRow.comparison.filing,10000);
// A matching sum cannot conceal a misallocation between insurance types.
const hintRow=insuredFixture();hintRow.insuranceDeductionHints=Object.freeze({sourceLifeDeductionHint:40000,sourceEarthDeductionHint:50000});
runFamily(hintRow);assert.equal(batch.canOutputEstimate(hintRow),true,hintRow.reason);
hintRow.insuranceDeductionHints={sourceLifeDeductionHint:50000,sourceEarthDeductionHint:40000};
assert.equal(batch.canOutputEstimate(hintRow),false);
runFamily(hintRow);assert.equal(hintRow.status,"HOLD");assert.match(hintRow.reason,/生命保険料控除額/);assert.equal(columns(hintRow)[11],"");
const earthMismatch=insuredFixture();earthMismatch.insuranceDeductionHints={sourceEarthDeductionHint:49000};
runFamily(earthMismatch);assert.equal(earthMismatch.status,"HOLD");assert.match(earthMismatch.reason,/地震保険料控除額/);
for(const mutate of [
 r=>{r.insuranceReviewed=false;},r=>{r.sourceInsurance_generalNew="0";},
 r=>{r.targetInsurance_generalNew="80000";},r=>{r.sourceIndicators.hasMortgage=true;}
]){
 const r=insuredFixture();runFamily(r);assert.equal(batch.canOutputEstimate(r),true);
 mutate(r);assert.equal(batch.canOutputEstimate(r),false);
 assert.deepEqual(columns(r).slice(27,33),["","","","","",""]);
}
for(const [key,value] of [["sourceInsurance_generalNew","0"],["targetInsurance_generalNew","bad"],
 ["targetInsurance_generalNew","-1"],["targetInsurance_generalNew","100000001"]]){
 const r=insuredFixture();batch.edit(r,key,value);attest(r);r.insuranceReviewed=true;
 runFamily(r);assert.equal(r.status,"HOLD");assert.equal(r.donationLimitYen,null);
}
const same=insuredFixture();batch.edit(same,"year","2025");
batch.edit(same,"familyTargetText",same.familySourceText);attest(same);same.insuranceReviewed=true;
runFamily(same);assert.equal(same.donationLimitYen,52000);
batch.edit(same,"targetInsurance_generalNew","80000");attest(same);same.insuranceReviewed=true;
runFamily(same);assert.equal(same.status,"HOLD");
batch.edit(insuredRow,"trialInput","60000");runFamily(insuredRow);
assert.equal(insuredRow.comparison.trial.selfPay,9339);
assert.equal(insuredRow.insuranceReviewed,true);
// Other deductions: reviewed original-year total and G25 within G26.
function otherFixture(){
 const r=fixture(1,{year:2025,eligibleForManualTransfer:true,sourceIndicators:{hasDisability:true,hasSmallEnterpriseContributions:true},
  candidates:{salaryGross:7000000,salaryIncomeReference:5200000,socialInsurance:1000000,deductionsReference:1900000}},2026);
 for(const k of ["familySourceText","familyTargetText"])batch.edit(r,k,"なし");
 for(const k of ["otherSourceText","otherTargetText"])batch.edit(r,k,"ordinary,none,none,0,0,120000");
 attest(r);r.insuranceReviewed=true;r.otherReviewed=true;return r;
}
const otherRow=otherFixture();otherRow.otherReviewed=false;runFamily(otherRow);assert.equal(otherRow.status,"HOLD");
otherRow.otherReviewed=true;runFamily(otherRow);assert.equal(otherRow.status,"前年参考概算",otherRow.reason);
assert.equal(otherRow.appliedDeductionsYen,1940000);
assert.deepEqual(columns(otherRow).slice(33,39),["390000","120000","390000","380000","120000","880000"]);
assert.equal(batch.canOutputEstimate(otherRow),true);
for(const mutate of [
 r=>{r.otherReviewed=false;},r=>{r.otherSourceText="なし";},r=>{r.otherTargetText="なし";},r=>{r.sourceIndicators.hasMortgage=true;}
]){
 const r=otherFixture();runFamily(r);assert.equal(batch.canOutputEstimate(r),true);
 mutate(r);assert.equal(batch.canOutputEstimate(r),false);
 assert.deepEqual(columns(r).slice(33,39),["","","","","",""]);
}
for(const bad of ["ordinary,none,none,0,0,1000001","ordinary,none,none,0,0,-1","ordinary,none,none,0,0,120000,special","ordinary,none,none,1,0,120000"]){
 const r=otherFixture();batch.edit(r,"otherTargetText",bad);attest(r);r.insuranceReviewed=true;r.otherReviewed=true;
 runFamily(r);assert.equal(r.status,"HOLD");assert.equal(r.donationLimitYen,null);
}
// Direct amount: no additional blank household or premium review.
function medicalFixture(amount="300000",withOther=true){
 const r=withOther?otherFixture():fixture(1,basic2026);
 r.filing="return";batch.edit(r,"medicalNetPaidYen",amount);
 r.confirmed=true;r.noExclusions=true;
 if(withOther){attest(r);r.insuranceReviewed=true;r.otherReviewed=true;}
 return r;
}
const med=medicalFixture();runFamily(med);
assert.equal(med.status,"前年参考概算",med.reason);
assert.equal(med.appliedDeductionsYen,2140000);
assert.equal(med.familySummary.sourceTotal,1900000);
assert.equal(med.comparison.oneStop,null);
assert.equal(med.donationLimitYen,med.comparison.filing);
assert.equal(med.comparison.trial.donation,med.comparison.filing);
assert.equal(batch.canOutputEstimate(med),true);
assert.deepEqual(columns(med).slice(39,42),["200000","300000","100000"]);
assert.equal(columns(med)[17],"");
const simple=medicalFixture("188000",false);runFamily(simple);
assert.equal(simple.status,"概算",simple.reason);
assert.equal(simple.familyReviewed,false);
assert.equal(simple.appliedDeductionsYen,1758000);
assert.equal(simple.comparison.oneStop,null);
assert.equal(batch.canOutputEstimate(simple),true);
for(const change of [
 r=>{r.filing="one-stop";},r=>{r.medicalNetPaidYen="bad";},
 r=>{r.medicalNetPaidYen="-1";},r=>{r.medicalNetPaidYen="100000000001";},
 r=>{r.sourceIndicators.hasMedical=true;},
 r=>{r.originalCandidates={...r.originalCandidates,deductionsReference:2100000};}
]){
 const r=medicalFixture();runFamily(r);assert.equal(batch.canOutputEstimate(r),true);
 change(r);assert.equal(batch.canOutputEstimate(r),false);
 assert.deepEqual(columns(r).slice(39,42),["","",""]);
 runFamily(r);assert.equal(r.status,"HOLD",r.reason);assert.equal(r.donationLimitYen,null);
}
batch.edit(med,"medicalNetPaidYen","400000");assert.equal(batch.canOutputEstimate(med),false);
// Ordinary net input: statutory threshold and cap, including sub-yen 5%.
const medEngine=require("../dist/medical-deductions.js");
for(const [income,net,threshold,deduction] of [[1000000,300000,50000,250000],[1500001,300000,75000,225000],[1999999,300000,99999,200001],[2000000,300000,100000,200000],[5200000,100000,100000,0],[5200000,50000,100000,0],[5200000,2100001,100000,2000000]]){
 const res=medEngine.calculateNet({year:2026,salaryIncome:income,netEligibleYen:net});
 assert.equal(res.status,"COMPONENTS_ONLY");assert.equal(res.calculation.thresholdYen,threshold);
 assert.equal(res.calculation.nationalDeductionYen,deduction);assert.equal(res.calculation.residentDeductionYen,deduction);
}
for(const bad of [-1,1.5,100000000001,"300000",NaN])assert.equal(medEngine.calculateNet({year:2026,salaryIncome:5200000,netEligibleYen:bad}).status,"HOLD");
const lowGross=2500000,lowIncome=win.FurusatoEngine.salaryIncome(lowGross,2026);
const low=fixture(1,{year:2026,eligibleForManualTransfer:true,candidates:{salaryGross:lowGross,salaryIncomeReference:lowIncome,socialInsurance:0,deductionsReference:1040000}});
low.filing="return";batch.edit(low,"medicalNetPaidYen","300000");low.confirmed=true;low.noExclusions=true;runFamily(low);
assert.equal(low.status,"概算",low.reason);
assert.equal(low.medicalSummary.thresholdYen,Math.floor(lowIncome/20));
assert.equal(low.medicalSummary.nationalDeductionYen,300000-Math.floor(lowIncome/20));
assert.equal(low.appliedDeductionsYen,1040000+low.medicalSummary.nationalDeductionYen);
const zero=medicalFixture("50000",false);runFamily(zero);assert.equal(zero.status,"概算",zero.reason);assert.equal(zero.medicalSummary.nationalDeductionYen,0);
const cap=medicalFixture("2500000",false);runFamily(cap);assert.equal(cap.status,"概算",cap.reason);assert.equal(cap.medicalSummary.nationalDeductionYen,2000000);
// High salary: G46/G47 mandatory only for the original high salary slip.
function highFixture(gross=9000000,eligible=false){
 const adj=eligible?Math.ceil((Math.min(gross,10000000)-8500000)/10):0;
 const r=fixture(1,{year:2025,eligibleForManualTransfer:true,sourceIndicators:eligible?{hasIncomeAdjustment:true}:{},
  candidates:{salaryGross:gross,salaryIncomeReference:gross-1950000-adj,socialInsurance:1000000,deductionsReference:1580000}},2026);
 batch.edit(r,"sourceBasicYen","580000");batch.edit(r,"sourceAdjustmentYen",String(adj));
 if(eligible){batch.edit(r,"sourceAdjustmentExtras","10,0,0");batch.edit(r,"targetAdjustmentExtras","11,0,0");}
 r.confirmed=true;r.noExclusions=true;r.forecastReviewed=true;r.highReviewed=true;return r;
}
for(const [gross,eligible,adj] of [[9000000,false,0],[9000000,true,50000],[20000000,true,150000]]){
 const r=highFixture(gross,eligible);runFamily(r);assert.equal(r.status,"前年参考概算",r.reason);
 assert.equal(batch.canOutputEstimate(r),true);assert.equal(r.highSummary.targetAdjustmentYen,adj);
 assert.equal(r.highSummary.targetSalaryIncomeYen,gross-1950000-adj);
 assert.equal(r.highSummary.targetBasicYen,620000);assert.equal(r.familyReviewed,false);
 assert.deepEqual(columns(r).slice(42,47),["580000",String(adj),"620000",String(adj),String(gross-1950000-adj)]);
}
for(const mutate of [r=>{r.highReviewed=false;},r=>{r.sourceBasicYen="";},r=>{r.sourceBasicYen="620000";},
 r=>{r.sourceAdjustmentYen="0";},r=>{r.targetAdjustmentExtras="";},r=>{r.sourceIndicators.hasMortgage=true;}]){
 const r=highFixture(9000000,true);runFamily(r);assert.equal(batch.canOutputEstimate(r),true);mutate(r);
 assert.equal(batch.canOutputEstimate(r),false);assert.deepEqual(columns(r).slice(42,47),Array(5).fill(""));
 runFamily(r);assert.equal(r.status,"HOLD",r.reason);
}
const highMed=highFixture(20000000,true);batch.edit(highMed,"medicalNetPaidYen","300000");highMed.filing="return";
 highMed.confirmed=true;highMed.noExclusions=true;highMed.forecastReviewed=true;highMed.highReviewed=true;runFamily(highMed);
 assert.equal(highMed.status,"前年参考概算",highMed.reason);assert.equal(highMed.medicalSummary.nationalDeductionYen,200000);
 assert.equal(highMed.comparison.oneStop,null);
// Housing interaction components only; never publish a mortgage estimate.
const housingTax={year:2026,salaryIncome:5200000,socialInsurance:1000000,municipality:"standard",
 spouse:null,relatives:[],conditions:"salary-basic-social-family-only-reviewed"};
const housingRequest=(possibleYen,filing="return",moveInYear=2025,capClass="standard5")=>({tax:housingTax,housing:{possibleYen,moveInYear,capClass,eligibilityReviewed:true},filing});
const noOffset=familyTax.mortgageTrial(housingRequest(10000),100000);
assert.equal(noOffset.status,"COMPONENTS_ONLY");assert.equal(noOffset.donationLimitYen,null);
assert.equal(noOffset.calculation.before.nationalHousingYen,10000);
assert.equal(noOffset.calculation.before.residentHousingYen,0);
const overlap=familyTax.mortgageTrial(housingRequest(500000),100000);
assert.equal(overlap.status,"COMPONENTS_ONLY");
assert.equal(overlap.calculation.before.nationalTaxYen,0);
assert.equal(overlap.calculation.before.residentHousingYen,97500);
assert.equal(overlap.calculation.nationalSavingYen,0);
assert.ok(overlap.calculation.selfPayYen>2000);
const os=familyTax.mortgageTrial(housingRequest(500000,"one-stop"),100000);
assert.equal(os.status,"COMPONENTS_ONLY");assert.equal(os.calculation.nationalSavingYen,0);
assert.deepEqual(os.calculation.before,os.calculation.after);
assert.ok(os.calculation.selfPayYen<overlap.calculation.selfPayYen);
const pfx=familyTax.mortgagePrefix(housingRequest(500000));
assert.equal(pfx.status,"COMPONENTS_ONLY");assert.equal(pfx.donationLimitYen,null);
assert.ok(pfx.calculation.atPrefix.within2000);
const transitional=familyTax.mortgageTrial(housingRequest(500000,"return",2020,"transitional7"),2000);
assert.equal(transitional.calculation.before.localCapYen,136500);
for(const req of [housingRequest(500000,"one-stop",2026),housingRequest(500000,"return",2026,"transitional7"),
 {...housingRequest(500000),housing:{...housingRequest(500000).housing,eligibilityReviewed:false}},
 housingRequest(0),housingRequest(-1)])
 assert.equal(familyTax.mortgageTrial(req,100000).status,"HOLD");
// Continuing housing: preserve source flag, separate original credit audit, no balance input.
function mortgageFixture(possible="500000",applied="286500"){
 const r=fixture(1,{year:2025,eligibleForManualTransfer:true,sourceIndicators:{hasMortgage:true},
  candidates:{salaryGross:7000000,salaryIncomeReference:5200000,socialInsurance:1000000,deductionsReference:1630000}},2026);
 batch.edit(r,"mortgageSourceApplied",applied);batch.edit(r,"mortgageSourcePossible",possible);
 batch.edit(r,"mortgageMoveInYear","2021");batch.edit(r,"mortgageCapClass","standard5");
 r.confirmed=true;r.noExclusions=true;r.forecastReviewed=true;r.mortgageReviewed=true;return r;
}
const mr=mortgageFixture();runFamily(mr);
assert.equal(mr.status,"前年参考概算",mr.reason);assert.equal(batch.canOutputEstimate(mr),true);
assert.equal(mr.sourceIndicators.hasMortgage,true);
assert.equal(mr.familySummary.sourceTotal,1630000);
assert.equal(mr.mortgageSummary.sourceAppliedYen,286500);
assert.equal(mr.mortgageSummary.possibleYen,500000);
assert.equal(mr.mortgageSummary.nationalHousingYen,278500);
assert.equal(mr.mortgageSummary.residentHousingYen,97500);
assert.equal(mr.familyReviewed,false);
assert.match(mr.reason,/残高の変動は考慮していません/);
assert.deepEqual(columns(mr).slice(47),["286500","500000","278500","97500"]);
assert.equal(mr.donationLimitYen,mr.comparison.oneStop);
assert.ok(mr.comparison.filing<mr.comparison.oneStop);
const blank=mortgageFixture("","10000");runFamily(blank);assert.equal(blank.status,"前年参考概算",blank.reason);
assert.equal(blank.mortgageSummary.possibleYen,10000);
for(const mutate of [r=>{r.mortgageReviewed=false;},r=>{r.mortgageSourceApplied="286499";},
 r=>{r.mortgageSourcePossible="286500";},r=>{r.mortgageSourcePossible="";r.mortgageSourceApplied="400000";},
 r=>{r.mortgageMoveInYear="2025";},r=>{r.mortgageCapClass="";},r=>{r.sourceIndicators.hasOtherIncome=true;}]){
 const r=mortgageFixture();runFamily(r);assert.equal(batch.canOutputEstimate(r),true);mutate(r);
 assert.equal(batch.canOutputEstimate(r),false);assert.deepEqual(columns(r).slice(47),Array(4).fill(""));
 runFamily(r);assert.equal(r.status,"HOLD",r.reason);assert.equal(r.donationLimitYen,null);
}
const mortgageMed=mortgageFixture();batch.edit(mortgageMed,"medicalNetPaidYen","300000");mortgageMed.filing="return";
 mortgageMed.confirmed=true;mortgageMed.noExclusions=true;mortgageMed.forecastReviewed=true;mortgageMed.mortgageReviewed=true;
 runFamily(mortgageMed);assert.equal(mortgageMed.status,"前年参考概算",mortgageMed.reason);
 assert.equal(mortgageMed.comparison.oneStop,null);assert.equal(mortgageMed.medicalSummary.nationalDeductionYen,200000);
// Review-only G-code numeric prefills. No confirmation is inherited.
const autoHigh=fixture(1,{year:2025,eligibleForManualTransfer:true,sourceIndicators:{hasMortgage:true,hasIncomeAdjustment:true},
 candidates:{salaryGross:9000000,salaryIncomeReference:7000000,socialInsurance:1000000,deductionsReference:1580000},
 optionalCandidates:{sourceBasicYen:580000,sourceAdjustmentYen:50000,mortgageSourceApplied:50000}},2026);
assert.equal(autoHigh.sourceBasicYen,"580000");assert.equal(autoHigh.sourceAdjustmentYen,"50000");
assert.equal(autoHigh.mortgageSourceApplied,"50000");assert.equal(autoHigh.mortgageSourcePossible,"");
assert.equal(autoHigh.confirmed,false);assert.equal(autoHigh.highReviewed,false);assert.equal(autoHigh.mortgageReviewed,false);
runFamily(autoHigh);assert.equal(autoHigh.status,"HOLD");assert.equal(autoHigh.donationLimitYen,null);
const optionalLow=fixture(1,{...basic2026,optionalCandidates:{sourceBasicYen:670000,sourceAdjustmentYen:0,mortgageSourceApplied:200000}});
assert.equal(optionalLow.sourceBasicYen,"");assert.equal(optionalLow.sourceAdjustmentYen,"");assert.equal(optionalLow.mortgageSourceApplied,"");
const malformedOptional=fixture(1,{year:2025,eligibleForManualTransfer:true,sourceIndicators:{hasMortgage:true},
 candidates:{salaryGross:9000000,salaryIncomeReference:7050000,socialInsurance:1000000,deductionsReference:1580000},
 optionalCandidates:{sourceBasicYen:"580000",sourceAdjustmentYen:-1,mortgageSourceApplied:600001}},2026);
assert.equal(malformedOptional.sourceBasicYen,"");assert.equal(malformedOptional.sourceAdjustmentYen,"");assert.equal(malformedOptional.mortgageSourceApplied,"");
// One explicit copy of seven premium categories, no consent or result copied.
const copyRow=fixture(1,basic2026);
batch.edit(copyRow,"sourceInsurance_generalNew","120000");
batch.edit(copyRow,"sourceInsurance_earthquake","50000");
batch.edit(copyRow,"targetInsurance_generalOld","12345");
copyRow.confirmed=true;copyRow.noExclusions=true;copyRow.insuranceReviewed=true;
assert.equal(batch.copySourcePremiums(copyRow),true);
assert.equal(copyRow.targetInsurance_generalNew,"120000");
assert.equal(copyRow.targetInsurance_earthquake,"50000");
assert.equal(copyRow.targetInsurance_generalOld,"");
assert.equal(copyRow.confirmed,false);assert.equal(copyRow.insuranceReviewed,false);
assert.equal(copyRow.noExclusions,false);assert.equal(copyRow.donationLimitYen,null);
batch.edit(copyRow,"sourceInsurance_generalNew","bad");
assert.equal(batch.copySourcePremiums(copyRow),false);
assert.equal(copyRow.targetInsurance_generalNew,"120000");
const emptyCopy=fixture(1,basic2026);assert.equal(batch.copySourcePremiums(emptyCopy),false);
// Grouped basic confirmation is per recipient, explicit, and not a detail attestation.
const grouped=fixture(1,basic2026);
assert.equal(batch.confirmBasic(grouped),true);
assert.equal(grouped.confirmed,true);assert.equal(grouped.noExclusions,true);assert.equal(grouped.forecastReviewed,false);
assert.equal(grouped.familyReviewed,false);assert.equal(grouped.insuranceReviewed,false);assert.equal(grouped.mortgageReviewed,false);
assert.equal(grouped.donationLimitYen,null);
const priorGrouped=fixture(1,{...basic2026,year:2025},2026);
assert.equal(batch.confirmBasic(priorGrouped),true);assert.equal(priorGrouped.forecastReviewed,true);
batch.edit(priorGrouped,"socialInsurance","1100000");assert.equal(priorGrouped.confirmed,false);assert.equal(priorGrouped.forecastReviewed,false);
const badGrouped=fixture(1,basic2026);badGrouped.sourceIndicators.hasOtherIncome=true;
assert.equal(batch.confirmBasic(badGrouped),false);assert.equal(badGrouped.confirmed,false);
const unselected=fixture(1,basic2026);unselected.municipality="";assert.equal(batch.confirmBasic(unselected),false);
// R7 prefill is source-year only and never approves a result.
const premiumPrefill=fixture(1,{year:2025,eligibleForManualTransfer:true,sourceIndicators:{hasLifeInsurance:true,hasEarthquakeInsurance:true,hasMortgage:true},candidates:{salaryGross:7000000,salaryIncomeReference:5200000,socialInsurance:1000000,deductionsReference:1630000},optionalCandidates:{sourceInsurance_generalNew:123456,sourceInsurance_longTermOld:12345,mortgageSourcePossible:345678,mortgageMoveInYear:2021}},2026);
assert.equal(premiumPrefill.mortgageMoveInYear,"2021");assert.equal(premiumPrefill.mortgageCapClass,"");
assert.equal(premiumPrefill.sourceInsurance_generalNew,"123456");
assert.equal(premiumPrefill.sourceInsurance_longTermOld,"12345");
assert.equal(premiumPrefill.mortgageSourcePossible,"345678");
assert.equal(premiumPrefill.targetInsurance_generalNew,"");
assert.equal(premiumPrefill.sourceInsurance_earthquake,"");
assert.equal(premiumPrefill.insuranceReviewed,false);assert.equal(premiumPrefill.mortgageReviewed,false);
runFamily(premiumPrefill);assert.equal(premiumPrefill.status,"HOLD");assert.equal(premiumPrefill.donationLimitYen,null);
// Counts are review hints only, not manufactured household inputs.
const countRow=fixture(1,{year:2025,eligibleForManualTransfer:true,sourceIndicators:{hasDependents:true},candidates:{salaryGross:7000000,salaryIncomeReference:5200000,socialInsurance:1000000,deductionsReference:1630000},optionalCandidates:{familySpecificCount:2,familyUnder16Count:1,familyOtherCount:99}},2026);
assert.deepEqual(countRow.familyCountHints,{familySpecificCount:2,familyUnder16Count:1});
assert.equal(countRow.familySourceText,"");assert.equal(countRow.familyTargetText,"");assert.equal(countRow.familyReviewed,false);
runFamily(countRow);assert.equal(countRow.status,"HOLD");assert.equal(countRow.donationLimitYen,null);
// A missing under-16 child can leave income-tax deduction totals unchanged.
function countFixture(hints={familySpecificCount:1,familyUnder16Count:1}){
 const row=fixture(1,{year:2025,eligibleForManualTransfer:true,sourceIndicators:{hasDependents:true},candidates:{salaryGross:7000000,salaryIncomeReference:5200000,socialInsurance:1000000,deductionsReference:2260000},optionalCandidates:hints},2026);
 batch.edit(row,"familySourceText","R,20,0,0\nR,10,0,0");batch.edit(row,"familyTargetText","R,21,0,0\nR,11,0,0");
 Object.assign(row,{confirmed:true,noExclusions:true,forecastReviewed:true,familyReviewed:true});return row;
}
const matchCounts=countFixture();runFamily(matchCounts);
assert.equal(matchCounts.status,"前年参考概算",matchCounts.reason);
assert.equal(batch.canOutputEstimate(matchCounts),true);
const originalHints=matchCounts.familyCountHints;
matchCounts.familyCountHints={familySpecificCount:1,familyUnder16Count:2};
assert.equal(batch.canOutputEstimate(matchCounts),false);
runFamily(matchCounts);assert.equal(matchCounts.status,"HOLD");assert.equal(matchCounts.donationLimitYen,null);
matchCounts.familyCountHints=originalHints;
for(const text of ["R,20,0,0","R,20,0,0\nR,10,0,0\nR,8,0,0","R,20,0,0\nR,10,580001,0"]){
 const row=countFixture();batch.edit(row,"familySourceText",text);
 Object.assign(row,{confirmed:true,noExclusions:true,forecastReviewed:true,familyReviewed:true});
 runFamily(row);assert.equal(row.status,"HOLD",row.reason);assert.match(row.reason,/16歳未満/);
 assert.equal(row.donationLimitYen,null);assert.equal(batch.canOutputEstimate(row),false);
}
// A change in the forecast household is permitted; only the original year is compared.
const forecastCounts=countFixture();batch.edit(forecastCounts,"familyTargetText","R,21,0,0");
Object.assign(forecastCounts,{confirmed:true,noExclusions:true,forecastReviewed:true,familyReviewed:true});
runFamily(forecastCounts);assert.equal(forecastCounts.status,"前年参考概算",forecastCounts.reason);
// R8: verified G72 count must reconcile, never infer family details.
const specialR8={year:2026,eligibleForManualTransfer:true,r8VerifiedLayout:true,sourceIndicators:{hasDependents:true},candidates:{salaryGross:7000000,salaryIncomeReference:5200000,socialInsurance:1000000,deductionsReference:2300000},optionalCandidates:{familySpecialRelativeCount:1}};
function specialR8Row(){
 const row=fixture(1,specialR8,2026);
 batch.edit(row,"familySourceText","R,20,800000,0");batch.edit(row,"familyTargetText","R,20,800000,0");
 Object.assign(row,{confirmed:true,noExclusions:true,familyReviewed:true});return row;
}
const specialMatch=specialR8Row();runFamily(specialMatch);
assert.equal(specialMatch.status,"概算",specialMatch.reason);
assert.equal(batch.canOutputEstimate(specialMatch),true);
for(const hints of [{familySpecialRelativeCount:2},{familySpecialRelativeCount:1,familyOtherCount:1},{familySpecialRelativeCount:0},{familySpecialRelativeCount:"1"}]){
 const row=specialR8Row();row.familyCountHints=hints;runFamily(row);
 assert.equal(row.status,"HOLD",row.reason);assert.equal(row.donationLimitYen,null);assert.equal(batch.canOutputEstimate(row),false);
}
specialMatch.familyCountHints={familySpecialRelativeCount:2};
assert.equal(batch.canOutputEstimate(specialMatch),false);
// Ordinary family forecast copy: source stays intact, ages advance and consent is revoked.
const familyCopy=fixture(1,{...basic2026,year:2025},2026);
batch.edit(familyCopy,"familySourceText","S,40,600000\nR,15,0,0\nR,70,0,1");
batch.edit(familyCopy,"familyTargetText","なし");
familyCopy.confirmed=true;familyCopy.familyReviewed=true;familyCopy.forecastReviewed=true;
assert.equal(batch.copySourceFamily(familyCopy),true);
assert.equal(familyCopy.familySourceText,"S,40,600000\nR,15,0,0\nR,70,0,1");
assert.equal(familyCopy.familyTargetText,"S,41,600000\nR,16,0,0\nR,71,0,1");
assert.equal(familyCopy.familyReviewed,false);assert.equal(familyCopy.confirmed,false);assert.equal(familyCopy.forecastReviewed,false);
assert.equal(familyCopy.donationLimitYen,null);
batch.edit(familyCopy,"familySourceText","R,130,0,0");
assert.equal(batch.copySourceFamily(familyCopy),false);
assert.equal(familyCopy.familyTargetText,"S,41,600000\nR,16,0,0\nR,71,0,1");
batch.edit(familyCopy,"familySourceText","なし");batch.edit(familyCopy,"otherTargetText","ordinary,none,none,0,0,0");
assert.equal(batch.copySourceFamily(familyCopy),false);
batch.edit(familyCopy,"otherTargetText","");assert.equal(batch.copySourceFamily(familyCopy),true);
assert.equal(familyCopy.familyTargetText,"なし");
// Spouse income is independent evidence, never a fabricated age.
const spouseHintRow=fixture(1,{year:2025,eligibleForManualTransfer:true,sourceIndicators:{hasSpouse:true},candidates:{salaryGross:7000000,salaryIncomeReference:5200000,socialInsurance:1000000,deductionsReference:2010000},optionalCandidates:{sourceSpouseIncome:720000}},2026);
assert.equal(spouseHintRow.spouseIncomeHint,720000);assert.equal(spouseHintRow.familySourceText,"");
assert.equal(spouseHintRow.familyReviewed,false);
batch.edit(spouseHintRow,"familySourceText","S,40,730000");batch.edit(spouseHintRow,"familyTargetText","S,41,730000");
Object.assign(spouseHintRow,{confirmed:true,noExclusions:true,forecastReviewed:true,familyReviewed:true});
runFamily(spouseHintRow);assert.equal(spouseHintRow.status,"HOLD");assert.equal(spouseHintRow.donationLimitYen,null);
assert.match(spouseHintRow.reason,/G43/);
batch.edit(spouseHintRow,"familySourceText","S,40,720000");
Object.assign(spouseHintRow,{confirmed:true,noExclusions:true,forecastReviewed:true,familyReviewed:true});
runFamily(spouseHintRow);assert.notEqual(spouseHintRow.donationLimitYen,null);
// Manual blank G26 attestation fills the original snapshot, not just forecast.
const zeroReview={schema:"furusato-positioned-gcodes/v1",year:2025,eligibleForManualTransfer:false,reasons:["CODE_G26_AMOUNT_UNVERIFIED"],candidates:{salaryGross:7000000,salaryIncomeReference:5200000,deductionsReference:630000}};
const zeroRow=fixture(1,zeroReview,2026);
assert.equal(batch.canConfirmSocialZero(zeroRow),true);
assert.equal(zeroRow.originalCandidates.socialInsurance,undefined);
assert.equal(batch.confirmSocialZero(zeroRow),true);
assert.equal(zeroRow.originalCandidates.socialInsurance,0);assert.equal(zeroRow.candidates.socialInsurance,0);
assert.equal(zeroRow.socialZeroManuallyConfirmed,true);assert.equal(zeroRow.confirmed,false);assert.equal(zeroRow.forecastReviewed,false);
assert.equal(zeroRow.sourceValid,true);assert.equal(zeroRow.donationLimitYen,null);
assert.equal(batch.confirmSocialZero(zeroRow),false);
const altered=fixture(1,zeroReview,2026);batch.edit(altered,"salaryGross","7000001");assert.equal(batch.confirmSocialZero(altered),false);
const ambiguous=fixture(1,{...zeroReview,reasons:["CODE_G26_AMBIGUOUS"]},2026);assert.equal(batch.confirmSocialZero(ambiguous),false);
const gridBlank={...zeroReview,schema:"furusato-slip-grid-review/v1",reasons:["GRID_SOCIAL_AMOUNT_UNVERIFIED"]};
const gridRow=fixture(1,gridBlank,2026);
assert.equal(batch.canEstimate(gridRow),false);
assert.equal(batch.canOutputEstimate(gridRow),false);
assert.equal(batch.confirmSocialZero(gridRow),true);
assert.equal(gridRow.originalCandidates.socialInsurance,0);
assert.equal(gridRow.confirmed,false);
assert.equal(gridRow.donationLimitYen,null);
assert.equal(batch.canOutputEstimate(gridRow),false);
for(const review of [{...gridBlank,reasons:["GRID_AMOUNT_DISAGREEMENT"]},{...gridBlank,reasons:[...gridBlank.reasons,"GRID_FULL_PAGE_CONFLICT"]},{...gridBlank,candidates:{...gridBlank.candidates,socialInsurance:123}}]){
 assert.equal(batch.confirmSocialZero(fixture(1,review,2026)),false);
}
// Verify that zero is not itself a calculation hold: actual shared engine,
 // actual Web display guard, same-year and prior-year forecast, synthetic only.
for(const targetYear of [2025,2026]){
 const row=fixture(1,gridBlank,targetYear);
 const calculate=()=>batch.calculate(row,win.FurusatoEngine,guard,selected,win.FurusatoResidentLevy);
 calculate();assert.equal(row.status,"HOLD");assert.equal(row.donationLimitYen,null);
 assert.equal(batch.canOutputEstimate(row),false);
 assert.equal(batch.confirmSocialZero(row),true);
 calculate();assert.equal(row.status,"HOLD");assert.equal(batch.canOutputEstimate(row),false);
 assert.equal(batch.confirmBasic(row),true);
 calculate();
 assert.equal(row.status,targetYear===2025?"概算":"前年参考概算");
 assert.equal(row.donationLimitYen,138000);assert.equal(batch.canOutputEstimate(row),true);
 const explicit=fixture(2,{...gridBlank,eligibleForManualTransfer:true,reasons:[],candidates:{...gridBlank.candidates,socialInsurance:0}},targetYear);
 assert.equal(batch.confirmBasic(explicit),true);
 batch.calculate(explicit,win.FurusatoEngine,guard,selected,win.FurusatoResidentLevy);
 assert.equal(explicit.donationLimitYen,row.donationLimitYen);
 assert.equal(batch.canOutputEstimate(explicit),true);
}
const actual=fixture(1,basic2026);assert.equal(batch.confirmSocialZero(actual),false);
const optionalBlank={...zeroReview,sourceIndicators:{hasLifeInsurance:true,hasSpouse:true,hasDependents:true},optionalCandidates:{sourceInsurance_generalNew:123456,sourceSpouseIncome:654321,familyUnder16Count:2}};
const optionalBlankRow=fixture(1,optionalBlank,2026);
assert.equal(optionalBlankRow.sourceInsurance_generalNew,"123456");
assert.equal(optionalBlankRow.spouseIncomeHint,654321);
assert.equal(optionalBlankRow.familyCountHints.familyUnder16Count,2);
assert.equal(optionalBlankRow.sourceValid,false);
assert.equal(batch.canEstimate(optionalBlankRow),false);
assert.equal(batch.canOutputEstimate(optionalBlankRow),false);
assert.equal(batch.confirmSocialZero(optionalBlankRow),true);
assert.equal(optionalBlankRow.sourceInsurance_generalNew,"123456");
assert.equal(optionalBlankRow.insuranceReviewed,false);
assert.equal(optionalBlankRow.familyReviewed,false);
assert.equal(batch.canOutputEstimate(optionalBlankRow),false);
const conflictingBlank=fixture(1,{...optionalBlank,reasons:["CODE_G26_AMOUNT_CONFLICT"]},2026);
assert.equal(conflictingBlank.sourceInsurance_generalNew,"");
assert.equal(conflictingBlank.spouseIncomeHint,undefined);
assert.equal(batch.confirmSocialZero(conflictingBlank),false);
// R8 fields are review hints only and require verified layout provenance.
const r8Fixture={...basic2026,r8VerifiedLayout:true,sourceIndicators:{hasLifeInsurance:true,hasMortgage:true,hasDependents:true},optionalCandidates:{sourceInsurance_generalNew:12345,sourceInsurance_pensionNew:56789,mortgageSourcePossible:234567,mortgageMoveInYear:2023,familySpecialRelativeCount:2,familyOtherCount:1}};
const r8Row=fixture(1,r8Fixture,2026);
assert.equal(r8Row.sourceInsurance_generalNew,"12345");
assert.equal(r8Row.sourceInsurance_pensionNew,"");
assert.equal(r8Row.mortgageSourcePossible,"234567");
assert.equal(r8Row.mortgageMoveInYear,"2023");
assert.deepEqual(r8Row.familyCountHints,{familySpecialRelativeCount:2});
assert.equal(batch.canOutputEstimate(r8Row),false);
const unverifiedR8=fixture(1,{...r8Fixture,r8VerifiedLayout:false},2026);
assert.equal(unverifiedR8.sourceInsurance_generalNew,"");
assert.equal(unverifiedR8.mortgageSourcePossible,"");
assert.equal(batch.canOutputEstimate(unverifiedR8),false);
// Fictional low-income cases. No amount is published even after classification.
for(const target of [2025,2026]){
 const gross=900000, income=win.FurusatoEngine.salaryIncome(gross,target);
 const review={year:2025,eligibleForManualTransfer:true,candidates:{salaryGross:gross,salaryIncomeReference:250000,deductionsReference:950000,socialInsurance:0}};
 const row=fixture(1,review,target);
 if(target===2026)batch.edit(row,"salaryIncomeReference",String(income));
 runFamily(row);assert.equal(row.status,"HOLD");
 assert.equal(batch.confirmBasic(row),true);
 runFamily(row);assert.equal(row.status,"控除余地なし");
 assert.equal(batch.canOutputNoTax(row),true);assert.equal(batch.canOutputEstimate(row),false);
 assert.equal(columns(row)[11],"");assert.equal(columns(row)[12],"控除余地なし");
 row.confirmed=false;assert.equal(batch.canOutputNoTax(row),false);assert.equal(columns(row)[12],"HOLD");
 const insured=fixture(2,{...review,candidates:{...review.candidates,deductionsReference:972500},sourceIndicators:{hasLifeInsurance:true}},target);
 if(target===2026)batch.edit(insured,"salaryIncomeReference",String(income));
 batch.edit(insured,"familySourceText","なし");batch.edit(insured,"familyTargetText","なし");
 batch.edit(insured,"sourceInsurance_generalNew","25000");batch.edit(insured,"targetInsurance_generalNew","25000");
 Object.assign(insured,{confirmed:true,noExclusions:true,forecastReviewed:target===2026,familyReviewed:true,insuranceReviewed:true});
 runFamily(insured);assert.equal(insured.status,"控除余地なし");
 assert.equal(batch.canOutputNoTax(insured),true);assert.equal(columns(insured)[11],"");
 batch.edit(insured,"sourceInsurance_generalNew","24000");
 Object.assign(insured,{confirmed:true,noExclusions:true,forecastReviewed:target===2026,familyReviewed:true,insuranceReviewed:true});
 runFamily(insured);assert.equal(insured.status,"HOLD");
}
dom.window.close();
console.log("PUBLIC_BATCH_PER_PAGE_LOCAL_SAFETY_SYNTHETIC_PASS; no private slips; no deploy");
