"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const crypto=require("node:crypto");
const google=require("../deployment/private-gas.cjs");
const policy=require("../deployment/policy.json");
const {checkCandidate,assess,committedSources,protectedConfigHold,inspectGlobalAuthRefresh} = require("../scripts/plan-v020-private-stage.cjs");
const sha="a".repeat(40);
const origin="https://github.com/tanaka456jp/Furusato_nouzei.git";
const files=google.source();
const pkg=require("../package.json");
assert.equal(pkg.version,"0.1.20");
const valid=()=>({files,committed:files.map(f=>({...f})),
  packageVersion:pkg.version,branch:"feature/gas-workflow-20261106",
  origin,dirty:"",currentHead:sha,expectedHead:sha,remoteHead:sha});
const pass=checkCandidate(valid());
assert.equal(pass.status,"CANDIDATE_SOURCE_READY");
assert.equal(pass.appVersion,"v0.1.20");
const realCheckout=committedSources();
// Never substitute a copied worktree file for the actual committed sources.
// This catches Windows line-ending/encoding mismatches missed by mock-only CI.
const realCandidate=checkCandidate({...valid(),files:google.source(),committed:realCheckout.files,
 currentHead:realCheckout.head,expectedHead:realCheckout.head,remoteHead:realCheckout.head});
assert.equal(realCandidate.status,"CANDIDATE_SOURCE_READY",
 `Actual Git checkout source mismatch: ${realCandidate.reasons.join(",")}`);
