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
 win.fetch=function(){networkAttempts++;throw Error("NETWORK_FORBIDDEN");};
 win.createImageBitmap=async()=>({width:1200,height:800,close(){}});
 win.HTMLCanvasElement.prototype.getContext=function(){
   return {
    fillStyle:"white",drawImage(){},fillRect(){},
    getImageData(){return {data:new Uint8ClampedArray(1200*800*4)};},
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
         return {data:{text:text,confidence:96}};
       },
       terminate:async()=>{terminated++;}
     };
   }
 };
 win.eval(script("engine.js"));
 win.eval(script("app.js"));
 win.eval(script("ocr-review.js"));
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
 assert.equal(calc().className,"result hold");
 assert.doesNotMatch(calc().textContent,/109,000円/);
 form.reset();
 assert.equal(form.dataset.ocrYear,undefined);
 assert.equal(form.dataset.ocrReviewPending,undefined);
 assert.equal(field("salaryIncomeReference").value,"");
 assert.equal(networkAttempts,0);
 dom.window.close();
 console.log("PUBLIC_OCR_MANUAL_TRANSFER_DOM_PASS; synthetic; no network; not accuracy proof");
}
main().catch(error=>{console.error(error);process.exitCode=1;});