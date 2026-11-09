"use strict";

const policy=require("../deployment/policy.json");
const google=require("../deployment/private-gas.cjs");
const {exactFiles,appVersion}=require("./audit-installed-private-version.cjs");

const titlePrefix=policy.projectPrefix+"V020_STAGE_";
const titlePattern=new RegExp("^"+titlePrefix+"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$");
const sheetFields="id,name,mimeType,ownedByMe,owners(permissionId),trashed,shared,capabilities(canEdit),appProperties";
const versionDescription="Furusato synthetic v0.1.20; release HOLD";
const deploymentDescription="Furusato NEW PRIVATE synthetic v0.1.20; release HOLD";
const scope="DEDICATED_OAUTH_USER_CORPUS_INCLUDING_TRASH";
const isId=value=>typeof value==="string"&&/^[A-Za-z0-9_-]{6,512}$/.test(value);
const webAppUrl=/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;
const projectUrl=id=>"https://script.googleapis.com/v1/projects/"+encodeURIComponent(id);

async function readPages(api,url,key,{optionalList=false}={}){
 const rows=[],tokens=new Set();
 for(let page=0;page<100;page++){
  const result=await api(url.toString(),"GET");
  if(!result||typeof result!=="object"||Array.isArray(result)||
     (result.incompleteSearch!==undefined&&result.incompleteSearch!==false))
   throw Error("STAGE_INVENTORY_INCOMPLETE");
  const items=optionalList&&result[key]===undefined?[]:result[key];
  if(!Array.isArray(items))throw Error("STAGE_INVENTORY_INCOMPLETE");
  rows.push(...items);
  const next=result.nextPageToken;
  if(next===undefined)return rows;
  if(typeof next!=="string"||!next||next.length>8192||tokens.has(next))
   throw Error("STAGE_INVENTORY_INCOMPLETE");
  tokens.add(next);url.searchParams.set("pageToken",next);
 }
 throw Error("STAGE_INVENTORY_INCOMPLETE");
}

async function listStageSheets(api){
 const url=new URL("https://www.googleapis.com/drive/v3/files");
 url.searchParams.set("q","name contains '"+titlePrefix+"' or appProperties has { key='furusatoStage' and value='v020-private' }");
 url.searchParams.set("corpora","user");
 url.searchParams.set("spaces","drive");
 url.searchParams.set("pageSize","100");
 url.searchParams.set("fields","nextPageToken,incompleteSearch,files("+sheetFields+")");
 const rows=await readPages(api,url,"files");
 if(rows.some(row=>!isId(row?.id))||new Set(rows.map(row=>row.id)).size!==rows.length)
  throw Error("STAGE_INVENTORY_INCOMPLETE");
 return rows;
}

function verifyStageSheet(sheet,id,title,r,old){
 if(!isId(id)||[r.spreadsheetId,r.scriptId,r.protectedScriptId,old.protectedParent].includes(id))
  throw Error("NEW_SHEET_COLLISION");
 if(!sheet||sheet.id!==id||sheet.name!==title||!titlePattern.test(title)||
    sheet.mimeType!=="application/vnd.google-apps.spreadsheet"||
    sheet.appProperties?.furusatoInstaller!=="v1"||sheet.appProperties?.furusatoStage!=="v020-private")
  throw Error("NEW_SHEET_MARKER_MISMATCH");
 if(sheet.ownedByMe!==true||sheet.trashed!==false||sheet.shared!==false||
    sheet.capabilities?.canEdit!==true||sheet.owners?.length!==1||sheet.owners[0]?.permissionId!==old.owner)
  throw Error("NEW_SHEET_NOT_PRIVATE");
}

function matchesCandidate(files,digest){
 return exactFiles(files)&&appVersion(files)==="0.1.20"&&google.digest(files)===digest;
}

function isEmptyProject(files){
 return Array.isArray(files)&&files.length>=1&&files.length<=2&&
  files.filter(file=>file?.name==="appsscript"&&file.type==="JSON"&&typeof file.source==="string").length===1&&
  files.every(file=>file?.name==="appsscript"||(file?.name==="Code"&&file.type==="SERVER_JS"&&
   typeof file.source==="string"&&/^\s*function myFunction\(\)\s*\{\s*\}\s*$/.test(file.source)));
}

