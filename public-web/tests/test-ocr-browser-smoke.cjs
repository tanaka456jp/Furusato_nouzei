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
const {chromium,webkit}=require("../../gas/node_modules/playwright");
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

// Two *fictional* taxpayers: one synthetic image-only slip per PDF page.
// No personal names or real salary statements are embedded in the fixture.
function twoPageImagePdf(){
 const w=1100,h=800,pixels=Buffer.alloc(w*h*3,255);
 for(let y=80;y<730;y++)for(let x=60;x<1020;x++){
  if((y%91<5&&x%37<26)||(x%131<4&&y%41<27)){
   const i=(y*w+x)*3;pixels[i]=pixels[i+1]=pixels[i+2]=30;
  }
 }
 const image=zlib.deflateSync(pixels,{level:6});
 const stream=Buffer.from("q 1100 0 0 800 0 0 cm /Im0 Do Q");
 const objects=[
  Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
  Buffer.from("<< /Type /Pages /Count 2 /Kids [3 0 R 6 0 R] >>"),
  Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1100 800] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>"),
  Buffer.concat([Buffer.from("<< /Length "+stream.length+" >>\\nstream\\n"),stream,Buffer.from("\\nendstream")]),
  Buffer.concat([Buffer.from("<< /Type /XObject /Subtype /Image /Width 1100 /Height 800 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length "+image.length+" >>\\nstream\\n"),image,Buffer.from("\\nendstream")]),
  Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1100 800] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 7 0 R >>"),
  Buffer.concat([Buffer.from("<< /Length "+stream.length+" >>\\nstream\\n"),stream,Buffer.from("\\nendstream")])
 ];
 const blocks=[Buffer.from("%PDF-1.4\\n%\\xE2\\xE3\\xCF\\xD3\\n","binary")];
 const offsets=[0];let size=blocks[0].length;
 objects.forEach((obj,i)=>{
  offsets.push(size);
  const block=Buffer.concat([Buffer.from((i+1)+" 0 obj\\n"),obj,Buffer.from("\\nendobj\\n")]);
  blocks.push(block);size+=block.length;
 });
 const xref=["xref","0 "+(objects.length+1),"0000000000 65535 f "];
 for(let i=1;i<offsets.length;i++)
  xref.push(String(offsets[i]).padStart(10,"0")+" 00000 n ");
 blocks.push(Buffer.from(xref.join("\\n")+"\\ntrailer\\n<< /Size "+(objects.length+1)+" /Root 1 0 R >>\\nstartxref\\n"+size+"\\n%%EOF\\n"));
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
  // Edge on Windows, WebKit on Linux, Chromium on Linux: all browser
  // engines use identical synthetic-only local PDF/OCR privacy gates.
  const channel=process.env.FURUSATO_BROWSER_CHANNEL;
  if(channel&&channel!=="msedge"&&channel!=="webkit")
    throw Error("UNAPPROVED_BROWSER_CHANNEL");
  browser=channel==="webkit"
    ?await webkit.launch({headless:true})
    :await chromium.launch(channel==="msedge"
      ?{headless:true,channel:"msedge"}:{headless:true});
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
     // Deliberately low page-wide confidence: identity/address text
     // is outside the five tax-relevant OCR quality targets.
     return {data:{text:ocrText,confidence:0}};
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
  // Real browser / actual PDF.js two-page image-only document acceptance:
  // independent person-by-page processing, no automatic estimates, per-row
  // review and supported-condition checks, HOLD for an unverified row.
  await page.locator("#batchPdf").setInputFiles({
   name:"fictional-two-page-slips.pdf",
   mimeType:"application/pdf",buffer:twoPageImagePdf()
  });
  const beforeBatchCalls=await page.evaluate(()=>window.__syntheticPdfOcrCalls);
  await page.locator("#batchScan").click();
  await page.waitForFunction(()=>
   document.getElementById("batchScan").disabled===false &&
   document.querySelectorAll("#batchRows tr").length===2,
   null,{timeout:30000});
  assert.equal(await page.evaluate(()=>window.__syntheticPdfOcrCalls),
   beforeBatchCalls+4,"two scan pages require four exact tax-field OCR reads");
  assert.equal(await page.locator("#batchRows tr").count(),2);
  assert.equal(await page.locator("#batchDownload").isDisabled(),true);
  await page.locator("#batchCalculate").click();
  assert.equal(await page.locator("#batchRows .batch-result").first().textContent(),"—",
   "bulk estimate must not calculate without manual source verification");
  await page.locator('#batchRows input[data-field="confirmed"]').first().check();
  await page.locator('#batchRows input[data-field="noExclusions"]').first().check();
  await page.locator("#batchCalculate").click();
  const results=await page.locator("#batchRows .batch-result").allTextContents();
  assert.deepEqual(results,["109,000円","—"],
   "unverified second taxpayer must stay HOLD, never inherit first consent");
  await page.locator('#batchRows input[data-field="confirmed"]').nth(1).check();
  await page.locator('#batchRows input[data-field="noExclusions"]').nth(1).check();
  await page.locator("#batchCalculate").click();
  assert.deepEqual(await page.locator("#batchRows .batch-result").allTextContents(),
    ["109,000円","109,000円"],
    "each independently confirmed taxpayer must get a separate result");
  assert.equal(await page.locator("#batchDownload").isEnabled(),true);
  await page.locator("#batchClear").click();
  assert.equal(await page.locator("#batchRows tr").count(),0);
  assert.equal(await page.locator("#batchDownload").isDisabled(),true);
  assert.equal(await page.locator("#batchScan").isDisabled(),false);
  assert.equal(await page.evaluate(()=>window.FurusatoBatchPdf.isSingleBusy()),false);

  // Repeated PDF scans must finish both OCR passes and release the PDF.js
  // document before the next scan is enabled. This exercises the real
  // browser's worker lifecycle, but measures no memory-retention proof.
  for(let attempt=0;attempt<3;attempt++){
   await page.locator("#slipFile").setInputFiles({
    name:"synthetic-repeat-"+attempt+".pdf",
    mimeType:"application/pdf",buffer:sample
   });
   const previousCalls=await page.evaluate(()=>window.__syntheticPdfOcrCalls);
   await page.locator("#slipScan").click();
   await page.waitForFunction(()=>document.getElementById("slipScan").disabled===false &&
      document.getElementById("slipReview").textContent.includes("候補"),
    null,{timeout:30000});
   assert.equal(await page.evaluate(()=>window.__syntheticPdfOcrCalls),previousCalls+2,
     "every synthetic repeat must perform exactly two recognition passes");
   assert.equal(await page.locator("#slipTransfer").isEnabled(),true);
   assert.equal(await page.locator('[name="salaryGross"]').inputValue(),"",
     "new PDF scan must invalidate previously transferred OCR salary");
  }
  // A File API read may finish AFTER the picker has been cancelled.
  // The stale byte buffer must be discarded before PDF.js starts loading.
  await page.evaluate(()=>{
   const original=File.prototype.arrayBuffer;
   window.__pdfBytesProbe={original};
   window.__pdfBytesStarted=false;
   window.__releasePdfBytes=null;
   File.prototype.arrayBuffer=function(){
    if(this.name!=="synthetic-delayed-pdf-bytes.pdf")
     return original.call(this);
    window.__pdfBytesStarted=true;
    const source=this;
    return new Promise((resolve,reject)=>{
     window.__releasePdfBytes=()=>original.call(source).then(resolve,reject);
    });
   };
  });
  try{
   const beforeBytesOcr=await page.evaluate(()=>window.__syntheticPdfOcrCalls);
   await page.locator("#slipFile").setInputFiles({
    name:"synthetic-delayed-pdf-bytes.pdf",
    mimeType:"application/pdf",buffer:sample
   });
   await page.locator("#slipScan").click();
   await page.waitForFunction(()=>window.__pdfBytesStarted,
     null,{timeout:30000});
   await page.locator("#slipFile").setInputFiles({
    name:"synthetic-after-bytes-swap.pdf",
    mimeType:"application/pdf",buffer:sample
   });
   await page.evaluate(()=>window.__releasePdfBytes());
   await page.waitForFunction(()=>
    document.getElementById("slipScan").disabled===false,
    null,{timeout:30000});
   assert.equal(await page.locator("#slipTransfer").isEnabled(),false);
   assert.equal(await page.evaluate(()=>window.__syntheticPdfOcrCalls),
    beforeBytesOcr,"cancelled raw PDF bytes must never start a recognition");
   assert.equal(await page.evaluate(()=>
    document.getElementById("calculator").dataset.ocrReviewPending),"true");
  }finally{
   await page.evaluate(()=>{
    File.prototype.arrayBuffer=window.__pdfBytesProbe.original;
    delete window.__pdfBytesProbe;
   });
  }

  // Distinct from OCR cancellation: interrupt an in-progress PDF text
  // extraction. The PDF.js loading-task worker must be destroyed BEFORE
  // the blocked text-extraction Promise is manually released.
  await page.evaluate(async raw=>{
   const pdfjs=await import("./vendor/pdf.mjs");
   const probe=pdfjs.getDocument({data:new Uint8Array(raw)});
   const document=await probe.promise;
   const one=await document.getPage(1);
   const taskPrototype=Object.getPrototypeOf(probe);
   const pagePrototype=Object.getPrototypeOf(one);
   await probe.destroy();
   const originalDestroy=taskPrototype.destroy;
   const originalText=pagePrototype.streamTextContent;
   window.__pdfCancellationProbe={
    taskPrototype,pagePrototype,originalDestroy,originalText
   };
   window.__pdfCancelLoads=0;
   window.__pdfTextPending=false;
   window.__pdfTextCancelled=0;
   taskPrototype.destroy=function(){
    window.__pdfCancelLoads++;
    return originalDestroy.apply(this,arguments);
   };
   pagePrototype.streamTextContent=function(){
    window.__pdfTextPending=true;
    // The reader stays pending until the production cancel path closes it.
    return new ReadableStream({
     cancel(){window.__pdfTextCancelled++;}
    });
   };
  },Array.from(sample));
  try{
   await page.locator("#slipFile").setInputFiles({
    name:"synthetic-blocked-text-old.pdf",mimeType:"application/pdf",buffer:sample
   });
   await page.locator("#slipScan").click();
   await page.waitForFunction(()=>window.__pdfTextPending,
     null,{timeout:30000});
   await page.locator("#slipFile").setInputFiles({
    name:"synthetic-blocked-text-new.pdf",mimeType:"application/pdf",buffer:sample
   });
   await page.waitForFunction(()=>window.__pdfTextCancelled===1,
     null,{timeout:30000});
   await page.waitForFunction(()=>window.__pdfCancelLoads===1,
     null,{timeout:30000});
   await page.waitForFunction(()=>
    document.getElementById("slipScan").disabled===false,
    null,{timeout:30000});
   const cancelled=await page.evaluate(()=>({
    destroyed:window.__pdfCancelLoads,
    pending:document.getElementById("calculator").dataset.ocrReviewPending,
    transfer:document.getElementById("slipTransfer").disabled
   }));
   assert.equal(cancelled.destroyed,1,
    "PDF loading task must be destroyed only once");
   assert.equal(cancelled.pending,"true");
   assert.equal(cancelled.transfer,true);
  }finally{
   await page.evaluate(()=>{
    const x=window.__pdfCancellationProbe;
    x.taskPrototype.destroy=x.originalDestroy;
    x.pagePrototype.streamTextContent=x.originalText;
    delete window.__pdfCancellationProbe;
   });
  }

  // Also cancel PDF page rendering itself. A blocked renderer must receive
  // renderTask.cancel() and reject, instead of waiting for a large raster to
  // complete before the next PDF can be read.
  await page.evaluate(async raw=>{
   const pdfjs=await import("./vendor/pdf.mjs");
   const probe=pdfjs.getDocument({data:new Uint8Array(raw)});
   const document=await probe.promise;
   const one=await document.getPage(1);
   const prototype=Object.getPrototypeOf(one);
   await probe.destroy();
   const originalRender=prototype.render;
   window.__pdfRenderProbe={prototype,originalRender};
   window.__pdfRenderStarted=false;
   window.__pdfRenderCancelled=0;
   prototype.render=function(){
    window.__pdfRenderStarted=true;
    let rejectRender;
    return {
     promise:new Promise((_resolve,reject)=>{rejectRender=reject;}),
     cancel(){
      window.__pdfRenderCancelled++;
      rejectRender(Error("SYNTHETIC_RENDER_CANCELLED"));
     }
    };
   };
  },Array.from(sample));
  try{
   await page.locator("#slipFile").setInputFiles({
    name:"synthetic-blocked-render-old.pdf",mimeType:"application/pdf",
    buffer:sample
   });
   await page.locator("#slipScan").click();
   await page.waitForFunction(()=>window.__pdfRenderStarted,
     null,{timeout:30000});
   await page.locator("#slipFile").setInputFiles({
    name:"synthetic-blocked-render-new.pdf",mimeType:"application/pdf",
    buffer:sample
   });
   await page.waitForFunction(()=>window.__pdfRenderCancelled===1,
     null,{timeout:30000});
   await page.waitForFunction(()=>
    document.getElementById("slipScan").disabled===false,
    null,{timeout:30000});
   assert.equal(await page.locator("#slipTransfer").isEnabled(),false);
   assert.equal(await page.locator("#result").isVisible(),false);
   assert.equal(await page.evaluate(()=>
    document.getElementById("calculator").dataset.ocrReviewPending),"true");
  }finally{
   await page.evaluate(()=>{
    const x=window.__pdfRenderProbe;
    x.prototype.render=x.originalRender;
    delete window.__pdfRenderProbe;
   });
  }

  // Cancel a PDF OCR mid-recognition by selecting another synthetic source.
  // The stale scan must not proceed to the contrast pass or resurrect the
  // old candidate, even if its worker returns after source replacement.
  await page.evaluate(ocrText=>{
   window.__cancelSyntheticCalls=0;
   window.__cancelSyntheticTerminations=0;
   window.__releaseSyntheticRecognition=null;
   Tesseract.createWorker=async()=>({
    recognize:async()=>{
     window.__cancelSyntheticCalls++;
     if(window.__cancelSyntheticCalls===1)
       await new Promise(resolve=>{window.__releaseSyntheticRecognition=resolve;});
     return {data:{text:ocrText,confidence:97}};
    },
    terminate:async()=>{window.__cancelSyntheticTerminations++;}
   });
  },fixture);
  await page.locator("#slipFile").setInputFiles({
   name:"synthetic-abort-old.pdf",mimeType:"application/pdf",buffer:sample
  });
  await page.locator("#slipScan").click();
  await page.waitForFunction(()=>typeof window.__releaseSyntheticRecognition==="function",
    null,{timeout:30000});
  await page.locator("#slipFile").setInputFiles({
   name:"synthetic-abort-new.pdf",mimeType:"application/pdf",buffer:sample
  });
  // A stale recognition must trigger immediate worker termination. Do
  // not release the synthetic in-flight Promise until the stop is observed.
  await page.waitForFunction(()=>window.__cancelSyntheticTerminations===1,
    null,{timeout:30000});
  assert.equal(await page.locator("#slipScan").isDisabled(),true,
    "prevent overlapping PDF workers until cleanup finishes");
  await page.evaluate(()=>window.__releaseSyntheticRecognition());
  await page.waitForFunction(()=>document.getElementById("slipScan").disabled===false,
    null,{timeout:30000});
  const aborted=await page.evaluate(()=>({
   calls:window.__cancelSyntheticCalls,
   terminated:window.__cancelSyntheticTerminations,
   pending:document.getElementById("calculator").dataset.ocrReviewPending,
   transferable:!document.getElementById("slipTransfer").disabled
  }));
  assert.equal(aborted.calls,1,"stale PDF must skip the second OCR pass");
  assert.equal(aborted.terminated,1,"stale PDF worker must terminate");
  assert.equal(aborted.pending,"true","new source must remain review pending");
  assert.equal(aborted.transferable,false,"no stale source may be transferred");
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

  // Eager getTextContent() would allocate the entire malicious text
  // layer first. Bound stream chunks before assembling/flattening them.
  await page.evaluate(async raw=>{
   const pdfjs=await import("./vendor/pdf.mjs");
   const task=pdfjs.getDocument({data:new Uint8Array(raw)});
   const document=await task.promise;
   const one=await document.getPage(1);
   const prototype=Object.getPrototypeOf(one);
   await task.destroy();
   window.__streamGuardProbe={prototype,original:prototype.streamTextContent};
   window.__streamGuardCancelled=0;
   prototype.streamTextContent=function(){
    return new ReadableStream({
     start(controller){
      controller.enqueue({items:Array.from({length:4001},(_v,i)=>({
       str:"1",transform:[1,0,0,1,i,1]
      }))});
     },
     cancel(){window.__streamGuardCancelled++;}
    });
   };
  },Array.from(sample));
  try{
   const countBeforeStream=await page.evaluate(()=>window.__syntheticPdfOcrCalls);
   await page.locator("#slipFile").setInputFiles({
    name:"synthetic-oversized-text-layer.pdf",
    mimeType:"application/pdf",buffer:sample
   });
   await page.locator("#slipScan").click();
   await page.waitForFunction(()=>
     document.getElementById("slipScan").disabled===false &&
     document.getElementById("slipReview").textContent.includes("OCRを完了できません"),
     null,{timeout:30000});
   assert.equal(await page.evaluate(()=>window.__streamGuardCancelled),1,
     "oversized PDF text reader must be cancelled");
   assert.equal(await page.evaluate(()=>window.__syntheticPdfOcrCalls),
     countBeforeStream,"oversized PDF text must not fall back to OCR");
   assert.equal(await page.locator("#slipTransfer").isEnabled(),false);
   assert.equal(await page.locator("#result").isVisible(),false);
  }finally{
   await page.evaluate(()=>{
    const a=window.__streamGuardProbe;
    a.prototype.streamTextContent=a.original;
    delete window.__streamGuardProbe;
   });
  }
  // A pending ReadableStream reader must be cancelled promptly on file
  // replacement, without waiting for an unbounded text layer to arrive.
  await page.evaluate(async raw=>{
   const pdfjs=await import("./vendor/pdf.mjs");
   const task=pdfjs.getDocument({data:new Uint8Array(raw)});
   const document=await task.promise;
   const one=await document.getPage(1);
   const prototype=Object.getPrototypeOf(one);
   await task.destroy();
   window.__streamCancelProbe={prototype,original:prototype.streamTextContent};
   window.__streamReadingStarted=false;
   window.__streamCancelCalls=0;
   prototype.streamTextContent=function(){
    return new ReadableStream({
     start(){window.__streamReadingStarted=true;},
     cancel(){window.__streamCancelCalls++;}
    });
   };
  },Array.from(sample));
  try{
   await page.locator("#slipFile").setInputFiles({
    name:"synthetic-stalled-text-layer.pdf",
    mimeType:"application/pdf",buffer:sample
   });
   await page.locator("#slipScan").click();
   await page.waitForFunction(()=>window.__streamReadingStarted,
    null,{timeout:30000});
   await page.locator("#slipFile").setInputFiles({
    name:"synthetic-after-stalled-stream.pdf",
    mimeType:"application/pdf",buffer:sample
   });
   await page.waitForFunction(()=>window.__streamCancelCalls===1,
    null,{timeout:30000});
   await page.waitForFunction(()=>
    document.getElementById("slipScan").disabled===false,
    null,{timeout:30000});
   assert.equal(await page.locator("#slipTransfer").isEnabled(),false);
   assert.equal(await page.evaluate(()=>
    document.getElementById("calculator").dataset.ocrReviewPending),"true");
  }finally{
   await page.evaluate(()=>{
    const a=window.__streamCancelProbe;
    a.prototype.streamTextContent=a.original;
    delete window.__streamCancelProbe;
   });
  }

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
  // A synthetically forged 48MP PNG header is refused before decode.
  const largePhotoHeader=Buffer.from([
    137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,
    0,0,31,128,0,0,23,160
  ]); // 8064 x 6048; metadata only, not a real photo
  const callsBeforeHighRes=await page.evaluate(()=>window.__syntheticPdfOcrCalls);
  await page.locator("#slipFile").setInputFiles({
    name:"synthetic-48mp-header.png",mimeType:"image/png",
    buffer:largePhotoHeader
  });
  await page.locator("#slipScan").click();
  await page.waitForFunction(() =>
    document.getElementById("slipScan").disabled===false &&
    document.getElementById("slipReview").textContent.includes("OCRを完了できません"),
    null,{timeout:30000});
  assert.equal(await page.evaluate(()=>window.__syntheticPdfOcrCalls),callsBeforeHighRes);
  assert.equal(await page.locator("#slipTransfer").isEnabled(),false);
  assert.equal(await page.locator("#slipConfirm").isEnabled(),false);
  assert.deepEqual(external,[],"External network request attempted");
  assert.ok(requestCount>=8,"OCR assets not fetched");
  console.log((process.env.FURUSATO_BROWSER_CHANNEL==="msedge"?
   "PUBLIC_OCR_WINDOWS_EDGE_LOCAL_WASM_BOOT_PASS":
   process.env.FURUSATO_BROWSER_CHANNEL==="webkit"?
   "PUBLIC_OCR_LINUX_WEBKIT_LOCAL_WASM_BOOT_PASS":
   "PUBLIC_OCR_CHROMIUM_LOCAL_WASM_BOOT_PASS")+
   "; synthetic only; OCR accuracy NOT CERTIFIED");
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