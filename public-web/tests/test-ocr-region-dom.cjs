"use strict";
/* Real form state, mocked OCR text and geometry; never real sources. */
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const {JSDOM}=require("../../gas/node_modules/jsdom");
const dir=path.join(__dirname,"..","dist");
const html=fs.readFileSync(path.join(dir,"index.html"),"utf8");
// Minimal binary headers for synthetic JPEG/PNG file objects.
const pngHeader=Uint8Array.from([
 137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,4,176,0,0,3,32
]);
const jpegHeader=Uint8Array.from([
 255,216,255,224,0,4,1,1,255,192,0,7,8,3,32,4,176,255,218
]);
function syntheticRasterFile(name,type="image/png",size=1024){
 return {name,type,size,slice(){
  return {arrayBuffer:async()=>{
   const data=type==="image/jpeg"?jpegHeader:pngHeader;
   return data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);
  }};
 }};
}

const doc=new JSDOM(html,{url:"https://local-review.invalid/",runScripts:"outside-only"});
const win=doc.window,dom=win.document;
function evaluate(name){win.eval(fs.readFileSync(path.join(dir,name),"utf8"));}
let external=0,calls=0,closed=0,recheckWrong=false,roiCalls=0,separateMode=false,separateConflict=false,gridMode=false,gridNumericMode=false,gridReadIndex=0,gridParameters=0,gridHeaderMode=false,gridHeaderConflict=false,gridLabelMode=false,gridLabelConflict=false;
win.fetch=()=>{external++;throw Error("REMOTE_REQUEST_FORBIDDEN");};
win.createImageBitmap=async()=>({width:1200,height:800,close(){}});
const gridDraws=[];
win.HTMLCanvasElement.prototype.getContext=function(){
 const canvas=this;
 return {fillStyle:"white",fillRect(){},drawImage(...args){
  if(gridNumericMode&&args.length===9)gridDraws.push({source:args[0],width:canvas.width,height:canvas.height});
 },
  getImageData(x,y,w,h){
   return {data:new Uint8ClampedArray((w||this.canvas?.width||1200)*(h||this.canvas?.height||800)*4)};
  },putImageData(){}};
};
const lines=[
 ["salaryGross","支払金額","7,000,000円"],
 ["salaryIncomeReference","給与所得控除後の金額","5,200,000円"],
 ["deductionsReference","所得控除の額の合計額","1,670,000円"],
 ["socialInsurance","社会保険料等の金額","1,000,000円"]
];
const full="令和8年分 給与所得の源泉徴収票\n"+
  lines.map(row=>row[1]+" "+row[2]).join("\n");
const blocks=[{paragraphs:[{lines:lines.map((row,i)=>({
 text:row[1]+" "+row[2],
 bbox:{x0:80,y0:115+160*i,x1:770,y1:155+160*i}
}))}]}];

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
win.FurusatoImageQuality={assessCanvas:()=>({status:"REVIEW"})};
win.FurusatoPerspective={tryRectify:()=>({status:"UNVERIFIED",canvas:null})};
win.Tesseract={OEM:{LSTM_ONLY:1},createWorker:async()=>{
 roiCalls=0;
 return {setParameters:async params=>{
  assert.equal(params.tessedit_pageseg_mode,"7");
  assert.equal(params.tessedit_char_whitelist,gridHeaderMode&&gridParameters===2?"":"0123456789,");
  gridParameters++;
 },recognize:async(_image,options,output)=>{
  calls++;
  if(gridMode){
   if(gridLabelMode&&gridReadIndex>=12){
    const idx=gridReadIndex++-12;
    const headings=["支払金額","給与所得控除後の金額(調整控除後)","所得控除の額の合計額","社会保険料等の金額"];
    return {data:{text:gridLabelConflict&&idx===3?"社会保険料等の金客":headings[idx],confidence:95}};
   }
   if(gridHeaderMode&&gridReadIndex>=10){
    const idx=gridReadIndex++;
    return {data:{text:idx===10?"|令和|8|年分給与所得の源泉徴収票":gridHeaderConflict?"令和|7|年分":"令和|8|年分",confidence:95}};
   }
   if(gridNumericMode&&gridReadIndex++>=2){
    const idx=(gridReadIndex-3)%4;
    return {data:{text:lines[idx][2].replace("円",""),confidence:95}};
   }
   return {data:{text:"令和8年分 給与所得の源泉徴収票",confidence:90}};
  }
  if(separateMode){
   if(output?.blocks){
    const geometry=tableBlocks();
    if(separateConflict&&roiCalls===1)geometry[0].paragraphs[0].lines[4].text="7,100,000円";
    roiCalls++;
    return {data:{text:tableText,blocks:geometry,confidence:95}};
   }
   const idx=roiCalls-2;roiCalls++;
   const value=lines[idx]?.[2];
   return {data:{text:recheckWrong&&idx===2?"1,970,000円":value,confidence:94}};
  }
  if(output?.blocks)return {data:{text:full,confidence:95,blocks}};
  // Immediately following global full OCR is the enhanced whole-page read.
  if(roiCalls===0){
   roiCalls++;
   return {data:{text:full,confidence:96}};
  }
  const idx=roiCalls-1;
  roiCalls++;
  let value=lines[idx]?.[1]+" "+lines[idx]?.[2];
  if(recheckWrong&&idx===2)value="所得控除の額の合計額 1,970,000円";
  return {data:{text:value,confidence:94}};
 },terminate:async()=>{closed++;}};
}};
for(const name of ["engine.js","app.js","ocr-review.js","ocr-regions.js","ocr-image-header.js","ocr.js"])
 evaluate(name);
