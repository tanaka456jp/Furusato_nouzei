"use strict";
/**
 * Builds an OFFLINE REVIEW artifact for Cloudflare Pages-compatible static
 * hosting. Deployment is intentionally not part of this script or CI.
 * No secrets, users' data, OCR, Google APIs or ad network configuration.
 */
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const root=path.resolve(__dirname,"..");
const gas=path.resolve(root,"..","gas","Engine.gs");
const sourceDir=path.join(root,"src"),dest=path.join(root,"dist");
const engine=fs.readFileSync(gas,"utf8");
const ver=/var\s+VERSION\s*=\s*"gas-mvp-(0\.1\.23)"/.exec(engine);
if(!ver||!engine.includes("FurusatoEngine")||
   !engine.includes("FurusatoSeparateTax")||/<\/script\b/i.test(engine))
 throw Error("PUBLIC_ENGINE_NOT_AUDITED");
if(/\b(?:DriveApp|SpreadsheetApp|UrlFetchApp)\s*\./.test(engine)||
   /\bgoogle\.script\.run\b/.test(engine))
 throw Error("REMOTE_GAS_DEPENDENCY_FORBIDDEN");
const html=fs.readFileSync(path.join(sourceDir,"index.html"),"utf8");
const app=fs.readFileSync(path.join(sourceDir,"app.js"),"utf8");
if(!html.includes('name="robots" content="noindex,nofollow,noarchive"')||
   !html.includes('name="acknowledgedExclusions"')||
   !html.includes('name="hasMortgage"')||
   !app.includes("FurusatoEngine.calculate")||
   /(?:\bfetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|document\.cookie|google\.script\.run)/.test(app))
 throw Error("PUBLIC_REVIEW_PRIVACY_CONTRACT_FAILED");
const files=["index.html","style.css","app.js","about.html","privacy.html"];
for(const name of files){
 const contents=fs.readFileSync(path.join(sourceDir,name),"utf8");
 if(!contents.trim())throw Error("MISSING_PUBLIC_SOURCE");
}
// Refuse overwriting a symbolic-link or out-of-tree build directory.
if(fs.existsSync(dest)){
 const st=fs.lstatSync(dest);
 if(!st.isDirectory()||st.isSymbolicLink())throw Error("UNSAFE_DIST_TARGET");
 fs.rmSync(dest,{recursive:true,force:true});
}
fs.mkdirSync(dest,{recursive:true});
for(const name of files)
 fs.copyFileSync(path.join(sourceDir,name),path.join(dest,name));
fs.writeFileSync(path.join(dest,"engine.js"),engine,"utf8");
const headers=`/*
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  X-Robots-Tag: noindex, nofollow, noarchive
`;
fs.writeFileSync(path.join(dest,"_headers"),headers,"utf8");
fs.writeFileSync(path.join(dest,"robots.txt"),
 "User-agent: *\nDisallow: /\n","utf8");
const hash=crypto.createHash("sha256").update(engine).digest("hex");
console.log(JSON.stringify({
 status:"STATIC_REVIEW_BUILD_PASS",engineVersion:"v"+ver[1],
 sourceEngine:"gas/Engine.gs",sourceSha256:hash,
 deployment:"NOT_RUN",ads:"NOT_ENABLED",ocr:"DISABLED",
 privacy:"NO_APPLICATION_NETWORK_OR_STORAGE",searchIndex:"DISABLED",
 release:"HOLD"
}));
