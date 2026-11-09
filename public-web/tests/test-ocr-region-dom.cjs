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
let external=0,calls=0,closed=0,recheckWrong=false,roiCalls=0;
win.fetch=()=>{external++;throw Error("REMOTE_REQUEST_FORBIDDEN");};
win.createImageBitmap=async()=>({width:1200,height:800,close(){}});
win.HTMLCanvasElement.prototype.getContext=function(){
 return {fillStyle:"white",fillRect(){},drawImage(){},
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
win.FurusatoImageQuality={assessCanvas:()=>({status:"REVIEW"})};
win.FurusatoPerspective={tryRectify:()=>({status:"UNVERIFIED",canvas:null})};
win.Tesseract={OEM:{LSTM_ONLY:1},createWorker:async()=>{
 roiCalls=0;
 return {recognize:async(_image,options,output)=>{
  calls++;
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
 assert.equal(external,0);
 doc.window.close();
 console.log("PUBLIC_OCR_FIELD_REREAD_DOM_VETO_PASS; synthetic only; RELEASE_HOLD");
}
main().catch(e=>{console.error(e);process.exitCode=1;});