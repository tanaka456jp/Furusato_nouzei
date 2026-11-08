"use strict";
// Read-only and strictly allowlisted summary of LOCAL synthetic GAS browser evidence.
// Never prints Google URLs/IDs, authentication, file paths, hashes or raw exceptions.
const fs=require("node:fs"),path=require("node:path");
const file=path.resolve(__dirname,"..",".private","furusato","evidence","browser-evidence.json");
const allowedChecks=new Set(["TAX-700","PRINT-PDF","MOBILE","HOLD-MORTGAGE","GOOGLE-DRIVE-API",
 "GOOGLE-OCR-PNG","GOOGLE-OCR-PDF","GOOGLE-OCR-JPEG","GOOGLE-SPLIT-EXACT-HOLD-RECOVERY","GOOGLE-SPLIT-DESIGNATED-CITY"]);
const allowedStages=new Set(["INITIALIZE","PRIVATE_DEPLOYMENT_VERIFY","PRIVATE_BROWSER_SETUP","WEB_APP_NAVIGATION","OWNER_WEB_APP_FRAME","STANDARD_TAX_CALCULATION","PRINT_PDF","MOBILE_LAYOUT","MORTGAGE_HOLD","DRIVE_DIAGNOSTICS","OCR_PNG","OCR_PDF","OCR_JPEG","SEPARATE_TAX","CLEANUP_BROWSER"]);
const allowedCodes=new Set(["OWNER_WEB_APP_AUTH_REQUIRED","LOCAL_BROWSER_UNAVAILABLE","DRIVE_DIAGNOSTIC_FAILED",
 "OCR_RESPONSE_FAILED","TIMEOUT","LOCAL_PDF_VALIDATION_FAILED","LIVE_STEP_FAILED"]);
function summarize(e){
 if(!e||typeof e!=="object"||Array.isArray(e))return {status:"INVALID",release:"HOLD"};
 const checks=Array.isArray(e.tests)?e.tests.filter(x=>x&&allowedChecks.has(x.id)&&x.status==="PASS")
   .map(x=>x.id):[];
 return {status:e.status==="PASS"?"PASS":"HOLD",release:"HOLD",
  environment:e.environment==="REAL_GOOGLE_WEB_APP"?"REAL_GOOGLE_WEB_APP":"UNVERIFIED",
  completedChecks:[...new Set(checks)],
  failureStage:allowedStages.has(e.failureStage)?e.failureStage:"UNRECORDED",
  failureCode:allowedCodes.has(e.failureCode)?e.failureCode:"UNRECORDED",
  format:e.failureStage?"STAGED":"LEGACY_NO_FAILURE_STAGE",
  note:"No Google access or mutation; inspect only local synthetic browser evidence"};
}
function main(){
 let evidence;
 try{
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.size>1024*1024)throw Error("BAD_FILE");
  evidence=JSON.parse(fs.readFileSync(file,"utf8"));
 }catch{console.log(JSON.stringify({status:"NO_VALID_PRIVATE_EVIDENCE",release:"HOLD"}));return;}
 console.log(JSON.stringify(summarize(evidence)));
}
module.exports={summarize};
if(require.main===module)main();
