"use strict";
/**
 * Strictly synthetic, offline: no Google network, no real credentials, no
 * writing outside an ephemeral OS temp directory. Tests the actual POST/PUT
 * sequence, ID scope guards, privacy, journals and non-retry behavior.
 */
const assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const google=require("../deployment/private-gas.cjs");
const {localGate,validateNewIdentity,createStage,stageReport,preflightResult}=
 require("../scripts/create-v020-isolated-stage.cjs");
const files=google.source();
const candidate={sha:"a".repeat(40),digest:google.digest(files)};
const r={scriptId:"old-script-id",spreadsheetId:"old-sheet-id",
 protectedScriptId:"housing-script-id",deploymentId:"old-deploy-id"};
const old={owner:"owner-permission",email:"owner@example.invalid",
 protectedParent:"housing-parent-id"};
const before={oldReceipt:"b".repeat(64),oldAuth:"c".repeat(64)};
const changes=[
 {name:"housing-clasp",state:"UNCHANGED"},
 {name:"housing-appsscript",state:"UNCHANGED"},
 {name:"housing-project",state:"UNCHANGED"},
 {name:"global-clasp-auth",state:"CHANGED"}
];
const owner={email:old.email};
const oldNewSheet={id:"new-synthetic-sheet-id"};
const base="https://script.googleapis.com/v1/projects/";
const newId="new-synthetic-script-id";
const webAppUrl="https://script.google.com/macros/s/NEW_PRIVATE_SYNTHETIC/exec";
const deployment={deploymentId:"new-private-deployment-id",
 deploymentConfig:{scriptId:newId,versionNumber:1},
 entryPoints:[{entryPointType:"WEB_APP",webApp:{
  entryPointConfig:{access:"MYSELF",executeAs:"USER_DEPLOYING"},
  url:webAppUrl
 }}]};
