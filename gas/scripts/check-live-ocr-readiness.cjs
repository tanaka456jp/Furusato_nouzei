"use strict";
/**
 * Local-only live OCR acceptance gate for an attested, isolated Furusato GAS.
 * Default is entirely offline/read-only and prints no URLs, hashes or secrets.
 * Never deploys, creates, updates or adopts a Google project.
 */
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),cp=require("node:child_process");
const root=path.resolve(__dirname,"..");
const privateDir=path.join(root,".private","furusato");
const google=require("../deployment/private-gas.cjs");
const {openOwnerSystemBrowser}=require("../deployment/system-browser.cjs");
const policy=require("../deployment/policy.json");
const sourceNames=policy.sourceFiles;
const webAppUrl=/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;
const options=new Set(["--verify-remote","--probe-only","--authorize-owner","--run-synthetic","--ack-temporary-google-docs","--protected-root"]);
function parseArguments(args){
 const choices=new Set(args),i=args.indexOf("--protected-root");
 if(i>=0&&(i===args.length-1||args[i+1].startsWith("--")))throw Error("MISSING_PROTECTED_ROOT");
 const used=args.filter((v,j)=>i<0||j!==i+1);
 if(used.some(x=>!options.has(x)))throw Error("UNKNOWN_ARGUMENT");
 if((Number(choices.has("--probe-only"))+Number(choices.has("--run-synthetic"))+Number(choices.has("--authorize-owner")))>1)
  throw Error("OWNER_AUTH_PROBE_AND_OCR_ARE_EXCLUSIVE");
 if(choices.has("--run-synthetic")&&!choices.has("--ack-temporary-google-docs"))
  throw Error("EXPLICIT_TEMPORARY_GOOGLE_DOCUMENT_ACK_REQUIRED");
 if(choices.has("--ack-temporary-google-docs")&&!choices.has("--run-synthetic"))
  throw Error("TEMPORARY_GOOGLE_DOCUMENT_ACK_WITHOUT_RUN");
 return {verify:choices.has("--verify-remote")||choices.has("--run-synthetic")||choices.has("--probe-only")||choices.has("--authorize-owner"),
  probe:choices.has("--probe-only"),authorizeOwner:choices.has("--authorize-owner"),run:choices.has("--run-synthetic"),
  protectedRoot:i>=0?path.resolve(args[i+1]):path.resolve(root,"..","..","HousingERP")};
}
/**
 * Offline shape check only. Never prints, exports, refreshes or hashes tokens.
 * Mirrors the fields private-gas.cjs/accessToken actually requires.
 */
