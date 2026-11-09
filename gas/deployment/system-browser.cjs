"use strict";
// Owner sign-in in an unautomated OS-default browser. No Playwright, remote
// debugging, CDP, browser profile access, cookies or OAuth credentials.
const cp=require("node:child_process");
const privateWebApp=/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;
function openOwnerSystemBrowser(url,{platform=process.platform,spawn=cp.spawnSync,env=process.env}={}){
 if(typeof url!=="string"||!privateWebApp.test(url))
  throw Error("UNVERIFIED_PRIVATE_WEB_APP_URL");
 if(platform!=="win32")throw Error("OWNER_SYSTEM_BROWSER_WINDOWS_ONLY");
 const command="Start-Process -FilePath $env:FURUSATO_PRIVATE_WEB_APP_URL";
 const child=spawn("powershell.exe",["-NoProfile","-NonInteractive","-Command",command],{
  env:{...env,FURUSATO_PRIVATE_WEB_APP_URL:url},windowsHide:true,stdio:"pipe",timeout:15000
 });
 if(child.error||child.status!==0)throw Error("OWNER_SYSTEM_BROWSER_OPEN_FAILED");
 return {status:"OPENED",scope:"MANUAL_OWNER_WEB_APP_REVIEW_ONLY",release:"HOLD"};
}
module.exports={openOwnerSystemBrowser};
