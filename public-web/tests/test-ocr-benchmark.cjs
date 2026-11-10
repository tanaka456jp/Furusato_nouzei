"use strict";
/* Synthetic cases only. No private slip records in GitHub. */
const assert=require("node:assert/strict");
const {summarize,wilsonLower}=require("../quality/score-private.cjs");
const truth={year:2026,salaryGross:7000000,salaryIncomeReference:5200000,
 deductionsReference:1670000,socialInsurance:1000000};
const correct={eligibleForManualTransfer:true,year:2026,
 candidates:{...truth}};
const wrong={eligibleForManualTransfer:true,year:2026,
 candidates:{...truth,salaryGross:7100000}};
const rows=[
 {format:"digital-pdf",truth,result:correct,
  privateName:"NEVER_PRINT_PRIVATE_NAME"},
 {format:"scan-pdf",truth,result:{eligibleForManualTransfer:false}},
 {format:"photo",truth,result:wrong}
];
const summary=summarize(rows);
assert.equal(summary.overall.slipCount,3);
assert.equal(summary.overall.fieldCorrect,7);
assert.equal(summary.overall.fieldCount,12);
assert.equal(summary.overall.fullSlipCorrect,1);
assert.equal(summary.overall.unsafeTransferCount,1);
assert.equal(summary.overall.holdCount,1);
assert.equal(summary.overall.accuracyCertified,undefined);
assert.equal(summary.accuracyCertified,false);
assert.equal(summary.sourceValuesIncluded,false);
assert.equal(summary.byFormat["photo"].unsafeTransferCount,1);
assert.equal(summary.byFormat["scan-pdf"].holdCount,1);
assert.equal(summary.byFormat["digital-pdf"].fullSlipCorrect,1);
assert.ok(summary.overall.fieldWilson95Lower<.995);
assert.equal(wilsonLower(0,0),null);
assert.equal(wilsonLower(1000,1000)>.995,true);
assert.equal(JSON.stringify(summary).includes("NEVER_PRINT_PRIVATE_NAME"),false);
assert.equal(JSON.stringify(summary).includes("7000000"),false);
assert.throws(()=>summarize([{format:"photo",truth:{...truth,
 salaryGross:"7000000"},result:correct}]),/BENCHMARK_TRUTH_INVALID/);
assert.throws(()=>summarize([{format:"unknown",truth,
 result:correct}]),/BENCHMARK_SCHEMA_INVALID/);
assert.throws(()=>summarize([]),/BENCHMARK_RECORD_COUNT_INVALID/);

// An unaudited small set cannot be represented as statistically proven,
// even when the OCR outputs themselves happen to match the fixture.
assert.equal(summary.overall.statisticalTargetMet,false);
assert.equal(summary.overall.independentlyCheckedRealCount,0);
assert.equal(summary.byDevice["iphone-safari"].slipCount,0);
assert.throws(()=>summarize([{format:"photo",truth,
 result:{eligibleForManualTransfer:"false"}}]),/BENCHMARK_RESULT_INVALID/);
function auditFor(i,device="windows-edge",sourceKind="real"){
 return {caseId:"00000000-0000-4000-8000-"+i.toString(16).padStart(12,"0"),
  sourceFingerprint:i.toString(16).padStart(64,"0"),
  device,sourceKind,independentTruthVerified:true,
  secondEntry:{...truth}};
}
const audited={format:"digital-pdf",truth,result:correct,
 audit:auditFor(1)};
assert.throws(()=>summarize([audited,{...audited}]),/BENCHMARK_DUPLICATE_CASE/);
assert.throws(()=>summarize([audited,{...audited,
 audit:{...auditFor(2),sourceFingerprint:audited.audit.sourceFingerprint}}]),
 /BENCHMARK_DUPLICATE_SOURCE/);
assert.throws(()=>summarize([{...audited,
 audit:{...auditFor(3),secondEntry:{...truth,salaryGross:1}}}]),
 /BENCHMARK_TRUTH_DISAGREEMENT/);
assert.equal(summarize([{...audited,
 audit:{...auditFor(4),sourceKind:"synthetic"}}]).overall.statisticalTargetMet,false);
// Model a *hypothetically attested* large sample using synthetic rows.
// It tests only coverage arithmetic, NOT source identity or OCR accuracy.
const large=[];
let seq=100;
for(const format of ["digital-pdf","scan-pdf","photo"])
 for(const device of ["windows-edge","iphone-safari"])
  for(let k=0;k<800;k++)
   large.push({format,truth,result:correct,audit:auditFor(seq++,device)});
const ideal=summarize(large);
assert.equal(ideal.overall.statisticalTargetMet,true);
assert.equal(ideal.accuracyCertified,false);
assert.equal(ideal.release.startsWith("HOLD"),true);
assert.equal(ideal.byDevice["iphone-safari"].slipCount,2400);
assert.equal(ideal.byFormat.photo.slipCount,1600);
assert.equal(ideal.byFormatAndDevice.photo["iphone-safari"].slipCount,800);
assert.equal(summarize(large.filter(r=>
 !(r.format==="photo"&&r.audit.device==="iphone-safari")))
 .overall.statisticalTargetMet,false);
assert.equal(JSON.stringify(ideal).includes("sourceFingerprint"),false);
assert.equal(JSON.stringify(ideal).includes("caseId"),false);
// Lack of either iOS or scanned-format evidence blocks the overall target.
assert.equal(summarize(large.filter(r=>r.audit.device==="windows-edge"))
 .overall.statisticalTargetMet,false);
assert.equal(summarize(large.filter(r=>r.format==="digital-pdf"))
 .overall.statisticalTargetMet,false);

console.log("PUBLIC_OCR_AGGREGATE_ONLY_BENCHMARK_SYNTHETIC_PASS; private records NOT included");
