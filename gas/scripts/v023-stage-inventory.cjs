"use strict";
/**
 * Dedicated OAuth, Drive GET-only inventory for NEW v0.1.23 stages.
 * Include trashed files: ambiguous or partial prior creation MUST stop
 * before any possible write or retry. Never print resource identifiers.
 *
 * This list can only establish zero results within the dedicated OAuth's
 * visible corpus. Apps Script projects orphaned from a parent sheet cannot
 * be enumerated by the parent ID: this is NOT an account-wide guarantee.
 */
const policy=require("../deployment/policy.json");
const {isId}=require("./v020-stage-inventory.cjs");
const scope="DEDICATED_OAUTH_USER_CORPUS_INCLUDING_TRASH";
const titlePrefix=policy.projectPrefix+"V023_STAGE_";
const markerKey="furusatoStage";
const markerValue="v023-private";
const fields="nextPageToken,incompleteSearch,files(id,name,mimeType,trashed,appProperties)";
async function listV023StageCandidates(api){
 const url=new URL("https://www.googleapis.com/drive/v3/files");
 url.searchParams.set("q",
  "name contains '"+titlePrefix+"' or appProperties has { key='"+markerKey+
  "' and value='"+markerValue+"' }");
 url.searchParams.set("corpora","user");
 url.searchParams.set("spaces","drive");
 url.searchParams.set("pageSize","100");
 url.searchParams.set("fields",fields);
 const seenPages=new Set(),seenIds=new Set();
 const rows=[];
 for(let i=0;i<100;i++){
  const response=await api(url.toString(),"GET");
  if(!response||typeof response!=="object"||Array.isArray(response)||
   response.incompleteSearch===true||!Array.isArray(response.files))
   throw Error("V023_REMOTE_INVENTORY_UNVERIFIED");
  for(const file of response.files){
   if(!isId(file?.id)||typeof file.name!=="string"||
      typeof file.mimeType!=="string"||typeof file.trashed!=="boolean"||
      seenIds.has(file.id))
    throw Error("V023_REMOTE_INVENTORY_UNVERIFIED");
   seenIds.add(file.id);
   rows.push(file);
  }
  if(response.nextPageToken===undefined)return rows;
  const token=response.nextPageToken;
  if(typeof token!=="string"||!token||token.length>8192||
     seenPages.has(token))
   throw Error("V023_REMOTE_INVENTORY_UNVERIFIED");
  seenPages.add(token);
  url.searchParams.set("pageToken",token);
 }
 throw Error("V023_REMOTE_INVENTORY_UNVERIFIED");
}
function classifyV023Inventory(rows){
 if(!Array.isArray(rows))return {status:"HOLD",scope,
  reason:"REMOTE_INVENTORY_UNVERIFIED",matchingResources:null};
 // Do not infer whether a recorded resource was created or is safe to
 // overwrite. Any visible match, including trash, blocks a new stage.
 if(rows.length>0)return {status:"HOLD",scope,
  reason:"V023_STAGE_POSSIBLY_EXISTS",matchingResources:rows.length};
 return {status:"PASS",scope,
  reason:"NO_V023_MATCH_VISIBLE_IN_DEDICATED_OAUTH_SCOPE",
  matchingResources:0};
}
async function auditV023Inventory(api){
 return classifyV023Inventory(await listV023StageCandidates(api));
}
module.exports={
 scope,titlePrefix,markerKey,markerValue,listV023StageCandidates,
 classifyV023Inventory,auditV023Inventory
};
