"use strict";
const assert=require("node:assert/strict");
const {summarize,wilsonLower}=require("../scripts/ocr-accuracy-metrics.cjs");
const truth={year:2026,salaryGross:7000000,
 salaryIncomeReference:5200000,deductionsReference:1670000,socialInsurance:1000000};
const correct={eligibleForManualTransfer:true,year:2026,
 candidates:{salaryGross:7000000,salaryIncomeReference:5200000,
 deductionsReference:1670000,socialInsurance:1000000}};
const wrong={eligibleForManualTransfer:true,year:2026,
 candidates:{...correct.candidates,salaryGross:7100000}};
const hold={eligibleForManualTransfer:false,year:null,candidates:{}};
const rows=[
 {kind:"digital_pdf",truth,review:correct},
 {kind:"mfp_scan",truth,review:wrong},
 {kind:"mobile_photo",truth,review:hold},
 {kind:"other",truth,review:hold}
];
const out=summarize(rows);
assert.equal(out.qualityScope,"INCOME_YEAR_AND_FOUR_AMOUNTS_ONLY");
assert.deepEqual(out.evaluatedMonetaryFields,[
 "salaryGross","salaryIncomeReference","deductionsReference","socialInsurance"
]);
const scoped=summarize([{kind:"digital_pdf",truth:{
 ...truth,personalName:"SYNTHETIC_EXPECTED_NAME",
 employer:"SYNTHETIC_EXPECTED_EMPLOYER",address:"SYNTHETIC_ADDRESS"},
 review:{...correct,candidates:{...correct.candidates,
  personalName:"SYNTHETIC_WRONG_NAME",
  employer:"SYNTHETIC_WRONG_EMPLOYER",address:"SYNTHETIC_WRONG_ADDRESS"}}}]);
const only=summarize([{kind:"digital_pdf",truth,review:correct}]);
assert.deepEqual(scoped,only);
assert.equal(scoped.overall.fields,4);
assert.equal(scoped.overall.exactDocuments,1);
assert.doesNotMatch(JSON.stringify(scoped),/SYNTHETIC_(EXPECTED|WRONG|ADDRESS)/);

assert.equal(out.status,"MEASURED_NOT_CERTIFIED");
assert.equal(out.release,"HOLD");
assert.equal(out.overall.documents,4);
assert.equal(out.overall.fields,16);
assert.equal(out.overall.exactFields,7);
assert.equal(out.overall.exactDocuments,1);
assert.equal(out.overall.eligible,2);
assert.equal(out.overall.held,2);
assert.equal(out.overall.incorrectEligible,1);
assert.equal(out.overall.wrongFieldCandidates,1);
assert.equal(out.byKind.digital_pdf.exactDocumentRate,1);
assert.equal(out.byKind.mfp_scan.incorrectEligible,1);
assert.ok(out.overall.exactDocumentLower95<out.overall.exactDocumentRate);
assert.ok(wilsonLower(0,1)===0);
assert.ok(wilsonLower(100,100)<1);
assert.ok(wilsonLower(990,1000)<990/1000);
assert.throws(()=>summarize([]),/INVALID_PRIVATE_BENCHMARK_INPUT/);
assert.throws(()=>summarize([{}]),/UNVERIFIED_BENCHMARK_RECORD/);
assert.throws(()=>summarize([{kind:"mobile_photo",truth,review:{
 eligibleForManualTransfer:true,candidates:null}}]),/UNVERIFIED_OCR_REVIEW_RESULT/);
const json=JSON.stringify(out);
for(const privateAmount of ["7000000","7100000","5200000","1670000"]){
 assert.equal(json.includes(privateAmount),false,"aggregate must not print raw amounts");
}
assert.equal(Object.keys(out.byKind).length,4);
console.log("PUBLIC_OCR_AGGREGATE_ACCURACY_METRICS_SYNTHETIC_PASS; release HOLD");
