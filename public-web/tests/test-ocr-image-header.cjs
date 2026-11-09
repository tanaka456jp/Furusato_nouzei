"use strict";
const assert=require("node:assert/strict");
const h=require("../src/ocr-image-header.js");
function png(w,ht){
 const a=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,0,0,0,0,0]);
 for(const [n,value] of [[16,w],[20,ht]]){
  a[n]=Math.floor(value/16777216)%256;a[n+1]=Math.floor(value/65536)%256;
  a[n+2]=Math.floor(value/256)%256;a[n+3]=value%256;
 }
 return a;
}
const jpeg=(w,ht,frame=0xC0)=>Uint8Array.from([
 255,216,255,224,0,4,1,1,255,frame,0,7,8,
 Math.floor(ht/256),ht%256,Math.floor(w/256),w%256,255,218]);
for(const [bytes,mime] of [
 [png(1200,800),"image/png"],[png(4000,12000),"image/png"],
 [jpeg(1200,800),"image/jpeg"],[jpeg(8064,6048,0xC2),"image/jpeg"]]){
 const result=h.inspect(bytes,mime);
 assert.equal(result.status,"ACCEPT");assert.ok(result.width*result.height<=h.MAX_PIXELS);
}
for(const [bytes,mime] of [
 [png(0,800),"image/png"],[png(50000,100),"image/png"],
 [png(15000,15000),"image/png"],[jpeg(65000,65000),"image/jpeg"],
 [jpeg(1200,800).slice(0,9),"image/jpeg"],[png(1200,800),"image/jpeg"],
 [jpeg(1200,800),"image/png"],[new Uint8Array(2),"image/png"],
 [new Uint8Array(h.MAX_HEADER_BYTES+1),"image/png"],
 [png(1200,800),"application/pdf"]]){
 const result=h.inspect(bytes,mime);assert.equal(result.status,"HOLD");
 assert.equal(result.width,null);assert.ok(result.reasons.length>0);
}
const invalid=jpeg(1200,800);invalid[4]=255;invalid[5]=255;
assert.equal(h.inspect(invalid,"image/jpeg").status,"HOLD");
const duplicate=Uint8Array.from([...jpeg(1000,1000).slice(0,-2),
 ...jpeg(1000,1000).slice(2)]);
assert.equal(h.inspect(duplicate,"image/jpeg").status,"HOLD");
assert.equal(h.inspect(null,"image/png").status,"HOLD");
// The browser-reported dimensions must agree with the file header,
// apart from EXIF orientation swapping width and height.
const good=h.inspect(jpeg(1200,800),"image/jpeg");
assert.equal(h.verifyDecodedSize(good,1200,800).status,"ACCEPT");
assert.equal(h.verifyDecodedSize(good,800,1200).status,"ACCEPT");
for(const [w,ht] of [[20000,800],[1200,801],[0,800],
 [1000,1000],[NaN,800],[-1,1200],[Infinity,800]]){
 assert.equal(h.verifyDecodedSize(good,w,ht).status,"HOLD");
}
assert.equal(h.verifyDecodedSize(null,1200,800).status,"HOLD");
assert.equal(h.verifyDecodedSize(h.inspect(png(0,800),"image/png"),1200,800).status,"HOLD");
assert.equal(h.verifyDecodedSize(h.inspect(png(4000,12000),"image/png"),4000,12000).status,"ACCEPT");
console.log("PUBLIC_OCR_IMAGE_HEADER_PREFLIGHT_SYNTHETIC_PASS; no real source data");
