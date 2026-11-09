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
const zlib=require("node:zlib");
const {chromium}=require("../../gas/node_modules/playwright");
const root=path.resolve(__dirname,"..","dist");
const types={".js":"text/javascript; charset=utf-8",
 ".mjs":"text/javascript; charset=utf-8",
 ".html":"text/html; charset=utf-8",
 ".css":"text/css; charset=utf-8",
 ".wasm":"application/wasm",".gz":"application/gzip"};

// A one-page PDF with ONLY an RGB image XObject, no BT/Tj/Text operators.
// All pixels are synthetic. The PDF is assembled in memory and never
// uploaded to GitHub, an artifact or any remote server.
function imageOnlyPdf(blank=false){
 const w=1100,h=800,pixels=Buffer.alloc(w*h*3,255);
 if(!blank){
  for(let y=80;y<730;y++)for(let x=60;x<1020;x++){
   const stroke=(y%91<5&&x%37<26)||(x%131<4&&y%41<27);
   if(stroke){
    const i=(y*w+x)*3;
    pixels[i]=pixels[i+1]=pixels[i+2]=30;
   }
  }
 }
 const encoded=zlib.deflateSync(pixels,{level:6});
 const objects=[
  Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
  Buffer.from("<< /Type /Pages /Count 1 /Kids [3 0 R] >>"),
  Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1100 800] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>"),
  Buffer.from("<< /Length 31 >>\nstream\nq 1100 0 0 800 0 0 cm /Im0 Do Q\nendstream"),
  Buffer.concat([Buffer.from("<< /Type /XObject /Subtype /Image /Width 1100 /Height 800 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length "+encoded.length+" >>\nstream\n"),encoded,Buffer.from("\nendstream")])
 ];
 const blocks=[Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n","binary")],offsets=[0];
 let length=blocks[0].length;
 for(let i=0;i<objects.length;i++){
  offsets.push(length);
  const obj=Buffer.concat([Buffer.from((i+1)+" 0 obj\n"),objects[i],Buffer.from("\nendobj\n")]);
  blocks.push(obj);length+=obj.length;
 }
 const start=length;
 const xref=["xref","0 "+(objects.length+1),"0000000000 65535 f "];
 for(let i=1;i<offsets.length;i++)xref.push(String(offsets[i]).padStart(10,"0")+" 00000 n ");
 const trailer=Buffer.from(xref.join("\n")+"\ntrailer\n<< /Size "+(objects.length+1)+" /Root 1 0 R >>\nstartxref\n"+start+"\n%%EOF\n");
 blocks.push(trailer);
 return Buffer.concat(blocks);
}

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
    const outcome=await worker.recognize(canvas,{}, {text:true,blocks:true});
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
      confidence:outcome?.data?.confidence,blocksReturned:Array.isArray(outcome?.data?.blocks),geometry};
   }finally{await worker.terminate();}
  },{timeout:180000});
  assert.equal(status.textType,"string");
  assert.ok(Number.isFinite(status.confidence));
  assert.equal(status.blocksReturned,true,"OCR word position output is unavailable");
  assert.equal(status.geometry.status,"APPLIED");
  assert.ok(status.geometry.width>=750&&status.geometry.height>=400);
  assert.ok(status.geometry.width*status.geometry.height<=3200000);

  // PDF.js must see an actual single-page image-only PDF, report no text,
  // rasterize it locally and call two-pass OCR. The fake OCR result below
  // proves routing and review gates, NOT real Japanese text accuracy.
  const sample=imageOnlyPdf();
  const pdfSnapshot=await page.evaluate(async raw=>{
   const pdfjs=await import("./vendor/pdf.mjs");
   pdfjs.GlobalWorkerOptions.workerSrc="./vendor/pdf.worker.mjs";
   const instance=await pdfjs.getDocument({data:new Uint8Array(raw)}).promise;
   try{
    const one=await instance.getPage(1);
    const layer=await one.getTextContent();
    return {pages:instance.numPages,count:layer.items.length};
   }finally{if(typeof instance.destroy==="function")await instance.destroy();}
  },Array.from(sample));
  assert.deepEqual(pdfSnapshot,{pages:1,count:0});

  // A synthetic-only direct PDF.js rendering probe. Show the exception
  // name/message for THIS GENERATED PDF only, never for a real upload.
  const renderProbe=await page.evaluate(async raw=>{
   const pdfjs=await import("./vendor/pdf.mjs");
   pdfjs.GlobalWorkerOptions.workerSrc="./vendor/pdf.worker.mjs";
   const task=pdfjs.getDocument({data:new Uint8Array(raw),
    disableAutoFetch:true,disableStream:true,
    isEvalSupported:false,useSystemFonts:false,stopAtErrors:true});
   const document=await task.promise;
   try{
    const page=await document.getPage(1);
    const viewport=page.getViewport({scale:1});
    const scale=Math.min(3,2600/Math.max(viewport.width,viewport.height));
    const view=page.getViewport({scale});
    const canvas=window.document.createElement("canvas");
    canvas.width=Math.ceil(view.width);canvas.height=Math.ceil(view.height);
    try{
     await page.render({canvas,canvasContext:canvas.getContext("2d"),viewport:view}).promise;
     return {status:"OK",width:canvas.width,height:canvas.height};
    }catch(err){
     return {status:"FAIL",name:String(err?.name||""),message:String(err?.message||"").slice(0,250)};
    }finally{canvas.width=0;canvas.height=0;}
   }finally{if(typeof task.destroy==="function")await task.destroy();}
  },Array.from(sample));
  assert.equal(renderProbe.status,"OK",JSON.stringify(renderProbe));
  const fixture=[
   "令和8年分 給与所得の源泉徴収票",
   "支払金額 7,000,000円",
   "給与所得控除後の金額 5,200,000円",
   "所得控除の額の合計額 1,670,000円",
   "社会保険料等の金額 1,000,000円"
  ].join("\n");
  await page.evaluate(ocrText=>{
   window.__syntheticPdfOcrCalls=0;
   Tesseract.createWorker=async()=>({
    recognize:async()=>{
     window.__syntheticPdfOcrCalls++;
     return {data:{text:ocrText,confidence:97}};
    },
    terminate:async()=>{}
   });
  },fixture);
  await page.locator("#slipFile").setInputFiles({
   name:"synthetic-image-only.pdf",mimeType:"application/pdf",buffer:sample
  });
  await page.locator("#slipScan").click();
  try{
    await page.waitForFunction(()=>
      document.getElementById("slipScan").disabled===false &&
      (document.getElementById("slipReview").textContent.includes("候補") ||
       document.getElementById("slipReview").textContent.includes("保留")),
      null,{timeout:30000});
  }catch(_){
    // These strings come exclusively from generated synthetic PDFs and
    // generic UI messages, never from real documents or uploaded data.
    const state=await page.evaluate(()=>({
      disabled:document.getElementById("slipScan").disabled,
      reason:document.getElementById("slipReview").textContent.slice(0,220),
      ocrCalls:window.__syntheticPdfOcrCalls
    }));
    throw Error("SYNTHETIC_IMAGE_ONLY_PDF_ROUTE_FAILED:"+JSON.stringify(state));
  }
  const route=await page.evaluate(()=>({
   calls:window.__syntheticPdfOcrCalls,
   transferable:!document.getElementById("slipTransfer").disabled,
   before:document.querySelector('[name="salaryGross"]').value
  }));
  assert.equal(route.calls,2,"image-only PDF must take the two-pass OCR path");
  assert.equal(route.transferable,true,"mocked matching OCR still requires manual confirmation");
  assert.equal(route.before,"");
  await page.locator("#slipTransfer").click();
  assert.equal(await page.locator('[name="salaryGross"]').inputValue(),"");
  await page.locator("#slipConfirm").check();
  await page.locator("#slipTransfer").click();
  assert.equal(await page.locator('[name="salaryGross"]').inputValue(),"7000000");
  // A completely blank one-page PDF is also image-only but fails quality
  // screening, not promoted into a transfer candidate by the mocked OCR.
  await page.locator("#slipFile").setInputFiles({
   name:"synthetic-blank-page.pdf",mimeType:"application/pdf",
   buffer:imageOnlyPdf(true)
  });
  await page.locator("#slipScan").click();
  await page.waitForFunction(()=>
   document.getElementById("slipScan").disabled===false &&
   document.getElementById("slipReview").textContent.includes("OCRを完了できません"),
   {timeout:30000});
  assert.equal(await page.locator("#slipTransfer").isEnabled(),false);
  assert.equal(await page.locator('[name="salaryGross"]').inputValue(),"");
  assert.equal(await page.locator("#result").isVisible(),false);
  // PDF.js loading-task worker cleanup applies on both success and HOLD paths.

  // An extremely small forged PNG advertising 50,000 x 50,000 pixels
  // must be rejected before any decode or OCR, with no source upload.
  const oversizedHeader=Buffer.from([
    137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,
    0,0,195,80,0,0,195,80
  ]);
  const beforeOversize=await page.evaluate(()=>window.__syntheticPdfOcrCalls);
  await page.locator("#slipFile").setInputFiles({
    name:"synthetic-oversize.png",mimeType:"image/png",buffer:oversizedHeader
  });
  await page.locator("#slipScan").click();
  await page.waitForFunction(()=>
    document.getElementById("slipScan").disabled===false &&
    document.getElementById("slipReview").textContent.includes("OCRを完了できません"),
    null,{timeout:30000});
  assert.equal(await page.evaluate(()=>window.__syntheticPdfOcrCalls),beforeOversize);
  assert.equal(await page.locator("#slipTransfer").isEnabled(),false);
  assert.equal(await page.locator("#slipConfirm").isEnabled(),false);
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