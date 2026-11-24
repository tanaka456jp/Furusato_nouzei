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
 [png(1200,800),"image/png"],[png(5000,5000),"image/png"],
 [jpeg(1200,800),"image/jpeg"],[jpeg(5712,4284,0xC2),"image/jpeg"]]){
 const result=h.inspect(bytes,mime);
 assert.equal(result.status,"ACCEPT");assert.ok(result.width*result.height<=h.MAX_PIXELS);
}
for(const [bytes,mime] of [
 [png(0,800),"image/png"],[png(50000,100),"image/png"],
 [png(5001,5000),"image/png"],[png(4000,12000),"image/png"],
 [png(15000,15000),"image/png"],[jpeg(8064,6048,0xC2),"image/jpeg"],
 [jpeg(65000,65000),"image/jpeg"],
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
assert.equal(h.verifyDecodedSize(h.inspect(png(5000,5000),"image/png"),5000,5000).status,"ACCEPT");
assert.equal(h.verifyDecodedSize(h.inspect(png(4000,12000),"image/png"),4000,12000).status,"HOLD");
// Synthetic headers only. A valid metadata preflight is not proof
// that a compressed payload will decode or OCR correctly.
function webp(tag,w,ht,payload=10){
 const size=20+payload+payload%2;
 const a=new Uint8Array(size);
 const view=new DataView(a.buffer);
 const put=(at,s)=>[...s].forEach((c,i)=>a[at+i]=c.charCodeAt(0));
 put(0,"RIFF");view.setUint32(4,size-8,true);put(8,"WEBP");
 put(12,tag);view.setUint32(16,payload,true);
 if(tag==="VP8 "){a.set([0,0,0,157,1,42],20);view.setUint16(26,w,true);view.setUint16(28,ht,true);}
 if(tag==="VP8L"){a[20]=47;view.setUint32(21,(w-1)|((ht-1)<<14),true);}
 return a;
}
for(const [tag,w,ht] of [["VP8 ",1200,800],["VP8L",1200,800],["VP8L",5000,5000]]){
 const b=webp(tag,w,ht);
 const out=h.inspect(b,"image/webp",b.length);
 assert.deepEqual(out,{status:"ACCEPT",width:w,height:ht,reasons:[]});
 assert.equal(h.verifyDecodedSize(out,w,ht).status,"ACCEPT");
 assert.equal(h.verifyDecodedSize(out,w,ht+1).status,"HOLD");
}
const big=webp("VP8 ",1200,800,h.MAX_HEADER_BYTES+50);
assert.equal(h.inspect(big.slice(0,h.MAX_HEADER_BYTES),"image/webp",big.length).status,"ACCEPT");
for(const b of [webp("VP8X",1200,800),webp("ANIM",1200,800),webp("VP8 ",0,800),webp("VP8L",6000,6000),webp("VP8 ",16383,1)]){
 // VP8 16383 exceeds the global 16000 edge limit.
 assert.equal(h.inspect(b,"image/webp",b.length).status,"HOLD");
}
const sample=webp("VP8 ",1200,800);
for(const [index,value] of [[0,0],[8,0],[16,0],[20,1],[23,0]]){
 const bad=sample.slice();bad[index]=value;
 assert.equal(h.inspect(bad,"image/webp",bad.length).status,"HOLD");
}
const lossless=webp("VP8L",1200,800);lossless[24]|=32;
assert.equal(h.inspect(lossless,"image/webp",lossless.length).status,"HOLD");
assert.equal(h.inspect(sample,"image/webp",sample.length+2).status,"HOLD");
assert.equal(h.inspect(sample.slice(0,25),"image/webp",sample.length).status,"HOLD");
assert.equal(h.inspect(sample,"image/webp").status,"HOLD");
assert.equal(h.inspect(sample,"image/png",sample.length).status,"HOLD");
assert.equal(h.inspect(png(1200,800),"image/webp",24).status,"HOLD");
console.log("PUBLIC_OCR_IMAGE_HEADER_PREFLIGHT_SYNTHETIC_PASS; no real source data");
