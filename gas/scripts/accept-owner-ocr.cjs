"use strict";
// The owner uses their ordinary browser. The CLI only opens the attested URL,
// records owner observations, and runs the independent read-only Drive audit.
const cp=require("node:child_process"),fs=require("node:fs"),path=require("node:path");
const readline=require("node:readline/promises");
const {randomUUID}=require("node:crypto");
const {rejectLinks}=require("../deployment/private-gas.cjs");
const root=path.resolve(__dirname,"..");
const privateDir=path.join(root,".private","furusato");
const evidenceDir=path.join(privateDir,"evidence");
const fixtureDir=path.join(privateDir,"owner-fixtures");

function localNode(name,args=[]){
 return cp.spawnSync(process.execPath,[path.join(__dirname,name),...args],{
  cwd:root,encoding:"utf8",stdio:"pipe",windowsHide:true,timeout:150000
 });
}

function auditDrive(){
 const run=localNode("check-private-ocr-temporary-files.cjs");
 try {
  const row=JSON.parse(run.stdout);
  if(row.coverage!=="FURUSATO_DEDICATED_OAUTH_SCOPE_ONLY"||
    !Number.isSafeInteger(row.temporaryOcrFiles)||row.temporaryOcrFiles<0||
    !Number.isSafeInteger(row.pages)||row.pages<1)throw Error();
  if(run.status===0&&row.status==="PASS"&&row.temporaryOcrFiles===0)
   return {status:"PASS",temporaryOcrFiles:0,pages:row.pages,protection:"PASS"};
  if(run.status===2&&row.status==="HOLD"&&row.temporaryOcrFiles>0)
   return {status:"HOLD",temporaryOcrFiles:row.temporaryOcrFiles,pages:row.pages,protection:"PASS"};
 } catch {}
 return {status:"HOLD",temporaryOcrFiles:null,protection:"UNVERIFIED"};
}

async function main(){
 const args=process.argv.slice(2),iphone=args.length===1&&args[0]==="--iphone";
 if((args.length&&!iphone)||process.env.CI||process.platform!=="win32"||!process.stdin.isTTY)
  throw Error("OWNER_WINDOWS_INTERACTIVE_ONLY");
 const formats=iphone?["jpeg"]:["pdf","png","jpeg"];
 const revision=cp.execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8",windowsHide:true}).trim();
 if(!/^[a-f0-9]{40}$/.test(revision))throw Error("GIT_HEAD_UNVERIFIED");
 rejectLinks([privateDir,evidenceDir,fixtureDir,...formats.map(ext=>path.join(fixtureDir,"synthetic-slip."+ext))]);
 if(!formats.every(ext=>fs.existsSync(path.join(fixtureDir,"synthetic-slip."+ext))))
  throw Error("OWNER_SYNTHETIC_FIXTURES_MISSING");
 fs.mkdirSync(evidenceDir,{recursive:true});
 const evidencePath=path.join(evidenceDir,"owner-ocr-"+randomUUID()+".json");
 const record={protocolRevision:1,release:"HOLD",status:"HOLD",sourceCommit:revision,
  startedAt:new Date().toISOString(),device:iphone?"IPHONE_SAFARI_OWNER_OBSERVED":"WINDOWS_EDGE_OWNER_OBSERVED",
  driveCoverage:"FURUSATO_DEDICATED_OAUTH_SCOPE_ONLY_INCLUDING_TRASH",results:[]};
 const terminal=readline.createInterface({input:process.stdin,output:process.stdout});
 const ask=async message=>{
  while(true){
   const answer=(await terminal.question(message+" [y=確認 / n=不合格 / s=中止] ")).trim().toLowerCase();
   if(answer==="y")return "PASS";
   if(answer==="n")return "FAIL";
   if(answer==="s")return "NOT_TESTED";
  }
 };
 try{
  console.log("専用Google Driveと保護対象の照合中です。");
  record.before=auditDrive();
  console.log("OCR前の診断 "+JSON.stringify(record.before));
  if(record.before.status!=="PASS")return;
  if(iphone){
   console.log("iPhone実機のSafariで、所有者アカウントを使い既存の非公開GASを開いてください。");
  }else{
   if(localNode("check-live-ocr-readiness.cjs",["--authorize-owner"]).status!==0)
    throw Error("OWNER_SYSTEM_BROWSER_OPEN_FAILED");
   console.log("通常のMicrosoft Edgeで操作してください。必要な場合は所有者としてログインします。");
  }
  console.log("合成ファイルの場所 "+fixtureDir);
  for(const format of formats){
   const row={format:format.toUpperCase()};
   record.results.push(row);
   console.log("\n所得年を2025年に戻し、給与入力欄の3金額を空にしてから、synthetic-slip."+format+" を選択してください。");
   console.log("2件目以降は、直前のGoogle転送同意にチェックが入った状態で次のファイルを選択します。");
   row.consentReset=await ask("ファイル選択後、転送同意のチェックは外れていますか？");
   if(row.consentReset!=="PASS")break;
   console.log("合成ファイルの転送に同意してOCRを1回実行します。2026年への変更はSTEP 1で確認できます。");
   row.candidates=await ask("OCR完了と仮転記を確認しましたか？ 2026年、7,000,000円、1,000,000円、5,200,000円");
   if(row.candidates!=="NOT_TESTED"){
    console.log("原票照合は行わず、控除・扶養の該当有無だけを確認し、計算を実行してください。");
    row.unreviewedHold=await ask("結果は計算停止で、原票未照合の理由が表示されていますか？");
   }
   row.after=auditDrive();
   console.log("OCR後の診断 "+JSON.stringify(row.after));
   if(row.after.status!=="PASS"||row.candidates==="NOT_TESTED"||row.unreviewedHold==="NOT_TESTED")break;
   console.log("次の形式がある場合は、入力を修正して給与入力画面に戻ります。");
  }
  if(record.results.length===formats.length&&record.results.every(row=>
   row.consentReset==="PASS"&&row.candidates==="PASS"&&row.unreviewedHold==="PASS"&&row.after?.status==="PASS"))
   record.status="PASS";
 }finally{
  terminal.close();
  record.finishedAt=new Date().toISOString();
  fs.writeFileSync(evidencePath,JSON.stringify(record,null,2)+"\n",{flag:"wx",mode:0o600});
  console.log("OWNER_OCR="+record.status+"; RELEASE=HOLD; evidence/"+path.basename(evidencePath));
  if(record.status!=="PASS")process.exitCode=2;
 }
}

main().catch(error=>{
 const safe=new Set(["OWNER_WINDOWS_INTERACTIVE_ONLY","GIT_HEAD_UNVERIFIED","OWNER_SYNTHETIC_FIXTURES_MISSING",
  "OWNER_SYSTEM_BROWSER_OPEN_FAILED"]);
 console.error("OWNER_OCR_HOLD: "+(safe.has(error.message)?error.message:"LOCAL_ACCEPTANCE_FAILED"));
 process.exitCode=1;
});
