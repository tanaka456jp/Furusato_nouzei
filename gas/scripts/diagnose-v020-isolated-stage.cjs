"use strict";
/**
 * Read-only owner-PC diagnosis of an INTERRUPTED new private v0.1.20 stage.
 * Never restarts creation, updates credentials/receipts/snapshots, or prints
 * IDs, paths, token data, titles, hashes or remote API responses.
 *
 * Default: local journal only, NO network/Google calls.
 * --check-prerequisites: only when NO stage directory exists; repeat the
 * original checks step by step with Google GET requests (OAuth refresh only).
 * This is NOT authority to retry the creation command.
 */
const fs=require("node:fs"),path=require("node:path"),cp=require("node:child_process");
const g=require("../deployment/private-gas.cjs");
const policy=require("../deployment/policy.json");
const original=require("./create-v020-isolated-stage.cjs");
const {recordCheck,historicalFiles}=require("./audit-installed-private-version.cjs");
const {liveTrustedBranchTip}=require("./plan-v020-private-stage.cjs");
const {scope,listStageSheets,matchesCandidate,inspectRecordedStage}=require("./v020-stage-inventory.cjs");
const {countTemporaryDocuments}=require("./check-private-ocr-temporary-files.cjs");
const root=path.resolve(__dirname,"..");
const protectedRoot=path.resolve(root,"..","..","HousingERP");
const dir=path.join(root,".private","furusato-v020-stage");
const oldReceipt=path.join(root,".private","furusato","receipt.json");
const allowedSteps=Object.freeze([
 "PREPARED","SHEET_CREATE_REQUESTED","SHEET_CREATED",
 "SCRIPT_CREATE_REQUESTED","SCRIPT_CREATED",
 "SOURCE_UPLOAD_REQUESTED","SOURCE_UPLOADED",
 "VERSION_CREATE_REQUESTED","VERSION_CREATED",
 "DEPLOYMENT_CREATE_REQUESTED","DEPLOYMENT_CREATED","COMPLETE"
]);
const safeCode=new Set([
 "STAGE_ALREADY_EXISTS_DO_NOT_RETRY","STAGE_PATH_NOT_ALLOWED",
 "STAGE_JOURNAL_INVALID","STAGE_RECEIPT_INVALID","PROTECTION_REPORT_INVALID",
 "SHARED_AUTH_UNSAFE","HOUSING_LOCAL_DRIFT",
 "TRUSTED_CANDIDATE_CHECK_FAILED","TRUSTED_REMOTE_READ_FAILED",
 "TRUSTED_REMOTE_TIP_UNVERIFIED","UNTRUSTED_GIT_ORIGIN",
 "OLD_OWNER_NOT_VERIFIED","HOUSING_REMOTE_IDENTITY_FAILED",
 "OLD_PROJECT_IDENTITY_FAILED","PROTECTED_GOOGLE_COLLISION",
 "OLD_SHEET_IDENTITY_FAILED","OLD_DRIVE_AUDIT_HOLD",
 "NEW_PROJECT_IDENTITY_FAILED","PROTECTED_LOCAL_DIFFERS",
 "PRIVATE_FILE_UNSAFE","PRIVATE_PARENT_UNSAFE","RECEIPT_NOT_ATTESTED",
 "APP_VERSION_MISMATCH","FROZEN_SOURCE_DIFFERS","PROJECT_HEAD_DIFFERS",
 "PROTECTED_GOOGLE_DIFFERS","HISTORICAL_SOURCE_DIFFERS",
 "REMOTE_TIP_DIFFERS_FROM_CHECKOUT"
]);
const validHash=x=>typeof x==="string"&&/^[a-f0-9]{64}$/.test(x);
const validId=x=>typeof x==="string"&&x.length>4&&x.length<1024;
function fileState(f){
 try{
  const st=fs.lstatSync(f);
  if(st.isSymbolicLink())return "BLOCKED_LINK";
  if(!st.isFile()||st.size<2||st.size>=1024*1024)return "INVALID";
  return "PRESENT";
 }catch(e){return e?.code==="ENOENT"?"ABSENT":"UNREADABLE";}
}
function readPrivateJson(f){
 if(fileState(f)!=="PRESENT")throw Error("PRIVATE_FILE_UNSAFE");
 const value=JSON.parse(fs.readFileSync(f,"utf8").replace(/^\uFEFF/,""));
 if(!value||typeof value!=="object"||Array.isArray(value))
  throw Error("PRIVATE_FILE_UNSAFE");
 return value;
}
function classifyState({directory,journal,receipt}){
 const base={
  status:"HOLD",kind:"V020_STAGE_RECOVERY_READONLY",
  stageDirectory:directory,
  journal:"NOT_VERIFIED",journalStep:"NOT_VERIFIED",
  sheetRequest:"NOT_VERIFIED",scriptRequest:"NOT_VERIFIED",
  uploadedVersion:"NOT_VERIFIED",deploymentRequest:"NOT_VERIFIED",
  privateReceipt:"NOT_VERIFIED",remoteCreation:"UNVERIFIED",
  allowedAction:"READONLY_INVESTIGATION_ONLY",release:"HOLD"
 };
 if(directory==="ABSENT"){
  return {...base,journal:"ABSENT",privateReceipt:"ABSENT",
   stageDirectory:"ABSENT",journalStep:"NO_LOCAL_JOURNAL",
   sheetRequest:"NOT_RECORDED_LOCALLY",scriptRequest:"NOT_RECORDED_LOCALLY",
   uploadedVersion:"NOT_RECORDED_LOCALLY",deploymentRequest:"NOT_RECORDED_LOCALLY"};
 }
 if(directory!=="PRESENT")return base;
 if(!journal||journal.schema!=="furusato-v020-stage/v1"||
  journal.appVersion!=="0.1.20"||
  !allowedSteps.includes(journal.step)||
  !validHash(journal.oldReceiptDigest)||!validHash(journal.oldAuthDigest)||
  !validHash(journal.sourceDigest)||
  typeof journal.oldDeploymentId!=="string"||
  !journal.oldDeploymentId)return {...base,journal:"INVALID_OR_UNREADABLE"};
 const i=allowedSteps.indexOf(journal.step);
 const stepIndex=s=>allowedSteps.indexOf(s);
 const atLeast=s=>i>=stepIndex(s);
 const state={
  ...base,journal:"STRUCTURE_PASS",journalStep:journal.step,
  sheetRequest:atLeast("SHEET_CREATE_REQUESTED")?"RECORDED":"NOT_RECORDED",
  scriptRequest:atLeast("SCRIPT_CREATE_REQUESTED")?"RECORDED":"NOT_RECORDED",
  uploadedVersion:atLeast("VERSION_CREATED")?"RECORDED":"NOT_RECORDED",
  deploymentRequest:atLeast("DEPLOYMENT_CREATE_REQUESTED")?"RECORDED":"NOT_RECORDED",
  privateReceipt:receipt?"PRESENT_UNVERIFIED":"ABSENT"
 };
 const checks=[
  ["SHEET_CREATED",journal.spreadsheetId],
  ["SCRIPT_CREATED",journal.scriptId],
  ["VERSION_CREATED",journal.versionNumber],
  ["DEPLOYMENT_CREATED",journal.deploymentId]
 ];
 for(const [step,value] of checks){
  if(!atLeast(step))continue;
  if(step==="VERSION_CREATED"?( !Number.isSafeInteger(value)||value<1 ):!validId(value))
   return {...state,journal:"INCONSISTENT",remoteCreation:"UNVERIFIED"};
 }
 if(receipt){
  const ok=receipt.schema==="furusato-v020-stage/v1"&&
   receipt.appVersion==="v0.1.20"&&receipt.release==="HOLD"&&
   receipt.oldDeployment==="UNMODIFIED_BY_STAGE"&&
   receipt.deploymentId===journal.deploymentId&&
   receipt.scriptId===journal.scriptId&&
   receipt.spreadsheetId===journal.spreadsheetId&&
   receipt.versionNumber===journal.versionNumber;
  state.privateReceipt=ok?"STRUCTURE_PASS":"INCONSISTENT";
 }
 if(i===0){
  state.remoteCreation="NO_CREATE_REQUEST_IN_JOURNAL";
 }else if(journal.step.endsWith("_REQUESTED")){
  state.remoteCreation="UNKNOWN_OUTCOME_AFTER_REQUEST";
 }else if(journal.step==="COMPLETE"&&state.privateReceipt==="STRUCTURE_PASS"){
  state.remoteCreation="LOCALLY_RECORDED_COMPLETE_NOT_INDEPENDENTLY_VERIFIED";
 }else{
  state.remoteCreation="SOME_RESOURCE_REQUESTS_RECORDED";
 }
 return state;
}
function inspectLocal(d=dir){
 const parent=path.dirname(d);
 const ps=fs.lstatSync(parent);
 if(!ps.isDirectory()||ps.isSymbolicLink())throw Error("PRIVATE_PARENT_UNSAFE");
 let directory="ABSENT";
 try{
  const st=fs.lstatSync(d);
  directory=st.isSymbolicLink()?"BLOCKED_LINK":st.isDirectory()?"PRESENT":"INVALID";
 }catch(e){if(e.code!=="ENOENT")directory="UNREADABLE";}
 if(directory!=="PRESENT")return classifyState({directory});
 const children=fs.readdirSync(d);
 if(children.some(name=>!["journal.json","receipt.json",".journal.tmp","evidence"].includes(name)))
  return {...classifyState({directory}),journal:"UNEXPECTED_PRIVATE_ENTRIES"};
 if(children.includes("evidence")){
  const st=fs.lstatSync(path.join(d,"evidence"));
  if(!st.isDirectory()||st.isSymbolicLink())return {...classifyState({directory}),journal:"UNEXPECTED_PRIVATE_ENTRIES"};
 }
 const journalStatus=fileState(path.join(d,"journal.json"));
 if(journalStatus!=="PRESENT")
  return {...classifyState({directory}),journal:journalStatus};
 let j,receipt=null;
 try{j=readPrivateJson(path.join(d,"journal.json"));}
 catch{return {...classifyState({directory}),journal:"INVALID_OR_UNREADABLE"};}
 const receiptStatus=fileState(path.join(d,"receipt.json"));
 if(receiptStatus==="PRESENT"){
  try{receipt=readPrivateJson(path.join(d,"receipt.json"));}
  catch{return {...classifyState({directory}),journal:"STRUCTURE_UNVERIFIED",privateReceipt:"INVALID_OR_UNREADABLE"};}
 }else if(receiptStatus!=="ABSENT")
  return {...classifyState({directory}),journal:"STRUCTURE_UNVERIFIED",privateReceipt:receiptStatus};
 return classifyState({directory,journal:j,receipt});
}
async function checkPrerequisites({reconcile=false}={}){
 const local=inspectLocal();
 if(local.stageDirectory!=="ABSENT"&&(!reconcile||local.journal!=="STRUCTURE_PASS"||
    !["STRUCTURE_PASS","ABSENT"].includes(local.privateReceipt)))return local;
 const recorded=local.stageDirectory==="PRESENT";
 let phase="LOCAL_PATHS";
 let drive;
 const fail=e=>({
  ...local,preflight:"HOLD",failedAt:phase,
  reason:safeCode.has(e?.message)?e.message:original.failureCode(e),
  ...(reconcile&&drive?{drive}:{}),
  existingStage:"NOT_RECREATED"
 });
 try {
  original.verifyPaths({allowRecordedStage:recorded});
  phase="LOCAL_GAS_MANIFEST";
  g.preflight();
  phase="OLD_RECEIPT";
  const r=readPrivateJson(oldReceipt);
  recordCheck(r);
  phase="GIT_AND_SOURCE";
  let candidate,journal,receipt;
  if(recorded){
   journal=readPrivateJson(path.join(dir,"journal.json"));
   if(local.privateReceipt==="STRUCTURE_PASS")receipt=readPrivateJson(path.join(dir,"receipt.json"));
   if(journal.step!==local.journalStep||!matchesCandidate(historicalFiles(journal.sourceCommit),journal.sourceDigest))
    throw Error("STAGE_JOURNAL_INVALID");
   cp.execFileSync("git",["merge-base","--is-ancestor",journal.sourceCommit,liveTrustedBranchTip()],{
    cwd:root,stdio:"pipe",timeout:12000
   });
  }else candidate=original.currentCandidate();
  phase="PROTECTED_LOCAL_CONFIG";
  const drift=g.configDriftReport(r,protectedRoot);
  original.localGate(r,drift,{status:"CANDIDATE_SOURCE_READY"});
  phase="LOCAL_FINGERPRINT";
  const before=original.snapshotReadOnly();
  if(recorded&&(journal.oldReceiptDigest!==before.oldReceipt||journal.oldAuthDigest!==before.oldAuth||
     journal.oldDeploymentId!==r.deploymentId))throw Error("STAGE_JOURNAL_INVALID");
  phase="DEDICATED_OAUTH";
  const api=g.googleApi(await g.accessToken());
  phase="OLD_REMOTE_IMMUTABLE_VERSION";
  const old=await original.auditOldLive(api,r);
  phase="TEMPORARY_OCR_DRIVE";
  drive=await countTemporaryDocuments(api);
  if(drive.status!=="PASS"||drive.temporaryOcrFiles!==0||
   drive.coverage!=="FURUSATO_DEDICATED_OAUTH_SCOPE_ONLY")
   throw Error("OLD_DRIVE_AUDIT_HOLD");
  let remote;
  if(reconcile){
   phase="STAGE_INVENTORY";
   const sheets=await listStageSheets(api);
   phase="RECORDED_STAGE_ATTESTATION";
   const proof=recorded?await inspectRecordedStage(api,{sheets,journal,receipt,r,old}):{
    resume:sheets.length===0?"NO_STAGE_SHEET_VISIBLE":"VISIBLE_STAGE_WITHOUT_TRUSTED_JOURNAL"
   };
   remote={stageSheetCount:sheets.length,inventoryScope:scope,...proof};
  }
  phase="OLD_LOCAL_FILES_RECHECK";
  original.unchangedAll(before);
  phase="GIT_AND_JOURNAL_RECHECK";
  if(recorded){
   if(JSON.stringify(journal)!==JSON.stringify(readPrivateJson(path.join(dir,"journal.json")))||
      (receipt&&JSON.stringify(receipt)!==JSON.stringify(readPrivateJson(path.join(dir,"receipt.json")))))
    throw Error("STAGE_JOURNAL_INVALID");
  }else{
   const repeat=original.currentCandidate();
   if(repeat.sha!==candidate.sha||repeat.digest!==candidate.digest||inspectLocal().stageDirectory!=="ABSENT")
    throw Error("TRUSTED_CANDIDATE_CHECK_FAILED");
  }
  return {...local,preflight:"PASS_READONLY",failedAt:"NONE",
   ...(remote?{remote,drive}:{}),
   existingStage:"NOT_RECREATED",authorization:"NO_CREATION_FROM_DIAGNOSTIC",
   oldVersion:"v0.1.17",candidateVersion:"v0.1.20"};
 }catch(e){return fail(e);}
}
async function main(){
 const mode=process.argv[2]||"--local";
 if(process.env.CI||!["--local","--check-prerequisites","--check-remote"].includes(mode)||
  process.argv.length>3)throw Error("OWNER_ONLY_READONLY");
 const report=mode==="--local"?inspectLocal():await checkPrerequisites({reconcile:mode==="--check-remote"});
 console.log(JSON.stringify(report));
 // A diagnostic never establishes real v0.1.20 acceptance / release.
 if(report.preflight!=="PASS_READONLY"||(mode==="--check-remote"&&
    !["NO_STAGE_SHEET_VISIBLE","OWNER_ACCEPTANCE_READY"].includes(report.remote?.resume)))process.exitCode=2;
}
module.exports={classifyState,inspectLocal,checkPrerequisites};
if(require.main===module)main().catch(()=>{
 console.error("V020_RECOVERY_DIAGNOSTIC_HOLD: PRIVATE_LOCAL_STATE_NOT_READABLE");
 process.exitCode=2;
});
