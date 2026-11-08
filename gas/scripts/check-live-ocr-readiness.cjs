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
const policy=require("../deployment/policy.json");
const sourceNames=policy.sourceFiles;
const webAppUrl=/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;
const options=new Set(["--verify-remote","--run-synthetic","--ack-temporary-google-docs","--protected-root"]);
function parseArguments(args){
 const choices=new Set(args),i=args.indexOf("--protected-root");
 if(i>=0&&(i===args.length-1||args[i+1].startsWith("--")))throw Error("MISSING_PROTECTED_ROOT");
 const used=args.filter((v,j)=>i<0||j!==i+1);
 if(used.some(x=>!options.has(x)))throw Error("UNKNOWN_ARGUMENT");
 if(choices.has("--run-synthetic")&&!choices.has("--ack-temporary-google-docs"))
  throw Error("EXPLICIT_TEMPORARY_GOOGLE_DOCUMENT_ACK_REQUIRED");
 if(choices.has("--ack-temporary-google-docs")&&!choices.has("--run-synthetic"))
  throw Error("TEMPORARY_GOOGLE_DOCUMENT_ACK_WITHOUT_RUN");
 return {verify:choices.has("--verify-remote")||choices.has("--run-synthetic"),
  run:choices.has("--run-synthetic"),
  protectedRoot:i>=0?path.resolve(args[i+1]):path.resolve(root,"..","..","HousingERP")};
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
 fail("ISOLATED_CLASP_CONFIG_UNAVAILABLE",data.claspExists!==true);
 fail("PROTECTED_CONFIG_DRIFT",data.protectedStatus!=="MATCH");
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
  claspExists:fs.existsSync(path.join(privateDir,"project",".clasp.json")),
  protectedStatus});
}
function runChild(args){
 const r=cp.spawnSync(process.execPath,args,{cwd:root,encoding:"utf8",stdio:"pipe",
  windowsHide:true,timeout:8*60*1000});
 if(r.status!==0)throw Error("PRIVATE_GOOGLE_VERIFICATION_OR_SYNTHETIC_OCR_FAILED");
}
function main(args){
 const opt=parseArguments(args);
 if(process.env.CI&&opt.run)throw Error("LIVE_GOOGLE_OCR_MUST_RUN_OUTSIDE_CI");
 const local=readLocalReadiness(opt.protectedRoot);
 console.log(JSON.stringify(local));
 if(local.status!=="READY_FOR_REMOTE_VERIFY"){process.exitCode=2;return;}
 if(!opt.verify)return;
 // Read-only Google API checks of owner, immutable version, source digest,
 // protected HousingERP and dedicated synthetic spreadsheet.
 runChild([path.join(root,"deployment","private-gas.cjs"),"verify","--attest-head",
  "--protected-root",opt.protectedRoot]);
 console.log("REMOTE_PRIVATE_IMMUTABLE_VERSION_MATCH: PASS (release HOLD)");
 if(opt.run){
  // This operation creates and removes only Google temporary OCR documents
  // under the already attested Furusato-private synthetic deployment.
  runChild([path.join(root,"tests","test-real-browser.cjs"),"--live","--attest-head",
   "--token-auth","--protected-root",opt.protectedRoot]);
  console.log("REAL_GOOGLE_SYNTHETIC_OCR: PASS; inspect private evidence for PNG/PDF/JPEG and cleanup (release HOLD)");
 }
}
module.exports={parseArguments,evaluateReadiness,committedSourceDigest,readLocalReadiness};
if(require.main===module)try{main(process.argv.slice(2));}catch(e){
 const allow=new Set(["MISSING_PROTECTED_ROOT","UNKNOWN_ARGUMENT","EXPLICIT_TEMPORARY_GOOGLE_DOCUMENT_ACK_REQUIRED",
  "TEMPORARY_GOOGLE_DOCUMENT_ACK_WITHOUT_RUN","UNREADABLE_PRIVATE_RECEIPT","UNVERIFIED_GIT_HEAD",
  "LIVE_GOOGLE_OCR_MUST_RUN_OUTSIDE_CI","PRIVATE_GOOGLE_VERIFICATION_OR_SYNTHETIC_OCR_FAILED"]);
 console.error("LIVE_OCR_HOLD: "+(allow.has(e.message)?e.message:"LOCAL_PRIVATE_STATE_UNVERIFIED"));
 process.exitCode=1;
}
