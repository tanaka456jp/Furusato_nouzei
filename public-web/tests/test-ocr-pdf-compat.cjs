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
