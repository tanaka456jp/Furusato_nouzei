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
// Page-wide confidence must NOT rate irrelevant identity/address OCR.
const unrelatedA=[
 "（架空の氏名欄）〇〇　〇〇", "住所欄　架空住所　丁目番号",
 "支払者名称欄　架空事業所", "個人番号欄　読取対象外"
].join("\n");
const unrelatedB=[
 "（架空の氏名欄）XX　XX", "住所欄　認識失敗",
 "支払者名称欄　文字化け", "個人番号欄　判定対象外"
].join("\n");
const scoped=review.compareAttempts(sample+"\n"+unrelatedA,
 sample+"\n"+unrelatedB,5,0);
assert.equal(scoped.eligibleForManualTransfer,true);
assert.equal(scoped.qualityScope,"INCOME_YEAR_AND_FOUR_AMOUNTS_ONLY");
assert.equal(scoped.autoApproved,false);
assert.equal(scoped.originalCompared,false);
assert.deepEqual(scoped.candidates,a.candidates);
assert.equal(scoped.reasons.length,0);
// Irrelevant changes never excuse a mismatch in income year or money.
const material=review.compareAttempts(sample+"\n"+unrelatedA,
 sample.replace("7,000,000円","7,100,000円")+"\n"+unrelatedB,99,99);
assert.equal(material.eligibleForManualTransfer,false);
assert.deepEqual(material.candidates,{});
assert.ok(material.reasons.includes("FIELD_DISAGREEMENT_salaryGross"));
// Even missing/invalid whole-page confidence is not evidence that the
// four required fields are wrong. Confirmation is still always manual.
for(const bad of [[null,99],[99,null],[74.9,90],[90,10],[NaN,100]]){
 const result=review.compareAttempts(sample,sample,bad[0],bad[1]);
 assert.equal(result.eligibleForManualTransfer,true,JSON.stringify(bad));
 assert.equal(result.autoApproved,false);
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
