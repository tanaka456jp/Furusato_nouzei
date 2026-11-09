"use strict";
/** Synthetic-only v0.1.23 stage plan regression. No Google or private auth. */
const assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const cp=require("node:child_process");
const {assessV023,assessCandidate,snapshotEqual,targetPathAbsent}=
 require("../scripts/plan-v023-isolated-stage.cjs");
const g=require("../deployment/private-gas.cjs");
const files=[
 {name:"Code",type:"SERVER_JS",source:"function doGet() {}"},
 {name:"Engine",type:"SERVER_JS",source:'var VERSION = "gas-mvp-0.1.23";'},
 {name:"SourceOCR",type:"SERVER_JS",source:"function OCR() {}"},
 {name:"Index",type:"HTML",source:"<html></html>"},
 {name:"appsscript",type:"JSON",source:'{"webapp":{"access":"MYSELF","executeAs":"USER_DEPLOYING"}}'}
];
const previousFiles=files.map(x=>({...x,source:x.name==="Engine"?
 'var VERSION = "gas-mvp-0.1.20";':x.source}));
const sha="a".repeat(40), prior="b".repeat(40);
const good={
 workingFiles:files,committedFiles:files,packageVersion:"0.1.23",
 head:sha,remoteHead:sha,origin:"https://github.com/tanaka456jp/Furusato_nouzei.git",
 localBranch:"feature/gas-workflow-20261106",trackedChanges:"",
 previousDigest:g.digest(previousFiles),previousCommit:prior,stageAbsent:true
};
assert.equal(assessCandidate(good).ready,true);
for(const patch of [
 {packageVersion:"0.1.20"},
 {workingFiles:previousFiles},
 {committedFiles:previousFiles},
 {committedFiles:[...files.slice(0,4),{...files[4],source:"changed"}]},
 {head:"c".repeat(40)},
 {remoteHead:"c".repeat(40)},
 {origin:"https://github.com/attacker/repo.git"},
 {localBranch:"main"},
 {trackedChanges:" M gas/Engine.gs"},
 {previousDigest:g.digest(files)},
 {previousDigest:"bad"},
 {previousCommit:"not a commit"},
 {stageAbsent:false}
]){
 assert.equal(assessCandidate({...good,...patch}).ready,false,JSON.stringify(Object.keys(patch)));
}
assert.equal(assessCandidate({...good,localBranch:""}).ready,true);
const original={
 candidate:{ready:true},
 attestation:{status:"LIMITED_V020_OWNER_EVIDENCE_AND_GOOGLE_GET_PASS",
  version:"v0.1.20",release:"HOLD",googleWrites:"NONE_FROM_THIS_GATE"},
 stable:true,targetAbsent:true
};
const pass=assessV023(original);
assert.equal(pass.status,"READY_FOR_SEPARATE_V023_STAGE_APPROVAL");
assert.equal(pass.googleWrites,"NONE_FROM_THIS_PLAN");
assert.equal(pass.release,"HOLD");
assert.equal(pass.ownerAuthorization,"SEPARATE_EXPLICIT_APPROVAL_REQUIRED_FOR_ANY_GOOGLE_WRITE");
assert.equal(pass.v023ActualOCR,"NOT_TESTED");
assert.equal(pass.v023RemoteExists,"NOT_CHECKED");
for(const [patch,reason] of [
 [{candidate:{ready:false}},"CANDIDATE_SOURCE_NOT_VERIFIED"],
 [{attestation:null},"V020_OWNER_AND_GOOGLE_READONLY_ATTESTATION_NOT_PASS"],
 [{attestation:{...original.attestation,status:"HOLD"}},"V020_OWNER_AND_GOOGLE_READONLY_ATTESTATION_NOT_PASS"],
 [{attestation:{...original.attestation,version:"v0.1.23"}},"V020_OWNER_AND_GOOGLE_READONLY_ATTESTATION_NOT_PASS"],
 [{attestation:{...original.attestation,googleWrites:"PRESENT"}},"V020_OWNER_AND_GOOGLE_READONLY_ATTESTATION_NOT_PASS"],
 [{stable:false},"CANDIDATE_CHANGED_DURING_CHECK"],
 [{targetAbsent:false},"V023_TARGET_ALREADY_PRESENT"]
]){
 const x=assessV023({...original,...patch});
 assert.equal(x.status,"HOLD",reason);
 assert.ok(x.reasons.includes(reason),reason);
 assert.equal(x.release,"HOLD");
}
const snap={candidate:{ready:true},identity:{head:sha,sourceDigest:"f".repeat(64),
 previousCommit:prior,previousDigest:good.previousDigest}};
assert.equal(snapshotEqual(snap,structuredClone(snap)),true);
assert.equal(snapshotEqual(snap,{...snap,identity:{...snap.identity,sourceDigest:"0".repeat(64)}}),false);
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"furusato-v023-plan-"));
try{
 const missing=path.join(temp,"no-stage");
 assert.equal(targetPathAbsent(missing),true);
 fs.mkdirSync(missing);
 assert.equal(targetPathAbsent(missing),false);
}finally{fs.rmSync(temp,{recursive:true,force:true})}
// CI must not request an OAuth token or read owner private materials.
const cli=cp.spawnSync(process.execPath,[
 path.join(__dirname,"..","scripts","plan-v023-isolated-stage.cjs"),
 "--check-readonly"
],{encoding:"utf8",env:{...process.env,CI:"true"},timeout:5000});
assert.equal(cli.status,2);
assert.match(cli.stderr,/V023_READONLY_STAGE_PLAN_HOLD/);
assert.equal(cli.stdout,"");
console.log("V023_PRIVATE_READONLY_PLAN_SYNTHETIC_PASS; no Google or OAuth; release HOLD");
