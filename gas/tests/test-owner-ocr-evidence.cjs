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
// v0.1.20 owner evidence is protocol 2 and must never be mixed with the
// v0.1.17 legacy directory, silently relabeled, or used as release approval.
const digest = "c".repeat(64);
const stageOptions = {stageV020:true,receiptFingerprint:digest,sourceCommit:sha};
const stage = device => ({
  ...record(device,device==="WINDOWS_EDGE_OWNER_OBSERVED"?["PDF","PNG","JPEG"]:["JPEG"]),
  protocolRevision:2,candidateVersion:"v0.1.20",stageReceiptFingerprint:digest
});
const stageWin=stage("WINDOWS_EDGE_OWNER_OBSERVED");
const stagePhone=stage("IPHONE_SAFARI_OWNER_OBSERVED");
assert.equal(validateRecord(stageWin,stageOptions).status,"OWNER_ATTESTED_STRUCTURE_PASS");
assert.ok(validateRecord(stageWin).reasons.includes("PROTOCOL_UNSUPPORTED"),
  "Legacy mode must reject v0.1.20 stage evidence");
assert.equal(summarizeRecords([stageWin,stagePhone],0,stageOptions).structuralStatus,
  "OWNER_ATTESTED_STRUCTURE_PASS");
assert.equal(summarizeRecords([stageWin,stagePhone],0,stageOptions).candidateVersion,"v0.1.20");
assert.equal(summarizeRecords([stageWin,stagePhone],0,stageOptions).immutableDeploymentVersion,
  "REQUIRES_INDEPENDENT_REMOTE_GET");
for(const [bad,reason] of [
 [{...stageWin,protocolRevision:1},"PROTOCOL_UNSUPPORTED"],
 [{...stageWin,candidateVersion:"v0.1.23"},"STAGE_VERSION_INVALID"],
 [{...stageWin,stageReceiptFingerprint:"b".repeat(64)},"STAGE_RECEIPT_BINDING_INVALID"],
 [{...stageWin,sourceCommit:"b".repeat(40)},"STAGE_SOURCE_COMMIT_DIFFERS"]
]){
 const res=validateRecord(bad,stageOptions);
 assert.equal(res.status,"HOLD",reason);
 assert.ok(res.reasons.includes(reason),reason);
}
assert.equal(summarizeRecords([stageWin,stagePhone],1,stageOptions).structuralStatus,"HOLD");
const stageLatestFailure={...stageWin,finishedAt:"2026-11-09T03:25:00.000Z",
 results:[{...stageWin.results[0],candidates:"FAIL"},...stageWin.results.slice(1)]};
assert.equal(summarizeRecords([stageWin,stagePhone,stageLatestFailure],0,stageOptions).structuralStatus,
 "HOLD","Latest failed owner evidence must not be masked by an old PASS");
const stageSummary=JSON.stringify(summarizeRecords([stageWin,stagePhone],0,stageOptions));
assert.ok(!stageSummary.includes(digest),"Private stage receipt digest must not leave the audit");
assert.ok(!stageSummary.includes(sha),"Private source revision must not leave the audit");
// Fail closed when an invalid clock/date masks an older valid owner record.
for(const opts of [{},{...stageOptions}]){
 const win = opts.stageV020 ? stageWin : windows;
 const phone = opts.stageV020 ? stagePhone : iphone;
 const malformed = {...win,finishedAt:"NOT_A_TIMESTAMP"};
 const invalidCalendar = {...win,finishedAt:"2026-02-30T02:25:00.000Z"};
 for(const invalid of [malformed,invalidCalendar]){
  assert.ok(validateRecord(invalid,opts).reasons.includes("TIME_UNVERIFIED"));
  const a=summarizeRecords([win,phone,invalid],0,opts);
  const b=summarizeRecords([invalid,win,phone],0,opts);
  assert.equal(a.structuralStatus,"HOLD");
  assert.equal(b.structuralStatus,"HOLD");
  assert.ok(a.windows.reasons.includes("UNORDERABLE_EVIDENCE_TIME"));
 }
 // Same-millisecond records may disagree and readdir ordering must not
 // choose a winner; both orders must HOLD.
 const simultaneousFail = {...win,
  results:[{...win.results[0],candidates:"FAIL"},...win.results.slice(1)]};
 for(const rows of [[win,phone,simultaneousFail],[simultaneousFail,win,phone]]){
  const a=summarizeRecords(rows,0,opts);
  assert.equal(a.structuralStatus,"HOLD");
  assert.ok(a.windows.reasons.includes("DUPLICATE_LATEST_FINISHED_AT"));
 }
 // A later valid owner re-test can supersede a past same-time conflict.
 const recovered={...win,finishedAt:"2026-11-09T04:25:00.000Z"};
 assert.equal(summarizeRecords([win,simultaneousFail,phone,recovered],0,opts).structuralStatus,
  "OWNER_ATTESTED_STRUCTURE_PASS");
}
console.log("OWNER_OCR_OFFLINE_AUDIT_TEST_PASS; synthetic only; version remains unverified; release HOLD");
