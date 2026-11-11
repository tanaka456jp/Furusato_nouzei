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
const files=["index.html","style.css","app.js","about.html","privacy.html",
 "ocr.js","ocr-review.js","ocr-quality.js","ocr-layout.js","ocr-perspective.js","ocr-regions.js","ocr-image-header.js","pdf-compat.js",
 "batch-core.js","batch.js"];
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
// Self-host each code/model asset: no CDN fallback, no user document upload.
// Fail build if an asset is absent rather than silently using remote default.
const vendor=path.join(dest,"vendor");
const npmRoot=path.join(root,"node_modules");
const readNpm=function(pkg){return path.join(npmRoot,pkg);};
const requireVersion=function(pkg,version){
 const actual=JSON.parse(fs.readFileSync(path.join(readNpm(pkg),"package.json"),"utf8")).version;
 if(actual!==version)throw Error("OCR_DEPENDENCY_VERSION_NOT_PINNED:"+pkg);
};
requireVersion("tesseract.js","7.0.0");
requireVersion("@tesseract.js-data/jpn","1.0.0");
requireVersion("pdfjs-dist","6.3.289");
fs.mkdirSync(path.join(vendor,"tesseract","core"),{recursive:true});
fs.mkdirSync(path.join(vendor,"tesseract","lang"),{recursive:true});
function copy(from,to){
 const stat=fs.statSync(from);
 if(!stat.isFile()||stat.size<100||stat.size>150*1024*1024)
  throw Error("OCR_ASSET_INVALID:"+path.basename(from));
 fs.copyFileSync(from,to);
}
copy(path.join(readNpm("tesseract.js"),"dist","tesseract.min.js"),
 path.join(vendor,"tesseract","tesseract.min.js"));
copy(path.join(readNpm("tesseract.js"),"dist","worker.min.js"),
 path.join(vendor,"tesseract","worker.min.js"));
const coreSrc=path.join(readNpm("tesseract.js-core"));
const cores=fs.readdirSync(coreSrc).filter(function(x){
 return /^tesseract-core[\w-]*\.wasm(?:\.js)?$/.test(x);
});
if(cores.filter(x=>x.endsWith(".wasm.js")).length<2||
   cores.filter(x=>x.endsWith(".wasm")).length<2)
 throw Error("OCR_WASM_CORE_INCOMPLETE");
for(const name of cores)copy(path.join(coreSrc,name),
 path.join(vendor,"tesseract","core",name));
copy(path.join(readNpm("@tesseract.js-data/jpn"),"4.0.0_best_int","jpn.traineddata.gz"),
 path.join(vendor,"tesseract","lang","jpn.traineddata.gz"));
copy(path.join(readNpm("pdfjs-dist"),"build","pdf.mjs"),
 path.join(vendor,"pdf.mjs"));
copy(path.join(readNpm("pdfjs-dist"),"build","pdf.worker.mjs"),
 path.join(vendor,"pdf.worker.mjs"));
const notices=[
  {name:"tesseract.js",version:"7.0.0",license:"Apache-2.0",folder:"tesseract-js"},
  {name:"tesseract.js-core",version:"7.0.0",license:"Apache-2.0",folder:"tesseract-core"},
  {name:"@tesseract.js-data/jpn",version:"1.0.0",license:"MIT",folder:"tesseract-jpn"},
  {name:"pdfjs-dist",version:"6.3.289",license:"Apache-2.0",folder:"pdfjs"}
];
const legal=path.join(dest,"licenses");
fs.mkdirSync(legal,{recursive:true});
for(const p of notices){
 const metadata=JSON.parse(fs.readFileSync(path.join(readNpm(p.name),"package.json"),"utf8"));
 if(metadata.version!==p.version||String(metadata.license).toUpperCase()!==p.license.toUpperCase())
  throw Error("OCR_LICENSE_METADATA_UNVERIFIED");
 for(const filename of fs.readdirSync(readNpm(p.name)).filter(
   x=>/^(?:LICENSE|LICENCE|NOTICE)(?:[.\w-]*)?$/i.test(x))){
   const source=path.join(readNpm(p.name),filename);
   if(fs.statSync(source).isFile())
    fs.copyFileSync(source,path.join(legal,p.folder+"-"+filename));
 }
}
fs.writeFileSync(path.join(legal,"THIRD_PARTY_NOTICES.txt"),
 "OCR components and licenses (review build)\\n"+
 notices.map(p=>p.name+" "+p.version+" "+p.license).join("\\n")+
 "\\nSource: https://github.com/naptha/tesseract.js and https://github.com/mozilla/pdf.js\\n",
 "utf8");
fs.writeFileSync(path.join(dest,"engine.js"),engine,"utf8");
const headers=`/*
  Content-Security-Policy: default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'none'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
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
 deployment:"NOT_RUN",ads:"NOT_ENABLED",ocr:"LOCAL_ONLY_REVIEW",
 privacy:"NO_SOURCE_DOCUMENT_UPLOAD_OR_STORAGE; SELF_HOSTED_LIBRARY_FETCHES_ONLY",searchIndex:"DISABLED",
 release:"HOLD"
}));
