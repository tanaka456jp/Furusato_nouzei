"use strict";
const assert = require("node:assert/strict");
const {validateRecord,summarizeRecords,auditDrive} = require("../scripts/audit-owner-ocr-evidence.cjs");
const coverage = "FURUSATO_DEDICATED_OAUTH_SCOPE_ONLY_INCLUDING_TRASH";
const drive = () => ({status:"PASS",temporaryOcrFiles:0,pages:1,protection:"PASS"});
const sha = "a".repeat(40);
function record(device,formats,finishedAt="2026-11-09T02:25:00.000Z") {
  return {
    protocolRevision:1,release:"HOLD",status:"PASS",sourceCommit:sha,
    startedAt:"2026-11-09T02:00:00.000Z",finishedAt,device,
    driveCoverage:coverage,before:drive(),
    results:formats.map(format=>({format,consentReset:"PASS",candidates:"PASS",
      unreviewedHold:"PASS",after:drive()}))
  };
}
const windows=record("WINDOWS_EDGE_OWNER_OBSERVED",["PDF","PNG","JPEG"]);
const iphone=record("IPHONE_SAFARI_OWNER_OBSERVED",["JPEG"]);
assert.equal(auditDrive(drive()),true);
assert.equal(auditDrive({...drive(),temporaryOcrFiles:1}),false);
assert.equal(validateRecord(windows).status,"OWNER_ATTESTED_STRUCTURE_PASS");
assert.equal(validateRecord(iphone).status,"OWNER_ATTESTED_STRUCTURE_PASS");
const summary=summarizeRecords([windows,iphone]);
assert.equal(summary.structuralStatus,"OWNER_ATTESTED_STRUCTURE_PASS");
assert.equal(summary.release,"HOLD");
assert.equal(summary.immutableDeploymentVersion,"NOT_IN_OWNER_RECORD");
assert.equal(summary.independentOcrAccuracy,"NOT_VERIFIED");
assert.equal(summary.independentDeletionOutsideOauthScope,"NOT_VERIFIED");
assert.equal(summary.sameRecordedSourceCommit,"YES");
const bad=[
  [null,"INVALID_RECORD"],
  [{...windows,device:"UNKNOWN"},"UNSUPPORTED_DEVICE"],
  [{...windows,status:"HOLD"},"OWNER_STATUS_NOT_PASS"],
  [{...windows,release:"GO"},"RELEASE_NOT_HOLD"],
  [{...windows,sourceCommit:"not-a-sha"},"SOURCE_COMMIT_INVALID"],
  [{...windows,driveCoverage:"ACCOUNT_WIDE"},"DRIVE_SCOPE_NOT_RECORDED"],
  [{...windows,startedAt:"2026-11-10T02:00:00.000Z"},"TIME_UNVERIFIED"],
  [{...windows,before:{...drive(),temporaryOcrFiles:1}},"BEFORE_DRIVE_AUDIT_INVALID"],
  [{...windows,results:windows.results.slice(1)},"FORMAT_COVERAGE_INCOMPLETE"],
  [{...windows,results:[{...windows.results[0],format:"JPEG"},...windows.results.slice(1)]},"FORMAT_OR_ORDER_INVALID"],
  [{...windows,results:[{...windows.results[0],candidates:"FAIL"},...windows.results.slice(1)]},"OWNER_ASSERTION_INCOMPLETE"],
  [{...windows,results:[{...windows.results[0],after:{...drive(),pages:0}},...windows.results.slice(1)]},"AFTER_DRIVE_AUDIT_INVALID"]
];
for(const [r,code] of bad){
 const audit=validateRecord(r);
 assert.equal(audit.status,"HOLD",code);
 assert.ok(audit.reasons.includes(code),code);
}
assert.equal(summarizeRecords([windows]).structuralStatus,"HOLD");
assert.equal(summarizeRecords([windows,iphone],1).structuralStatus,"HOLD");
assert.equal(summarizeRecords([windows,{...iphone,sourceCommit:"b".repeat(40)}]).sameRecordedSourceCommit,"UNVERIFIED");
assert.equal(summarizeRecords([windows,{...iphone,sourceCommit:"b".repeat(40)}]).structuralStatus,"HOLD");
// A newer failed attempt must never be masked by an older PASS record.
const laterFailed=record("WINDOWS_EDGE_OWNER_OBSERVED",["PDF","PNG","JPEG"],"2026-11-09T03:25:00.000Z");
laterFailed.results[0].unreviewedHold="FAIL";
assert.equal(summarizeRecords([windows,iphone,laterFailed]).structuralStatus,"HOLD");
const secrets="https://script.google.com/macros/s/SECRET/exec";
const result=summarizeRecords([{...windows,credentials:secrets,rawException:secrets},iphone]);
assert.ok(!JSON.stringify(result).includes(secrets));
assert.ok(!JSON.stringify(result).includes(sha));
console.log("OWNER_OCR_OFFLINE_AUDIT_TEST_PASS; synthetic only; version remains unverified; release HOLD");
