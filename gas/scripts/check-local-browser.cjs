"use strict";
// Safe local-only inspection. Does not launch a browser or touch Google.
const {chromium}=require("playwright");
const {chooseBrowser}=require("../deployment/browser-runtime.cjs");
const report=chooseBrowser({chromium});
const safe=report.status==="PASS"?
 {status:"PASS",browser:report.engine,googleAccess:false,installation:false}:
 {status:"HOLD",reason:report.reason,googleAccess:false,installation:false};
console.log(JSON.stringify(safe));
if(report.status!=="PASS")process.exitCode=2;