const initial={files:[{name:"appsscript",type:"JSON",source:"{}"}]};
function mock(options={}){
 const calls=[];
 let uploaded=false,createdTitle="";
 const api=async(url,method="GET",body)=>{
  calls.push({url,method});
  if(options.failAt && url.includes(options.failAt) &&
      method===options.failMethod)throw Error("SYNTHETIC_HTTP_INTERRUPTED");
  if(method==="POST"&&url.includes("www.googleapis.com/drive/v3/files?"))
    return oldNewSheet;
  if(method==="GET"&&url.includes("/drive/v3/files/new-synthetic-sheet-id?"))
    return {id:oldNewSheet.id,name:options.invalidSheet?"OTHER":options.title?.(),
     mimeType:"application/vnd.google-apps.spreadsheet",ownedByMe:true,
     trashed:false,shared:false,capabilities:{canEdit:true},
     owners:[{permissionId:old.owner}],
     appProperties:{furusatoInstaller:"v1",furusatoStage:"v020-private"}};
  if(method==="POST"&&url==="https://script.googleapis.com/v1/projects"){
    createdTitle=body.title;
    return {scriptId:newId,parentId:oldNewSheet.id,title:createdTitle,
      creator:{email:old.email}};
  }
  if(method==="GET"&&url===base+newId)
    return {scriptId:newId,parentId:oldNewSheet.id,title:createdTitle,
      creator:{email:old.email}};
  if(url===base+newId+"/content"){
    if(method==="PUT"){
      assert.equal(google.digest(body.files),candidate.digest);
      uploaded=true;return {files:body.files};
    }
    return uploaded?{files}:initial;
  }
  if(method==="POST"&&url===base+newId+"/versions")
    return {scriptId:newId,versionNumber:1};
  if(method==="GET"&&url===base+newId+"/content?versionNumber=1")
    return {files};
  if(method==="POST"&&url===base+newId+"/deployments"){
    assert.equal(body.versionNumber,1);
    assert.equal(body.manifestFileName,"appsscript");
    return deployment;
  }
  if(method==="GET"&&url===base+newId+"/deployments/"+deployment.deploymentId)
    return options.publicDeployment?{
     ...deployment,entryPoints:[{entryPointType:"WEB_APP",webApp:{
      ...deployment.entryPoints[0].webApp,
      entryPointConfig:{access:"ANYONE",executeAs:"USER_DEPLOYING"}
     }}]
    }:deployment;
  throw Error("UNEXPECTED_SYNTHETIC_API");
 };
 return {api,calls};
}
async function run(){
 assert.equal(stageReport().status,"DEPLOYED_PENDING_OWNER_ACCEPTANCE");
 assert.equal(stageReport().release,"HOLD");
 assert.equal(preflightResult(candidate).stage,"NOT_CREATED");
 assert.equal(preflightResult(candidate).release,"HOLD");
 const drift={status:"HOLD",checks:changes};
 assert.throws(()=>localGate({
  ...r,sourceCommit:"bad"},drift,{status:"CANDIDATE_SOURCE_READY"}),
  /RECEIPT_NOT_ATTESTED/);
 assert.equal(validateNewIdentity({r,newSheet:oldNewSheet,newProject:{
  scriptId:newId,parentId:oldNewSheet.id,title:"Furusato_PRIVATE_SYNTHETIC_stage",
  creator:owner},old,owner:old}),true);
 assert.throws(()=>validateNewIdentity({r,newSheet:oldNewSheet,newProject:{
  scriptId:r.scriptId,parentId:oldNewSheet.id,title:"Furusato_PRIVATE_SYNTHETIC_stage",
  creator:owner},old,owner:old}),/NEW_PROJECT_IDENTITY_FAILED/);
 const badDrift={status:"HOLD",checks:changes.map(x=>({...x}))};
 badDrift.checks[0].state="CHANGED";
 const rootOfTests=fs.mkdtempSync(path.join(os.tmpdir(),"furusato-v020-stage-tests-"));
 const prev=process.env.NODE_ENV;process.env.NODE_ENV="test";
 try{
  const newDir=path.join(rootOfTests,"created");
  const sim=mock();
  let title="";
  // The cloud sheet name is derived from the generated private title.
  const origApi=sim.api;
  let recordedTitle="";
  const api=async(url,method,body)=>{
   if(method==="POST"&&url.includes("drive/v3/files?"))recordedTitle=body.name;
   return origApi(url,method,body||{});
  };
  const apiWithName=async(url,method="GET",body)=>{
   if(method==="GET"&&url.includes("drive/v3/files/new-synthetic-sheet-id?"))
    return {id:oldNewSheet.id,name:recordedTitle,
     mimeType:"application/vnd.google-apps.spreadsheet",ownedByMe:true,
     trashed:false,shared:false,capabilities:{canEdit:true},
     owners:[{permissionId:old.owner}],
     appProperties:{furusatoInstaller:"v1",furusatoStage:"v020-private"}};
   return api(url,method,body);
  };
  let stability=0;
  const success=await createStage({api:apiWithName,r,old,files,candidate,before,
   dir:newDir,assertStable:()=>{stability++}});
  assert.ok(stability>=5);
  assert.equal(success.status,"DEPLOYED_PENDING_OWNER_ACCEPTANCE");
  assert.equal(success.release,"HOLD");
  assert.equal(success.ocrWindows,"NOT_TESTED");
  assert.equal(success.ocrIPhone,"NOT_TESTED");
  const saved=JSON.parse(fs.readFileSync(path.join(newDir,"receipt.json"),"utf8"));
  assert.equal(saved.scriptId,newId);
  assert.equal(saved.spreadsheetId,oldNewSheet.id);
  assert.equal(saved.deploymentId,deployment.deploymentId);
  assert.equal(saved.versionNumber,1);
  assert.equal(saved.webAppUrl,webAppUrl);
  assert.equal(saved.release,"HOLD");
  const journal=JSON.parse(fs.readFileSync(path.join(newDir,"journal.json"),"utf8"));
  assert.equal(journal.step,"COMPLETE");
  assert.equal(journal.oldDeploymentId,r.deploymentId);
  assert.equal(journal.sourceCommit,candidate.sha);
  assert.equal(journal.schema,"furusato-v020-stage/v1");
  const remoteWrites=sim.calls.filter(x=>["POST","PUT"].includes(x.method));
  assert.deepEqual(remoteWrites.map(x=>x.method),["POST","POST","PUT","POST","POST"]);
  assert.ok(remoteWrites.every(x=>!x.url.includes(r.scriptId)&&
    !x.url.includes(r.protectedScriptId)&&!x.url.includes(r.deploymentId)));
  for(const secret of [newId,oldNewSheet.id,old.email,r.scriptId,
   r.deploymentId,webAppUrl,candidate.sha,candidate.digest])
   assert.ok(!JSON.stringify(success).includes(secret));
  await assert.rejects(()=>createStage({api:apiWithName,r,old,files,candidate,before,
   dir:newDir}),/STAGE_ALREADY_EXISTS_DO_NOT_RETRY/);
  assert.equal(sim.calls.filter(x=>["POST","PUT"].includes(x.method)).length,5);
  const interrupted=path.join(rootOfTests,"interrupted");
  const fails=mock({failAt:"drive/v3/files?",failMethod:"POST"});
  await assert.rejects(()=>createStage({api:fails.api,r,old,files,candidate,before,
   dir:interrupted}),/SYNTHETIC_HTTP_INTERRUPTED/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(interrupted,"journal.json"),"utf8")).step,
   "SHEET_CREATE_REQUESTED");
  assert.equal(fs.existsSync(path.join(interrupted,"receipt.json")),false);
  await assert.rejects(()=>createStage({api:fails.api,r,old,files,candidate,before,
   dir:interrupted}),/STAGE_ALREADY_EXISTS_DO_NOT_RETRY/);
  const leaked=path.join(rootOfTests,"untrusted-sheet");
  const m=mock({invalidSheet:true});
  await assert.rejects(()=>createStage({api:m.api,r,old,files,candidate,before,
   dir:leaked}),/NEW_SHEET_MARKER_MISMATCH/);
  assert.equal(m.calls.filter(x=>x.method==="POST").length,1);
  assert.equal(fs.existsSync(path.join(leaked,"receipt.json")),false);
  // No testing fixture should interact with any real auth.
  assert.equal(Object.values(success).includes("NOT_MODIFIED"),true);
  console.log("V020_NEW_ISOLATED_STAGE_SYNTHETIC_PASS; 5 allowlisted writes tested; no real Google; release HOLD");
 }finally{
  if(prev===undefined)delete process.env.NODE_ENV;
  else process.env.NODE_ENV=prev;
  fs.rmSync(rootOfTests,{recursive:true,force:true});
 }
}
run().catch(e=>{console.error(e.stack);process.exitCode=1});
