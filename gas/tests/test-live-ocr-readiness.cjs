"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const {parseArguments,evaluateReadiness,inspectIsolatedAuth}=require("../scripts/check-live-ocr-readiness.cjs");
const fixture={
 schema:"furusato-private-install/v1",createdByInstaller:true,
 title:"Furusato_PRIVATE_SYNTHETIC_TEST",sourceCommit:"a".repeat(40),
 protectedRemoteDigest:"a".repeat(64),privateVerifiedAt:"2026-11-08T00:00:00Z",
 versionNumber:5,deploymentId:"synthetic",webAppUrl:"https://script.google.com/macros/s/SYNTHETIC/exec",
 uploadDigest:"b".repeat(64)
};
const context={receipt:fixture,sourceDigest:fixture.uploadDigest,
 gitHeadMatches:true,authExists:true,authValid:true,claspExists:true,protectedStatus:"MATCH"};
assert.equal(evaluateReadiness(context).status,"READY_FOR_REMOTE_VERIFY");
const freshState=evaluateReadiness({...context,receipt:null,claspExists:false,protectedStatus:"HOLD"});
assert.equal(freshState.status,"HOLD");
assert.ok(freshState.problems.includes("PRIVATE_RECEIPT_MISSING"));
assert.ok(freshState.problems.includes("ISOLATED_CLASP_CONFIG_UNAVAILABLE"));
assert.ok(!freshState.problems.includes("PROTECTED_CONFIG_DRIFT"),
 "No saved snapshot means drift cannot yet be assessed");
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
 ["ISOLATED_AUTH_FORMAT_INVALID",{authValid:false}],
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
assert.equal(parseArguments(["--probe-only"]).verify,true);
assert.equal(parseArguments(["--probe-only"]).probe,true);
assert.equal(parseArguments(["--verify-remote"]).probe,false);
assert.throws(()=>parseArguments(["--probe-only","--run-synthetic","--ack-temporary-google-docs"]),/PROBE_AND_OCR_ARE_EXCLUSIVE/);
assert.throws(()=>parseArguments(["--probe-only","--ack-temporary-google-docs"]),/ACK_WITHOUT_RUN/);
assert.equal(parseArguments(["--run-synthetic","--ack-temporary-google-docs"]).run,true);
assert.throws(()=>parseArguments(["--run-synthetic"]),/EXPLICIT_TEMPORARY/);
assert.throws(()=>parseArguments(["--ack-temporary-google-docs"]),/ACK_WITHOUT_RUN/);
assert.throws(()=>parseArguments(["--protected-root"]),/MISSING_PROTECTED_ROOT/);
assert.throws(()=>parseArguments(["--unknown"]),/UNKNOWN_ARGUMENT/);
// Local-only synthetic credentials; no real OAuth or filesystem outside tmp.
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"furusato-auth-shape-"));
try{
 const f=path.join(tmp,"auth.json");
 assert.equal(inspectIsolatedAuth(f),"MISSING");
 fs.writeFileSync(f,JSON.stringify({tokens:{default:{
  refresh_token:"synthetic-refresh",client_id:"synthetic-id",client_secret:"synthetic-secret"
 }}}));
 assert.equal(inspectIsolatedAuth(f),"VALID");
 for(const malformed of ['not-json','{}','{"tokens":{"default":{"refresh_token":"r"}}}',
  '{"tokens":{"default":{"refresh_token":"r","client_id":"i","client_secret":"\\n"}}}']){
  fs.writeFileSync(f,malformed);
  assert.equal(inspectIsolatedAuth(f),"INVALID");
 }
 fs.rmSync(f);
 fs.mkdirSync(f);
 assert.equal(inspectIsolatedAuth(f),"INVALID");
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
console.log("LIVE_OCR_READINESS_PASS 12 fail-closed scenarios + 7 synthetic auth-shape checks; no Google access");
