"use strict";
/**
 * Synthetic offline recovery tests. No real Google requests or credentials,
 * and no file creation outside a disposable OS temp directory.
 */
const assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const crypto=require("node:crypto");
const {classifyState,inspectLocal}=require("../scripts/diagnose-v020-isolated-stage.cjs");
const g=require("../deployment/private-gas.cjs");
const {titlePrefix,listStageSheets,inspectRecordedStage,versionDescription,deploymentDescription}=
 require("../scripts/v020-stage-inventory.cjs");
const hash=x=>crypto.createHash("sha256").update(x).digest("hex");
const journal={
 schema:"furusato-v020-stage/v1",appVersion:"0.1.20",
 sourceCommit:"a".repeat(40),
 sourceDigest:"b".repeat(64),
 oldReceiptDigest:"c".repeat(64),
 oldAuthDigest:"d".repeat(64),
 oldDeploymentId:"OLD_PRIVATE_DEPLOYMENT_SECRET",
 title:"PRIVATE_SYNTHETIC_SECRET_TITLE",
 step:"PREPARED"
};
const aliases={
 spreadsheetId:"NEW_SECRET_SHEET_ID",
 scriptId:"NEW_SECRET_SCRIPT_ID",
 versionNumber:1,
 deploymentId:"NEW_SECRET_DEPLOYMENT_ID"
};
const receipt={
 schema:"furusato-v020-stage/v1",
 appVersion:"v0.1.20",release:"HOLD",
 oldDeployment:"UNMODIFIED_BY_STAGE",
 ...aliases,webAppUrl:"https://script.google.com/macros/s/SECRET_PRIVATE/exec"
};
const safe=text=>{
 for(const value of Object.values(aliases).filter(x=>typeof x==="string").concat([
  journal.oldDeploymentId,journal.title,receipt.webAppUrl,journal.sourceDigest
 ]))assert.ok(!JSON.stringify(text).includes(value),"A private value escaped to diagnostic");
};
function check(record,expected){
 const result=classifyState(record);
 assert.equal(result.status,"HOLD");
 assert.equal(result.remoteCreation,expected);
 assert.equal(result.release,"HOLD");
 safe(result);return result;
}
const absent=check({directory:"ABSENT"},"UNVERIFIED");
assert.equal(absent.stageDirectory,"ABSENT");
assert.equal(absent.sheetRequest,"NOT_RECORDED_LOCALLY");
assert.equal(absent.journalStep,"NO_LOCAL_JOURNAL");
const prepared=check({directory:"PRESENT",journal},"NO_CREATE_REQUEST_IN_JOURNAL");
assert.equal(prepared.journalStep,"PREPARED");
assert.equal(prepared.sheetRequest,"NOT_RECORDED");
const first=check({directory:"PRESENT",journal:{...journal,step:"SHEET_CREATE_REQUESTED"}},"UNKNOWN_OUTCOME_AFTER_REQUEST");
assert.equal(first.sheetRequest,"RECORDED");
assert.equal(first.privateReceipt,"ABSENT");
const sentSheet=check({directory:"PRESENT",journal:{
 ...journal,step:"SHEET_CREATED",spreadsheetId:aliases.spreadsheetId
}},"SOME_RESOURCE_REQUESTS_RECORDED");
assert.equal(sentSheet.scriptRequest,"NOT_RECORDED");
const sheetCheck=classifyState({directory:"PRESENT",journal:{
 ...journal,step:"SHEET_CREATED"
}});
assert.equal(sheetCheck.journal,"INCONSISTENT");
const scriptRequested=check({directory:"PRESENT",journal:{
 ...journal,step:"SCRIPT_CREATE_REQUESTED",spreadsheetId:aliases.spreadsheetId
}},"UNKNOWN_OUTCOME_AFTER_REQUEST");
assert.equal(scriptRequested.scriptRequest,"RECORDED");
const sourceRequested=check({directory:"PRESENT",journal:{
 ...journal,step:"SOURCE_UPLOAD_REQUESTED",spreadsheetId:aliases.spreadsheetId,scriptId:aliases.scriptId
}},"UNKNOWN_OUTCOME_AFTER_REQUEST");
assert.equal(sourceRequested.uploadedVersion,"NOT_RECORDED");
const deployed=check({directory:"PRESENT",journal:{
 ...journal,step:"COMPLETE",...aliases
},receipt},"LOCALLY_RECORDED_COMPLETE_NOT_INDEPENDENTLY_VERIFIED");
assert.equal(deployed.privateReceipt,"STRUCTURE_PASS");
const invalidReceipt=classifyState({directory:"PRESENT",journal:{
 ...journal,step:"COMPLETE",...aliases
},receipt:{...receipt,scriptId:"WRONG_SECRET_SCRIPT"}});
assert.equal(invalidReceipt.privateReceipt,"INCONSISTENT");
safe(invalidReceipt);
const invalidStep=classifyState({directory:"PRESENT",journal:{
 ...journal,step:"OWNER_TAMPERED_STAGE"
}});
assert.equal(invalidStep.journal,"INVALID_OR_UNREADABLE");
safe(invalidStep);
const root=fs.mkdtempSync(path.join(os.tmpdir(),"furusato-stage-recover-test-"));
try {
 const target=path.join(root,"stage");
 const empty=inspectLocal(target);
 assert.equal(empty.stageDirectory,"ABSENT");
 fs.mkdirSync(target);
 const d=path.join(target,"journal.json");
 const write=v=>fs.writeFileSync(d,JSON.stringify(v)+"\n");
 write({...journal,step:"SHEET_CREATE_REQUESTED"});
 const before=hash(fs.readFileSync(d));
 const read=inspectLocal(target);
 assert.equal(read.remoteCreation,"UNKNOWN_OUTCOME_AFTER_REQUEST");
 assert.equal(hash(fs.readFileSync(d)),before,"Read-only diagnostic wrote to journal");
 safe(read);
 fs.writeFileSync(path.join(target,"receipt.json"),JSON.stringify(receipt));
 const withUnexpected=inspectLocal(target);
 assert.equal(withUnexpected.privateReceipt,"INCONSISTENT");
 fs.writeFileSync(path.join(target,"unapproved.txt"),"secret values");
 assert.equal(inspectLocal(target).journal,"UNEXPECTED_PRIVATE_ENTRIES");
 fs.unlinkSync(path.join(target,"unapproved.txt"));
 fs.unlinkSync(path.join(target,"receipt.json"));
 fs.unlinkSync(d);
 if(process.platform==="win32"){
  const junctionTarget=fs.mkdirSync(path.join(root,"junction-target"),{recursive:true});
  fs.symlinkSync(junctionTarget,d,"junction");
 }else fs.symlinkSync(path.join(root,"missing"),d);
 assert.equal(inspectLocal(target).journal,"BLOCKED_LINK");
}finally{fs.rmSync(root,{recursive:true,force:true})}

