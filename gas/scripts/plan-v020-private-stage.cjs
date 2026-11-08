"use strict";
/**
 * Preflight ONLY. v0.1.20 must be tested in a SEPARATE synthetic deployment.
 * Never changes the previously accepted v0.1.17 GAS, local receipt, auth,
 * deployment, Google project, HousingERP or any source files.
 *
 * Permitted external requests: OAuth access token refresh and GET-only
 * Apps Script / Drive API verification of the existing private resources.
 */
const fs=require("node:fs");
const path=require("node:path");
const cp=require("node:child_process");
const google=require("../deployment/private-gas.cjs");
const policy=require("../deployment/policy.json");
const {
 exactFiles,appVersion,recordCheck,historicalFiles,perform
}=require("./audit-installed-private-version.cjs");
const {countTemporaryDocuments}=require("./check-private-ocr-temporary-files.cjs");
const root=path.resolve(__dirname,"..");
const privateRoot=path.join(root,".private","furusato");
const originalReceipt=path.join(privateRoot,"receipt.json");
const targetVersion="0.1.20";
const expectedBranch="feature/gas-workflow-20261106";
const remotes=new Set([
 "https://github.com/tanaka456jp/Furusato_nouzei.git",
 "https://github.com/tanaka456jp/Furusato_nouzei",
 "git@github.com:tanaka456jp/Furusato_nouzei.git"
]);
function git(args,trim=true){
 const output=cp.execFileSync("git",args,{cwd:root,encoding:"utf8",
  stdio:["ignore","pipe","pipe"],timeout:12000,maxBuffer:8*1024*1024});
 return trim?output.trim():output;
}
function checkCandidate({files,committed,packageVersion,branch,origin,dirty,currentHead,expectedHead}) {
 const issues=[];
 const fail=(code,condition)=>{if(condition)issues.push(code);};
 fail("INVALID_GIT_HEAD",!(/^[a-f0-9]{40}$/).test(currentHead||""));
 fail("GIT_HEAD_CHANGED_DURING_PROBE",!!expectedHead&&expectedHead!==currentHead);
 fail("UNTRUSTED_GIT_ORIGIN",!remotes.has(origin));
 fail("WRONG_DEVELOPMENT_BRANCH",branch!==expectedBranch);
 fail("TRACKED_WORKTREE_DIRTY",!!dirty);
 fail("CANDIDATE_SOURCE_SET_INVALID",!exactFiles(files)||!exactFiles(committed));
 fail("CANDIDATE_VERSION_INVALID",packageVersion!==targetVersion||
  appVersion(files)!==targetVersion||appVersion(committed)!==targetVersion);
 if(exactFiles(files)&&exactFiles(committed))
  fail("WORKTREE_SOURCE_DIFFERS_FROM_COMMIT",google.digest(files)!==google.digest(committed));
 return {status:issues.length?"HOLD":"CANDIDATE_SOURCE_READY",
  reasons:issues,appVersion:issues.length?null:"v"+targetVersion};
}
function assess({candidate,old,drive,oldDigest,newDigest}){
 // A failed local check must NEVER masquerade as remote Google/Drive failure.
 // In this case the API has not been contacted, and the candidate's allowlisted
 // reason codes are the only verified failures.
 const candidateReady=candidate?.status==="CANDIDATE_SOURCE_READY";
 const issues=[];
 if(!candidateReady)issues.push("CANDIDATE_NOT_READY");
 else {
  if(old?.status!=="PASS"||old.appVersion!=="v0.1.17"||
     old.ownerAndPrivateAccess!=="PASS"||
     old.protectedLocal!=="UNCHANGED"||
     old.protectedGoogle!=="UNCHANGED")
    issues.push("OLD_PRIVATE_RELEASE_NOT_VERIFIED");
  if(!drive)
    issues.push("OLD_DRIVE_AUDIT_NOT_RUN");
  else if(drive.status!=="PASS"||drive.temporaryOcrFiles!==0||
          drive.coverage!=="FURUSATO_DEDICATED_OAUTH_SCOPE_ONLY")
    issues.push("OLD_DRIVE_TEMP_NOT_ZERO");
  if(oldDigest===undefined||newDigest===undefined)
    issues.push("SOURCE_COMPARISON_NOT_RUN");
  else if(typeof oldDigest!=="string"||typeof newDigest!=="string"||
     !/^[a-f0-9]{64}$/.test(oldDigest)||!/^[a-f0-9]{64}$/.test(newDigest)||
     oldDigest===newDigest)
    issues.push("CANDIDATE_SOURCE_NOT_DISTINCT");
 }
 return {
  status:issues.length?"HOLD":"READY_FOR_SEPARATE_STAGE_APPROVAL",
  stagePreflightRevision:2,
  stage:!candidateReady?"LOCAL_CANDIDATE":issues.length?"REMOTE_READONLY_ATTESTATION":"APPROVAL_GATE",
  problems:issues,
  candidateChecks:!candidateReady&&Array.isArray(candidate?.reasons)?candidate.reasons:[],
  oldPrivateAudit:!candidateReady?"NOT_RUN":old?.status==="PASS"?"PASS":"HOLD",
  driveAudit:!candidateReady?"NOT_RUN":drive?.status==="PASS"?"PASS":drive?"HOLD":"NOT_RUN",
  sourceComparison:!candidateReady?"NOT_RUN":oldDigest===undefined||newDigest===undefined?"NOT_RUN":
    oldDigest===newDigest?"SAME":"DISTINCT_OR_INVALID",
  existingApp:"v0.1.17",
  candidateApp:"v0.1.20",
  existingDeployment:"NOT_MODIFIED_BY_THIS_CHECK",
  candidateDeployment:"NOT_CREATED",
  proposedTarget:"NEW_ISOLATED_SYNTHETIC_PROJECT_ONLY",
  authorization:"OWNER_EXPLICIT_APPROVAL_REQUIRED_BEFORE_ANY_GOOGLE_WRITE",
  legacyOcrEvidence:"OWNER_ATTESTED_NOT_INDEPENDENTLY_REMEASURED",
  realV020GoogleAcceptance:"NOT_TESTED",
  release:"HOLD"
 };
}
function committedSources(){
 const head=git(["rev-parse","HEAD"]);
 const current=policy.sourceFiles.map(filename=>{
  const source=git(["show",head+":gas/"+filename],false);
  return {name:filename.replace(/\.(gs|html|json)$/,""),
   type:filename.endsWith(".gs")?"SERVER_JS":filename.endsWith(".html")?"HTML":"JSON",source};
 });
 return {head,files:current};
}
function readReceipt(){
 for(const item of [path.join(root,".private"),privateRoot,originalReceipt]){
  const st=fs.lstatSync(item);
  if(st.isSymbolicLink())throw Error("UNSAFE_PRIVATE_PATH");
  if(item===originalReceipt){
   if(!st.isFile()||st.size<2||st.size>1024*1024)throw Error("UNSAFE_RECEIPT");
  }else if(!st.isDirectory())throw Error("UNSAFE_PRIVATE_PATH");
 }
 const r=JSON.parse(fs.readFileSync(originalReceipt,"utf8"));
 recordCheck(r);
 return r;
}
async function main(){
 if(process.env.CI||process.argv.length!==2)throw Error("OWNER_LOCAL_PRECHECK_ONLY");
 google.preflight();
 const pkg=JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8"));
 const candidateFiles=google.source(),committed=committedSources();
 const candidate=checkCandidate({
  files:candidateFiles,committed:committed.files,packageVersion:pkg.version,
  currentHead:committed.head,branch:git(["branch","--show-current"]),
  origin:git(["remote","get-url","origin"]),
  dirty:git(["status","--porcelain","--untracked-files=no"])
 });
 if(candidate.status!=="CANDIDATE_SOURCE_READY"){
  console.log(JSON.stringify(assess({candidate})));process.exitCode=2;return;
 }
 const receipt=readReceipt();
 const protectedRoot=path.resolve(root,"..","..","HousingERP");
 if(google.configDriftReport(receipt,protectedRoot).status!=="MATCH")
  throw Error("PROTECTED_CONFIG_DRIFT");
 const historical=historicalFiles(receipt.sourceCommit);
 const api=google.googleApi(await google.accessToken());
 const old=await perform(api,receipt,protectedRoot,historical);
 const drive=await countTemporaryDocuments(api);
 const afterCommitted=committedSources();
 const after=checkCandidate({
  files:google.source(),committed:afterCommitted.files,packageVersion:pkg.version,
  currentHead:afterCommitted.head,expectedHead:committed.head,branch:git(["branch","--show-current"]),
  origin:git(["remote","get-url","origin"]),
  dirty:git(["status","--porcelain","--untracked-files=no"])
 });
 google.unchanged(receipt.protectedSnapshot);
 const report=assess({candidate:after,old,drive,
  oldDigest:receipt.uploadDigest,newDigest:google.digest(google.source())});
 console.log(JSON.stringify(report));
 if(report.status!=="READY_FOR_SEPARATE_STAGE_APPROVAL")process.exitCode=2;
}
module.exports={checkCandidate,assess,committedSources};
if(require.main===module)main().catch(()=>{
 console.error("V020_PRIVATE_STAGE_PREFLIGHT_HOLD: LOCAL_OR_GOOGLE_ATTESTATION_UNVERIFIED");
 process.exitCode=2;
});
