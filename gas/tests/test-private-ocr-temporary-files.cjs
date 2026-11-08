"use strict";
const assert=require("node:assert/strict");
const {checkPage,countTemporaryDocuments}=require("../scripts/check-private-ocr-temporary-files.cjs");
async function main(){
 const queries=[];
 const mock=pages=>async (url,method="GET")=>{
  assert.equal(method,"GET","Drive cleanup inspector may only call GET");
  const u=new URL(url);
  assert.equal(u.origin,"https://www.googleapis.com");
  assert.equal(u.pathname,"/drive/v3/files");
  assert.equal(u.searchParams.get("q"),"trashed = false and name contains 'Furusato_OCR_TEMP_'");
  assert.equal(u.searchParams.get("pageSize"),"100");
  assert.equal(u.searchParams.get("fields"),"nextPageToken,files(name)");
  queries.push(u.toString());
  const index=queries.length-1;
  return pages[index];
 };
 let result=await countTemporaryDocuments(mock([{files:[]}]));
 assert.deepEqual({...result},{status:"PASS",temporaryOcrFiles:0,pages:1,
  coverage:"FURUSATO_DEDICATED_OAUTH_SCOPE_ONLY",release:"HOLD"});
 queries.length=0;
 result=await countTemporaryDocuments(mock([
  {files:[{name:"Furusato_OCR_TEMP_1"}],nextPageToken:"TWO"},
  {files:[{name:"Furusato_OCR_TEMP_2"}]}
 ]));
 assert.equal(result.status,"HOLD");
 assert.equal(result.temporaryOcrFiles,2);
 assert.equal(result.pages,2);
 assert.equal(new URL(queries[1]).searchParams.get("pageToken"),"TWO");
 for(const invalid of [null,{}, {files:null}, {files:[{name:"not-our-file"}]},
  {files:[{}]}, {files:[],nextPageToken:99},
  {files:[],nextPageToken:""}]){
  assert.throws(()=>checkPage(invalid));
 }
 queries.length=0;
 await assert.rejects(()=>countTemporaryDocuments(mock([
  {files:[],nextPageToken:"abc"},
  {files:[],nextPageToken:"abc"}
 ])),/DRIVE_LIST_REPEATED_PAGE/);
 queries.length=0;
 let submitted=false;
 await assert.rejects(()=>countTemporaryDocuments(async ()=>{submitted=true;throw Error("SECRET_GOOGLE_API_ERROR");}),
  /SECRET_GOOGLE_API_ERROR/);
 assert.equal(submitted,true);
 const secret="secret-should-not-print";
 assert.ok(!JSON.stringify(result).includes(secret));
 assert.ok(!JSON.stringify(result).includes("Furusato_OCR_TEMP_1"),
  "The report must contain counts only, no Drive file names");
 console.log("PRIVATE_OCR_DRIVE_READ_ONLY_COUNT_CONTRACT_PASS; synthetic only, no Google access");
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
