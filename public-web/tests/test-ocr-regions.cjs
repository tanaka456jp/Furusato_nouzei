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

for(const f of [gridFixture(),gridFixture(.8,35,270),gridFixture(1.25,80,470)]){
 const out=gp(f);assert.equal(out.headerRectangles.length,3);
 assert.deepEqual(out.headerRectangles.map(v=>[v.key,v.scale]),[["title",3],["year",5],["yearCheck",3]]);
 for(const v of out.headerRectangles)assert.ok(v.left>=0&&v.top>=0&&v.left+v.width<=f.w&&v.top+v.height<=f.h);
}
const clipped=gp(gridFixture(1,55,80));
assert.equal(clipped.status,"LAYOUT_ONLY");assert.deepEqual(clipped.headerRectangles,[]);
const title="給与所得の源泉徴収票";
const headers=(a,b,c=b)=>[{key:"title",text:a},{key:"year",text:b},{key:"yearCheck",text:c}];
const full=[sr.reviewText(""),sr.reviewText("")];
for(const n of [7,8]){
 const result=region.assessGridHeader(headers(title,"令和｜"+n+"｜年分","令和 |"+n+"| 年分"),full);
 assert.deepEqual(result,{status:"MATCH",eligibleForManualTransfer:false,autoApproved:false});
 assert.equal(result.year,undefined);assert.equal(result.candidates,undefined);
}
for(const [b,c] of [["令和6年分","令和6年分"],["令和9年分","令和9年分"],["令和10年分","令和10年分"],["令和7年分","令和8年分"],["令和8年分","令和6年分"]])
 assert.equal(region.assessGridHeader(headers(title,b,c),full).status,"CONFLICT");
for(const [a,b,c] of [["退職所得の源泉徴収票","令和7年分","令和7年分"],["給与所得の源景徴収票","令和7年分","令和7年分"],[title+"令和8年分","令和7年分","令和7年分"],[title,"信和7年分","令和7年分"],[title,"令和||7年分","令和7年分"],[title,"令和7年分",""],[title,"","令和7年分"]])
 assert.equal(region.assessGridHeader(headers(a,b,c),full).status,"UNVERIFIED");
const matchingHeaders=headers(title,"令和7年分");
for(const raw of ["令和6年分 "+title,"令和8年分 "+title,"令和7年分 令和8年分 "+title])
 assert.equal(region.assessGridHeader(matchingHeaders,[sr.reviewText(raw),full[1]]).status,"CONFLICT");
assert.equal(region.assessGridHeader(matchingHeaders,[]).status,"UNVERIFIED");
assert.equal(region.assessGridHeader(matchingHeaders.slice(0,2),full).status,"UNVERIFIED");
assert.equal(region.assessGridHeader([matchingHeaders[0],matchingHeaders[1],matchingHeaders[1]],full).status,"UNVERIFIED");
assert.equal(region.assessGridHeader(headers(title,"令和7年分","令和7年分"),[sr.reviewText("公的年金等の源泉徴収票",true),full[1]]).status,"CONFLICT");