function inspectIsolatedAuth(file){
 let stat;
 try{stat=fs.lstatSync(file);}catch(e){return e.code==="ENOENT"?"MISSING":"INVALID";}
 if(!stat.isFile()||stat.size<2||stat.size>1024*1024)return "INVALID";
 try{
  const data=JSON.parse(fs.readFileSync(file,"utf8").replace(/^\uFEFF/,""));
  const token=data?.tokens?.default;
  const valid=["refresh_token","client_id","client_secret"].every(k=>
   typeof token?.[k]==="string"&&token[k].trim().length>0&&!/[\r\n]/.test(token[k]));
  return valid?"VALID":"INVALID";
 }catch{return "INVALID";}
}
function evaluateReadiness(data){
 const problems=[];
 const fail=(code,test)=>{if(test)problems.push(code);};
 const r=data.receipt;
 fail("PRIVATE_RECEIPT_MISSING",!r);
 if(r){
  fail("RECEIPT_NOT_ATTESTED",
   r.schema!==policy.schema||r.createdByInstaller!==true||
   !google.hasProtectedAttestation(r)||
   typeof r.title!=="string"||!r.title.startsWith(policy.projectPrefix)||
   !(Number.isSafeInteger(r.versionNumber)&&r.versionNumber>=1)||
   typeof r.deploymentId!=="string"||!r.deploymentId||
   typeof r.webAppUrl!=="string"||!webAppUrl.test(r.webAppUrl)||
   !r.privateVerifiedAt);
  fail("GOOGLE_SOURCE_DIGEST_MISMATCH",r.uploadDigest!==data.sourceDigest);
 }
 fail("SOURCE_DIFFERS_FROM_GIT_HEAD",data.gitHeadMatches!==true);
 fail("ISOLATED_AUTH_UNAVAILABLE",data.authExists!==true);
 fail("ISOLATED_AUTH_FORMAT_INVALID",data.authExists===true&&data.authValid!==true);
 fail("ISOLATED_CLASP_CONFIG_UNAVAILABLE",data.claspExists!==true);
 // No receipt means no saved protection baseline exists to compare against.
 fail("PROTECTED_CONFIG_DRIFT",!!r&&data.protectedStatus!=="MATCH");
 return {status:problems.length?"HOLD":"READY_FOR_REMOTE_VERIFY",
  release:"HOLD",scope:"ISOLATED_SYNTHETIC_ONLY",problems};
}
function committedSourceDigest(){
 // Validate that the actual five published sources are committed at this HEAD.
 const git=args=>cp.execFileSync("git",args,{cwd:root,encoding:"utf8",stdio:["ignore","pipe","pipe"],timeout:10000});
 const head=git(["rev-parse","HEAD"]).trim();
 if(!/^[a-f0-9]{40}$/.test(head))throw Error("UNVERIFIED_GIT_HEAD");
 const files=sourceNames.map(name=>{
  const p=path.posix.join("gas",name);
  const content=git(["show",head+":"+p]);
  return {name:name.replace(/\.(gs|html|json)$/,""),
    type:name.endsWith(".gs")?"SERVER_JS":name.endsWith(".html")?"HTML":"JSON",source:content};
 });
 return google.digest(files);
}
function readLocalReadiness(protectedRoot){
 google.preflight();
 google.rejectLinks([privateDir,path.join(privateDir,"receipt.json"),path.join(privateDir,"auth.json"),
  path.join(privateDir,"project"),path.join(privateDir,"project",".clasp.json")]);
 const receiptFile=path.join(privateDir,"receipt.json");
 let receipt=null;
 if(fs.existsSync(receiptFile)){
  try{receipt=JSON.parse(fs.readFileSync(receiptFile,"utf8"));}catch{throw Error("UNREADABLE_PRIVATE_RECEIPT");}
 }
 let protectedStatus="HOLD";
 if(receipt){
  try{protectedStatus=google.configDriftReport(receipt,protectedRoot).status;}
  catch{protectedStatus="HOLD";}
 }
 const localDigest=google.digest(google.source());
 let headMatches=false;
 try{headMatches=committedSourceDigest()===localDigest;}catch{}
 return evaluateReadiness({receipt,sourceDigest:localDigest,gitHeadMatches:headMatches,
  authExists:fs.existsSync(path.join(privateDir,"auth.json")),
  authValid:inspectIsolatedAuth(path.join(privateDir,"auth.json"))==="VALID",
  claspExists:fs.existsSync(path.join(privateDir,"project",".clasp.json")),
  protectedStatus});
}
function runChild(args,{interactiveOwner=false}={}){
 const r=cp.spawnSync(process.execPath,args,{cwd:root,encoding:"utf8",
  // The owner must SEE the dedicated browser. Do not collect/publish the
  // consent screen, OAuth credentials or any Google URL as a CI artifact.
  stdio:interactiveOwner?"inherit":"pipe",
  windowsHide:!interactiveOwner,timeout:interactiveOwner?12*60*1000:8*60*1000});
 if(r.status!==0){
  // Only relay a known, bounded failure category. Child errors and stack traces
  // can contain OAuth headers, Google project URLs or local private paths.
  const match=String(r.stderr||"").match(/PRIVATE_LIVE_BROWSER_HOLD (OWNER_WEB_APP_AUTH_REQUIRED|LOCAL_BROWSER_UNAVAILABLE|DRIVE_DIAGNOSTIC_FAILED|OCR_RESPONSE_FAILED|TIMEOUT|LOCAL_PDF_VALIDATION_FAILED|LIVE_STEP_FAILED) (INITIALIZE|PRIVATE_DEPLOYMENT_VERIFY|PRIVATE_BROWSER_SETUP|WEB_APP_NAVIGATION|OWNER_WEB_APP_FRAME|STANDARD_TAX_CALCULATION|PRINT_PDF|MOBILE_LAYOUT|MORTGAGE_HOLD|DRIVE_DIAGNOSTICS|OCR_PNG|OCR_PDF|OCR_JPEG|SEPARATE_TAX|CLEANUP_BROWSER)/);
  if(match)console.error("LIVE_OCR_SAFE_FAILURE: "+match[1]+"; step="+match[2]);
  throw Error("PRIVATE_GOOGLE_VERIFICATION_OR_SYNTHETIC_OCR_FAILED");
 }
}
function main(args){
 const opt=parseArguments(args);
 if(process.env.CI&&(opt.run||opt.probe||opt.authorizeOwner))throw Error("LIVE_GOOGLE_OCR_MUST_RUN_OUTSIDE_CI");
 const local=readLocalReadiness(opt.protectedRoot);
 console.log(JSON.stringify(local));
 if(local.status!=="READY_FOR_REMOTE_VERIFY"){process.exitCode=2;return;}
 if(!opt.verify)return;
 // Read-only Google API checks of owner, immutable version, source digest,
 // protected HousingERP and dedicated synthetic spreadsheet.
 runChild([path.join(root,"deployment","private-gas.cjs"),"verify","--attest-head",
  "--protected-root",opt.protectedRoot]);
 console.log("REMOTE_PRIVATE_IMMUTABLE_VERSION_MATCH: PASS (release HOLD)");
 if(opt.authorizeOwner){
  // Google may reject sign-in inside software-controlled browsers.
  // Use the Windows default browser, with NO Playwright/remote control.
  // Manual account confirmation is required; browser launch is not a PASS.
  const receiptPath=path.join(privateDir,"receipt.json");
  const receipt=JSON.parse(fs.readFileSync(receiptPath,"utf8"));
  const result=openOwnerSystemBrowser(receipt.webAppUrl);
  if(result.status!=="OPENED")throw Error("OWNER_SYSTEM_BROWSER_OPEN_FAILED");
  console.log("OWNER_SYSTEM_BROWSER_OPENED: MANUAL_REVIEW_REQUIRED; OCR NOT EXECUTED; release HOLD");
  return;
 }
 if(opt.probe){
  // GET-only Web App navigation. Browser exits before clicking workflow inputs,
  // invoking OCR, or creating Google temporary documents.
  runChild([path.join(root,"tests","test-real-browser.cjs"),"--live","--attest-head",
   "--probe-only","--protected-root",opt.protectedRoot]);
  console.log("REAL_GOOGLE_WEB_APP_PROBE: PASS; OCR NOT EXECUTED; release HOLD");
 }
 if(opt.run){
  // This operation creates and removes only Google temporary OCR documents
  // under the already attested Furusato-private synthetic deployment.
  runChild([path.join(root,"tests","test-real-browser.cjs"),"--live","--attest-head",
   "--protected-root",opt.protectedRoot]);
  console.log("REAL_GOOGLE_SYNTHETIC_OCR: PASS; inspect private evidence for PNG/PDF/JPEG and cleanup (release HOLD)");
 }
}
module.exports={parseArguments,evaluateReadiness,inspectIsolatedAuth,committedSourceDigest,readLocalReadiness};
if(require.main===module)try{main(process.argv.slice(2));}catch(e){
 const allow=new Set(["MISSING_PROTECTED_ROOT","UNKNOWN_ARGUMENT","EXPLICIT_TEMPORARY_GOOGLE_DOCUMENT_ACK_REQUIRED",
  "TEMPORARY_GOOGLE_DOCUMENT_ACK_WITHOUT_RUN","UNREADABLE_PRIVATE_RECEIPT","UNVERIFIED_GIT_HEAD",
  "LIVE_GOOGLE_OCR_MUST_RUN_OUTSIDE_CI","OWNER_AUTH_PROBE_AND_OCR_ARE_EXCLUSIVE",
  "UNVERIFIED_PRIVATE_WEB_APP_URL","OWNER_SYSTEM_BROWSER_WINDOWS_ONLY","OWNER_SYSTEM_BROWSER_OPEN_FAILED",
  "PRIVATE_GOOGLE_VERIFICATION_OR_SYNTHETIC_OCR_FAILED"]);
 console.error("LIVE_OCR_HOLD: "+(allow.has(e.message)?e.message:"LOCAL_PRIVATE_STATE_UNVERIFIED"));
 process.exitCode=1;
}