const form=dom.getElementById("calculator");
const input=dom.getElementById("slipFile");
const scan=dom.getElementById("slipScan");
const transfer=dom.getElementById("slipTransfer");
function file(name){
 Object.defineProperty(input,"files",{configurable:true,
  value:[syntheticRasterFile(name,"image/png",4096)]});
 input.dispatchEvent(new win.Event("change",{bubbles:true}));
}
async function run(){
 scan.click();
 for(let i=0;i<250&&scan.disabled;i++)
  await new Promise(resolve=>setImmediate(resolve));
 assert.equal(scan.disabled,false);
}
async function main(){
 file("first.png");
 await run();
 assert.equal(calls,6,"two whole-page and four region rereads");
 assert.equal(closed,1);
 assert.equal(transfer.disabled,false,"corroborated is still manually gated");
 assert.equal(form.elements.namedItem("salaryGross").value,"");
 transfer.click();
 assert.equal(form.elements.namedItem("salaryGross").value,"");
 file("second.png");
 recheckWrong=true;
 const before=calls;
 await run();
 assert.equal(calls-before,6);
 assert.equal(transfer.disabled,true,"mismatched field reread must disable transfer");
 assert.match(dom.getElementById("slipReview").textContent,/HOLD|保留|停止/);
 assert.equal(dom.getElementById("slipReview").textContent.includes("1,970,000"),false);
 separateMode=true;recheckWrong=false;
 file("separate.png");
 const sepBefore=calls;
 await run();
 assert.equal(calls-sepBefore,6);
 assert.equal(transfer.disabled,false);
 assert.equal(form.elements.namedItem("salaryGross").value,"");
 assert.equal(dom.getElementById("slipConfirm").checked,false);
 transfer.click();
 assert.equal(form.elements.namedItem("salaryGross").value,"");
 separateConflict=true;
 file("separate-disagree.png");
 const badBefore=calls;
 await run();
 assert.equal(calls-badBefore,2);
 assert.equal(transfer.disabled,true);
 assert.equal(dom.getElementById("slipReview").textContent.includes("7,100,000"),false);
 separateConflict=false;recheckWrong=true;
 file("separate-crop-disagree.png");
 const cropBefore=calls;
 await run();
 assert.equal(calls-cropBefore,6);
 assert.equal(transfer.disabled,true);
 assert.equal(dom.getElementById("slipReview").textContent.includes("1,970,000"),false);
 // Mock only the positive geometry diagnosis. A matching ruled table
 // without verified monetary values must never be promoted to transfer.
 gridMode=true;separateMode=false;
 let probes=0;
 const originalPlan=win.FurusatoOcrRegions.planGridCanvas;
 win.FurusatoOcrRegions.planGridCanvas=()=>{probes++;return {status:"LAYOUT_ONLY",layoutLocated:true,eligibleForManualTransfer:false,rectangles:[]};};
 file("grid-only.png");
 const gridBefore=calls;
 await run();
 assert.equal(calls-gridBefore,2);
 assert.equal(probes,1);
 assert.equal(transfer.disabled,true);
 assert.equal(dom.getElementById("slipConfirm").disabled,true);
 assert.equal(form.elements.namedItem("salaryGross").value,"");
 assert.match(dom.getElementById("slipReview").textContent,/罫線配置は一致しましたが/);
 assert.equal(dom.getElementById("result").hidden,true);
 // All four digit-only results agree across both crops, but the
 // underlying full-page read remains incomplete: NO positive transfer.
 gridNumericMode=true;gridReadIndex=0;
 win.FurusatoOcrRegions.planGridCanvas=()=>({status:"LAYOUT_ONLY",layoutLocated:true,
  eligibleForManualTransfer:false,rectangles:lines.map(([key],i)=>({key,left:80+i*120,top:120,width:100,height:28}))});
 file("grid-digits-only.png");
 const numericBefore=calls;
 await run();
 assert.equal(calls-numericBefore,10);
 assert.equal(gridParameters,1);
 assert.equal(gridDraws.length,8);
 for(let i=0;i<7;i++){
  assert.equal(gridDraws[i].width,340);
  assert.equal(gridDraws[i].height,124);
 }
 assert.equal(gridDraws[7].width,240);
 assert.equal(gridDraws[7].height,96);
 assert.equal(gridDraws[7].source,gridDraws[3].source);
 assert.notEqual(gridDraws[4].source,gridDraws[0].source);
 assert.equal(transfer.disabled,true);
 assert.equal(dom.getElementById("slipConfirm").disabled,true);
 assert.equal(form.elements.namedItem("salaryGross").value,"");
 assert.match(dom.getElementById("slipReview").textContent,/4欄中4欄で2回の認識結果が一致/);
 assert.equal(dom.getElementById("slipReview").textContent.includes("7,000,000"),false);
 assert.equal(dom.getElementById("result").hidden,true);
 gridHeaderMode=true;
 const numericPlan=win.FurusatoOcrRegions.planGridCanvas;
 win.FurusatoOcrRegions.planGridCanvas=()=>({...numericPlan(),headerRectangles:[
  {key:"heading",left:80,top:30,width:200,height:30,scale:3},
  {key:"year",left:80,top:30,width:90,height:30,scale:5}
 ]});
 for(const conflict of [false,true]){
  gridHeaderConflict=conflict;gridReadIndex=0;gridParameters=1;
  file("grid-header-"+conflict+".png");
  const before=calls;
  await run();
  assert.equal(calls-before,12);
  assert.equal(gridParameters,3);
  assert.equal(transfer.disabled,true);
  assert.equal(dom.getElementById("slipConfirm").disabled,true);
  assert.equal(form.elements.namedItem("salaryGross").value,"");
  assert.equal(dom.getElementById("result").hidden,true);
  assert.match(dom.getElementById("slipReview").textContent,conflict?/年分の不一致/:/表題・所得年の部分読取：一致/);
 }
 // Positive grid route requires ALL FOUR exact labels, even with
 // matching header and digit crops. No transfer without the fresh checkbox.
 gridLabelMode=true;gridHeaderConflict=false;
 const headerPlan=win.FurusatoOcrRegions.planGridCanvas;
 win.FurusatoOcrRegions.planGridCanvas=()=>({...headerPlan(),labelRectangles:lines.map(([key],i)=>({key,left:80+i*120,top:90,width:100,height:20,scale:2}))});
 for(const conflict of [true,false]){
  gridLabelConflict=conflict;gridReadIndex=0;gridParameters=1;
  file("grid-label-"+conflict+".png");const before=calls;await run();
  assert.equal(calls-before,16);
  assert.equal(transfer.disabled,conflict);
  assert.equal(form.elements.namedItem("salaryGross").value,"");
  assert.equal(dom.getElementById("slipConfirm").checked,false);
  assert.equal(dom.getElementById("result").hidden,true);
  if(conflict){assert.equal(dom.getElementById("slipReview").textContent.includes("7,000,000"),false);}
  else{
   transfer.click();
   assert.equal(form.elements.namedItem("salaryGross").value,"");
   dom.getElementById("slipConfirm").checked=true;
   dom.getElementById("slipConfirm").dispatchEvent(new win.Event("change",{bubbles:true}));
   transfer.click();
   assert.equal(form.elements.namedItem("salaryGross").value,"7000000");
   assert.equal(form.elements.namedItem("acknowledgedExclusions").checked,false);
   assert.equal(dom.getElementById("result").hidden,true);
  }
 }
 win.FurusatoOcrRegions.planGridCanvas=originalPlan;
 assert.equal(external,0);
 doc.window.close();
 console.log("PUBLIC_OCR_FIELD_REREAD_DOM_VETO_PASS; synthetic only; RELEASE_HOLD");
}
main().catch(e=>{console.error(e);process.exitCode=1;});