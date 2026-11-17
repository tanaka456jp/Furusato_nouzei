"use strict";
/** Synthetic-only Tesseract line bounding boxes, no customer documents. */
const assert=require("node:assert/strict");
const region=require("../src/ocr-regions.js");
const labels=[
 ["salaryGross","支払金額",7000000],
 ["salaryIncomeReference","給与所得控除後の金額",5200000],
 ["deductionsReference","所得控除の額の合計額",1670000],
 ["socialInsurance","社会保険料等の金額",1000000]
];
const expected=Object.fromEntries(labels.map(x=>[x[0],x[2]]));
function blocks(replace){
 return [{paragraphs:[{lines:labels.map((entry,i)=>{
  const amount=entry[2].toLocaleString("en-US");
  const line={text:entry[1]+" "+amount+"円",
    bbox:{x0:120,y0:170+175*i,x1:670,y1:210+175*i}};
  return replace?replace(line,entry,i):line;
 })}]}];
}
const ok=region.plan(blocks(),1000,1100,expected);
assert.equal(ok.status,"READY");
assert.equal(ok.autoApproved,false);
assert.deepEqual(ok.rectangles.map(x=>x.key),labels.map(x=>x[0]));
for(const r of ok.rectangles){
 assert.ok(r.left>=0&&r.top>=0&&r.left+r.width<=1000&&
    r.top+r.height<=1100&&r.width*r.height<=450000);
}
const outputs=labels.map(e=>({key:e[0],
 text:e[1]+" "+e[2].toLocaleString("en-US")+"円",confidence:95}));
assert.deepEqual(region.assessRechecks(outputs,expected),{
 status:"CORROBORATED",reasons:[],autoApproved:false,sourceVerified:false
});
function hold(result){assert.equal(result.status,"HOLD");assert.equal(result.autoApproved,false);}
hold(region.assessRechecks(outputs.slice(1),expected));
hold(region.assessRechecks(outputs.map((o,i)=>i===0?{...o,text:"支払金額 7,200,000円"}:o),expected));
hold(region.assessRechecks(outputs.map((o,i)=>i===0?{...o,confidence:74}:o),expected));
hold(region.assessRechecks(outputs.map((o,i)=>i===0?{...o,text:o.text+" 他 1,000円"}:o),expected));
hold(region.assessRechecks(outputs.map((o,i)=>i===0?{...o,text:"支払金額 7,0O0,000円"}:o),expected));
assert.equal(region.plan([],1000,1100,expected).status,"SKIPPED");
assert.equal(region.plan(blocks(),100,100,expected).status,"SKIPPED");
assert.equal(region.plan(blocks((l,e,i)=>i===0?
 {...l,text:"支払金額 8,000,000円"}:l),1000,1100,expected).status,"CONFLICT");
assert.equal(region.plan(blocks((l,e,i)=>i===0?
 {...l,bbox:{x0:0,x1:1100,y0:-500,y1:100}}:l),1000,1100,expected).status,"SKIPPED");
assert.equal(region.plan([{paragraphs:[{lines:[...blocks()[0].paragraphs[0].lines,
 blocks()[0].paragraphs[0].lines[0]]}]}],1000,1100,expected).status,"CONFLICT");
assert.equal(region.plan([{paragraphs:"corrupt"}],1000,1100,expected).status,"SKIPPED");
const noNumbers=blocks((line)=>({...line,text:line.text.replace(/[0-9,円]+/g,"")}));
assert.equal(region.plan(noNumbers,1000,1100,expected).status,"SKIPPED");
console.log("PUBLIC_OCR_BOUNDED_REGION_RECHECK_SYNTHETIC_PASS; no source accuracy claim");
