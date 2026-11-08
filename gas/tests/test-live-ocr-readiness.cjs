"use strict";
const assert=require("node:assert/strict");
const {parseArguments,evaluateReadiness}=require("../scripts/check-live-ocr-readiness.cjs");
const fixture={
 schema:"furusato-private-install/v1",createdByInstaller:true,
 title:"Furusato_PRIVATE_SYNTHETIC_TEST",sourceCommit:"a".repeat(40),
 protectedRemoteDigest:"a".repeat(64),privateVerifiedAt:"2026-11-08T00:00:00Z",
 versionNumber:5,deploymentId:"synthetic",webAppUrl:"https://script.google.com/macros/s/SYNTHETIC/exec",
 uploadDigest:"b".repeat(64)
};
const context={receipt:fixture,sourceDigest:fixture.uploadDigest,
 gitHeadMatches:true,authExists:true,claspExists:true,protectedStatus:"MATCH"};
assert.equal(evaluateReadiness(context).status,"READY_FOR_REMOTE_VERIFY");
const failures=[
 ["PRIVATE_RECEIPT_MISSING",{receipt:null}],
 ["RECEIPT_NOT_ATTESTED",{receipt:{...fixture,sourceCommit:null}}],
 ["RECEIPT_NOT_ATTESTED",{receipt:{...fixture,versionNumber:null}}],
 ["RECEIPT_NOT_ATTESTED",{receipt:{...fixture,webAppUrl:"https://attacker.invalid/exec"}}],
 ["RECEIPT_NOT_ATTESTED",{receipt:{...fixture,createdByInstaller:false}}],
 ["RECEIPT_NOT_ATTESTED",{receipt:{...fixture,title:"HousingERP"}}],
 ["GOOGLE_SOURCE_DIGEST_MISMATCH",{sourceDigest:"c".repeat(64)}],
 ["SOURCE_DIFFERS_FROM_GIT_HEAD",{gitHeadMatches:false}],
 ["ISOLATED_AUTH_UNAVAILABLE",{authExists:false}],
 ["ISOLATED_CLASP_CONFIG_UNAVAILABLE",{claspExists:false}],
 ["PROTECTED_CONFIG_DRIFT",{protectedStatus:"HOLD"}]
];
for(const [code,changed] of failures){
 const result=evaluateReadiness({...context,...changed});
 assert.equal(result.status,"HOLD");
 assert.ok(result.problems.includes(code),code);
 assert.equal(result.release,"HOLD");
 assert.ok(!JSON.stringify(result).includes(fixture.uploadDigest));
}
assert.equal(parseArguments([]).verify,false);
assert.equal(parseArguments(["--verify-remote"]).verify,true);
assert.equal(parseArguments(["--run-synthetic","--ack-temporary-google-docs"]).run,true);
assert.throws(()=>parseArguments(["--run-synthetic"]),/EXPLICIT_TEMPORARY/);
assert.throws(()=>parseArguments(["--ack-temporary-google-docs"]),/ACK_WITHOUT_RUN/);
assert.throws(()=>parseArguments(["--protected-root"]),/MISSING_PROTECTED_ROOT/);
assert.throws(()=>parseArguments(["--unknown"]),/UNKNOWN_ARGUMENT/);
console.log("LIVE_OCR_READINESS_PASS 11 fail-closed scenarios + explicit Google mutation opt-in; no Google access");
