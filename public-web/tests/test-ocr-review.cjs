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
// Unsupported printed tax years must not be ignored when another
// supported year happens to occur in the recognition output.
for(const year of ["令和6年分","令和9年分","令和10年分","2024年分","2027年分","平成30年分","令和元年分","令和 6 年 分"]){
 const single=sample.replace("令和8年分",year);
 const unsupported=review.reviewDigitalPdf(single);
 assert.equal(unsupported.yearUnsupported,true);
 assert.equal(unsupported.yearConflict,false);
 assert.equal(unsupported.year,null);
 assert.equal(unsupported.eligibleForManualTransfer,false);
 assert.deepEqual(unsupported.candidates,{});
 const mixed=sample+"\n"+year;
 const d=review.reviewDigitalPdf(mixed);
 assert.equal(d.yearConflict,true);
 assert.equal(d.yearUnsupported,true);
 assert.equal(d.eligibleForManualTransfer,false);
 assert.deepEqual(d.candidates,{});
 assert.equal(review.compareAttempts(mixed,mixed).eligibleForManualTransfer,false);
}
assert.equal(review.reviewDigitalPdf(sample+"\n2026年分").eligibleForManualTransfer,true);
// A visible ruled year may only veto, never independently promote.
for(const raw of ["令和|6|年分","令和｜６｜年分","令和 | 9 | 年 分","平成|30|年分"]){
 const d=review.reviewDigitalPdf(sample+"\n"+raw);
 assert.equal(d.yearUnsupported,true);
 assert.equal(d.yearConflict,true);
 assert.equal(d.eligibleForManualTransfer,false);
 assert.deepEqual(d.candidates,{});
 assert.equal(review.compareAttempts(sample+"\n"+raw,sample+"\n"+raw).eligibleForManualTransfer,false);
}
for(const raw of ["令和|7|年分","令和｜７｜年分","令和 7 | 年 | 分"]){
 const d=review.reviewDigitalPdf(sample+"\n"+raw);
 assert.equal(d.yearConflict,true);
 assert.equal(d.eligibleForManualTransfer,false);
}
const ruledOnly=sample.replace("令和8年分","令和|8|年分");
assert.equal(review.reviewText(ruledOnly,true).observedYear,2026);
assert.equal(review.reviewDigitalPdf(ruledOnly).eligibleForManualTransfer,false);
assert.equal(review.reviewDigitalPdf(sample+"\n令和|8|年分").eligibleForManualTransfer,true);
for(const raw of ["退職所得の源泉徴収票","公的年金等の源泉徴収票","退 職 所 得 の 源 泉 徴 収 票"]){
 const d=review.reviewDigitalPdf(sample+"\n"+raw);
 assert.equal(d.documentTypeConflict,true);
 assert.equal(d.eligibleForManualTransfer,false);
 assert.equal(d.year,null);
 assert.deepEqual(d.candidates,{});
 assert.equal(review.compareAttempts(sample+"\n"+raw,sample+"\n"+raw).eligibleForManualTransfer,false);
}
console.log("PUBLIC_OCR_SLIP_CONSENSUS_SYNTHETIC_PASS; no real recognition proof; HOLD");

const spaced=["令 和 8 年 分","給与 所 得 の 源泉 徴収 票","支払 金額 7000000","給与 所 得 控除 後 の 金額 5200000","所 得 控除 の 額 の 合計 額 1670000","社会 保険 料 等 の 金額 1000000"].join("\n");
const matched=review.compareAttempts(spaced,spaced);
assert.equal(matched.eligibleForManualTransfer,true);
assert.deepEqual(matched.candidates,a.candidates);
assert.equal(matched.year,2026);assert.equal(matched.autoApproved,false);
for(const mutated of [
 spaced.replace("7000000","7.000.000"),spaced.replace("7000000","7 000000"),
 spaced.replace("7000000","7,000 000"),spaced.replace("7000000","7,0O0,000"),
 spaced.replace("支払 金額","支 払 金 頻"),spaced.replace("令 和 8 年 分","令 和 8 0 年 分"),
 spaced+"\n令 和 7 年 分",spaced+"\n支 払 金 額 7000000",spaced+"\n退 職 所 得 の 源 泉 徴 収 票"
]){
 const out=review.compareAttempts(mutated,mutated);
 assert.equal(out.eligibleForManualTransfer,false);assert.deepEqual(out.candidates,{});
}

// Correlated separator errors in both reads must fail for every material field.
const separatorCases=[
 ["7,000,000","7.000.000"],["5,200,000","5,200.000"],
 ["1,670,000","1,670.000"],["1,000,000","1,000.000"]
];
for(const [correct,malformed] of separatorCases){
 for(const badText of [malformed,malformed.replace(/\./g,"．"),correct.replace(/,/g,"."),"-"+correct,correct+".00"]){
  const bad=sample.replace(correct,badText);
  assert.notEqual(bad,sample);
  for(const [left,right] of [[bad,bad],[sample,bad],[bad,sample]]){
   const result=review.compareAttempts(left,right,100,100);
   assert.equal(result.eligibleForManualTransfer,false);
   assert.deepEqual(result.candidates,{});
   assert.equal(result.autoApproved,false);
  }
  assert.equal(review.reviewDigitalPdf(bad).eligibleForManualTransfer,false);
 }
}
const allMalformed=separatorCases.reduce((s,[good,bad])=>s.replace(good,bad),sample);
assert.equal(review.compareAttempts(allMalformed,allMalformed,100,100).eligibleForManualTransfer,false);
// Test research metrics independently of the browser. Fixed variants must
// expose high-confidence wrong digits and never cherry-pick across settings.
const {summarizeAmountCrop}=require("./synthetic-amount-crop-metrics.cjs");
const researchExpected=a.candidates;
const researchRows=[];
for(const mode of ["7","13"])for(const scale of [1,2]){
 for(const [i,key] of Object.keys(researchExpected).entries()){
  researchRows.push({mode,scale,key,strictAmount:i===1?null:i===2?researchExpected[key]+1:researchExpected[key],
   confidence:i===3?74.9:90,elapsedMs:10});
 }
}
const researchSummary=summarizeAmountCrop(researchRows,researchExpected);
assert.equal(researchSummary.length,4);
for(const variant of researchSummary){
 assert.deepEqual([variant.exact,variant.malformed,variant.lowConfidence,variant.wrongHighConfidence,variant.elapsedMs],[1,1,1,1,40]);
 assert.equal(variant.byField.salaryGross.status,"EXACT");
 assert.equal(variant.byField.deductionsReference.status,"WRONG_HIGH_CONFIDENCE");
 assert.equal(variant.byField.socialInsurance.status,"LOW_CONFIDENCE");
}
assert.throws(()=>summarizeAmountCrop(researchRows.slice(1),researchExpected));
assert.throws(()=>summarizeAmountCrop([...researchRows.slice(1),researchRows[1]],researchExpected));
assert.throws(()=>summarizeAmountCrop(researchRows.map((x,i)=>i?x:{...x,confidence:Infinity}),researchExpected));
console.log("SYNTHETIC_AMOUNT_CROP_METRICS_AND_CORRELATED_SEPARATOR_HOLD_PASS");
