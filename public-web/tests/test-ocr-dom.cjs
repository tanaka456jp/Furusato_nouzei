"use strict";
/** Synthetic document ONLY. A DOM integration test, NOT real OCR accuracy. */
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const {JSDOM}=require("../../gas/node_modules/jsdom");
const root=path.resolve(__dirname,"..");
const dist=path.join(root,"dist");
const html=fs.readFileSync(path.join(dist,"index.html"),"utf8");
const script=function(name){return fs.readFileSync(path.join(dist,name),"utf8");};
const text=[
 "令和8年分 給与所得の源泉徴収票",
 "支払金額 7,000,000円",
 "給与所得控除後の金額 5,200,000円",
 "所得控除の額の合計額 1,670,000円",
 "社会保険料等の金額 1,000,000円"
].join("\n");
async function main(){
 const dom=new JSDOM(html,{url:"https://offline-review.invalid/index.html",
  runScripts:"outside-only"});
 const win=dom.window,doc=win.document;
 const form=doc.getElementById("calculator");
 const file=doc.getElementById("slipFile");
 const scan=doc.getElementById("slipScan");
 const transfer=doc.getElementById("slipTransfer");
 const check=doc.getElementById("slipConfirm");
 let recognized=0,terminated=0,networkAttempts=0;
 let holdRecognizer=false,releaseRecognition=null;
 win.fetch=function(){networkAttempts++;throw Error("NETWORK_FORBIDDEN");};
 win.createImageBitmap=async()=>({width:1200,height:800,close(){}});
 win.HTMLCanvasElement.prototype.getContext=function(){
   return {
    fillStyle:"white",drawImage(){},fillRect(){},
    getImageData(x,y,width,height){
      const w=width||1200,h=height||800;
      const data=new Uint8ClampedArray(w*h*4);
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        let i=(y*w+x)*4;
        let v=(x%29<4||y%41<3)?38:247;
        data[i]=data[i+1]=data[i+2]=v;data[i+3]=255;
      }
      return {data};
    },
    putImageData(){}
   };
 };
 win.Tesseract={
   OEM:{LSTM_ONLY:1},
   createWorker:async(lang,oem,opts)=>{
     assert.equal(lang,"jpn");
     assert.equal(oem,1);
     assert.equal(opts.workerBlobURL,false);
     assert.equal(opts.cacheMethod,"none");
     assert.ok(opts.workerPath.includes("/vendor/tesseract/worker.min.js"));
     assert.ok(opts.langPath.includes("/vendor/tesseract/lang"));
     return {
       recognize:async()=>{
         recognized++;
         if(holdRecognizer)return await new Promise(resolve=>{
           releaseRecognition=()=>resolve({data:{text:text,confidence:96}});
         });
         return {data:{text:text,confidence:96}};
       },
       terminate:async()=>{terminated++;}
     };
   }
 };
 win.eval(script("engine.js"));
 win.eval(script("app.js"));
 win.eval(script("ocr-review.js"));
 win.eval(script("ocr-quality.js"));
 win.eval(script("ocr-perspective.js"));
 win.eval(script("ocr.js"));
 function field(name){return form.elements.namedItem(name);}
 field("year").value="2026";
 field("salaryGross").value="7000000";
 field("socialInsurance").value="1000000";
 function calc(){
   form.dispatchEvent(new win.Event("submit",{bubbles:true,cancelable:true}));
   return doc.getElementById("result");
 }
 Object.defineProperty(file,"files",{configurable:true,value:[{
   name:"synthetic-slip.png",type:"image/png",size:1024
 }]});
 file.dispatchEvent(new win.Event("change",{bubbles:true}));
 assert.equal(form.dataset.ocrReviewPending,"true");
 assert.equal(doc.getElementById("result").hidden,true);
 assert.equal(calc().className,"result hold");
 assert.equal(transfer.disabled,true);
 scan.click();
 for(let i=0;i<100 && (scan.disabled||recognized<2);i++)
   await new Promise(resolve=>setImmediate(resolve));
 assert.equal(scan.disabled,false);
 assert.equal(recognized,2);
 assert.equal(terminated,1);
 assert.equal(transfer.disabled,false);
 assert.equal(field("salaryIncomeReference").value,"");
 // Candidate exists, but a manual edit made before transfer must invalidate
 // it without touching the user's newly typed value.
 field("salaryGross").value="7100000";
 field("salaryGross").dispatchEvent(new win.Event("input",{bubbles:true}));
 assert.equal(field("salaryGross").value,"7100000");
 assert.equal(transfer.disabled,true);
 assert.equal(form.dataset.ocrReviewPending,"true");
 // The user may explicitly re-run OCR, then confirm a fresh candidate.
 scan.click();
 for(let i=0;i<100&&scan.disabled;i++)
   await new Promise(resolve=>setImmediate(resolve));
 assert.equal(scan.disabled,false);
 assert.equal(transfer.disabled,false);
 transfer.click();
 assert.equal(field("salaryIncomeReference").value,"");
 check.checked=true;
 transfer.click();
 assert.equal(field("salaryGross").value,"7000000");
 assert.equal(field("socialInsurance").value,"1000000");
 assert.equal(field("salaryIncomeReference").value,"5200000");
 assert.equal(field("deductionsReference").value,"1670000");
 assert.equal(form.dataset.ocrYear,"2026");
 assert.equal(form.dataset.ocrReviewPending,"false");
 assert.equal(check.checked,false);
 assert.equal(transfer.disabled,true);
 assert.equal(file.value,"");
 assert.equal(calc().className,"result hold"); // exclusions not acknowledged
 field("acknowledgedExclusions").checked=true;
 assert.equal(calc().className,"result");
 assert.match(calc().textContent,/109,000円/);
 field("hasMortgage").checked=true;
 field("hasMortgage").dispatchEvent(new win.Event("change",{bubbles:true}));
 assert.equal(doc.getElementById("result").hidden,true);

 assert.equal(calc().className,"result hold");
 assert.doesNotMatch(calc().textContent,/109,000円/);
 // A tax-year change after field transfer must not silently retain an
 // apparent source verification for a different tax year.
 field("hasMortgage").checked=false;
 field("year").value="2025";
 field("year").dispatchEvent(new win.Event("change",{bubbles:true}));
 assert.equal(form.dataset.ocrReviewPending,"true");
 assert.equal(form.dataset.ocrYear,undefined);
 assert.equal(transfer.disabled,true);
 assert.equal(field("salaryIncomeReference").value,"");
 assert.equal(calc().className,"result hold");
 // Any later direct edit of an OCR-transferred amount invalidates the
 // source attestation, so the previous amount is not silently reused.
 // (This case is checked on a fresh transfer before resetting below.)
 form.reset();
 assert.equal(form.dataset.ocrYear,undefined);
 assert.equal(form.dataset.ocrReviewPending,undefined);
 assert.equal(field("salaryIncomeReference").value,"");
 // A file swap WHILE the asynchronous OCR task is in flight must not
 // re-enable transfer of the previous source's amounts.
 Object.defineProperty(file,"files",{configurable:true,value:[{
   name:"older-synthetic.png",type:"image/png",size:1024
 }]});
 file.dispatchEvent(new win.Event("change",{bubbles:true}));
 holdRecognizer=true;
 let oldCount=recognized;
 scan.click();
 for(let i=0;i<100&&!releaseRecognition;i++)
   await new Promise(resolve=>setImmediate(resolve));
 assert.equal(recognized,oldCount+1);
 const oldRelease=releaseRecognition;releaseRecognition=null;
 Object.defineProperty(file,"files",{configurable:true,value:[{
   name:"newer-synthetic.png",type:"image/png",size:1024
 }]});
 file.dispatchEvent(new win.Event("change",{bubbles:true}));
 assert.equal(form.dataset.ocrReviewPending,"true");
 holdRecognizer=false;
 oldRelease();
 for(let i=0;i<100 && scan.disabled;i++)
   await new Promise(resolve=>setImmediate(resolve));
 assert.equal(scan.disabled,false);
 assert.equal(transfer.disabled,true);
 assert.equal(field("salaryIncomeReference").value,"");
 assert.equal(doc.getElementById("slipReview").textContent.includes("older-synthetic"),false);
 holdRecognizer=false;
 // A manual monetary edit while the first OCR pass is still pending must
 // invalidate the late answer, even if both recognitions agree afterward.
 holdRecognizer=true;
 releaseRecognition=null;
 const duringManualBefore=recognized;
 scan.click();
 for(let i=0;i<100&&!releaseRecognition;i++)
   await new Promise(resolve=>setImmediate(resolve));
 assert.equal(recognized,duringManualBefore+1);
 const releasePendingRecognition=releaseRecognition;
 releaseRecognition=null;
 field("salaryGross").value="7150000";
 field("salaryGross").dispatchEvent(new win.Event("input",{bubbles:true}));
 assert.equal(form.dataset.ocrReviewPending,"true");
 assert.equal(transfer.disabled,true);
 holdRecognizer=false;
 releasePendingRecognition();
 for(let i=0;i<100&&scan.disabled;i++)
   await new Promise(resolve=>setImmediate(resolve));
 assert.equal(scan.disabled,false);
 assert.equal(field("salaryGross").value,"7150000");
 assert.equal(transfer.disabled,true);
 // Reset must invalidate any old source data even when no result exists.
 form.reset();
 assert.equal(form.dataset.ocrReviewPending,undefined);
 assert.equal(transfer.disabled,true);
 // A cancelled second file chooser must NOT silently restore the earlier
 // source amounts and permit a new estimate on the old income figures.
 field("year").value="2026";
 Object.defineProperty(file,"files",{configurable:true,value:[{
   name:"synthetic-replacement.png",type:"image/png",size:1024
 }]});
 file.dispatchEvent(new win.Event("change",{bubbles:true}));
 scan.click();
 for(let i=0;i<100&&(scan.disabled||recognized<oldCount+4);i++)
   await new Promise(resolve=>setImmediate(resolve));
 assert.equal(scan.disabled,false);
 assert.equal(transfer.disabled,false);
 check.checked=true;
 transfer.click();
 assert.equal(field("salaryGross").value,"7000000");
 Object.defineProperty(file,"files",{configurable:true,value:[]});
 file.dispatchEvent(new win.Event("change",{bubbles:true}));
 assert.equal(field("salaryGross").value,"");
 assert.equal(field("socialInsurance").value,"");
 assert.equal(field("salaryIncomeReference").value,"");
 assert.equal(field("deductionsReference").value,"");
 field("acknowledgedExclusions").checked=true;
 assert.equal(calc().className,"result hold");
 // Safari compatibility: some implementations expose createImageBitmap
 // but reject a JPEG or imageOrientation option. Native <img> decoding is
 // allowed, is local-only, and still goes through the same OCR/quality gates.
 let revoked=0,objectUrls=0;
 const oldBitmap=win.createImageBitmap,oldImage=win.Image;
 const oldMakeUrl=win.URL.createObjectURL,oldRevokeUrl=win.URL.revokeObjectURL;
 win.createImageBitmap=async()=>{throw Error("SYNTHETIC_BITMAP_DECODE_REJECTED");};
 win.URL.createObjectURL=()=>{objectUrls++;return "blob:offline-synthetic-jpeg";};
 win.URL.revokeObjectURL=()=>{revoked++;};
 win.Image=class SyntheticLocalImage{
   constructor(){this.naturalWidth=1200;this.naturalHeight=800;}
   set src(url){
     assert.match(url,/^blob:offline-synthetic-jpeg$/);
     Promise.resolve().then(()=>this.onload());
   }
 };
 try{
   Object.defineProperty(file,"files",{configurable:true,value:[{
     name:"synthetic-safari.jpg",type:"image/jpeg",size:1024
   }]});
   file.dispatchEvent(new win.Event("change",{bubbles:true}));
   const beforeFallback=recognized;
   scan.click();
   for(let i=0;i<100&&(scan.disabled||recognized<beforeFallback+2);i++)
     await new Promise(resolve=>setImmediate(resolve));
   assert.equal(scan.disabled,false);
   assert.equal(recognized,beforeFallback+2);
   assert.equal(transfer.disabled,false);
   assert.equal(objectUrls,1);
   assert.equal(revoked,1);
   assert.equal(networkAttempts,0);
 }finally{
   win.createImageBitmap=oldBitmap;
   win.Image=oldImage;
   win.URL.createObjectURL=oldMakeUrl;
   win.URL.revokeObjectURL=oldRevokeUrl;
 }
 // The Safari fallback yielded a manually gated OCR candidate. Transferring
 // it, then editing one amount invalidates the source attestation, but must
 // not lose provenance of the OTHER three old OCR values.
 check.checked=true;
 transfer.click();
 assert.equal(form.dataset.ocrYear,"2026");
 assert.equal(field("socialInsurance").value,"1000000");
 field("salaryGross").value="7150000";
 field("salaryGross").dispatchEvent(new win.Event("input",{bubbles:true}));
 assert.equal(form.dataset.ocrYear,undefined);
 assert.equal(form.dataset.ocrReviewPending,"true");
 Object.defineProperty(file,"files",{configurable:true,value:[{
   name:"replacement-after-manual-edit.png",type:"image/png",size:1024
 }]});
 file.dispatchEvent(new win.Event("change",{bubbles:true}));
 assert.equal(field("salaryGross").value,"7150000"); // manual edit retained
 assert.equal(field("socialInsurance").value,""); // stale OCR removed
 assert.equal(field("salaryIncomeReference").value,"");
 assert.equal(field("deductionsReference").value,"");
 assert.equal(form.dataset.ocrReviewPending,"true");
 // Completely manual reference fields are unrelated to a cancelled OCR
 // picker; they must never be silently erased by clearReview().
 form.reset();
 field("salaryIncomeReference").value="5100000";
 field("deductionsReference").value="1650000";
 Object.defineProperty(file,"files",{configurable:true,value:[{
   name:"manual-reference-preservation.png",type:"image/png",size:1024
 }]});
 file.dispatchEvent(new win.Event("change",{bubbles:true}));
 assert.equal(field("salaryIncomeReference").value,"5100000");
 assert.equal(field("deductionsReference").value,"1650000");
 Object.defineProperty(file,"files",{configurable:true,value:[]});
 file.dispatchEvent(new win.Event("change",{bubbles:true}));
 assert.equal(field("salaryIncomeReference").value,"5100000");
 assert.equal(field("deductionsReference").value,"1650000");
 assert.equal(networkAttempts,0);
 dom.window.close();
 console.log("PUBLIC_OCR_MANUAL_TRANSFER_DOM_PASS; synthetic; no network; not accuracy proof");
}
main().catch(error=>{console.error(error);process.exitCode=1;});