"use strict";
/**
 * One-shot, separately authorized v0.1.20 private synthetic acceptance stage.
 * Only creates NEW Google Sheet, NEW bound GAS, NEW immutable version and
 * NEW owner-only deployment. NEVER updates an existing Google resource.
 * Existing v0.1.17, HousingERP and shared credentials remain read-only.
 * No operation is performed merely by loading this module or by CI.
 */
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),crypto=require("node:crypto");
const g=require("../deployment/private-gas.cjs");
const policy=require("../deployment/policy.json");
const {recordCheck,historicalFiles,auditVersion,protectedDigest,appVersion,exactFiles}=
 require("./audit-installed-private-version.cjs");
const {liveTrustedBranchTip,committedSources,checkCandidate}=
 require("./plan-v020-private-stage.cjs");
const {countTemporaryDocuments}=require("./check-private-ocr-temporary-files.cjs");
const root=path.resolve(__dirname,"..");
const oldDir=path.join(root,".private","furusato");
const stageDir=path.join(root,".private","furusato-v020-stage");
const protectedRoot=path.resolve(root,"..","..","HousingERP");
const oldReceiptFile=path.join(oldDir,"receipt.json");
const oldAuthFile=path.join(oldDir,"auth.json");
const oldClaspFile=path.join(oldDir,"project",".clasp.json");
const stageMarker="FURUSATO_V020_NEW_PRIVATE_SYNTHETIC_ONLY";
const hash=x=>crypto.createHash("sha256").update(x).digest("hex");
function must(x,code){if(!x)throw Error(code);}
function readPrivate(file){
 const st=fs.lstatSync(file);
 must(st.isFile()&&!st.isSymbolicLink()&&st.size>2&&st.size<1048576,"PRIVATE_FILE_UNSAFE");
 return fs.readFileSync(file);
}
function jsonPrivate(file){return JSON.parse(readPrivate(file).toString("utf8").replace(/^\uFEFF/,""));}
function exists(file){try{fs.lstatSync(file);return true;}catch(e){if(e.code==="ENOENT")return false;throw e;}}
function verifyPaths(){
 for(const p of [root,path.join(root,".private"),oldDir,path.join(oldDir,"project")]){
  const st=fs.lstatSync(p);
  must(st.isDirectory()&&!st.isSymbolicLink(),"PRIVATE_PARENT_UNSAFE");
 }
 for(const p of [oldReceiptFile,oldAuthFile,oldClaspFile]){
  readPrivate(p);
 }
 must(!exists(stageDir),"STAGE_ALREADY_EXISTS_DO_NOT_RETRY");
}
function snapshotReadOnly(){
 return {
  oldReceipt:hash(readPrivate(oldReceiptFile)),
  oldAuth:hash(readPrivate(oldAuthFile)),
  oldClasp:hash(readPrivate(oldClaspFile)),
  protected:g.snapshot(protectedRoot)
 };
}
function unchangedAll(before){
 must(hash(readPrivate(oldReceiptFile))===before.oldReceipt,"OLD_RECEIPT_CHANGED");
 must(hash(readPrivate(oldAuthFile))===before.oldAuth,"OLD_AUTH_CHANGED");
 must(hash(readPrivate(oldClaspFile))===before.oldClasp,"OLD_PROJECT_CONFIG_CHANGED");
 g.unchanged(before.protected);
}
function localGate(r,drift,candidate){
 recordCheck(r);
 must(candidate?.status==="CANDIDATE_SOURCE_READY","CANDIDATE_NOT_READY");
 must(drift?.checks?.length===4&&drift.checks[0].name==="housing-clasp"&&
  drift.checks[1].name==="housing-appsscript"&&
  drift.checks[2].name==="housing-project"&&
  drift.checks[3].name==="global-clasp-auth","PROTECTION_REPORT_INVALID");
 must(drift.checks.slice(0,3).every(x=>x.state==="UNCHANGED"),"HOUSING_LOCAL_DRIFT");
 // This is a DIFFERENT stage gate, not an override of the legacy receipt.
 // The previously reported shared global-auth drift is never accepted as
 // historical identity proof. Instead use the old isolated auth, verify the
 // real dedicated owner and old project, and fingerprint the shared file now.
 must(["CHANGED","UNCHANGED"].includes(drift.checks[3].state),
  "SHARED_AUTH_UNSAFE");
 return {status:"PASS",historicGlobalAuth:"UNVERIFIED",
  oldSnapshot:"NOT_REWRITTEN",release:"HOLD"};
}
function currentCandidate(){
 const commit=committedSources();
 const candidate=checkCandidate({
  files:g.source(),committed:commit.files,
  packageVersion:require("../package.json").version,
  currentHead:commit.head,expectedHead:commit.head,
  remoteHead:liveTrustedBranchTip(),
  branch:require("node:child_process").execFileSync("git",["branch","--show-current"],
   {cwd:root,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim(),
  origin:require("node:child_process").execFileSync("git",["remote","get-url","origin"],
   {cwd:root,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim(),
  dirty:require("node:child_process").execFileSync("git",
   ["status","--porcelain","--untracked-files=no"],
   {cwd:root,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim()
 });
 must(candidate.status==="CANDIDATE_SOURCE_READY"&&
  appVersion(g.source())==="0.1.20"&&exactFiles(g.source()),
  "TRUSTED_CANDIDATE_CHECK_FAILED");
 return {sha:commit.head,digest:g.digest(g.source())};
}
function url(id){return "https://script.googleapis.com/v1/projects/"+encodeURIComponent(id);}
async function auditOldLive(api,r){
 recordCheck(r);
 const oldBase=url(r.scriptId);
 const [user,project,sheet,protectedProject,frozen,head,deployment,protectedHash]=
 await Promise.all([
  api("https://www.googleapis.com/drive/v3/about?fields=user(permissionId,emailAddress)"),
  api(oldBase),
  api("https://www.googleapis.com/drive/v3/files/"+encodeURIComponent(r.spreadsheetId)+
   "?fields=id,name,mimeType,ownedByMe,owners(permissionId),trashed,shared,capabilities(canEdit),appProperties"),
  api(url(r.protectedScriptId)),
  api(oldBase+"/content?versionNumber="+r.versionNumber),
  api(oldBase+"/content"),
  api(oldBase+"/deployments/"+encodeURIComponent(r.deploymentId)),
  protectedDigest(api,r.protectedScriptId)
 ]);
 must(user?.user?.permissionId===r.owner&&user.user.emailAddress,
  "OLD_OWNER_NOT_VERIFIED");
 must(protectedProject.scriptId===r.protectedScriptId&&protectedProject.parentId,
  "HOUSING_REMOTE_IDENTITY_FAILED");
 must(project.scriptId===r.scriptId&&project.parentId===r.spreadsheetId&&
  project.title===r.title&&project.creator?.email===user.user.emailAddress,
  "OLD_PROJECT_IDENTITY_FAILED");
 must(project.scriptId!==r.protectedScriptId&&r.spreadsheetId!==protectedProject.parentId,
  "PROTECTED_GOOGLE_COLLISION");
 must(sheet.id===r.spreadsheetId&&sheet.ownedByMe&&sheet.trashed===false&&
  sheet.shared===false&&sheet.capabilities?.canEdit===true&&
  sheet.owners?.length===1&&sheet.owners[0].permissionId===r.owner&&
  sheet.appProperties?.furusatoInstaller==="v1","OLD_SHEET_IDENTITY_FAILED");
 const oldCfg=jsonPrivate(oldClaspFile);
 g.identityCheck(r,project,user.user,oldCfg);
 auditVersion(r,{historical:historicalFiles(r.sourceCommit),frozen:frozen.files,
  projectHead:head.files,deployment,protectedRemoteHash:protectedHash});
 return {owner:user.user.permissionId,email:user.user.emailAddress,
  protectedId:r.protectedScriptId,protectedParent:protectedProject.parentId,
  verified:"PASS"};
}
function validateNewIdentity({r,newSheet,newProject,old,owner}){
 must(newSheet&&newSheet.id&&newSheet.id!==r.spreadsheetId&&
  newSheet.id!==r.scriptId&&newSheet.id!==r.protectedScriptId&&
  newSheet.id!==old.protectedParent,"SHEET_COLLISION");
 must(newProject&&typeof newProject.scriptId==="string"&&
  newProject.scriptId.length>5&&newProject.scriptId!==r.scriptId&&
  newProject.scriptId!==r.protectedScriptId&&newProject.scriptId!==newSheet.id&&
  newProject.parentId===newSheet.id&&
  newProject.creator?.email===owner.email&&
  newProject.title?.startsWith(policy.projectPrefix),
  "NEW_PROJECT_IDENTITY_FAILED");
 return true;
}
function writeJson(file,value,first=false){
 const body=JSON.stringify(value,null,2)+"\n";
 if(first){fs.writeFileSync(file,body,{flag:"wx",mode:0o600});return;}
 // Never overwrite a credential, old receipt or snapshot. Only new journal.
 must(file===path.join(stageDir,"journal.json") ||
  (process.env.NODE_ENV==="test" && path.basename(file)==="journal.json" &&
   path.dirname(file).startsWith(os.tmpdir()+path.sep)), "STAGE_WRITE_OUT_OF_SCOPE");
 const temp=path.join(path.dirname(file),".journal.tmp");
 fs.writeFileSync(temp,body,{flag:"wx",mode:0o600});
 fs.renameSync(temp,file);
}
function stageJournal(stageDirPath,step,details={}){
 // Private local record contains IDs for recovery; never echo it or upload.
 const journal=path.join(stageDirPath,"journal.json");
 const current=jsonPrivate(journal);
 must(current.schema==="furusato-v020-stage/v1","STAGE_JOURNAL_INVALID");
 writeJson(journal,{...current,...details,step,updatedAt:new Date().toISOString()});
}
function stageReport(stage="DEPLOYED_PENDING_OWNER_ACCEPTANCE"){
 return {status:stage,version:"v0.1.20",stage:"NEW_ISOLATED_PRIVATE",
  sourceFiles:5,oldVersion:"v0.1.17",oldDeployment:"NOT_MODIFIED",
  housingERP:"VERIFIED_UNCHANGED",sharedGlobalAuth:"NOT_USED_FOR_OAUTH",
  existingReceipt:"NOT_MODIFIED",existingIsolatedAuth:"NOT_MODIFIED",
  ownerOnly:"MYSELF",runAs:"USER_DEPLOYING",
  ocrWindows:"NOT_TESTED",ocrIPhone:"NOT_TESTED",release:"HOLD"};
}
async function createStage({api,r,old,files,candidate,before,dir=stageDir,
 assertStable=()=>{}}){
 must(dir===stageDir||(process.env.NODE_ENV==="test" &&
  path.resolve(dir).startsWith(os.tmpdir()+path.sep)),"STAGE_PATH_NOT_ALLOWED");
 must(!exists(dir),"STAGE_ALREADY_EXISTS_DO_NOT_RETRY");
 fs.mkdirSync(dir,{mode:0o700});
 const journal=path.join(dir,"journal.json");
 const name=policy.projectPrefix+"V020_STAGE_"+crypto.randomUUID();
 writeJson(journal,{schema:"furusato-v020-stage/v1",appVersion:"0.1.20",
  sourceCommit:candidate.sha,sourceDigest:candidate.digest,
  oldReceiptDigest:before.oldReceipt,oldAuthDigest:before.oldAuth,
  oldDeploymentId:r.deploymentId,title:name,step:"PREPARED",
  createdAt:new Date().toISOString()},true);
 // Do not retry after ANY unknown POST response: the private journal is a
 // recovery marker. A second run refuses to create duplicate resources.
 const base=url;
 assertStable();
 stageJournal(dir,"SHEET_CREATE_REQUESTED");
 const newSheet=await api("https://www.googleapis.com/drive/v3/files?fields=id","POST",{
  name, mimeType:"application/vnd.google-apps.spreadsheet",
  appProperties:{furusatoInstaller:"v1",furusatoStage:"v020-private"}
 });
 stageJournal(dir,"SHEET_CREATED",{spreadsheetId:newSheet.id});
 must(newSheet.id&&newSheet.id!==r.spreadsheetId&&
  newSheet.id!==r.scriptId&&newSheet.id!==r.protectedScriptId&&
  newSheet.id!==old.protectedParent,"NEW_SHEET_COLLISION");
 const sheet=await api("https://www.googleapis.com/drive/v3/files/"+
  encodeURIComponent(newSheet.id)+
  "?fields=id,name,mimeType,ownedByMe,owners(permissionId),trashed,shared,capabilities(canEdit),appProperties");
 must(sheet.id===newSheet.id&&sheet.name===name&&
  sheet.appProperties?.furusatoInstaller==="v1"&&
  sheet.appProperties?.furusatoStage==="v020-private","NEW_SHEET_MARKER_MISMATCH");
 must(sheet.ownedByMe&&sheet.trashed===false&&!sheet.shared&&
  sheet.capabilities?.canEdit&&sheet.owners?.length===1&&
  sheet.owners[0].permissionId===old.owner,"NEW_SHEET_NOT_PRIVATE");
 assertStable();
 stageJournal(dir,"SCRIPT_CREATE_REQUESTED");
 const newProject=await api("https://script.googleapis.com/v1/projects","POST",{
  title:name,parentId:newSheet.id
 });
 stageJournal(dir,"SCRIPT_CREATED",{scriptId:newProject.scriptId});
 must(typeof newProject.scriptId==="string"&&newProject.scriptId.length>5,
  "NEW_PROJECT_CREATE_RESPONSE_INVALID");
 const newProjectRemote=await api(base(newProject.scriptId));
 must(newProjectRemote.scriptId===newProject.scriptId,"NEW_PROJECT_CREATE_IDENTITY_MISMATCH");
 validateNewIdentity({r,newSheet,newProject:newProjectRemote,old,owner:old});
 const existing=await api(base(newProject.scriptId)+"/content");
 must(Array.isArray(existing.files)&&existing.files.every(f=>
  f.name==="appsscript"||(f.name==="Code"&&/^\s*function myFunction\(\)\s*\{\s*\}\s*$/.test(f.source))),
  "NEW_PROJECT_CONTAINS_UNKNOWN_SOURCE");
 assertStable();
 stageJournal(dir,"SOURCE_UPLOAD_REQUESTED");
 await api(base(newProject.scriptId)+"/content","PUT",{files});
 stageJournal(dir,"SOURCE_UPLOADED");
 const uploaded=await api(base(newProject.scriptId)+"/content");
 must(exactFiles(uploaded.files)&&
  g.digest(uploaded.files)===candidate.digest&&
  appVersion(uploaded.files)==="0.1.20","NEW_SOURCE_VERIFY_FAILED");
 g.manifestCheck(JSON.parse(uploaded.files.find(f=>f.name==="appsscript").source));
 assertStable();
 stageJournal(dir,"VERSION_CREATE_REQUESTED");
 const version=await api(base(newProject.scriptId)+"/versions","POST",{
  description:"Furusato synthetic v0.1.20; release HOLD"
 });
 stageJournal(dir,"VERSION_CREATED",{versionNumber:version.versionNumber});
 must(Number.isSafeInteger(version.versionNumber)&&version.versionNumber>=1,
  "NEW_VERSION_INVALID");
 const frozen=await api(base(newProject.scriptId)+"/content?versionNumber="+
  version.versionNumber);
 must(exactFiles(frozen.files)&&g.digest(frozen.files)===candidate.digest,
  "NEW_FROZEN_SOURCE_MISMATCH");
 assertStable();
 stageJournal(dir,"DEPLOYMENT_CREATE_REQUESTED");
 const deployment=await api(base(newProject.scriptId)+"/deployments","POST",{
  versionNumber:version.versionNumber,manifestFileName:"appsscript",
  description:"Furusato NEW PRIVATE synthetic v0.1.20; release HOLD"
 });
 stageJournal(dir,"DEPLOYMENT_CREATED",{deploymentId:deployment.deploymentId});
 const finalDeployment=await api(base(newProject.scriptId)+"/deployments/"+
  encodeURIComponent(deployment.deploymentId));
 must(finalDeployment.deploymentId===deployment.deploymentId,"NEW_DEPLOYMENT_NOT_FOUND");
 const webAppUrl=g.deploymentCheck(finalDeployment,newProject.scriptId,
  version.versionNumber);
 assertStable();
 const receipt={
  schema:"furusato-v020-stage/v1",appVersion:"v0.1.20",
  createdAt:new Date().toISOString(),release:"HOLD",
  sourceCommit:candidate.sha,sourceDigest:candidate.digest,
  scriptId:newProject.scriptId,spreadsheetId:newSheet.id,versionNumber:version.versionNumber,
  deploymentId:deployment.deploymentId,webAppUrl,owner:old.owner,title:name,
  previousReceiptDigest:before.oldReceipt,previousAuthDigest:before.oldAuth,
  historicalGlobalAuth:"UNVERIFIED",oldDeployment:"UNMODIFIED_BY_STAGE"
 };
 writeJson(path.join(dir,"receipt.json"),receipt,true);
 stageJournal(dir,"COMPLETE");
 return stageReport();
}
function preflightResult(candidate){
 return {status:"READY_TO_CREATE_ONLY_NEW_PRIVATE_STAGE",version:"v0.1.20",
  checkout:"TRUSTED_REMOTE_EXACT_COMMIT",oldPrivateVersion:"v0.1.17",
  oldGlobalAuthSnapshot:"DRIFT_RETAINED_NOT_OVERRIDDEN",
  protectedHousingERP:"UNCHANGED",
  stageWriteScope:"NEW_SHEET_NEW_GAS_NEW_VERSION_NEW_DEPLOYMENT_ONLY",
  candidateDigestVerified:!!candidate,stage:"NOT_CREATED",
  consent:"EXPLICIT_OWNER_APPROVAL_2026-11-09",
  release:"HOLD"};
}
async function main(){
 const mode=process.argv[2]||"--preflight";
 must(!process.env.CI&&
  (mode==="--preflight"&&process.argv.length===3 ||
   mode==="--create-approved"&&process.argv.length===4&&
   process.argv[3]===stageMarker),"LOCAL_EXPLICIT_STAGE_ONLY");
 verifyPaths();
 g.preflight();
 const r=jsonPrivate(oldReceiptFile);
 const candidate=currentCandidate();
 const drift=g.configDriftReport(r,protectedRoot);
 localGate(r,drift,{status:"CANDIDATE_SOURCE_READY"});
 const before=snapshotReadOnly();
 const files=g.source();
 const api=g.googleApi(await g.accessToken());
 const old=await auditOldLive(api,r);
 const drive=await countTemporaryDocuments(api);
 must(drive.status==="PASS"&&drive.temporaryOcrFiles===0&&
  drive.coverage==="FURUSATO_DEDICATED_OAUTH_SCOPE_ONLY","OLD_DRIVE_AUDIT_HOLD");
 unchangedAll(before);
 const stable=()=>{
  unchangedAll(before);
  must(currentCandidate().sha===candidate.sha&&
   currentCandidate().digest===candidate.digest,"SOURCE_CHANGED_DURING_STAGE");
 };
 stable();
 if(mode==="--preflight"){
  console.log(JSON.stringify(preflightResult(candidate)));return;
 }
 // Also guard against changes after all read-only checks.
 stable();
 const result=await createStage({
  api,r,old,files,candidate,before,assertStable:stable
 });
 const rechecked=await auditOldLive(api,r);
 must(rechecked.verified==="PASS","OLD_GOOGLE_CHANGED_AFTER_STAGE");
 unchangedAll(before);
 console.log(JSON.stringify(result));
}
module.exports={localGate,validateNewIdentity,createStage,stageReport,
 preflightResult,unchangedAll};
if(require.main===module)main().catch(()=>{
 // The private journal, if created, is intentionally preserved for manual
 // reconciliation. Never retry automatically, delete resources or print IDs.
 console.error("V020_NEW_PRIVATE_STAGE_HOLD: LOCAL_OR_GOOGLE_CHECK_UNVERIFIED; NO_AUTOMATIC_RETRY");
 process.exitCode=2;
});