// Different local branch/detached HEAD is safe if and only if GitHub HEAD matches.
for (const branch of ["", "owner-ocr-worktree", "main"]) {
 const alternative=checkCandidate({...valid(),branch});
 assert.equal(alternative.status,"CANDIDATE_SOURCE_READY");
 assert.equal(alternative.checkoutIdentity,"TRUSTED_REMOTE_EXACT_COMMIT");
}
assert.equal(checkCandidate(valid()).checkoutIdentity,"EXPECTED_LOCAL_BRANCH");
const deny=[
 [{branch:"main",remoteHead:"b".repeat(40)},"WRONG_DEVELOPMENT_BRANCH"],
 [{remoteHead:null},"TRUSTED_REMOTE_TIP_UNVERIFIED"],
 [{remoteHead:"b".repeat(40)},"REMOTE_TIP_DIFFERS_FROM_CHECKOUT"],
 [{origin:"https://github.com/bad/other"},"UNTRUSTED_GIT_ORIGIN"],
 [{dirty:" M gas/Engine.gs"},"TRACKED_WORKTREE_DIRTY"],
 [{packageVersion:"0.1.19"},"CANDIDATE_VERSION_INVALID"],
 [{currentHead:"bad"},"INVALID_GIT_HEAD"],
 [{expectedHead:"b".repeat(40)},"GIT_HEAD_CHANGED_DURING_PROBE"],
 [{files:files.slice(1)},"CANDIDATE_SOURCE_SET_INVALID"],
 [{committed:files.slice(1)},"CANDIDATE_SOURCE_SET_INVALID"],
 [{committed:files.map(x=>x.name==="Code"?{...x,source:"extra"}:x)},
   "WORKTREE_SOURCE_DIFFERS_FROM_COMMIT"]
];
for(const [patch,issue] of deny){
 const report=checkCandidate({...valid(),...patch});
 assert.equal(report.status,"HOLD");
 assert.ok(report.reasons.includes(issue),issue);
}
const old={
 status:"PASS",appVersion:"v0.1.17",ownerAndPrivateAccess:"PASS",
 protectedLocal:"UNCHANGED",protectedGoogle:"UNCHANGED"
};
const drive={
 status:"PASS",temporaryOcrFiles:0,
 coverage:"FURUSATO_DEDICATED_OAUTH_SCOPE_ONLY"
};
const digest=google.digest(files);
const values={candidate:pass,old,drive,oldDigest:"f".repeat(64),newDigest:digest};
const alternativePlan=assess({...values,candidate:checkCandidate({...valid(),branch:"owner-local"})});
assert.equal(alternativePlan.status,"READY_FOR_SEPARATE_STAGE_APPROVAL");
assert.equal(alternativePlan.candidateCheckoutIdentity,"TRUSTED_REMOTE_EXACT_COMMIT");
const plan=assess(values);
assert.equal(plan.status,"READY_FOR_SEPARATE_STAGE_APPROVAL");
assert.equal(plan.candidateDeployment,"NOT_CREATED");
assert.equal(plan.existingDeployment,"NOT_MODIFIED_BY_THIS_CHECK");
assert.equal(plan.stagePreflightRevision,5);
assert.equal(plan.stage,"APPROVAL_GATE");
assert.equal(plan.candidateCheckoutIdentity,"EXPECTED_LOCAL_BRANCH");
assert.deepEqual(plan.candidateChecks,[]);
assert.equal(plan.release,"HOLD");
assert.equal(plan.realV020GoogleAcceptance,"NOT_TESTED");
assert.equal(plan.authorization,"OWNER_EXPLICIT_APPROVAL_REQUIRED_BEFORE_ANY_GOOGLE_WRITE");
assert.ok(!JSON.stringify(plan).includes(sha));
assert.ok(!JSON.stringify(plan).includes(digest));
const cases=[
 [{candidate:checkCandidate({...valid(),dirty:"bad"})},"CANDIDATE_NOT_READY"],
 [{old:{...old,appVersion:"v0.1.20"}},"OLD_PRIVATE_RELEASE_NOT_VERIFIED"],
 [{old:{...old,ownerAndPrivateAccess:"HOLD"}},"OLD_PRIVATE_RELEASE_NOT_VERIFIED"],
 [{old:{...old,protectedGoogle:"CHANGED"}},"OLD_PRIVATE_RELEASE_NOT_VERIFIED"],
 [{drive:{...drive,temporaryOcrFiles:1}},"OLD_DRIVE_TEMP_NOT_ZERO"],
 [{drive:{...drive,coverage:"ACCOUNT_ALL"}},"OLD_DRIVE_TEMP_NOT_ZERO"],
 [{oldDigest:digest},"CANDIDATE_SOURCE_NOT_DISTINCT"],
 [{newDigest:"bad"},"CANDIDATE_SOURCE_NOT_DISTINCT"]
];
for(const [patch,reason] of cases){
 const report=assess({...values,...patch});
 assert.equal(report.status,"HOLD",reason);
 assert.ok(report.problems.includes(reason),reason);
 assert.equal(report.release,"HOLD");
}

// The initial owner's HOLD was a local-only failure. It must never imply that
// Google API or Drive had been checked, or that a Drive file actually remained.
const localHold=assess({candidate:checkCandidate({...valid(),dirty:" M gas/Engine.gs"})});
assert.deepEqual(localHold.problems,["CANDIDATE_NOT_READY"]);
assert.deepEqual(localHold.candidateChecks,["TRACKED_WORKTREE_DIRTY"]);
assert.equal(localHold.stage,"LOCAL_CANDIDATE");
assert.equal(localHold.candidateCheckoutIdentity,"NOT_VERIFIED");
assert.equal(localHold.oldPrivateAudit,"NOT_RUN");
assert.equal(localHold.driveAudit,"NOT_RUN");
assert.equal(localHold.sourceComparison,"NOT_RUN");
assert.ok(!JSON.stringify(localHold).includes("OLD_DRIVE_TEMP_NOT_ZERO"));
assert.ok(!JSON.stringify(localHold).includes("OLD_PRIVATE_RELEASE_NOT_VERIFIED"));
assert.ok(!JSON.stringify(localHold).includes("CANDIDATE_SOURCE_NOT_DISTINCT"));
const partialRemote=assess({candidate:pass});
assert.ok(partialRemote.problems.includes("OLD_DRIVE_AUDIT_NOT_RUN"));
assert.ok(partialRemote.problems.includes("SOURCE_COMPARISON_NOT_RUN"));
assert.ok(!partialRemote.problems.includes("OLD_DRIVE_TEMP_NOT_ZERO"));
assert.equal(partialRemote.stage,"REMOTE_READONLY_ATTESTATION");

