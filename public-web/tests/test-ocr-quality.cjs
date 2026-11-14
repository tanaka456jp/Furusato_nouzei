"use strict";
/** Synthetic-only camera quality triage, no real source images. */
const assert=require("node:assert/strict");
const q=require("../src/ocr-quality.js");
function pixels(w,h,mode){
 const rgba=new Uint8ClampedArray(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=(y*w+x)*4;
  const v=mode==="white"?255:mode==="dark"?0:
    mode==="lowContrast"?222:((x%29<4||y%41<3)?38:247);
  rgba[i]=rgba[i+1]=rgba[i+2]=v;rgba[i+3]=255;
 }
 return rgba;
}
assert.equal(q.analyzePixels(128,128,pixels(128,128,"white")).status,"HOLD");
assert.equal(q.analyzePixels(128,128,pixels(128,128,"dark")).status,"HOLD");
assert.equal(q.analyzePixels(128,128,pixels(128,128,"lowContrast")).status,"HOLD");
let good=q.analyzePixels(128,128,pixels(128,128,"text"));
assert.equal(good.status,"REVIEW");
assert.equal(good.accuracyCertified,false);
assert.equal(good.sourcePixelsPersisted,false);
const transparent=pixels(128,128,"text");
for(let i=3;i<transparent.length;i+=4)transparent[i]=0;
assert.equal(q.analyzePixels(128,128,transparent).status,"HOLD");
assert.equal(q.analyzePixels(0,128,new Uint8Array()).status,"HOLD");
assert.equal(q.analyzePixels(128,128,new Uint8Array(128)).status,"HOLD");
const sample={width:1300,height:900};
const previous=global.document;
global.document={createElement(){
 const c={width:0,height:0,getContext(){
  return {drawImage(){},getImageData(_x,_y,w,h){
   return {data:pixels(w,h,"text")};
  }};
 }};
 return c;
}};
try{
 assert.equal(q.assessCanvas(sample).status,"REVIEW");
 assert.equal(q.assessCanvas({width:200,height:200}).status,"HOLD");
 assert.equal(q.assessCanvas({width:12000,height:2000}).status,"HOLD");
}finally{
 if(previous===undefined)delete global.document;else global.document=previous;
}
console.log("PUBLIC_OCR_IMAGE_QUALITY_SYNTHETIC_PASS; no OCR accuracy claim");
