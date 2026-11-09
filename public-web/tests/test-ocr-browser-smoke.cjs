"use strict";
/**
 * Real headless Chromium OCR startup smoke; synthetic canvas only.
 * Never sends a document, calls Google, or opens a public port.
 * Success means the local WASM/jpn model starts, NOT OCR accuracy.
 */
const assert=require("node:assert/strict");
const fs=require("node:fs");
const http=require("node:http");
const path=require("node:path");
const {chromium}=require("../../gas/node_modules/playwright");
const root=path.resolve(__dirname,"..","dist");
const types={".js":"text/javascript; charset=utf-8",
 ".mjs":"text/javascript; charset=utf-8",
 ".html":"text/html; charset=utf-8",
 ".css":"text/css; charset=utf-8",
 ".wasm":"application/wasm",".gz":"application/gzip"};
async function main(){
 const csp=fs.readFileSync(path.join(root,"_headers"),"utf8")
   .split("\n").find(x=>x.trim().startsWith("Content-Security-Policy:"))
   .replace(/^\s*Content-Security-Policy:\s*/,"").trim();
 let requestCount=0;
 const server=http.createServer(function(req,res){
  try{
   const url=new URL(req.url,"http://127.0.0.1");
   if(req.method!=="GET"||url.pathname.includes("..")){
    res.writeHead(400);res.end();return;
   }
   const requested=url.pathname==="/"?"/index.html":url.pathname;
   const name=decodeURIComponent(requested).replace(/^\/+/,"");
   const full=path.resolve(root,name);
   if(!full.startsWith(root+path.sep)){
    res.writeHead(403);res.end();return;
   }
   const stat=fs.statSync(full);
   if(!stat.isFile())throw Error("missing asset");
   requestCount++;
   res.writeHead(200,{"Content-Type":types[path.extname(full)]||
     "application/octet-stream",
     "Content-Security-Policy":csp,
     "Cache-Control":"no-store","X-Robots-Tag":"noindex"});
   fs.createReadStream(full).pipe(res);
  }catch(_){res.writeHead(404);res.end();}
 });
 await new Promise(function(resolve,reject){
  server.once("error",reject);server.listen(0,"127.0.0.1",resolve);
 });
 let browser;
 try{
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage();
  const external=[];
  page.on("request",function(req){
   if(!req.url().startsWith("http://127.0.0.1:"))
    external.push(req.url().split("?")[0]);
  });
  const url="http://127.0.0.1:"+server.address().port+"/index.html";
  await page.goto(url,{waitUntil:"load",timeout:30000});
  const status=await page.evaluate(async function(){
   if(typeof Tesseract==="undefined"||!Tesseract.createWorker)
    throw Error("TESSERACT_NOT_LOADED");
   const lib=await import("./vendor/pdf.mjs");
   if(typeof lib.getDocument!=="function")throw Error("PDF_RUNTIME_NOT_LOADED");
   const worker=await Tesseract.createWorker("jpn",Tesseract.OEM.LSTM_ONLY,{
     workerPath:new URL("./vendor/tesseract/worker.min.js",location.href).href,
     corePath:new URL("./vendor/tesseract/core",location.href).href,
     langPath:new URL("./vendor/tesseract/lang",location.href).href,
     workerBlobURL:false,cacheMethod:"none"
   });
   try{
    const canvas=document.createElement("canvas");
    canvas.width=1400;canvas.height=800;
    const ctx=canvas.getContext("2d");
    ctx.fillStyle="white";ctx.fillRect(0,0,1400,800);
    ctx.fillStyle="black";ctx.font="48px sans-serif";
    ctx.fillText("令和8年分　給与所得の源泉徴収票",60,120);
    ctx.fillText("支払金額　7,000,000円",60,220);
    const outcome=await worker.recognize(canvas);
    canvas.width=0;canvas.height=0;
    if(!window.FurusatoPerspective||
       typeof window.FurusatoPerspective.tryRectify!=="function")
      throw Error("PERSPECTIVE_MODULE_NOT_LOADED");
    // A real Chromium Canvas path, but still a purely SYNTHETIC dark-background
    // photo. No tax information or private documents are used.
    const photo=document.createElement("canvas");
    photo.width=1200;photo.height=900;
    const pctx=photo.getContext("2d");
    pctx.fillStyle="#181818";pctx.fillRect(0,0,1200,900);
    pctx.beginPath();
    pctx.moveTo(180,80);pctx.lineTo(1080,120);
    pctx.lineTo(1000,850);pctx.lineTo(220,800);
    pctx.closePath();
    pctx.fillStyle="#f7f7f7";pctx.fill();
    const rectified=window.FurusatoPerspective.tryRectify(photo);
    photo.width=0;photo.height=0;
    const geometry={status:rectified.status,
      width:rectified.canvas?.width||0,height:rectified.canvas?.height||0};
    if(rectified.canvas){
      rectified.canvas.width=0;rectified.canvas.height=0;
    }
    return {textType:typeof outcome?.data?.text,
      confidence:outcome?.data?.confidence,geometry};
   }finally{await worker.terminate();}
  },{timeout:180000});
  assert.equal(status.textType,"string");
  assert.ok(Number.isFinite(status.confidence));
  assert.equal(status.geometry.status,"APPLIED");
  assert.ok(status.geometry.width>=750&&status.geometry.height>=400);
  assert.ok(status.geometry.width*status.geometry.height<=3200000);
  assert.deepEqual(external,[],"External network request attempted");
  assert.ok(requestCount>=8,"OCR assets not fetched");
  console.log("PUBLIC_OCR_CHROMIUM_LOCAL_WASM_BOOT_PASS; synthetic only; OCR accuracy NOT CERTIFIED");
  await page.close();
 }finally{
  if(browser)await browser.close();
  await new Promise(resolve=>server.close(resolve));
 }
}
main().catch(err=>{
 console.error("PUBLIC_OCR_CHROMIUM_LOCAL_BOOT_FAILED: "+
  String(err?.message||"unknown").slice(0,600));
 process.exitCode=1;
});