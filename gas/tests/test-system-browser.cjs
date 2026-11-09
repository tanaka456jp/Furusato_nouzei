"use strict";
const assert=require("node:assert/strict");
const {openOwnerSystemBrowser}=require("../deployment/system-browser.cjs");
const url="https://script.google.com/macros/s/SYNTHETIC_PRIVATE/exec";
let called=[];
const spawn=(name,args,options)=>{
 called.push({name,args,options});
 return {status:0};
};
const out=openOwnerSystemBrowser(url,{platform:"win32",spawn,env:{TEST_ONLY:"1"}});
assert.equal(out.status,"OPENED");
assert.equal(out.release,"HOLD");
assert.equal(called.length,1);
assert.equal(called[0].name,"powershell.exe");
assert.equal(called[0].options.env.FURUSATO_PRIVATE_WEB_APP_URL,url);
assert.equal(called[0].options.stdio,"pipe");
assert.ok(!called[0].args.join(" ").includes(url),
 "Secret project URL must not appear in process arguments");
assert.ok(called[0].args.includes("Start-Process -FilePath $env:FURUSATO_PRIVATE_WEB_APP_URL"),
 "Must use an unautomated system browser and no Playwright/CDP/debugging flags");
for(const bad of [
 "https://example.com/exec",
 "https://script.google.com/macros/s/X/exec?test=1",
 "https://script.google.com/macros/s/X/exec;echo bad",
 "javascript:alert(1)"
])assert.throws(()=>openOwnerSystemBrowser(bad,{platform:"win32",spawn}),/UNVERIFIED_PRIVATE_WEB_APP_URL/);
assert.equal(called.length,1,"Invalid URLs cannot open browser");
assert.throws(()=>openOwnerSystemBrowser(url,{platform:"linux",spawn}),/WINDOWS_ONLY/);
assert.equal(called.length,1,"Unsupported platform cannot launch browser");
assert.throws(()=>openOwnerSystemBrowser(url,{platform:"win32",spawn:()=>({status:1})}),/OPEN_FAILED/);
assert.throws(()=>openOwnerSystemBrowser(url,{platform:"win32",spawn:()=>({status:null,error:new Error("synthetic")})}),/OPEN_FAILED/);
console.log("SYSTEM_OWNER_BROWSER_CONTRACT_PASS: synthetic only, no browser opened, no Google access");
