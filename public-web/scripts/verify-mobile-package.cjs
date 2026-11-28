"use strict";
// Synthetic QA package integrity only; not a signature or source classifier.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),assert=require("node:assert/strict");
const root=path.resolve(__dirname,".."),manifestName="MOBILE_QA_MANIFEST.json";
const fixtures=[
 "01-electronic-not-slip.pdf",
 "02-scan-not-slip.pdf",
 "03-photo-not-slip.png",
 "04-batch-20-pages.pdf",
 "05-blank.pdf",
 "06-positive-electronic.pdf",
 "07-positive-mixed-batch.pdf",
 "08-positive-image.png",
 "09-positive-lines.png",
 "10-bilingual-varied.png",
 "11-bilingual-printed-period.png",
 "12-bilingual-printed-minus.png",
 "13-bilingual-duplicate-label.png",
 "14-bilingual-conflicting-year.png",
 "15-bilingual-jpeg.jpg",
 "16-bilingual-low-contrast.png",
 "17-bilingual-raster.pdf",
 "18-bilingual-raster-mixed.pdf",
 "19-bilingual-previous-year.png",
 "20-raster-period.pdf",
 "21-raster-minus.pdf",
 "22-raster-duplicate.pdf",
 "23-raster-year-conflict.pdf",
 "24-raster-prior-year.pdf",
 "25-jpeg-period.jpg",
 "26-jpeg-minus.jpg",
 "27-jpeg-duplicate.jpg",
 "28-jpeg-year-conflict.jpg",
 "29-jpeg-prior-year.jpg"
];
const docs=["docs/MOBILE_QA.md","docs/OCR_QUALITY_ACCEPTANCE.md","docs/RELEASE_ACCEPTANCE.md"];
const scripts=["scripts/serve-review.cjs","scripts/verify-mobile-package.cjs"];
function regular(rel){
 const target=path.join(root,rel);
 assert.ok(fs.lstatSync(target).isFile());
 assert.ok(fs.realpathSync(target).startsWith(fs.realpathSync(root)+path.sep));
 return target;
}
function walk(rel){
 assert.ok(fs.lstatSync(path.join(root,rel)).isDirectory());
 const names=[];
 for(const e of fs.readdirSync(path.join(root,rel),{withFileTypes:true})){
  assert.ok(/^[A-Za-z0-9_.-]+$/.test(e.name)&&!e.name.startsWith("."));
  const name=rel+"/"+e.name;
  if(e.isDirectory())names.push(...walk(name));
  else {assert.ok(e.isFile());names.push(name);}
 }
 return names;
}
function snapshot(){
 const actual=walk("qa-fixtures").sort();
 assert.deepEqual(actual,fixtures.map(x=>"qa-fixtures/"+x).sort());
 const dist=walk("dist");
 for(const name of ["index.html","engine.js","_headers","robots.txt","vendor/pdf.worker.mjs","vendor/tesseract/lang/jpn.traineddata.gz","vendor/tesseract/lang/eng.traineddata.gz"])
  assert.ok(dist.includes("dist/"+name));
 return [...dist,...actual,...docs,...scripts].sort().map(rel=>{
  const bytes=fs.readFileSync(regular(rel));
  return {path:rel,size:bytes.length,sha256:crypto.createHash("sha256").update(bytes).digest("hex")};
 });
}
function validate(m,files){
 assert.ok(m&&Object.keys(m).sort().join(",")==="buildSha,files,release,runId,schema,syntheticOnly");
 assert.equal(m.schema,"furusato-mobile-synthetic-package/v1");assert.equal(m.release,"HOLD");assert.equal(m.syntheticOnly,true);
 assert.ok(typeof m.buildSha==="string"&&/^[a-f0-9]{40}$/.test(m.buildSha));
 assert.ok(typeof m.runId==="string"&&/^[0-9]+$/.test(m.runId));
 assert.deepEqual(m.files,files);
}
try{
 const args=process.argv.slice(2),files=snapshot();
 if(args.length===3&&args[0]==="--create"){
  const m={schema:"furusato-mobile-synthetic-package/v1",buildSha:args[1],runId:args[2],syntheticOnly:true,release:"HOLD",files};
  validate(m,files);
  for(const bad of [{...m,files:files.slice(1)},{...m,files:files.map((x,i)=>i?x:{...x,sha256:"0".repeat(64)})},{...m,release:"PASS"},{...m,syntheticOnly:false}])assert.throws(()=>validate(bad,files));
  fs.writeFileSync(path.join(root,manifestName),JSON.stringify(m,null,2)+"\n",{flag:"wx"});
 }else if(args.length===1&&args[0]==="--verify"){
  const m=JSON.parse(fs.readFileSync(regular(manifestName),"utf8"));
  validate(m,files);
  console.log(JSON.stringify({status:"MOBILE_SYNTHETIC_PACKAGE_INTEGRITY_PASS",buildSha:m.buildSha,runId:m.runId,files:files.length,fixtures:fixtures.length,release:"HOLD"}));
 }else throw Error("PACKAGE_ARGUMENTS_INVALID");
}catch(_){console.error("MOBILE_SYNTHETIC_PACKAGE_VERIFICATION_FAILED");process.exitCode=1;}
