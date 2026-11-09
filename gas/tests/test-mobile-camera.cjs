"use strict";
// Synthetic phone-camera end-to-end offline test; never sends data to Google.
// The preview's stub captures only test data; base64 is not written to evidence.
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {pathToFileURL}=require("node:url"),{chromium}=require("playwright");
const root=path.resolve(__dirname,".."),preview=pathToFileURL(path.join(root,"dist/Furusato_GAS_LocalPreview.html")).href;
const directory=path.join(root,"dist/acceptance/mobile-camera");
(async()=>{
 fs.mkdirSync(directory,{recursive:true});
 const browser=await chromium.launch({headless:true,...(process.env.FURUSATO_BROWSER_CHANNEL?{channel:process.env.FURUSATO_BROWSER_CHANNEL}:{})});
 const evidence=[];
 try{
  for(const p of [{name:"iphone",w:390,h:844,dpr:3,mobile:true},{name:"android",w:412,h:915,dpr:2.625,mobile:true},
   {name:"landscape",w:844,h:390,dpr:3,mobile:true},{name:"pc",w:1280,h:800,dpr:1,mobile:false}]){
   const context=await browser.newContext({viewport:{width:p.w,height:p.h},deviceScaleFactor:p.dpr,isMobile:p.mobile,hasTouch:p.mobile});
   const page=await context.newPage();const errors=[];page.on("pageerror",e=>errors.push(e.message));
   try{
    await page.goto(preview);
    assert.equal(await page.locator("#ocrCamera").getAttribute("capture"),"environment");
    await page.locator("#next").click();
    assert.equal(await page.locator("#ocrCamera").isVisible(),p.w<=680,"camera visibility "+p.name);
    assert.equal(await page.evaluate(()=>document.activeElement?.textContent.trim()),"STEP 2　源泉徴収票・所得の入力");
    assert.match(await page.locator("#stepStatus").textContent(),/全5ステップ中 2/);
    assert.equal(await page.locator(".stepwords [aria-current='step']").count(),1);
    if(!p.mobile){
     await page.locator("#back").click();
     assert.equal(await page.evaluate(()=>document.activeElement?.textContent.trim()),"STEP 1　基本情報");
     evidence.push({profile:p.name,scope:"camera hidden on desktop, file picker available, keyboard focus tracked",status:"PASS"});
     continue;
    }
    const info=await page.evaluate(async()=>{
      // Synthetic photo with deterministic noisy pixels; no tax document is used.
      const canvas=document.createElement("canvas");canvas.width=2048;canvas.height=2048;
      const ctx=canvas.getContext("2d");const data=ctx.createImageData(2048,2048);
      let x=12345;
      for(let i=0;i<data.data.length;i+=4){
        x=(Math.imul(x,1664525)+1013904223)|0;
        data.data[i]=x&255;data.data[i+1]=(x>>>8)&255;data.data[i+2]=(x>>>16)&255;data.data[i+3]=255;
      }
      ctx.putImageData(data,0,0);
      const blob=await new Promise(r=>canvas.toBlob(r,"image/png"));
      const file=new File([blob],"synthetic-camera.png",{type:"image/png"});
      const dt=new DataTransfer();dt.items.add(file);
      const input=document.querySelector("#ocrCamera");input.files=dt.files;
      input.dispatchEvent(new Event("change",{bubbles:true}));
      return {bytes:file.size};
    });
    assert.ok(info.bytes>2*1024*1024,p.name+" test fixture must exceed original 2MB limit");
    await page.evaluate(()=>{
     window.__syntheticUpload=null;window.__syntheticUploadCount=0;
     window.google.script.run.extractWithholdingOcr=function(req){
      window.__syntheticUploadCount++;
      window.__syntheticUpload=req;
      this.onSuccess({schema:"furusato-ocr-review/v1",status:"REQUIRES_REVIEW",
       year:2026,candidates:{salary_gross:7000000,social_insurance:1000000}});
     };
    });
    await page.locator("#ocrRun").click();
    assert.match(await page.locator("#flash").textContent(),/同意してください/);
    assert.equal(await page.evaluate(()=>window.__syntheticUploadCount),0,"no upload without explicit opt-in");
    await page.locator("#ocrConsent").check();
    await page.locator("#ocrRun").click();
    await page.waitForFunction(()=>window.__syntheticUploadCount===1,{timeout:30000});
    const upload=await page.evaluate(()=>{
     const req=window.__syntheticUpload;
     const raw=atob(req.base64);
     return {consent:req.consent,mime:req.mimeType,bytes:raw.length,
       jpegHeader:raw.charCodeAt(0)===255&&raw.charCodeAt(1)===216,
       status:document.querySelector("#ocrResult").textContent,
       sourceStatus:document.querySelector("#sourceMessage").textContent};
    });
    assert.equal(upload.consent,true);
    assert.equal(upload.mime,"image/jpeg");
    assert.ok(upload.bytes>0&&upload.bytes<=2*1024*1024);
    assert.equal(upload.jpegHeader,true);
    assert.match(upload.status,/HOLD/);
    if(p.name==="iphone"){
     // OCR has returned on STEP 2; select a second synthetic document here.
     await page.evaluate(()=>{
      window.__newOcrRequest=null;window.__newOcrCount=0;
      window.google.script.run.extractWithholdingOcr=function(req){
       window.__newOcrCount++;window.__newOcrRequest={req,callback:this.onSuccess};
      };
      const c=document.createElement("canvas");c.width=8;c.height=8;
      c.getContext("2d").fillRect(0,0,8,8);
      c.toBlob(blob=>{
       const dt=new DataTransfer();
       dt.items.add(new File([blob],"second.png",{type:"image/png"}));
       const input=document.querySelector("#ocrCamera");input.files=dt.files;
       input.dispatchEvent(new Event("change",{bubbles:true}));
      },"image/png");
     });
     await page.waitForFunction(()=>document.querySelector("#ocrCamera").files.length>0 &&
       document.querySelector("#ocrConsent").checked===false);
     assert.equal(await page.locator("#salaryGross").inputValue(),"");
     assert.equal(await page.locator("#socialInsurance").inputValue(),"");
     await page.locator("#ocrRun").click();
     assert.equal(await page.evaluate(()=>window.__newOcrCount),0,"new source needs consent");
     await page.locator("#ocrConsent").check();
     await page.locator("#ocrRun").click();
     await page.waitForFunction(()=>window.__newOcrCount===1);
     await page.locator("#salaryGross").fill("7100000");
     await page.evaluate(()=>window.__newOcrRequest.callback({
      schema:"furusato-ocr-review/v1",status:"REQUIRES_REVIEW",year:2026,
      candidates:{salary_gross:9999999,social_insurance:9999999}}));
     assert.equal(await page.locator("#salaryGross").inputValue(),"7100000");
     assert.match(await page.locator("#ocrResult").textContent(),/HOLD/);
    }
    await page.locator("#salaryGross").fill("7000000");
    await page.locator("#socialInsurance").fill("1000000");
    await page.locator("#next").click();
    await page.locator("#ack").check();
    await page.locator("#next").click();await page.locator("#next").click();
    await page.locator("#reportAmount").filter({hasText:"計算停止"}).waitFor();
    assert.equal(await page.locator("#reportAmount").textContent(),"計算停止");
    assert.deepEqual(errors,[]);
    evidence.push({profile:p.name,scope:"large synthetic camera PNG->JPEG <=2MB; consent; HOLD; mobile step focus",
      status:"PASS",inputBytes:info.bytes,outputBytes:upload.bytes});
   }finally{await context.close();}
  }
 }finally{await browser.close();}
 fs.writeFileSync(path.join(directory,"evidence.json"),JSON.stringify({
  schema:"furusato-mobile-camera-review/v1",environment:"SYNTHETIC_BROWSER",
  realIosAndroid:"NOT_TESTED",googleUpload:"NOT_PERFORMED",release:"HOLD",cases:evidence},null,2)+"\n");
 console.log("MOBILE_CAMERA_PASS 4 profiles; consent required; local large-image compression; OCR remains HOLD");
})().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
