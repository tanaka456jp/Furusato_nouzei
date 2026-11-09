"use strict";
/** All synthetic. GET-only Drive inventory has NO credentials or network calls. */
const assert=require("node:assert/strict");
const {listV023StageCandidates,classifyV023Inventory,auditV023Inventory,
 titlePrefix,markerKey,markerValue,scope}=require("../scripts/v023-stage-inventory.cjs");
const sheet={
 id:"stage_001",name:titlePrefix+"00000000-0000-0000-0000-000000000001",
 mimeType:"application/vnd.google-apps.spreadsheet",trashed:false,
 appProperties:{furusatoStage:markerValue}
};
const trashed={...sheet,id:"stage_002",trashed:true};
async function test(){
 let calls=0;
 const inventory=async(url,method)=>{
  calls++;
  assert.equal(method,"GET");
  const u=new URL(url);
  assert.equal(u.hostname,"www.googleapis.com");
  assert.equal(u.pathname,"/drive/v3/files");
  assert.equal(u.searchParams.get("corpora"),"user");
  assert.equal(u.searchParams.get("spaces"),"drive");
  assert.match(u.searchParams.get("q"),/V023_STAGE_/);
  assert.ok(u.searchParams.get("q").includes(markerKey));
  assert.ok(u.searchParams.get("q").includes(markerValue));
  // Trashed matches MUST remain visible, not silently excluded.
  assert.doesNotMatch(u.searchParams.get("q"),/trashed\s*=/i);
  assert.match(u.searchParams.get("fields"),/nextPageToken/);
  assert.match(u.searchParams.get("fields"),/incompleteSearch/);
  return u.searchParams.has("pageToken")?
   {files:[trashed]}:{files:[sheet],nextPageToken:"PAGE_2"};
 };
 const rows=await listV023StageCandidates(inventory);
 assert.equal(rows.length,2);
 assert.equal(calls,2);
 const found=classifyV023Inventory(rows);
 assert.equal(found.status,"HOLD");
 assert.equal(found.reason,"V023_STAGE_POSSIBLY_EXISTS");
 assert.equal(found.matchingResources,2);
 assert.equal(found.scope,scope);
 assert.equal(classifyV023Inventory([trashed]).status,"HOLD");
 assert.equal(classifyV023Inventory(null).status,"HOLD");
 const zero=await auditV023Inventory(async(_url,method)=>{
  assert.equal(method,"GET");return {files:[]};
 });
 assert.equal(zero.status,"PASS");
 assert.equal(zero.matchingResources,0);
 assert.equal(zero.reason,"NO_V023_MATCH_VISIBLE_IN_DEDICATED_OAUTH_SCOPE");
 for(const reply of [
  {files:[],incompleteSearch:true},{files:null},
  {files:[{...sheet,id:"x"}]},{files:[sheet,sheet]},
  {files:[],nextPageToken:""}
 ]){
  await assert.rejects(()=>listV023StageCandidates(async()=>reply),
   /V023_REMOTE_INVENTORY_UNVERIFIED/);
 }
 await assert.rejects(()=>listV023StageCandidates(async()=>({
  files:[],nextPageToken:"DUPLICATE"
 })),/V023_REMOTE_INVENTORY_UNVERIFIED/);
 let callsCount=0;
 await assert.rejects(()=>listV023StageCandidates(async()=>{
  callsCount++;
  return callsCount===1?{files:[sheet],nextPageToken:"NEXT"}:
   {files:[sheet]};
 }),/V023_REMOTE_INVENTORY_UNVERIFIED/);
 // A response must expose an explicit trash bit for every candidate;
 // missing fields mean we cannot safely say whether creation happened.
 await assert.rejects(()=>listV023StageCandidates(async()=>({
  files:[{...sheet,trashed:undefined}]
 })),/V023_REMOTE_INVENTORY_UNVERIFIED/);
 console.log("V023_DRIVE_GET_ONLY_INVENTORY_SYNTHETIC_PASS; no Google; release HOLD");
}
test().catch(error=>{console.error(error);process.exitCode=1;});