const gridForRecovery=gp(gridFixture());
assert.equal(gridForRecovery.labelRectangles.length,4);
for(const box of gridForRecovery.labelRectangles)assert.ok(box.left>=0&&box.top>=0&&box.width>0&&box.height>0);
const lr=[{key:"salaryGross",text:"支払金額"},{key:"salaryIncomeReference",text:"給与所得控除後の金額（調整控除後）"},{key:"deductionsReference",text:"所得控除の額の合計額"},{key:"socialInsurance",text:"社会保険料等の金額"}];
const missingReview=[sr.reviewText("",true),sr.reviewText("",true)];
const recover=(grid=gridForRecovery,h=matchingHeaders,l=lr,a=digitReads,b=digitReads,p=missingReview)=>region.assessGridRecovery(grid,h,l,a,b,p);
const positive=recover();
assert.equal(positive.eligibleForManualTransfer,true);assert.equal(positive.year,2025);
assert.equal(positive.autoApproved,false);assert.equal(positive.originalCompared,false);
assert.deepEqual(positive.candidates,Object.fromEntries(labels.map(([k,,n])=>[k,n])));
assert.equal(positive.optionalCandidates,undefined);assert.equal(positive.sourceIndicators,undefined);
const partial=recover(undefined,undefined,lr,blankSocial,blankSocial);
assert.equal(partial.eligibleForManualTransfer,false);
assert.equal(partial.year,2025);
assert.equal(partial.autoApproved,false);
assert.deepEqual(partial.reasons,["GRID_SOCIAL_AMOUNT_UNVERIFIED"]);
assert.deepEqual(partial.candidates,Object.fromEntries(labels.filter(([k])=>k!=="socialInsurance").map(([k,,n])=>[k,n])));
const codes=require("../src/pdf-gcodes.js");
assert.equal(codes.canConfirmSocialZero(partial),true);
const confirmedBlank=codes.confirmSocialZero(partial);
assert.equal(confirmedBlank.candidates.socialInsurance,0);
assert.equal(confirmedBlank.originalCompared,false);
assert.equal(confirmedBlank.autoApproved,false);
assert.equal(partial.candidates.socialInsurance,undefined);
assert.equal(codes.canConfirmSocialZero({...partial,reasons:[...partial.reasons,"GRID_FULL_PAGE_CONFLICT"]}),false);
const explicitZero=recover(undefined,undefined,lr,falseSocial,falseSocial);
assert.equal(explicitZero.eligibleForManualTransfer,true);
assert.equal(explicitZero.candidates.socialInsurance,0);
assert.equal(codes.canConfirmSocialZero(explicitZero),false);
const fullNeg=[sr.reviewText("支払金額 123",true),missingReview[1]];
assert.equal(fullNeg[0].candidates.salaryGross,undefined);
assert.equal(fullNeg[0].observedCandidates.salaryGross,123);
const negatives=[
 recover({...gridForRecovery,labelRectangles:[]}),
 recover(undefined,headers(title,"令和7年分","令和8年分")),
 recover(undefined,matchingHeaders.slice(0,2)),
 recover({...gridForRecovery,headerRectangles:gridForRecovery.headerRectangles.slice(0,2)}),
 recover(undefined,undefined,lr.map((x,i)=>i===0?{...x,text:"源泉徴収税額"}:x)),
 recover(undefined,undefined,lr.slice(0,3)),
 recover(undefined,undefined,lr.map((x,i)=>i===3?{...x,text:"社会保険料等の金客"}:x)),
 recover(undefined,undefined,lr,blankSocial,falseSocial),
 recover(undefined,undefined,lr,falseSocial,blankSocial),
 recover(undefined,undefined,lr,blankSocial,blankSocial,[sr.reviewText("社会保険料等の金額 123",true),missingReview[1]]),
 recover(undefined,undefined,lr,blankSocial.map(v=>v.key==="socialInsurance"?{...v,text:"?"}:v),blankSocial),
 recover(undefined,undefined,lr,blankSocial.slice(0,3),blankSocial),
 recover(undefined,undefined,lr,digitReads,mismatch),
 recover(undefined,undefined,lr,digitReads,digitReads,fullNeg),
 recover(undefined,undefined,lr,digitReads,digitReads,[sr.reviewText("令和8年分",true),missingReview[1]]),
 recover(undefined,undefined,lr,digitReads,digitReads,[sr.reviewText("退職所得の源泉徴収票",true),missingReview[1]]),
 recover(undefined,undefined,lr,digitReads,digitReads,[sr.reviewText("支払金額 123\n支払金額 123",true),missingReview[1]]),
 recover(undefined,undefined,lr,digitReads,digitReads,[sr.reviewText("支払金額 1O0",true),missingReview[1]]),
 recover(undefined,undefined,lr,digitReads.map(x=>x.key==="salaryGross"?{...x,text:"20000001"}:x),digitReads.map(x=>x.key==="salaryGross"?{...x,text:"20000001"}:x))
];
for(const bad of negatives){assert.equal(bad.eligibleForManualTransfer,false);assert.equal(bad.autoApproved,false);assert.deepEqual(bad.candidates,{});assert.equal(bad.year,null);}
for(const raw of ["令和|6|年分","令和｜８｜年分","公的年金等の源泉徴収票","令和7年分\n令和|8|年分"]){
 const bad=recover(undefined,undefined,lr,digitReads,digitReads,[sr.reviewText(raw,true),missingReview[1]]);
 assert.equal(bad.eligibleForManualTransfer,false);
 assert.deepEqual(bad.candidates,{});
 assert.equal(bad.year,null);
}
assert.equal(recover(undefined,undefined,lr,digitReads,digitReads,[sr.reviewText("令和|7|年分",true),missingReview[1]]).eligibleForManualTransfer,true);

