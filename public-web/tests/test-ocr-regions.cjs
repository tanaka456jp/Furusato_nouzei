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

const tableText="令和8年分 給与所得の源泉徴収票\n支払金額\n給与所得控除後の金額\n所得控除の額の合計額\n源泉徴収税額\n7,000,000円\n5,200,000円\n1,670,000円\n285,800円\n社会保険料等の金額\n生命保険料の控除額\n1,000,000円";
function tableBlocks(){
 const line=(text,x0,y0,x1,y1)=>({text,bbox:{x0,y0,x1,y1}});
 return [{paragraphs:[{lines:[
  line("支払金額",90,200,230,224),
  line("給与所得控除後の金額",320,200,500,224),
  line("所得控除の額の合計額",590,200,770,224),
  line("源泉徴収税額",880,200,1020,224),
  line("7,000,000円",140,240,235,260),
  line("5,200,000円",385,240,480,260),
  line("1,670,000円",655,240,750,260),
  line("285,800円",905,240,995,260),
  line("社会保険料等の金額",100,400,250,424),
  line("生命保険料の控除額",365,400,520,424),
  line("1,000,000円",150,440,245,460)
 ]}]}];
}

const sr=require("../src/ocr-review.js");
const read=sr.reviewText(tableText);
assert.equal(read.fullyExtracted,false);
assert.equal(read.year,2026);
const plan=region.planSeparate(tableBlocks(),1100,1000,read);
assert.equal(plan.status,"READY");
assert.deepEqual(plan.candidates,expected);
assert.equal(plan.rectangles.length,4);
assert.equal(region.agreeSeparate(plan,region.planSeparate(tableBlocks(),1100,1000,read)).status,"READY");
const amounts=labels.map(([key,_,n])=>({key,text:n.toLocaleString("en-US")+"円",confidence:90}));
const accepted=region.assessSeparate(amounts,plan);
assert.equal(accepted.eligibleForManualTransfer,true);
assert.deepEqual(accepted.candidates,expected);
assert.equal(accepted.originalCompared,false);
assert.equal(accepted.autoApproved,false);
for(const mutate of [
 a=>a.splice(3,1), // withholding column missing
 a=>a.push({...a[4]}), // duplicate value
 a=>{a[4].text="7,0O0,000円";},
 a=>{a[4].bbox.x1=400;}, // crosses the cell boundary
 a=>{a[5].bbox.y0=180;}, // not below heading
 a=>{a[2].bbox.y0=300;a[2].bbox.y1=324;}, // unaligned headers
 a=>{a[8].bbox.y0=180;a[8].bbox.y1=204;}, // social row above
 a=>a.push({...a[0]}), // duplicate heading
 a=>a.push({text:"内 100円",bbox:{x0:150,y0:427,x1:240,y1:438}}),
 a=>{a[4].text="0";}
]){
 const input=tableBlocks();mutate(input[0].paragraphs[0].lines);
 const result=region.planSeparate(input,1100,1000,read);
 assert.equal(result.status,"HOLD");assert.deepEqual(result.candidates,{});
}
for(const bad of [tableText.replace("令和8年分","令和6年分"),tableText+"\n令和6年分",tableText+"\n支払金額 7,0O0,000円",tableText+"\n支払金額 8,000,000円"]){
 assert.equal(region.planSeparate(tableBlocks(),1100,1000,sr.reviewText(bad)).status,"HOLD");
}
const changed=tableBlocks();changed[0].paragraphs[0].lines[4].text="7,100,000円";
assert.equal(region.agreeSeparate(plan,region.planSeparate(changed,1100,1000,read)).status,"HOLD");
const shifted=tableBlocks();shifted[0].paragraphs[0].lines[4].bbox={x0:190,y0:240,x1:260,y1:260};
assert.equal(region.agreeSeparate(plan,region.planSeparate(shifted,1100,1000,read)).status,"HOLD");
for(const bad of [amounts.slice(1),amounts.map((x,i)=>i?x:{...x,text:"7,100,000円"}),amounts.map((x,i)=>i?x:{...x,confidence:74}),amounts.map((x,i)=>i?x:{...x,text:"7,000,000円 他 100円"})]){
 const result=region.assessSeparate(bad,plan);
 assert.equal(result.status,"HOLD");assert.deepEqual(result.candidates,{});
 assert.equal(result.autoApproved,false);
}
console.log("PUBLIC_OCR_BOUNDED_REGION_RECHECK_SYNTHETIC_PASS; no source accuracy claim");
