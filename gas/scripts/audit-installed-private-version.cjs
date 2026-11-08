"use strict";
/**
 * Read-only remote attestation of the PREVIOUS, immutable, private GAS version.
 * Can run from a newer Git HEAD: the old source is loaded via the installer
 * receipt's pinned commit. No clasp push, deployment update or receipt writes.
 * Private identifiers, Google responses, hashes and paths are never printed.
 */
const fs=require("node:fs"),path=require("node:path"),cp=require("node:child_process");
const crypto=require("node:crypto");
const google=require("../deployment/private-gas.cjs");
const policy=require("../deployment/policy.json");
const root=path.resolve(__dirname,"..");
const privateRoot=path.join(root,".private","furusato");
const expectedVersion="0.1.17";
const goodDigest=value=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);
const goodCommit=value=>typeof value==="string"&&/^[a-f0-9]{40}$/.test(value);
function exactFiles(files){
  if(!Array.isArray(files)||files.length!==policy.sourceFiles.length)return false;
  const actual=files.map(f=>f&&
    ({name:f.name,type:f.type,source:f.source})).filter(Boolean);
  if(actual.length!==policy.sourceFiles.length)return false;
  const expected=policy.sourceFiles.map(name=>({
    name:name.replace(/\.(gs|html|json)$/,""),
    type:name.endsWith(".gs")?"SERVER_JS":name.endsWith(".html")?"HTML":"JSON"
  }));
  return expected.every(e=>actual.filter(f=>f.name===e.name&&f.type===e.type&&typeof f.source==="string").length===1);
}
function appVersion(files){
  if(!exactFiles(files))return null;
  const engine=files.find(f=>f.name==="Engine").source;
  const re=/\bvar\s+VERSION\s*=\s*["']gas-mvp-(0\.1\.\d+)["']/g;
  const hits=[...engine.matchAll(re)];
  return hits.length===1?hits[0][1]:null;
}
function recordCheck(r){
  if(!r||r.schema!==policy.schema||r.createdByInstaller!==true||
     !google.hasProtectedAttestation(r)||!goodCommit(r.sourceCommit)||
     !goodDigest(r.uploadDigest)||!goodDigest(r.protectedRemoteDigest)||
     !Number.isSafeInteger(r.versionNumber)||r.versionNumber<1||
     typeof r.webAppUrl!=="string"||!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(r.webAppUrl)||
     typeof r.deploymentId!=="string"||!r.deploymentId||
     typeof r.scriptId!=="string"||!r.scriptId||
     typeof r.spreadsheetId!=="string"||!r.spreadsheetId)
      throw Error("RECEIPT_NOT_ATTESTED");
}
function historicalFiles(commit){
  if(!goodCommit(commit))throw Error("HISTORICAL_COMMIT_INVALID");
  const files=[];
  for(const filename of policy.sourceFiles){
    const source=cp.execFileSync("git",["show",commit+":gas/"+filename],{
      cwd:root,encoding:"utf8",stdio:["ignore","pipe","pipe"],timeout:12000,
      maxBuffer:4*1024*1024
    });
    files.push({name:filename.replace(/\.(gs|html|json)$/,""),
      type:filename.endsWith(".gs")?"SERVER_JS":filename.endsWith(".html")?"HTML":"JSON",source});
  }
  return files;
}
function auditVersion(r,{historical,frozen,projectHead,deployment,protectedRemoteHash}){
  recordCheck(r);
  if(!exactFiles(historical)||!exactFiles(frozen)||!exactFiles(projectHead))
    throw Error("SOURCE_SET_NOT_EXACTLY_FIVE");
  if(appVersion(historical)!==expectedVersion ||
     appVersion(frozen)!==expectedVersion ||
     appVersion(projectHead)!==expectedVersion)
    throw Error("APP_VERSION_MISMATCH");
  if(google.digest(historical)!==r.uploadDigest)throw Error("HISTORICAL_SOURCE_DIFFERS");
  if(google.digest(frozen)!==r.uploadDigest)throw Error("FROZEN_SOURCE_DIFFERS");
  if(google.digest(projectHead)!==r.uploadDigest)throw Error("PROJECT_HEAD_DIFFERS");
  const manifest=JSON.parse(frozen.find(f=>f.name==="appsscript").source);
  google.manifestCheck(manifest);
  if(deployment?.deploymentId!==r.deploymentId ||
     google.deploymentCheck(deployment,r.scriptId,r.versionNumber)!==r.webAppUrl)
    throw Error("PRIVATE_DEPLOYMENT_IDENTITY_DIFFERS");
  if(!goodDigest(protectedRemoteHash)||protectedRemoteHash!==r.protectedRemoteDigest)
    throw Error("PROTECTED_GOOGLE_DIFFERS");
  return {
    status:"PASS",audit:"EXISTING_PRIVATE_IMMUTABLE_VERSION",
    appVersion:"v"+expectedVersion,receiptSourceCommit:"MATCH",
    registeredSourceFiles:5,projectHead:"MATCH",immutableVersion:"MATCH",
    ownerAndPrivateAccess:"REQUIRES_SEPARATE_REMOTE_OWNER_CHECK",
    protectedGoogle:"UNCHANGED",protectedLocal:"REQUIRES_SEPARATE_LOCAL_CHECK",
    historicalOwnerOcrSessionBinding:"NOT_PROVEN",
    independentlyMeasuredOcrAccuracy:"NOT_PROVEN",
    release:"HOLD"
  };
}
async function protectedDigest(api,id){
  const base="https://script.googleapis.com/v1/projects/"+encodeURIComponent(id);
  const content=await api(base+"/content");
  const deployments=await api(base+"/deployments");
  if(deployments.nextPageToken)throw Error("PROTECTED_DEPLOYMENTS_INCOMPLETE");
  return crypto.createHash("sha256").update(JSON.stringify({
    content:google.digest(content.files),deployments
  })).digest("hex");
}
async function perform(api,r,protectedRoot,history){
  recordCheck(r);
  // The main installer verifier ensures owner, synthetic parent Sheet,
  // HousingERP remote script, identity and local protection snapshot.
  await google.verify(api,r,protectedRoot);
  const base="https://script.googleapis.com/v1/projects/"+encodeURIComponent(r.scriptId);
  const [frozen,projectHead,deployment,protectedRemoteHash]=await Promise.all([
    api(base+"/content?versionNumber="+r.versionNumber),
    api(base+"/content"),
    api(base+"/deployments/"+encodeURIComponent(r.deploymentId)),
    protectedDigest(api,r.protectedScriptId)
  ]);
  const report=auditVersion(r,{historical:history,frozen:frozen.files,projectHead:projectHead.files,
    deployment,protectedRemoteHash});
  report.ownerAndPrivateAccess="PASS";
  report.protectedLocal="UNCHANGED";
  return report;
}
async function main(){
  if(process.env.CI||process.argv.length!==2)throw Error("OWNER_LOCAL_ONLY");
  const protectedRoot=path.resolve(root,"..","..","HousingERP");
  const receiptFile=path.join(privateRoot,"receipt.json");
  google.rejectLinks([path.join(root,".private"),privateRoot,receiptFile,
    path.join(privateRoot,"auth.json"),path.join(privateRoot,"project"),
    path.join(privateRoot,"project",".clasp.json")]);
  google.preflight();
  const st=fs.lstatSync(receiptFile);
  if(!st.isFile()||st.size<2||st.size>1024*1024)throw Error("RECEIPT_NOT_ATTESTED");
  const receipt=JSON.parse(fs.readFileSync(receiptFile,"utf8"));
  recordCheck(receipt);
  if(google.configDriftReport(receipt,protectedRoot).status!=="MATCH")
    throw Error("PROTECTED_LOCAL_DIFFERS");
  const history=historicalFiles(receipt.sourceCommit);
  if(!exactFiles(history)||google.digest(history)!==receipt.uploadDigest||
     appVersion(history)!==expectedVersion)
    throw Error("HISTORICAL_VERSION_NOT_ATTESTED");
  // OAuth refresh is an authentication request; this does not write Google
  // resources or update saved credentials/receipts/snapshots.
  const api=google.googleApi(await google.accessToken());
  const report=await perform(api,receipt,protectedRoot,history);
  console.log(JSON.stringify(report));
}
module.exports={exactFiles,appVersion,recordCheck,auditVersion,perform,protectedDigest};
if(require.main===module)main().catch(error=>{
  const allow=new Set(["OWNER_LOCAL_ONLY","RECEIPT_NOT_ATTESTED",
    "PROTECTED_LOCAL_DIFFERS","HISTORICAL_VERSION_NOT_ATTESTED",
    "HISTORICAL_SOURCE_DIFFERS","FROZEN_SOURCE_DIFFERS","PROJECT_HEAD_DIFFERS",
    "SOURCE_SET_NOT_EXACTLY_FIVE","APP_VERSION_MISMATCH",
    "PRIVATE_DEPLOYMENT_IDENTITY_DIFFERS","PROTECTED_GOOGLE_DIFFERS",
    "PROTECTED_DEPLOYMENTS_INCOMPLETE"]);
  console.error("EXISTING_PRIVATE_VERSION_AUDIT_HOLD: "+
    (allow.has(error.message)?error.message:"IDENTITY_OR_API_UNVERIFIED"));
  process.exitCode=2;
});
