"use strict";
/**
 * Read-only planning for a NEW, separately approved v0.1.23 synthetic GAS.
 * NEVER modify or re-use the accepted v0.1.20 / v0.1.17 deployments.
 * This module has no Google resource write path or installer entrypoint.
 *
 * Owner PC invocation:
 *   node gas/scripts/plan-v023-isolated-stage.cjs --check-readonly
 *
 * The only external side effects are a trusted git ls-remote, OAuth token
 * acquisition for read-only checks, and Google GETs from the existing v0.1.20
 * recovery diagnosis. No credentials, IDs, hashes or private URLs are emitted.
 */
const fs=require("node:fs"),path=require("node:path"),cp=require("node:child_process");
const root=path.resolve(__dirname,"..");
const g=require("../deployment/private-gas.cjs");
const policy=require("../deployment/policy.json");
const {exactFiles,appVersion}=require("./audit-installed-private-version.cjs");
const {committedSources,liveTrustedBranchTip}=require("./plan-v020-private-stage.cjs");
const owner=require("./audit-owner-ocr-evidence.cjs");
const {fingerprintEvidence,evaluate}=require("./attest-v020-owner-acceptance.cjs");
const {checkPrerequisites}=require("./diagnose-v020-isolated-stage.cjs");
const targetDir=path.join(root,".private","furusato-v023-stage");
const branch="feature/gas-workflow-20261106";
const acceptedOrigins=new Set([
 "https://github.com/tanaka456jp/Furusato_nouzei.git",
 "https://github.com/tanaka456jp/Furusato_nouzei",
 "git@github.com:tanaka456jp/Furusato_nouzei.git"
]);
const isSha=x=>typeof x==="string"&&/^[a-f0-9]{40}$/.test(x);
const isDigest=x=>typeof x==="string"&&/^[a-f0-9]{64}$/.test(x);
function git(args){
 return cp.execFileSync("git",args,{cwd:root,encoding:"utf8",
  stdio:["ignore","pipe","pipe"],timeout:30000,maxBuffer:4*1024*1024}).trim();
}
function targetPathAbsent(dir=targetDir){
 try{fs.lstatSync(dir);return false;}
 catch(e){if(e?.code==="ENOENT")return true;throw e;}
}
function assessV023({candidate,attestation,stable=true,targetAbsent=true}={}){
 const reasons=[];
 const fail=(reason,condition)=>{if(condition)reasons.push(reason);};
 fail("CANDIDATE_SOURCE_NOT_VERIFIED",candidate?.ready!==true);
 fail("V020_OWNER_AND_GOOGLE_READONLY_ATTESTATION_NOT_PASS",
  attestation?.status!=="LIMITED_V020_OWNER_EVIDENCE_AND_GOOGLE_GET_PASS"||
  attestation?.version!=="v0.1.20"||attestation?.release!=="HOLD"||
  attestation?.googleWrites!=="NONE_FROM_THIS_GATE");
 fail("CANDIDATE_CHANGED_DURING_CHECK",stable!==true);
 fail("V023_TARGET_ALREADY_PRESENT",targetAbsent!==true);
 return {
  schema:"furusato-v023-private-stage-plan/v1",
  status:reasons.length?"HOLD":"READY_FOR_SEPARATE_V023_STAGE_APPROVAL",
  reasons,
  candidate:"v0.1.23",
  verifiedSourceFiles:candidate?.ready?5:0,
  oldV020:attestation?.status==="LIMITED_V020_OWNER_EVIDENCE_AND_GOOGLE_GET_PASS"?
   "READONLY_ATTESTED":"UNVERIFIED",
  v023RemoteExists:"NOT_CHECKED",
  v023ActualOCR:"NOT_TESTED",
  v023IphoneSafari:"NOT_TESTED",
  proposedTarget:"NEW_ISOLATED_PRIVATE_SYNTHETIC_PROJECT_ONLY",
  existingDeployments:"MUST_NOT_MODIFY",
  protectedGoogleResources:"MUST_NOT_MODIFY",
  ownerAuthorization:"SEPARATE_EXPLICIT_APPROVAL_REQUIRED_FOR_ANY_GOOGLE_WRITE",
  googleWrites:"NONE_FROM_THIS_PLAN",
  release:"HOLD",pr:"DRAFT"
 };
}
function assessCandidate({workingFiles,committedFiles,packageVersion,head,
 remoteHead,origin,localBranch,trackedChanges,previousDigest,previousCommit,
 stageAbsent}={}){
 const ready=exactFiles(workingFiles)&&exactFiles(committedFiles)&&
  appVersion(workingFiles)==="0.1.23"&&appVersion(committedFiles)==="0.1.23"&&
  packageVersion==="0.1.23"&&
  g.digest(workingFiles)===g.digest(committedFiles)&&
  isDigest(previousDigest)&&previousDigest!==g.digest(workingFiles)&&
  isSha(previousCommit)&&isSha(head)&&isSha(remoteHead)&&head===remoteHead&&
  acceptedOrigins.has(origin)&&
  (localBranch===branch||localBranch==="")&&
  trackedChanges===""&&stageAbsent===true&&policy.release==="HOLD";
 return {ready};
}
function getCandidate(){
 g.preflight();
 const committed=committedSources(),workingFiles=g.source();
 const packageVersion=JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8")).version;
 const receiptFile=path.join(root,".private","furusato-v020-stage","receipt.json");
 g.rejectLinks([path.join(root,".private"),
  path.dirname(receiptFile),receiptFile,targetDir]);
 const receiptStat=fs.lstatSync(receiptFile);
 if(!receiptStat.isFile()||receiptStat.isSymbolicLink()||
    receiptStat.size<3||receiptStat.size>1024*1024)
  throw Error("V020_RECEIPT_NOT_TRUSTED");
 const r=JSON.parse(fs.readFileSync(receiptFile,"utf8"));
 if(r.schema!=="furusato-v020-stage/v1"||r.appVersion!=="v0.1.20"||
    r.release!=="HOLD"||!isDigest(r.sourceDigest)||!isSha(r.sourceCommit))
  throw Error("V020_RECEIPT_NOT_TRUSTED");
 const origin=git(["remote","get-url","origin"]);
 if(!acceptedOrigins.has(origin))throw Error("UNTRUSTED_GIT_ORIGIN");
 const remoteHead=liveTrustedBranchTip();
 const head=committed.head;
 const changes=git(["status","--porcelain","--untracked-files=no"]);
 const localBranch=git(["branch","--show-current"]);
 const absent=targetPathAbsent();
 // This rejects detached checkouts except those exactly equal to the
 // trusted remote head, and rejects uncommitted tracked modifications.
 const candidate=assessCandidate({
  workingFiles,committedFiles:committed.files,packageVersion,
  head,remoteHead,origin,localBranch,trackedChanges:changes,
  previousDigest:r.sourceDigest,previousCommit:r.sourceCommit,stageAbsent:absent
 });
 return {candidate,identity:{head,sourceDigest:g.digest(workingFiles),
  previousCommit:r.sourceCommit,previousDigest:r.sourceDigest},
  targetAbsent:absent};
}
function snapshotEqual(before,after){
 return before.candidate.ready&&after.candidate.ready&&
  before.identity.head===after.identity.head&&
  before.identity.sourceDigest===after.identity.sourceDigest&&
  before.identity.previousCommit===after.identity.previousCommit&&
  before.identity.previousDigest===after.identity.previousDigest;
}
async function main(){
 if(process.env.CI||process.platform!=="win32"||
    process.argv.length!==3||process.argv[2]!=="--check-readonly")
  throw Error("OWNER_WINDOWS_READONLY_ONLY");
 const before=getCandidate();
 if(!before.candidate.ready){
  console.log(JSON.stringify(assessV023({
   candidate:before.candidate,attestation:null,targetAbsent:before.targetAbsent
  })));
  process.exitCode=2;return;
 }
 const ownerBefore=owner.readStageContext();
 const evidenceBefore=fingerprintEvidence(owner.stageEvidenceDir);
 const data=owner.loadRecords(owner.stageEvidenceDir);
 const summary=owner.summarizeRecords(data.records,data.rejected,ownerBefore);
 // The recovery tool verifies old v0.1.17 and current v0.1.20 private
 // immutable deployments, owner, source, and dedicated OAuth Drive scope.
 const remote=await checkPrerequisites({reconcile:true});
 const ownerAfter=owner.readStageContext();
 const evidenceAfter=fingerprintEvidence(owner.stageEvidenceDir);
 const accepted=evaluate({
  owner:summary,remote,
  receiptUnchanged:ownerBefore.receiptFingerprint===ownerAfter.receiptFingerprint&&
   ownerBefore.sourceCommit===ownerAfter.sourceCommit,
  evidenceUnchanged:evidenceBefore===evidenceAfter
 });
 const after=getCandidate();
 const result=assessV023({
  candidate:after.candidate,
  attestation:accepted,
  stable:snapshotEqual(before,after),
  targetAbsent:before.targetAbsent&&after.targetAbsent
 });
 console.log(JSON.stringify(result));
 if(result.status!=="READY_FOR_SEPARATE_V023_STAGE_APPROVAL")
  process.exitCode=2;
}
module.exports={assessV023,assessCandidate,snapshotEqual,targetPathAbsent};
if(require.main===module)main().catch(()=>{
 console.error("V023_READONLY_STAGE_PLAN_HOLD: LOCAL_OR_GOOGLE_ATTESTATION_UNVERIFIED; RELEASE=HOLD");
 process.exitCode=2;
});
