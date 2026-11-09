"use strict";
/** Synthetic-only, no original documents or individual identifiers. */
const assert=require("node:assert/strict");
const review=require("../src/ocr-review.js");
const sample=[
 "令和8年分　給与所得の源泉徴収票",
 "支払金額 7,000,000円",
 "給与所得控除後の金額 5,200,000円",
 "所得控除の額の合計額 1,670,000円",
 "社会保険料等の金額 1,000,000円"
].join("\n");
const a=review.reviewText(sample);
assert.equal(a.status,"REQUIRES_SOURCE_REVIEW");
assert.equal(a.year,2026);
assert.equal(a.fullyExtracted,true);
assert.deepEqual(a.candidates,{
 salaryGross:7000000,salaryIncomeReference:5200000,
 deductionsReference:1670000,socialInsurance:1000000
});
assert.equal(a.autoApproved,false);
assert.equal(a.sourceTextPersisted,false);
const digital=review.reviewDigitalPdf(sample);
assert.equal(digital.eligibleForManualTransfer,true);
assert.equal(digital.originalCompared,false);
assert.equal(digital.autoApproved,false);
const mixedExplicitYears=review.reviewDigitalPdf(sample+"\n令和7年分");
assert.equal(mixedExplicitYears.yearConflict,true);
assert.equal(mixedExplicitYears.eligibleForManualTransfer,false);
assert.deepEqual(mixedExplicitYears.candidates,{});
assert.equal(review.reviewDigitalPdf(sample).yearConflict,false);
// Distinguish malformed/missing separated text from a genuinely competing
// second tax year: the former can be reviewed by PDF coordinate extraction.
const splitYear=review.reviewDigitalPdf("給与所得の源泉徴収票\\n令和 8 年 分");
assert.equal(splitYear.yearConflict,false);
const pair=review.compareAttempts(sample,sample,96,89);
assert.equal(pair.eligibleForManualTransfer,true);
assert.equal(pair.status,"REQUIRES_SOURCE_REVIEW");
assert.equal(pair.year,2026);
assert.equal(pair.autoApproved,false);
const invalid=[
 sample.replace("支払金額 7,000,000円","支払金額 7,200,000円"),
 sample.replace("社会保険料等の金額 1,000,000円","社会保険料等の金額 1,100,000円"),
 sample.replace("令和8年分","令和7年分"),
 sample.replace("給与所得の源泉徴収票","年末調整資料"),
 sample.replace("所得控除の額の合計額 1,670,000円",""),
 sample.replace("支払金額 7,000,000円","支払金額 7,0O0,000円"),
 sample+" \n支払金額 8,000,000円",
 sample+"\n支払金額 7,000,000円",
 sample+"\n令和7年分",
 sample.replace("支払金額 7,000,000円","支払金額 7000万円"),
 sample.replace("支払金額 7,000,000円","支払金額 7000000.00円")
];
for(const mutated of invalid){
 const result=review.compareAttempts(sample,mutated,98,98);
 assert.equal(result.eligibleForManualTransfer,false,mutated.slice(-100));
 assert.deepEqual(result.candidates,{},mutated.slice(-100));
 assert.equal(result.status,"REQUIRES_SOURCE_REVIEW");
}
for(const bad of [[null,99],[99,null],[74.9,90],[90,10],[NaN,100]]){
 const result=review.compareAttempts(sample,sample,bad[0],bad[1]);
 assert.equal(result.eligibleForManualTransfer,false,JSON.stringify(bad));
 assert.ok(result.reasons.includes("OCR_CONFIDENCE_NOT_ENOUGH"));
}
for(const amount of ["123abc","１,０００,０１","-100","1e4","10.5","1,2,345","","¥100","1000万円"]){
 assert.equal(review.parseYen(amount),null,amount);
}
assert.equal(review.parseYen("7,000,000円"),7000000);
assert.equal(review.parseYen("0"),0);
const missing=review.reviewDigitalPdf("支払金額 7,000,000円\n"+
 "給与所得控除後の金額 5,200,000円");
assert.equal(missing.eligibleForManualTransfer,false);
assert.deepEqual(missing.candidates,{});
assert.equal(review.compareAttempts(sample,sample,100,100).originalCompared,false);
console.log("PUBLIC_OCR_SLIP_CONSENSUS_SYNTHETIC_PASS; no real recognition proof; HOLD");
