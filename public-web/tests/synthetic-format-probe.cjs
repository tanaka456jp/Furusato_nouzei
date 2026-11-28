"use strict";
// Test-only, fixed synthetic JPEG and empty-text PDF; no production import.
// Each configuration uses the production geometry and strict amount gate.
async function probeFormatInBrowser(){
 const file=document.getElementById("slipFile").files[0];
 const jpeg=file?.name==="15-bilingual-jpeg.jpg",pdf=file?.name==="17-bilingual-raster.pdf";
 if(!jpeg&&!pdf)throw Error("RESEARCH_SOURCE_NOT_SYNTHETIC");
 const regions=FurusatoOcrRegions,review=FurusatoSlipReview;
 const paths={workerPath:new URL("./vendor/tesseract/worker.min.js",location.href).href,
  corePath:new URL("./vendor/tesseract/core",location.href).href,
  langPath:new URL("./vendor/tesseract/lang",location.href).href,workerBlobURL:false,cacheMethod:"none"};
 const variants=jpeg?
  [{id:"JPEG_CURRENT",scale:1,gain:1.35,mid:139},{id:"JPEG_MILD",scale:1,gain:1.15,mid:128}]:
  [{id:"PDF_CURRENT",scale:3,gain:1.35,mid:139},{id:"PDF_2X",scale:2,gain:1.35,mid:139}];
 let bitmap,loading,documentPdf,pdfPage;
 const results=[];
 try{
  if(jpeg)bitmap=await createImageBitmap(file);
  else{
   const lib=await import("./vendor/pdf.mjs");
   lib.GlobalWorkerOptions.workerSrc=new URL("./vendor/pdf.worker.mjs",location.href).href;
   loading=lib.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,
    maxImageSize:16000000,disableFontFace:true});
   documentPdf=await loading.promise;
   if(documentPdf.numPages!==1)throw Error("RESEARCH_PDF_PAGE_COUNT");
   pdfPage=await documentPdf.getPage(1);
   const layer=await pdfPage.getTextContent();
   if(layer.items.some(x=>typeof x.str==="string"&&x.str.trim()))throw Error("RESEARCH_PDF_NOT_EMPTY");
  }
  for(const variant of variants){
   const canvases=[];let worker=null;
   const canvas=(w,h)=>{
    if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w*h>10000000)throw Error("RESEARCH_SIZE");
    const c=document.createElement("canvas");c.width=w;c.height=h;canvases.push(c);return c;
   };
   const stop=async()=>{if(worker){const w=worker;worker=null;await w.terminate();}};
   const makeWorker=async lang=>{worker=await Tesseract.createWorker(lang,Tesseract.OEM.LSTM_ONLY,paths);return worker;};
   const report={id:variant.id,configuration:variant,pages:[],reads:[],status:"HOLD"};
   try{
    let base;
    if(jpeg){base=canvas(bitmap.width,bitmap.height);base.getContext("2d").drawImage(bitmap,0,0);}
    else{
     const viewport=pdfPage.getViewport({scale:variant.scale});
     base=canvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
     await pdfPage.render({canvas:base,canvasContext:base.getContext("2d"),viewport}).promise;
    }
    report.dimensions=[base.width,base.height];
    if(FurusatoImageQuality.assessCanvas(base).status!=="REVIEW"){report.reason="QUALITY";continue;}
    const alternate=canvas(base.width,base.height),ctx=alternate.getContext("2d");
    ctx.drawImage(base,0,0);const pixels=ctx.getImageData(0,0,base.width,base.height);
    for(let i=0;i<pixels.data.length;i+=4){
     const grey=.299*pixels.data[i]+.587*pixels.data[i+1]+.114*pixels.data[i+2];
     const v=Math.max(0,Math.min(255,Math.round((grey-128)*variant.gain+variant.mid)));
     pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=v;
    }
    ctx.putImageData(pixels,0,0);
    const jpn=await makeWorker("jpn"),plans=[];
    for(const source of [base,alternate]){
     const rec=await jpn.recognize(source,{}, {text:true,blocks:true}),d=rec.data;
     const reviewed=review.reviewText(d.text),plan=regions.planBilingual(d.blocks,base.width,base.height,reviewed);
     const lines=(d.blocks||[]).flatMap(b=>b.paragraphs.flatMap(p=>p.lines.map(l=>({text:String(l.text||"").slice(0,240),bbox:l.bbox})))).slice(0,100);
     report.pages.push({year:reviewed.year,reasons:reviewed.reasons,plan,lines});
     plans.push(plan);
    }
    await stop();
    if(!regions.agreeBilingual(plans[0],plans[1])){report.reason="GEOMETRY_OR_YEAR";continue;}
    const eng=await makeWorker("eng");
    await eng.setParameters({tessedit_pageseg_mode:"7",tessedit_char_whitelist:"0123456789,.-"});
    for(const pass of [0,1]){
     const values=[],scale=pass===0?1:2;
     for(const f of plans[pass].fields){
      const w=f.width*scale,h=f.height*scale,c=canvas(w+40,h+40),cx=c.getContext("2d");
      cx.fillStyle="#fff";cx.fillRect(0,0,c.width,c.height);
      cx.drawImage(pass===0?base:alternate,f.left,f.top,f.width,f.height,20,20,w,h);
      const rec=await eng.recognize(c);values.push({key:f.key,text:rec.data.text,confidence:rec.data.confidence});
      c.width=c.height=0;
     }
     report.reads.push(values);
    }
    const assessed=regions.assessBilingual(plans[0],plans[1],report.reads[0],report.reads[1]);
    report.status=assessed.eligibleForManualTransfer?"RESEARCH_MATCH":"HOLD";
    report.assessment=assessed;
    // Diagnostic only, no transfer through the actual calculator.
   }finally{
    try{await stop();}finally{for(const c of canvases)c.width=c.height=0;results.push(report);}
   }
  }
  return results;
 }finally{if(bitmap)bitmap.close();if(loading)await loading.destroy();}
}
module.exports={probeFormatInBrowser};