async function verifyRemoteRecovery(){
 const files=g.source();
 const j={...journal,step:"COMPLETE",...aliases,
  title:titlePrefix+"00000000-0000-0000-0000-000000000001",sourceDigest:g.digest(files)};
 const old={owner:"fixture-owner",email:"fixture@example.invalid",protectedParent:"fixture-protected-parent"};
 const r={spreadsheetId:"fixture-old-sheet",scriptId:"fixture-old-script",protectedScriptId:"fixture-housing-script",
  deploymentId:"fixture-old-deployment",webAppUrl:"https://script.google.com/macros/s/FIXTURE_OLD/exec"};
 const sheet={id:j.spreadsheetId,name:j.title,mimeType:"application/vnd.google-apps.spreadsheet",
  ownedByMe:true,owners:[{permissionId:old.owner}],trashed:false,shared:false,capabilities:{canEdit:true},
  appProperties:{furusatoInstaller:"v1",furusatoStage:"v020-private"}};
 const completedReceipt={...receipt,owner:old.owner,title:j.title,sourceCommit:j.sourceCommit,
  sourceDigest:j.sourceDigest,previousReceiptDigest:j.oldReceiptDigest,previousAuthDigest:j.oldAuthDigest};
 const deployed={deploymentId:j.deploymentId,deploymentConfig:{scriptId:j.scriptId,versionNumber:1,description:deploymentDescription},
  entryPoints:[{entryPointType:"WEB_APP",webApp:{url:receipt.webAppUrl,entryPointConfig:{access:"MYSELF",executeAs:"USER_DEPLOYING"}}}]};
 const head={deploymentConfig:{scriptId:j.scriptId},deploymentId:"HEAD_FIXTURE"};
 const responses={
  "":{scriptId:j.scriptId,parentId:j.spreadsheetId,title:j.title,creator:{email:old.email}},
  "/content":{files},"/content?versionNumber=1":{files},
  "/versions":{versions:[{scriptId:j.scriptId,versionNumber:1,description:versionDescription}]},
  "/deployments":{deployments:[head,deployed]},["/deployments/"+j.deploymentId]:deployed
 };
 const api=async(url,method)=>{
  assert.equal(method,"GET");
  const u=new URL(url);
  if(u.hostname==="www.googleapis.com"){
   assert.equal(u.searchParams.get("corpora"),"user");
   assert.match(u.searchParams.get("q"),/furusatoStage/);
   assert.doesNotMatch(u.searchParams.get("q"),/trashed/);
   return u.searchParams.has("pageToken")?{files:[sheet]}:{files:[],nextPageToken:"SECOND"};
  }
  assert.equal(u.hostname,"script.googleapis.com");
  const key=u.pathname.replace("/v1/projects/"+j.scriptId,"")+u.search;
  assert.ok(Object.hasOwn(responses,key));
  return responses[key];
 };
 const sheets=await listStageSheets(api);
 assert.equal(sheets.length,1);
 const completed=await inspectRecordedStage(api,{sheets,journal:j,receipt:completedReceipt,r,old});
 assert.equal(completed.resume,"OWNER_ACCEPTANCE_READY");
 safe(completed);
 assert.equal((await inspectRecordedStage(api,{sheets,journal:{...j,scriptId:undefined,step:"SCRIPT_CREATE_REQUESTED"},r,old})).resume,
  "UNKNOWN_SCRIPT_ID_REQUIRES_OWNER_RECONCILIATION");
 assert.equal((await inspectRecordedStage(api,{sheets,journal:{...j,deploymentId:undefined,step:"DEPLOYMENT_CREATE_REQUESTED"},r,old})).resume,
  "PRIVATE_DEPLOYMENT_VERIFIED_RECORD_INCOMPLETE");
 await assert.rejects(()=>inspectRecordedStage(api,{sheets:[{...sheet,shared:true}],journal:j,r,old}),/NEW_SHEET_NOT_PRIVATE/);
 await assert.rejects(()=>listStageSheets(async()=>({files:[],incompleteSearch:true})),/STAGE_INVENTORY_INCOMPLETE/);
 await assert.rejects(()=>listStageSheets(async()=>({files:[],nextPageToken:"REPEATED"})),/STAGE_INVENTORY_INCOMPLETE/);
 console.log("V020_RECOVERY_LOCAL_AND_GET_ONLY_SYNTHETIC_PASS; no Google; no auth; release HOLD");
}
verifyRemoteRecovery().catch(error=>{console.error(error.message);process.exitCode=1;});
