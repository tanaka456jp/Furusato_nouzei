"use strict";
/**
 * Read-only count of Google Drive OCR temporary docs visible to the isolated
 * Furusato OAuth principal and scopes. Never enumerates names/IDs to stdout.
 * Does not create, update, move, or delete any Google file.
 */
const path=require("node:path"),cp=require("node:child_process");
const {readLocalReadiness}=require("./check-live-ocr-readiness.cjs");
const {accessToken,googleApi}=require("../deployment/private-gas.cjs");
const root=path.resolve(__dirname,"..");
const PREFIX="Furusato_OCR_TEMP_";
function checkPage(page){
 if(!page||typeof page!=="object"||!Array.isArray(page.files))
  throw Error("DRIVE_LIST_RESPONSE_INVALID");
 if(page.files.length>100)throw Error("DRIVE_LIST_PAGE_OVERFLOW");
 for(const f of page.files){
  if(!f||typeof f.name!=="string"||!f.name.startsWith(PREFIX))
   throw Error("DRIVE_LIST_UNEXPECTED_NAME");
 }
 if(page.nextPageToken!==undefined && (typeof page.nextPageToken!=="string"||
   !page.nextPageToken.length||page.nextPageToken.length>8192))
  throw Error("DRIVE_LIST_PAGE_TOKEN_INVALID");
 return {count:page.files.length,next:page.nextPageToken||""};
}
async function countTemporaryDocuments(api){
 if(typeof api!=="function")throw Error("DRIVE_CLIENT_UNAVAILABLE");
 let token="",count=0,pages=0;
 const seen=new Set();
 do{
  if(++pages>100)throw Error("DRIVE_LIST_NOT_EXHAUSTIVE");
  const url=new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q","trashed = false and name contains '"+PREFIX+"'");
  url.searchParams.set("fields","nextPageToken,files(name)");
  url.searchParams.set("pageSize","100");
  url.searchParams.set("spaces","drive");
  if(token)url.searchParams.set("pageToken",token);
  const page=checkPage(await api(url.toString()));
  count+=page.count;
  if(!page.next)break;
  if(seen.has(page.next))throw Error("DRIVE_LIST_REPEATED_PAGE");
  seen.add(page.next);token=page.next;
 }while(true);
 return {status:count===0?"PASS":"HOLD",temporaryOcrFiles:count,pages,
  coverage:"FURUSATO_DEDICATED_OAUTH_SCOPE_ONLY",release:"HOLD"};
}
async function main(){
 if(process.env.CI)throw Error("LIVE_GOOGLE_CALL_PROHIBITED_IN_CI");
 if(process.argv.length!==2)throw Error("UNKNOWN_ARGUMENT");
 const dir=path.resolve(root,"..","..","HousingERP");
 const readiness=readLocalReadiness(dir);
 if(readiness.status!=="READY_FOR_REMOTE_VERIFY")throw Error("LOCAL_SAFE_READINESS_HOLD");
 // Verify live owner, immutable source, deployment and HousingERP protection
 // before querying Drive; never skip this read-only API attestation.
 cp.execFileSync(process.execPath,[path.join(root,"scripts","check-live-ocr-readiness.cjs"),
  "--verify-remote"],{cwd:root,stdio:"pipe",timeout:120000});
 const report=await countTemporaryDocuments(googleApi(await accessToken()));
 console.log(JSON.stringify(report));
 if(report.status!=="PASS")process.exitCode=2;
}
module.exports={checkPage,countTemporaryDocuments};
if(require.main===module)main().catch(e=>{
 const allow=new Set(["LIVE_GOOGLE_CALL_PROHIBITED_IN_CI","UNKNOWN_ARGUMENT",
  "LOCAL_SAFE_READINESS_HOLD","DRIVE_LIST_RESPONSE_INVALID","DRIVE_LIST_PAGE_OVERFLOW",
  "DRIVE_LIST_UNEXPECTED_NAME","DRIVE_LIST_PAGE_TOKEN_INVALID","DRIVE_LIST_NOT_EXHAUSTIVE",
  "DRIVE_LIST_REPEATED_PAGE","DRIVE_CLIENT_UNAVAILABLE"]);
 // Do not print raw Google errors: they may reveal HTTP request details.
 console.error("TEMP_OCR_DRIVE_CHECK_HOLD: "+(allow.has(e.message)?e.message:"GOOGLE_VERIFICATION_UNAVAILABLE"));
 process.exitCode=1;
});
