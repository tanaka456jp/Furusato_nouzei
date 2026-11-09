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
console.log("PUBLIC_OCR_AGGREGATE_ONLY_BENCHMARK_SYNTHETIC_PASS; private records NOT included");
