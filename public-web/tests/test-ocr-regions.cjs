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

// Rule-only synthetic grid. No source pixels, private amounts or text.
// The geometry alone must not produce any candidate or approve transfer.
function gridFixture(scale=1,left=55,top=350,broken=false,twice=false,missingInner=false){
 const w=Math.round(1190*scale),h=Math.round(1684*scale);
 const W=Math.round(1080*scale),data=new Uint8ClampedArray(w*h*4);
 data.fill(255);
 const dark=(x,y)=>{if(x>=0&&x<w&&y>=0&&y<h){const i=(y*w+x)*4;data[i]=data[i+1]=data[i+2]=0;}};
 function draw(y0){
  const Y=v=>y0+Math.round(v*scale),X=v=>left+Math.round(v*scale);
  for(const v of [0,32,96,192,212,276])
   for(let x=left;x<=left+W;x++)dark(x,Y(v));
  if(!missingInner)for(const [a,b,y] of [[144,397,64],[210,452,244]])
   for(let x=X(a);x<=X(b);x++)dark(x,Y(y));
  for(const [x,a,b] of [
   ...[0,144,397,618,838,1080].map(x=>[x,0,96]),
   ...[0,210,452,662,872,1080].map(x=>[x,192,276]),
   ...[166,420,639].map(x=>[x,32,96]),[232,212,276]
  ]){
   if(broken&&x===397)continue;
   for(let y=Y(a);y<=Y(b);y++)dark(X(x),y);
  }
 }
 draw(top);
 if(twice)draw(top+Math.round(600*scale));
 return {w,h,data};
}
const gp=f=>region.planGridPixels(f.data,f.w,f.h);
for(const [scale,left,top] of [[1,55,350],[.8,35,270],[1.25,80,470],[1,75,490]]){
 const f=gridFixture(scale,left,top),out=gp(f);
 assert.equal(out.status,"LAYOUT_ONLY");assert.equal(out.layoutLocated,true);
 assert.deepEqual(out.rectangles.map(x=>x.key),labels.map(x=>x[0]));
 assert.equal(out.eligibleForManualTransfer,false);assert.equal(out.autoApproved,false);
 assert.equal(out.candidates,undefined);assert.equal(out.year,undefined);
 for(const box of out.rectangles)assert.ok(box.left>=0&&box.top>=0&&box.left+box.width<=f.w&&box.top+box.height<=f.h);
 assert.ok(out.rectangles[0].top>top+Math.round(64*scale));
 assert.ok(out.rectangles[3].top>top+Math.round(244*scale));
 assert.ok(out.rectangles[0].left+out.rectangles[0].width>=left+Math.round(397*scale)-2);
}
for(const f of [gridFixture(1,55,350,true),gridFixture(1,55,350,false,true),gridFixture(1,55,350,false,false,true)]){
 const out=gp(f);assert.equal(out.status,"HOLD");assert.deepEqual(out.rectangles,[]);
 assert.equal(out.eligibleForManualTransfer,false);
}
const blank=gridFixture();blank.data.fill(255);
assert.equal(gp(blank).status,"HOLD");
assert.equal(region.planGridPixels(null,1000,1000).status,"HOLD");
assert.equal(region.planGridPixels(new Uint8Array(10),1000,1000).status,"HOLD");
assert.equal(region.planGridPixels(new Uint8Array(10),1000000,1000000).status,"HOLD");
assert.equal(region.planGridCanvas(null).status,"HOLD");


const digitReads=labels.map(([key,,n])=>({key,text:String(n)}));
const gd=region.assessGridDigits(digitReads,digitReads);
assert.deepEqual(gd,{status:"DIAGNOSTIC_ONLY",matchedFields:4,eligibleForManualTransfer:false,autoApproved:false});
for(const invalid of [""," ","1 234","1\n234","1,23","1,234円","-1","01","1e3","1,234 567","1,234,56","999999999"]){
 const bad=digitReads.map((v,i)=>i===0?{...v,text:invalid}:v);
 assert.equal(region.assessGridDigits(bad,bad).matchedFields,3);
}
const mismatch=digitReads.map((v,i)=>i===0?{...v,text:"123"}:v);
assert.equal(region.assessGridDigits(digitReads,mismatch).matchedFields,3);
assert.equal(region.assessGridDigits(digitReads.slice(1),digitReads).status,"HOLD");
assert.equal(region.assessGridDigits([...digitReads.slice(1),digitReads[1]],digitReads).status,"HOLD");
const spaced=digitReads.map((v,i)=>i===0?{...v,text:"７, ０００, ０００"}:v);
assert.equal(region.assessGridDigits(digitReads,spaced).matchedFields,4);

for(const [key] of labels){
 assert.deepEqual(region.gridReadVariant(key,0),{source:"original",scale:3});
 assert.deepEqual(region.gridReadVariant(key,1),key==="socialInsurance"?{source:"original",scale:2}:{source:"enhanced",scale:3});
}
assert.equal(region.gridReadVariant("withholdingTax",1),null);
assert.equal(region.gridReadVariant("socialInsurance",2),null);
const blankSocial=digitReads.map(v=>v.key==="socialInsurance"?{...v,text:""}:v);
const falseSocial=digitReads.map(v=>v.key==="socialInsurance"?{...v,text:"0"}:v);
for(const [a,b] of [[blankSocial,falseSocial],[falseSocial,blankSocial],[blankSocial,blankSocial]]){
 const out=region.assessGridDigits(a,b);
 assert.equal(out.matchedFields,3);
 assert.equal(out.eligibleForManualTransfer,false);
 assert.equal(out.autoApproved,false);
 assert.equal(out.candidates,undefined);
}
console.log("PUBLIC_OCR_BOUNDED_REGION_RECHECK_SYNTHETIC_PASS; no source accuracy claim");
