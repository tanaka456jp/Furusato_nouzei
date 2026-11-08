"use strict";
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const google=require("../deployment/private-gas.cjs");
const policy=require("../deployment/policy.json");
const {appVersion,exactFiles,recordCheck,auditVersion,protectedDigest}=
  require("../scripts/audit-installed-private-version.cjs");
const app="0.1.17";
const files=policy.sourceFiles.map(filename=>({
  name:filename.replace(/\.(gs|html|json)$/,""),
  type:filename.endsWith(".gs")?"SERVER_JS":filename.endsWith(".html")?"HTML":"JSON",
  source:filename==="Engine.gs"?'var FurusatoEngine=(function() { var VERSION = "gas-mvp-'+app+'"; })();':
    filename==="appsscript.json"?JSON.stringify(require("../appsscript.json")):
    "synthetic fixture; no customer information"
}));
const receipt={
  schema:policy.schema,createdByInstaller:true,privateVerifiedAt:"2026-11-09T01:00:00Z",
  sourceCommit:"a".repeat(40),protectedRemoteDigest:"c".repeat(64),
  uploadDigest:google.digest(files),versionNumber:8,scriptId:"synthetic-script",
  spreadsheetId:"synthetic-sheet",deploymentId:"synthetic-deploy",
  webAppUrl:"https://script.google.com/macros/s/SYNTHETIC/exec"
};
const deployment={
  deploymentId:receipt.deploymentId,
  deploymentConfig:{scriptId:receipt.scriptId,versionNumber:receipt.versionNumber},
  entryPoints:[{entryPointType:"WEB_APP",webApp:{
    entryPointConfig:{access:"MYSELF",executeAs:"USER_DEPLOYING"},
    url:receipt.webAppUrl
  }}]
};
function params(mod={}){
 return {historical:files,frozen:files,projectHead:files,
   protectedRemoteHash:receipt.protectedRemoteDigest,deployment,...mod};
}
assert.equal(exactFiles(files),true);
assert.equal(appVersion(files),app);
assert.doesNotThrow(()=>recordCheck(receipt));
const output=auditVersion(receipt,params());
assert.equal(output.status,"PASS");
assert.equal(output.appVersion,"v0.1.17");
assert.equal(output.release,"HOLD");
assert.equal(output.historicalOwnerOcrSessionBinding,"NOT_PROVEN");
assert.equal(output.independentlyMeasuredOcrAccuracy,"NOT_PROVEN");
assert.equal(output.ownerAndPrivateAccess,"REQUIRES_SEPARATE_REMOTE_OWNER_CHECK");
const old=files.map(x=>({...x})),wrong=files.map(x=>({...x}));
wrong.find(x=>x.name==="Engine").source='var VERSION = "gas-mvp-0.1.20"';
const duplicate=[...files,files[0]];
assert.equal(exactFiles(duplicate),false);
assert.equal(appVersion(duplicate),null);
assert.equal(appVersion(wrong),"0.1.20");
const cases=[
 [{historical:wrong},"APP_VERSION_MISMATCH"],
 [{frozen:wrong},"APP_VERSION_MISMATCH"],
 [{projectHead:wrong},"APP_VERSION_MISMATCH"],
 [{frozen:duplicate},"SOURCE_SET_NOT_EXACTLY_FIVE"],
 [{frozen:files.map(x=>x.name==="Code"?{...x,source:"changed"}:x)},"FROZEN_SOURCE_DIFFERS"],
 [{projectHead:files.map(x=>x.name==="Code"?{...x,source:"changed"}:x)},"PROJECT_HEAD_DIFFERS"],
 [{deployment:{...deployment,deploymentId:"other"}},"PRIVATE_DEPLOYMENT_IDENTITY_DIFFERS"],
 [{protectedRemoteHash:"d".repeat(64)},"PROTECTED_GOOGLE_DIFFERS"]
];
for(const [changed,reason] of cases){
 assert.throws(()=>auditVersion(receipt,params(changed)),new RegExp(reason),reason);
}
assert.throws(()=>recordCheck({...receipt,sourceCommit:"evil"}),/RECEIPT_NOT_ATTESTED/);
assert.throws(()=>recordCheck({...receipt,sourceCommit:null}),/RECEIPT_NOT_ATTESTED/);
assert.throws(()=>recordCheck({...receipt,webAppUrl:"https://attacker.example/"}),/RECEIPT_NOT_ATTESTED/);
assert.throws(()=>recordCheck({...receipt,protectedRemoteDigest:"bad"}),/RECEIPT_NOT_ATTESTED/);
assert.throws(()=>auditVersion({...receipt,uploadDigest:"f".repeat(64)},params()),/HISTORICAL_SOURCE_DIFFERS/);
assert.throws(()=>auditVersion(receipt,params({deployment:{
  ...deployment,entryPoints:[{entryPointType:"WEB_APP",webApp:{
    entryPointConfig:{access:"ANYONE",executeAs:"USER_DEPLOYING"},
    url:receipt.webAppUrl
  }}]
}})),/SAFE-GOOGLE-PRIVATE/);
assert.equal(JSON.stringify(output).includes(receipt.webAppUrl),false);
assert.equal(JSON.stringify(output).includes(receipt.uploadDigest),false);
async function run(){
 const syntheticContent={files:files};
 const syntheticDeployments={deployments:[deployment]};
 const digest=crypto.createHash("sha256").update(JSON.stringify({
  content:google.digest(files),deployments:syntheticDeployments
 })).digest("hex");
 const requested=[];
 const got=await protectedDigest(async url=>{
   requested.push(url);
   if(url.endsWith("/content"))return syntheticContent;
   if(url.endsWith("/deployments"))return syntheticDeployments;
   throw Error("UNKNOWN_REQUEST");
 },"synthetic-protected-script");
 assert.equal(got,digest);
 assert.equal(requested.length,2);
 await assert.rejects(()=>protectedDigest(async url=>
  url.endsWith("/content")?syntheticContent:{...syntheticDeployments,nextPageToken:"next"}
 ,"synthetic-protected-script"),/PROTECTED_DEPLOYMENTS_INCOMPLETE/);
 console.log("PRIVATE_IMMUTABLE_VERSION_READONLY_AUDIT_PASS; synthetic only; release HOLD");
}
run().catch(()=>{process.exitCode=1;});
