"use strict";
// Local-only browser selection. This module never starts a browser, accesses
// Google, installs software, or reads any private OAuth or GAS receipt.
const fs=require("node:fs"),path=require("node:path");
const windowsCandidates=(env)=>({
 msedge:[
   env["PROGRAMFILES(X86)"]&&path.join(env["PROGRAMFILES(X86)"],"Microsoft","Edge","Application","msedge.exe"),
   env.ProgramFiles&&path.join(env.ProgramFiles,"Microsoft","Edge","Application","msedge.exe"),
   env.LOCALAPPDATA&&path.join(env.LOCALAPPDATA,"Microsoft","Edge","Application","msedge.exe")
 ],
 chrome:[
   env.ProgramFiles&&path.join(env.ProgramFiles,"Google","Chrome","Application","chrome.exe"),
   env["PROGRAMFILES(X86)"]&&path.join(env["PROGRAMFILES(X86)"],"Google","Chrome","Application","chrome.exe"),
   env.LOCALAPPDATA&&path.join(env.LOCALAPPDATA,"Google","Chrome","Application","chrome.exe")
 ]
});
function chooseBrowser({chromium,env=process.env,platform=process.platform,exists=fs.existsSync}){
 if(!chromium||typeof chromium.executablePath!=="function")return {status:"HOLD",reason:"BROWSER_ENGINE_UNAVAILABLE"};
 const requested=(env.FURUSATO_BROWSER_CHANNEL||"").trim().toLowerCase();
 if(requested&&!["chromium","msedge","chrome"].includes(requested)){
  return {status:"HOLD",reason:"UNSUPPORTED_BROWSER_CHANNEL"};
 }
 let bundled=false;
 try{bundled=!!exists(chromium.executablePath());}catch{}
 const candidates=platform==="win32"?windowsCandidates(env):{msedge:[],chrome:[]};
 const has=(key)=>(candidates[key]||[]).some(x=>x&&exists(x));
 const allowed=(key)=>key==="chromium"?bundled:has(key);
 if(requested)return allowed(requested)?{status:"PASS",engine:requested,launch:requested==="chromium"?{}:{channel:requested}}:
  {status:"HOLD",reason:"REQUESTED_BROWSER_NOT_INSTALLED"};
 if(bundled)return {status:"PASS",engine:"chromium",launch:{}};
 for(const key of ["msedge","chrome"])if(has(key))return {status:"PASS",engine:key,launch:{channel:key}};
 return {status:"HOLD",reason:"NO_LOCAL_CHROMIUM_EDGE_OR_CHROME"};
}
module.exports={chooseBrowser};
