"use strict";
const assert=require("node:assert/strict");
const {summarize}=require("../scripts/report-private-ocr-status.cjs");
const secret="https://script.google.com/macros/s/SECRET-DO-NOT-DISCLOSE/exec";
const data={status:"HOLD",environment:"REAL_GOOGLE_WEB_APP",
 tests:[{id:"TAX-700",status:"PASS"},{id:"GOOGLE-OCR-PNG",status:"PASS"},
 {id:secret,status:"PASS"},{id:"GOOGLE-OCR-JPEG",status:"FAIL",details:secret}],
 failureStage:"OCR_PDF",failureCode:"OCR_RESPONSE_FAILED",url:secret,
 credentials:{refresh_token:"PRIVATE_TOKEN"},exception:secret};
const report=summarize(data);
assert.deepEqual(report.completedChecks,["TAX-700","GOOGLE-OCR-PNG"]);
assert.equal(report.failureStage,"OCR_PDF");
assert.equal(report.failureCode,"OCR_RESPONSE_FAILED");
assert.equal(report.status,"HOLD");
assert.equal(report.release,"HOLD");
assert.equal(report.format,"STAGED");
assert.ok(!JSON.stringify(report).includes(secret));
assert.ok(!JSON.stringify(report).includes("PRIVATE_TOKEN"));
const legacy=summarize({status:"HOLD",environment:"REAL_GOOGLE_WEB_APP",
 tests:[{id:"TAX-700",status:"PASS"}]});
assert.equal(legacy.failureStage,"UNRECORDED");
assert.equal(legacy.format,"LEGACY_NO_FAILURE_STAGE");
assert.equal(summarize({status:"PASS",environment:secret,tests:[{id:secret,status:"PASS"}]}).environment,"UNVERIFIED");
assert.equal(summarize(null).status,"INVALID");
console.log("PRIVATE_OCR_EVIDENCE_REDACTION_PASS; synthetic only, no Google access");
