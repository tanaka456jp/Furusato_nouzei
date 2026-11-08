"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const reader=fs.readFileSync(path.resolve(root,"..","tools","withholding_reader.py"),"utf8");
const html=fs.readFileSync(path.join(root,"Index.html"),"utf8");
const ignore=fs.readFileSync(path.join(root,".claspignore"),"utf8").trim().split(/\r?\n/);
const gitignore=fs.readFileSync(path.join(root,".gitignore"),"utf8").split(/\r?\n/);
const slice=(text,a,b)=>{const i=text.indexOf(a);if(i<0)throw new Error("Missing "+a);const j=text.indexOf(b,i+a.length);if(j<0)throw new Error("Missing "+b);return text.slice(i,j);};
const readerCode=slice(reader,"CODE_MAP =","AMOUNT =");
const browserFields=slice(html,"var allowedReaderFields=[","];");
const sourceFields=new Set([...readerCode.matchAll(/"[^"]+"\s*:\s*"([a-z][a-z0-9_]*)"/g)].map(x=>x[1]));
const acceptedFields=new Set([...browserFields.matchAll(/"([a-z][a-z0-9_]*)"/g)].map(x=>x[1]));
assert.deepEqual([...sourceFields].sort(),[...acceptedFields].sort(),"Browser field allowlist must exactly match source reader keys");
console.log("PASS: Python source-reader keys = GAS import allowlist ("+sourceFields.size+" unique)");
assert.deepEqual(ignore,["**/**","!Code.gs","!Engine.gs","!Index.html","!appsscript.json","!SourceOCR.gs"],"No test/preview file may be pushed to Google");
console.log("PASS: clasp pushes only approved 5 files");
for(const key of [".clasp.json",".clasprc.json","node_modules/","dist/"])assert.ok(gitignore.includes(key),"Missing git ignore for "+key);
console.log("PASS: script IDs, credentials and generated preview are git-ignored");
assert.ok(reader.includes('"schema":"furusato-withholding-extract/v1"'));
assert.ok(reader.includes('"personal_identifiers":"NEVER_EXTRACTED"'));
assert.ok(reader.includes('writer.writerow(["WARNINGS"'));
assert.ok(html.includes('if(obj.personal_identifiers!=="NEVER_EXTRACTED")'));
console.log("PASS: source JSON schema, warning fields, and privacy marker match");

const manifest=JSON.parse(fs.readFileSync(path.join(root,"appsscript.json"),"utf8"));
assert.equal(manifest.webapp.access,"MYSELF");
assert.equal(manifest.webapp.executeAs,"USER_DEPLOYING");
assert.deepEqual(manifest.oauthScopes,[
 "https://www.googleapis.com/auth/spreadsheets.currentonly",
 "https://www.googleapis.com/auth/drive.file",
 "https://www.googleapis.com/auth/documents"
]);
assert.equal(manifest.dependencies.enabledAdvancedServices[0].serviceId,"drive");
assert.equal(manifest.dependencies.enabledAdvancedServices[0].version,"v3");
assert.ok(html.includes('id="ocrConsent"'));
console.log("PASS: private OCR consent and explicit Drive v3 configuration");

assert.ok(html.includes('<meta name="viewport" content="width=device-width'));
assert.ok(html.includes("@media screen and (min-width:1100px)"));
assert.ok(html.includes("@media screen and (max-width:680px)"));
assert.ok(html.includes("font-size:16px"));
assert.ok(html.includes("env(safe-area-inset-left)"));
assert.ok(!/maximum-scale=1|user-scalable=no/.test(html));
console.log("PASS: responsive PC/tablet/mobile contract, user zoom remains enabled");

assert.ok(html.includes('id="ocrCamera"'));
assert.ok(html.includes('capture="environment"'));
assert.ok(html.includes('prepareOcrUpload(f).then'));
assert.ok(html.includes('if(!byId("ocrConsent").checked)'));
assert.ok(html.includes('state.sourceStatus="REQUIRES_REVIEW"'));
assert.ok(html.includes('showStep(0,true)'));
assert.ok(html.includes('role="status" aria-live="polite"'));
console.log("PASS: mobile camera is opt-in and OCR stays review-only; step change announces heading");