const baseCrop={width:200,height:40};
for(const [kind,scale,expected] of [
 ["digit",3,{width:600,height:120,border:20}],
 ["digit",2,{width:400,height:80,border:20}],
 ["header",5,{width:1000,height:200,border:20}],
 ["label",4,{width:1200,height:240,border:20}],
 ["label",2,{width:600,height:120,border:20}]
]){
 for(const factor of [.75,1,1.5,2]){
  const r={width:baseCrop.width*factor,height:baseCrop.height*factor};
  assert.deepEqual(region.gridCropSize(r,1080*factor,kind,scale),expected);
 }
}
for(const [r,span,kind,scale] of [
 [baseCrop,0,"digit",3],[baseCrop,NaN,"digit",3],[baseCrop,1080,"bad",3],
 [baseCrop,1080,"digit",5],[baseCrop,1080,"label",3],
 [{width:1080,height:1080},1080,"label",4],
 [{width:200,height:2},1080,"header",5],[{width:200.5,height:40},1080,"digit",3],
 [baseCrop,3000,"digit",3],[baseCrop,1080,"__proto__",3]
])assert.equal(region.gridCropSize(r,span,kind,scale),null);
for(const plan of [gp(gridFixture()),gp(gridFixture(1.25,80,470))]){
 assert.ok(Number.isSafeInteger(plan.gridSpan));
 for(const [kind,rectangles] of [["digit",plan.rectangles],["header",plan.headerRectangles],["label",plan.labelRectangles]]){
  for(const crop of rectangles)assert.ok(region.gridCropSize(crop,plan.gridSpan,kind,kind==="digit"?3:crop.scale));
 }
}
// Long-label sampling is fixed by field, not selected from OCR results.
for(const factor of [.75,1,1.5,2]){
 for(const [key,scale,expectedWidth] of [
  ["salaryGross",4,1200],["salaryIncomeReference",4,800],
  ["deductionsReference",2,400],["socialInsurance",2,600]
 ]){
  const box={key,width:200*factor,height:40*factor};
  assert.deepEqual(region.gridCropSize(box,1080*factor,"label",scale),
   {width:expectedWidth,height:expectedWidth/5,border:20});
 }
}
const trimmedLabel=gridForRecovery.labelRectangles.find(v=>v.key==="salaryIncomeReference");
assert.ok(trimmedLabel.width<=Math.ceil(gridForRecovery.gridSpan*187/1080));
assert.equal(region.assessGridRecovery(gridForRecovery,matchingHeaders,lr.map(v=>v.key==="salaryIncomeReference"?{...v,text:v.text+"余分"}:v),digitReads,digitReads,missingReview).eligibleForManualTransfer,false);
assert.equal(region.assessGridRecovery(gridForRecovery,matchingHeaders,lr.map(v=>v.key==="deductionsReference"?{...v,text:"所得控除の額の合計客"}:v),digitReads,digitReads,missingReview).eligibleForManualTransfer,false);
console.log("PUBLIC_OCR_BOUNDED_REGION_RECHECK_SYNTHETIC_PASS; no source accuracy claim");
