"use strict";
/* Pure synthetic compatibility contract. Never reads real PDF data. */
const assert=require("node:assert/strict");
const {install}=require("../src/pdf-compat.js");
class LocalMap extends Map{}
const proto=install(LocalMap);
assert.equal(proto,LocalMap.prototype);
assert.equal(typeof proto.getOrInsert,"function");
assert.equal(typeof proto.getOrInsertComputed,"function");
const m=new LocalMap();
let computed=0;
assert.equal(m.getOrInsert("gross",7000000),7000000);
assert.equal(m.getOrInsert("gross",9000000),7000000);
assert.equal(m.getOrInsertComputed("gross",()=>{computed++;return -1;}),7000000);
assert.equal(computed,0);
assert.equal(m.getOrInsertComputed("social",key=>{computed++;assert.equal(key,"social");return 1000000;}),1000000);
assert.equal(computed,1);
assert.equal(m.getOrInsertComputed("social",()=>{throw Error("not called");}),1000000);
assert.equal(m.getOrInsert("zero",0),0);
assert.equal(m.getOrInsert("zero",25),0);
m.set("none",undefined);
assert.equal(m.getOrInsertComputed("none",()=>{throw Error("existing key");}),undefined);
assert.throws(()=>m.getOrInsertComputed("bad",null),TypeError);
const reentrant=m.getOrInsertComputed("self",()=>{m.set("self",11);return 22;});
assert.equal(reentrant,11);
assert.equal(Object.keys(LocalMap.prototype).includes("getOrInsertComputed"),false);
assert.equal(install(LocalMap),LocalMap.prototype);
assert.equal(m.get("gross"),7000000);
console.log("PUBLIC_PDFJS_OLDER_BROWSER_MAP_COMPAT_SYNTHETIC_PASS; no original documents");

// Safari 26 WebKit lacks native ReadableStream async iteration. The
// compatibility method is installed only when missing, with lock release
// and early-break cancellation. No source bytes or file data are logged.
const installReadableStream=require("../src/pdf-compat.js").installReadableStream;
class LocalStream {
 constructor(values){this.values=values;this.reads=0;this.cancels=0;this.releases=0;}
 getReader(){
  const self=this;
  return {
   async read(){return self.reads<self.values.length?
    {value:self.values[self.reads++],done:false}:{done:true};},
   async cancel(){self.cancels++;},
   releaseLock(){self.releases++;}
  };
 }
}
assert.equal(installReadableStream(LocalStream),true);
const key=Symbol.asyncIterator;
assert.equal(typeof LocalStream.prototype[key],"function");
assert.equal(installReadableStream(LocalStream),false);
(async()=>{
 const regular=new LocalStream([3,5,7]),observed=[];
 for await(const value of regular)observed.push(value);
 assert.deepEqual(observed,[3,5,7]);
 assert.equal(regular.cancels,0);
 assert.equal(regular.releases,1);
 const early=new LocalStream([11,13,17]),seen=[];
 for await(const value of early){seen.push(value);break;}
 assert.deepEqual(seen,[11]);
 assert.equal(early.cancels,1);
 assert.equal(early.releases,1);
 const failing=new LocalStream([23,29]);
 try{
  for await(const value of failing)throw Error("SYNTHETIC_CONSUMER_ERROR");
 }catch(error){assert.match(error.message,/SYNTHETIC_CONSUMER_ERROR/);}
 assert.equal(failing.cancels,1);
 assert.equal(failing.releases,1);
 assert.equal(installReadableStream(undefined),false);
 console.log("PUBLIC_PDFJS_WEBKIT_STREAM_ASYNC_ITERATOR_PASS; synthetic only");
})().catch(error=>{console.error(error);process.exitCode=1;});
