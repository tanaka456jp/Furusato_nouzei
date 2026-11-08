"use strict";
const assert=require("node:assert/strict");
const google=require("../deployment/private-gas.cjs");
const policy=require("../deployment/policy.json");
const {checkCandidate,assess} = require("../scripts/plan-v020-private-stage.cjs");
const sha="a".repeat(40);
const origin="https://github.com/tanaka456jp/Furusato_nouzei.git";
const files=google.source();
const pkg=require("../package.json");
assert.equal(pkg.version,"0.1.20");
const valid=()=>({files,committed:files.map(f=>({...f})),
  packageVersion:pkg.version,branch:"feature/gas-workflow-20261106",
  origin,dirty:"",currentHead:sha,expectedHead:sha});
const pass=checkCandidate(valid());
assert.equal(pass.status,"CANDIDATE_SOURCE_READY");
assert.equal(pass.appVersion,"v0.1.20");
const deny=[
 [{branch:"main"},"WRONG_DEVELOPMENT_BRANCH"],
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
const plan=assess(values);
assert.equal(plan.status,"READY_FOR_SEPARATE_STAGE_APPROVAL");
assert.equal(plan.candidateDeployment,"NOT_CREATED");
assert.equal(plan.existingDeployment,"UNCHANGED");
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
console.log("V020_SEPARATE_STAGE_PREFLIGHT_PASS: synthetic only; no Google resource mutations; approval pending");
