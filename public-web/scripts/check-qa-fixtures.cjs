"use strict";
// Fixed inventory for the synthetic QA artifact. Not a classifier of private
// documents: generate in a clean CI checkout and never add user documents.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const expected=[
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
  "24-raster-prior-year.pdf"
];
const root=path.resolve(__dirname,"../qa-fixtures");
assert.ok(fs.lstatSync(root).isDirectory(),"QA_FIXTURE_DIRECTORY_INVALID");
const entries=fs.readdirSync(root,{withFileTypes:true});
assert.equal(entries.length,expected.length,"QA_FIXTURE_COUNT");
assert.ok(entries.every(e=>e.isFile()&&expected.includes(e.name)),"QA_FIXTURE_UNEXPECTED_ENTRY");
assert.deepEqual(entries.map(e=>e.name).sort(),expected.slice().sort(),"QA_FIXTURE_INVENTORY");
for(const name of expected){
 const p=path.join(root,name);
 const stat=fs.lstatSync(p);
 assert.ok(stat.isFile()&&stat.size>100&&stat.size<8*1024*1024,"QA_FIXTURE_SIZE");
 const fd=fs.openSync(p,"r");let bytes=Buffer.alloc(8);
 try{assert.equal(fs.readSync(fd,bytes,0,8,0),8);}finally{fs.closeSync(fd);}
 const ext=path.extname(name);
 const valid=ext===".pdf"?bytes.subarray(0,5).toString()==="%PDF-":
  ext===".png"?bytes.equals(Buffer.from([137,80,78,71,13,10,26,10])):
  ext===".jpg"?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:false;
 assert.ok(valid,"QA_FIXTURE_SIGNATURE");
}
console.log("SYNTHETIC_QA_FIXTURE_INVENTORY_24_PASS");