// Read-only snapshot drift: report ONLY exact allowlisted names and states.
// A changed OAuth file is NOT proof of compromise or a verified token refresh.
const names=["housing-clasp","housing-appsscript","housing-project","global-clasp-auth"];
const rows=names.map(name=>({name,state:"UNCHANGED",file:"PRIVATE_ABSOLUTE_PATH",modifiedUtc:"SECRET_TIMESTAMP",hash:"SECRET_HASH"}));
rows[3].state="CHANGED";
const driftHold=protectedConfigHold(pass,{status:"HOLD",checks:rows});
assert.equal(driftHold.status,"HOLD");
assert.equal(driftHold.stagePreflightRevision,5);
assert.equal(driftHold.stage,"PROTECTED_LOCAL_CONFIG");
assert.deepEqual(driftHold.problems,["PROTECTED_CONFIG_DRIFT"]);
assert.equal(driftHold.candidateCheckoutIdentity,"EXPECTED_LOCAL_BRANCH");
assert.deepEqual(driftHold.protectedConfiguration.checks,
 names.map((name,i)=>({name,state:i===3?"CHANGED":"UNCHANGED"})));
assert.equal(driftHold.oldPrivateAudit,"NOT_RUN");
assert.equal(driftHold.driveAudit,"NOT_RUN");
assert.equal(driftHold.sourceComparison,"NOT_RUN");
assert.equal(driftHold.release,"HOLD");
for(const secret of ["PRIVATE_ABSOLUTE_PATH","SECRET_TIMESTAMP","SECRET_HASH"])
 assert.ok(!JSON.stringify(driftHold).includes(secret));
const alternateDrift=protectedConfigHold(checkCandidate({...valid(),branch:"other-local"}),
 {status:"HOLD",checks:rows});
assert.equal(alternateDrift.candidateCheckoutIdentity,"TRUSTED_REMOTE_EXACT_COMMIT");
for(const malformed of [
 null,{status:"HOLD",checks:[]},
 {status:"MATCH",checks:rows},
 {status:"HOLD",checks:rows.map(x=>({...x,name:"private-token"}))},
 {status:"HOLD",checks:rows.map(x=>({...x,state:"SECRET_VALUE"}))}
]){
 const rejected=protectedConfigHold(pass,malformed);
 assert.equal(rejected.status,"HOLD");
 assert.deepEqual(rejected.problems,["PROTECTED_DRIFT_REPORT_INVALID"]);
 assert.deepEqual(rejected.protectedConfiguration.checks,[]);
}
// The application must never infer v0.1.20 OCR PASS from a local-only check.
assert.equal(driftHold.realV020GoogleAcceptance,"NOT_TESTED");

// Synthetic-only historical auth comparison: proves a limited token diff shape,
 // NOT the writer identity, remote deployment integrity, or safe bypass.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"furusato-auth-review-"));