async function inspectRecordedStage(api,{sheets,journal:j,receipt,r,old}){
 if(!titlePattern.test(j.title)||!(/^[a-f0-9]{40}$/.test(j.sourceCommit||"")))throw Error("STAGE_JOURNAL_INVALID");
 const sheet=sheets.find(row=>row.name===j.title&&(!j.spreadsheetId||row.id===j.spreadsheetId));
 if(sheets.length!==1||!sheet)return {resume:"SHEET_NOT_UNIQUELY_VISIBLE"};
 verifyStageSheet(sheet,sheet.id,j.title,r,old);
 const proof={sheetIdentity:"PASS"};
 if(!j.scriptId)return {...proof,resume:j.step==="SCRIPT_CREATE_REQUESTED"?
  "UNKNOWN_SCRIPT_ID_REQUIRES_OWNER_RECONCILIATION":"SCRIPT_ID_NOT_RECORDED"};
 if(!isId(j.scriptId)||[r.scriptId,r.spreadsheetId,r.protectedScriptId,old.protectedParent,sheet.id].includes(j.scriptId))
  throw Error("NEW_PROJECT_IDENTITY_FAILED");
 const base=projectUrl(j.scriptId);
 const project=await api(base,"GET");
 if(project?.scriptId!==j.scriptId||project.parentId!==sheet.id||project.title!==j.title||
    project.creator?.email!==old.email)throw Error("NEW_PROJECT_IDENTITY_FAILED");
 proof.projectIdentity="PASS";
 const content=await api(base+"/content","GET");
 if(!matchesCandidate(content?.files,j.sourceDigest))return {...proof,
  projectSource:isEmptyProject(content?.files)?"EMPTY_PROJECT":"DIFFERS",
  resume:"SOURCE_NOT_ATTESTED"};
 proof.projectSource="PASS";
 const versions=await readPages(api,new URL(base+"/versions"),"versions",{optionalList:true});
 const version=versions.length===1?versions[0]:null;
 if(!version||version.description!==versionDescription||version.scriptId!==j.scriptId||
    !Number.isSafeInteger(version.versionNumber)||version.versionNumber<1||
    (j.versionNumber!==undefined&&j.versionNumber!==version.versionNumber))
  return {...proof,resume:versions.length?"VERSION_NOT_UNIQUELY_ATTESTED":"NO_FIXED_VERSION_VISIBLE"};
 const frozen=await api(base+"/content?versionNumber="+version.versionNumber,"GET");
 if(!matchesCandidate(frozen?.files,j.sourceDigest))throw Error("NEW_FROZEN_SOURCE_MISMATCH");
 google.manifestCheck(JSON.parse(frozen.files.find(file=>file.name==="appsscript").source));
 proof.immutableVersion="PASS";
 const deployments=await readPages(api,new URL(base+"/deployments"),"deployments",{optionalList:true});
 // Google may list an unversioned HEAD with its own owner-only web entry.
 const headEntries=deployments.filter(item=>[undefined,0].includes(item?.deploymentConfig?.versionNumber));
 if(headEntries.length>1||headEntries.some(item=>{
  const config=item?.deploymentConfig,entries=item?.entryPoints??[];
  if(!isId(item?.deploymentId)||item.deploymentId===j.deploymentId||config?.scriptId!==j.scriptId||
     config.manifestFileName!=="appsscript"||config.description||!Array.isArray(entries))return true;
  if(entries.length===0)return false;
  const entry=entries[0],web=entry?.webApp;
  return entries.length!==1||entry?.entryPointType!=="WEB_APP"||!webAppUrl.test(web?.url||"")||
   web.entryPointConfig?.access!=="MYSELF"||web.entryPointConfig?.executeAs!=="USER_DEPLOYING";
 }))throw Error("STAGE_HEAD_DEPLOYMENT_UNSAFE");
 const versioned=deployments.filter(item=>!headEntries.includes(item));
 const deployed=versioned.length===1?versioned[0]:null;
 if(!deployed||!isId(deployed.deploymentId)||deployed.deploymentId===r.deploymentId||
    deployed.deploymentConfig?.description!==deploymentDescription||
    (j.deploymentId&&j.deploymentId!==deployed.deploymentId))
  return {...proof,resume:versioned.length?"DEPLOYMENT_NOT_UNIQUELY_ATTESTED":"NO_PRIVATE_DEPLOYMENT_VISIBLE"};
 const reread=await api(base+"/deployments/"+encodeURIComponent(deployed.deploymentId),"GET");
 if(reread?.deploymentId!==deployed.deploymentId||reread.deploymentConfig?.manifestFileName!=="appsscript"||
    reread.deploymentConfig?.description!==deploymentDescription)throw Error("NEW_DEPLOYMENT_NOT_FOUND");
 const url=google.deploymentCheck(reread,j.scriptId,version.versionNumber);
 if(url===r.webAppUrl||receipt&&(receipt.webAppUrl!==url||receipt.owner!==old.owner||
    receipt.title!==j.title||receipt.sourceCommit!==j.sourceCommit||receipt.sourceDigest!==j.sourceDigest||
    receipt.previousReceiptDigest!==j.oldReceiptDigest||receipt.previousAuthDigest!==j.oldAuthDigest))
  throw Error("STAGE_RECEIPT_INVALID");
 return {...proof,privateDeployment:"PASS",resume:receipt&&j.step==="COMPLETE"?
  "OWNER_ACCEPTANCE_READY":"PRIVATE_DEPLOYMENT_VERIFIED_RECORD_INCOMPLETE"};
}

module.exports={titlePrefix,sheetFields,scope,isId,versionDescription,deploymentDescription,
 listStageSheets,verifyStageSheet,matchesCandidate,isEmptyProject,inspectRecordedStage};