try {
 const originalPath=path.join(dir,"isolated-auth.json");
 const currentPath=path.join(dir,"global-auth.json");
 const baseAuth={tokens:{default:{
  refresh_token:"synthetic-refresh",client_id:"synthetic-id",
  client_secret:"synthetic-secret",access_token:"synthetic-access-old",expiry_date:100
 }}};
 const revised=structuredClone(baseAuth);
 revised.tokens.default.access_token="synthetic-access-new";
 revised.tokens.default.expiry_date=200;
 const originalBytes=Buffer.from(JSON.stringify(baseAuth));
 fs.writeFileSync(originalPath,originalBytes);
 fs.writeFileSync(currentPath,JSON.stringify(revised));
 const hash=value=>crypto.createHash("sha256").update(value).digest("hex");
 const receipt={protectedSnapshot:{[path.resolve(currentPath)]:hash(originalBytes)}};
 const drift={status:"HOLD",checks:rows};
 const review=inspectGlobalAuthRefresh({receipt,drift,
  isolatedAuthFile:originalPath,globalAuthFile:currentPath});
 assert.deepEqual(review,{
  status:"HOLD",baseline:"HISTORICAL_BYTES_MATCHED",
  pattern:"TOKEN_REFRESH_COMPATIBLE",writer:"UNVERIFIED",
  snapshotWrite:"PROHIBITED",ownerReview:"REQUIRED"
 });
 const output=protectedConfigHold(pass,drift,review);
 assert.equal(output.status,"HOLD");
 assert.equal(output.stage,"PROTECTED_LOCAL_CONFIG");
 assert.equal(output.stagePreflightRevision,5);
 assert.equal(output.globalAuthReview.pattern,"TOKEN_REFRESH_COMPATIBLE");
 assert.equal(output.globalAuthReview.ownerReview,"REQUIRED");
 assert.equal(output.oldPrivateAudit,"NOT_RUN");
 assert.equal(output.driveAudit,"NOT_RUN");
 for(const value of ["synthetic-refresh","synthetic-secret","synthetic-access-old",
  "synthetic-access-new",dir,receipt.protectedSnapshot[path.resolve(currentPath)]])
  assert.ok(!JSON.stringify(output).includes(value),"Private value escaped");
 assert.deepEqual(fs.readFileSync(originalPath),originalBytes,"Historical isolated auth altered");
 assert.equal(fs.readFileSync(currentPath,"utf8"),JSON.stringify(revised),
  "Global clasp auth altered");
 assert.equal(inspectGlobalAuthRefresh({receipt:{protectedSnapshot:{[path.resolve(currentPath)]:"e".repeat(64)}},
  drift,isolatedAuthFile:originalPath,globalAuthFile:currentPath}).baseline,
  "HISTORICAL_BYTES_NOT_MATCHED");
 const wrongRefresh=structuredClone(revised);
 wrongRefresh.tokens.default.refresh_token="altered-refresh";
 fs.writeFileSync(currentPath,JSON.stringify(wrongRefresh));
 const bad=inspectGlobalAuthRefresh({receipt,drift,
  isolatedAuthFile:originalPath,globalAuthFile:currentPath});
 assert.equal(bad.baseline,"HISTORICAL_BYTES_MATCHED");
 assert.equal(bad.pattern,"UNVERIFIED");
 fs.writeFileSync(currentPath,"not json");
 assert.equal(inspectGlobalAuthRefresh({receipt,drift,isolatedAuthFile:originalPath,
  globalAuthFile:currentPath}).baseline,"HISTORICAL_COMPARISON_UNAVAILABLE");
 fs.writeFileSync(currentPath,JSON.stringify(revised));
 const changedHousing=structuredClone(drift);
 changedHousing.checks[0].state="CHANGED";
 assert.equal(inspectGlobalAuthRefresh({receipt,drift:changedHousing,isolatedAuthFile:originalPath,
  globalAuthFile:currentPath}).baseline,"NOT_SOLE_GLOBAL_AUTH_CHANGE");
 assert.equal(inspectGlobalAuthRefresh({receipt,drift,isolatedAuthFile:path.join(dir,"missing"),
  globalAuthFile:currentPath}).baseline,"HISTORICAL_COMPARISON_UNAVAILABLE");
}finally{fs.rmSync(dir,{recursive:true,force:true});}

console.log("V020_SEPARATE_STAGE_PREFLIGHT_PASS: synthetic only; no Google resource mutations; approval pending");
