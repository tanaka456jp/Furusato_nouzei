"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {JSDOM} = require("jsdom");

const root = path.resolve(__dirname,"..");
const context = {module:{exports:{}},console,Math,Number,String,Infinity};
vm.runInNewContext(fs.readFileSync(path.join(root,"Engine.gs"),"utf8"),context);
const engine = context.module.exports;
const html = fs.readFileSync(path.join(root,"Index.html"),"utf8");

function createPage() {
  const calls = [];
  const dom = new JSDOM(html,{url:"https://example.test",runScripts:"dangerously",
    pretendToBeVisual:true,beforeParse(win) {
      win.scrollTo = () => {};
      const runner = {
        withSuccessHandler(fn){this.ok=fn;return this;},
        withFailureHandler(fn){this.fail=fn;return this;},
        runFurusatoSimulation(input) {
          calls.push(input);
          try {this.ok(engine.calculate(input));}
          catch(e){this.fail(e);}
        }
      };
      win.google={script:{run:runner}};
    }
  });
  const w=dom.window;
  function el(id){return w.document.getElementById(id);}
  function click(id){el(id).click();}
  function type(id,value){el(id).value=String(value);el(id).dispatchEvent(new w.Event("change",{bubbles:true}));}
  function next(){click("next");}
  function enterSalary(){next();type("salaryGross",7000000);type("socialInsurance",1000000);}
  function confirmOthers(){next();el("ack").checked=true;next();}
  return {w,calls,dom,el,click,type,next,enterSalary,confirmOthers};
}

async function importJson(page,payload) {
  const file = new page.w.File([JSON.stringify(payload)],"source.json",{type:"application/json"});
  Object.defineProperty(page.el("file"),"files",{configurable:true,value:[file]});
  page.el("file").dispatchEvent(new page.w.Event("change",{bubbles:true}));
  await new Promise(resolve=>page.w.setTimeout(resolve,60));
}

function source(status,fields,warnings) {
  return {schema:"furusato-withholding-extract/v1",status,year:2026,
    format:"PDF_TEXT",fields:fields||{salary_gross:7000000,salary_reference:5200000,
      social_insurance:1000000,income_tax_withheld:285800,deductions_reference:1670000},
    warnings:warnings||[],personal_identifiers:"NEVER_EXTRACTED"};
}
const tests = [];
function test(name,fn){tests.push({name,fn});}

test("e-Tax five-stage wizard yields printable standard salary estimate",async()=>{
 const p=createPage();
 try {
  assert.equal(p.w.document.querySelectorAll(".stage").length,5);
  p.enterSalary();p.confirmOthers();
  assert.equal(p.el("screen3").classList.contains("active"),true);
  p.next();
  assert.equal(p.calls.length,1);
  assert.equal(p.el("resultScreen").classList.contains("active"),true);
  assert.equal(p.el("reportAmount").textContent,"109,000 円");
  assert.ok(p.el("reportLines").textContent.includes("住民税所得割"));
  assert.match(p.el("reportLines").textContent,/所得税（寄附控除前）278,500 円/);
  assert.ok(p.el("formulaDetails").textContent.includes("計算式"));
  assert.equal(p.el("print").disabled,false);
 } finally {p.w.close();}
});
test("2026 salary 2m wizard calculates without salary reference input",async()=>{
 const p=createPage();
 try{
  p.next();p.type("salaryGross",2000000);p.type("socialInsurance",100000);
  assert.equal(p.el("salaryIncomeReference").value,"");
  p.next();assert.equal(p.el("screen2").classList.contains("active"),true);
  p.el("ack").checked=true;p.next();p.next();
  assert.equal(p.el("reportAmount").textContent,"18,000 円");
  assert.ok(p.el("reportLines").textContent.includes("1,260,000"));
 }finally{p.w.close();}
});
test("2026 salary 2.193m special band is calculated and source mismatch stops",async()=>{
 const p=createPage();
 try{
  p.next();p.type("salaryGross",2193000);p.type("socialInsurance",100000);
  p.type("salaryIncomeReference",1451000);p.next();
  p.el("ack").checked=true;p.next();p.next();
  assert.equal(p.el("reportAmount").textContent,"計算停止");
  assert.ok(p.el("reasonBlock").textContent.includes("一致しません"));
 }finally{p.w.close();}
});
test("mortgage scenario does not expose a limit, but can print a HOLD report",async()=>{
 const p=createPage();
 try {
  p.enterSalary();p.next();
  p.w.document.querySelector('[data-key="hasMortgage"]').checked=true;
  p.el("ack").checked=true;p.next();p.next();
  assert.equal(p.el("reportAmount").textContent,"計算停止");
  assert.ok(p.el("reasonBlock").textContent.includes("住宅借入金"));
  assert.equal(p.el("print").disabled,false);
 } finally {p.w.close();}
});
test("malformed salary calculation cannot display or print a stale or invalid amount",async()=>{
 const p=createPage();
 try{
  p.enterSalary();p.confirmOthers();
  const runner=p.w.google.script.run;
  const actual=runner.runFurusatoSimulation;
  for(const patch of [{donationLimitYen:"bogus"},{calculation:null},{residentYear:2026}]){
   runner.runFurusatoSimulation=function(input){this.ok({...engine.calculate(input),...patch});};
   p.next();
   assert.equal(p.el("resultScreen").classList.contains("active"),false);
   assert.equal(p.el("print").disabled,true);
   assert.match(p.el("flash").textContent,/形式を確認できません/);
  }
  runner.runFurusatoSimulation=actual;
  p.next();
  assert.equal(p.el("reportAmount").textContent,"109,000 円");
  assert.equal(p.el("print").disabled,false);
 }finally{p.w.close();}
});
test("switching mode while a draft is reading leaves the selected mode in place",async()=>{
 const p=createPage();
 try{
  const values={year:"2025",incomeType:"salary",filing:"return",salaryGross:"7000000",
   socialInsurance:"1000000",salaryIncomeReference:"",deductionsReference:""};
  p.w.document.querySelectorAll("#exclusionChecks [data-key]").forEach(node=>{values[node.dataset.key]=false;});
  let reader;
  p.w.FileReader=class {
   constructor(){reader=this;}
   readAsText(){this.result=JSON.stringify({schema:"furusato-input-draft/v1",mode:"salary",values});}
  };
  const file=new p.w.File(["synthetic"],"draft.json",{type:"application/json"});
  Object.defineProperty(p.el("draftFile"),"files",{value:[file]});
  p.click("loadDraft");p.click("splitMode");reader.onload();
  assert.equal(p.el("splitMode").getAttribute("aria-pressed"),"true");
  assert.equal(p.el("salaryGross").value,"");
  assert.match(p.el("draftStatus").textContent,/読み込みを中止/);
 }finally{p.w.close();}
});
test("reader READY requires explicit original-paper cross-check, not implicit approval",async()=>{
 const p=createPage();
 try {
  p.next();
  await importJson(p,source("READY_FOR_EXCEL_CROSSCHECK"));
  assert.equal(p.el("sourceConfirmed").checked,false);
  assert.equal(p.el("sourceConfirmBox").style.display,"flex");
  p.next();p.el("ack").checked=true;p.next();p.next();
  assert.equal(p.el("reportAmount").textContent,"計算停止");
  assert.equal(p.calls.at(-1).sourceReviewPending,true);
  p.click("edit");p.click("back");p.click("back");
  p.el("sourceConfirmed").checked=true;
  p.next();p.next();p.next();
  assert.equal(p.calls.at(-1).sourceReviewPending,false);
  assert.equal(p.el("reportAmount").textContent,"109,000 円");
 } finally {p.w.close();}
});
test("reader REVIEW cannot be overridden by clicking a checkbox",async()=>{
 const p=createPage();
 try {
  p.next();
  await importJson(p,source("REQUIRES_REVIEW"));
  p.w.URL.createObjectURL=()=>{throw new Error("Unreviewed OCR data must not be saved as a manual draft");};
  p.click("saveDraft");
  assert.match(p.el("draftStatus").textContent,/取込中の原票があるため保存できません/);
  assert.equal(p.el("sourceConfirmBox").style.display,"none");
  p.next();p.el("ack").checked=true;p.next();p.next();
  assert.equal(p.calls.at(-1).sourceReviewPending,true);
  assert.equal(p.el("reportAmount").textContent,"計算停止");
 } finally {p.w.close();}
});
test("G74 and special-relative input forces HOLD even after READY source review",async()=>{
 const p=createPage();
 try {
  p.next();
  const orig=source("READY_FOR_EXCEL_CROSSCHECK");
  orig.fields.special_relative_count=1;
  orig.fields.special_relative_deduction_reference=630000;
  await importJson(p,orig);
  assert.equal(p.w.document.querySelector('[data-key="hasDependents"]').checked,true);
  p.el("sourceConfirmed").checked=true;p.next();
  p.el("ack").checked=true;p.next();p.next();
  assert.equal(p.el("reportAmount").textContent,"計算停止");
 } finally {p.w.close();}
});
test("G46 mismatch in a READY slip still fails closed after checkbox confirmation",async()=>{
 const p=createPage();
 try {
  p.next();
  const orig=source("READY_FOR_EXCEL_CROSSCHECK");
  orig.fields.basic_reference=630000;
  await importJson(p,orig);
  p.el("sourceConfirmed").checked=true;
  p.next();p.el("ack").checked=true;p.next();p.next();
  assert.equal(p.el("reportAmount").textContent,"計算停止");
  assert.ok(p.el("reasonBlock").textContent.includes("基礎控除額"));
 } finally {p.w.close();}
});
test("source-detected mortgage remains blocked even when checkbox is manually changed",async()=>{
 const p=createPage();
 try {
  p.next();
  const src=source("READY_FOR_EXCEL_CROSSCHECK");
  src.fields.mortgage_credit=100000;
  await importJson(p,src);
  const checkbox=p.w.document.querySelector('[data-key="hasMortgage"]');
  assert.equal(checkbox.checked,true);
  assert.equal(checkbox.disabled,true);
  // Simulate stale UI state or an unintended programmatic form reset.
  checkbox.checked=false;
  p.el("sourceConfirmed").checked=true;
  p.next();p.el("ack").checked=true;p.next();p.next();
  assert.equal(p.el("reportAmount").textContent,"計算停止");
  assert.equal(p.calls.at(-1).sourceIndicators.hasMortgage,true);
  assert.ok(p.el("reasonBlock").textContent.includes("hasMortgage"));
 } finally {p.w.close();}
});
test("reader JSON marked as identifying people is never imported",async()=>{
 const p=createPage();
 try {
  p.next();
  const src=source("READY_FOR_EXCEL_CROSSCHECK");
  src.personal_identifiers="PRESENT";
  await importJson(p,src);
  assert.ok(p.el("flash").textContent.includes("個人識別情報"));
  assert.equal(p.el("sourceConfirmBox").style.display,"none");
 } finally {p.w.close();}
});
test("unknown personal identifiers are rejected and never shown",async()=>{
 const p=createPage();
 try {
  p.next();
  const orig=source("READY_FOR_EXCEL_CROSSCHECK");
  orig.fields.full_name="secret";
  await importJson(p,orig);
  assert.ok(p.el("flash").textContent.includes("未対応"));
  assert.ok(!p.el("flash").textContent.includes("secret"));
  p.type("salaryGross",7000000);p.type("socialInsurance",1000000);
  p.next();p.el("ack").checked=true;p.next();p.next();
  assert.equal(p.el("reportAmount").textContent,"計算停止");
 } finally {p.w.close();}
});
test("source year mismatch and re-edited amounts invalidate review",async()=>{
 const p=createPage();
 try {
  p.next();await importJson(p,source("READY_FOR_EXCEL_CROSSCHECK"));
  p.el("sourceConfirmed").checked=true;p.type("year",2025);
  assert.equal(p.el("sourceConfirmed").checked,false);
  p.next();p.el("ack").checked=true;p.next();p.next();
  assert.equal(p.el("reportAmount").textContent,"計算停止");
  assert.ok(p.el("reasonBlock").textContent.includes("所得年"));
 } finally {p.w.close();}
});


test("new smartphone photo revokes previously confirmed reader data before OCR",async()=>{
 const p=createPage();
 try{
  p.next();
  await importJson(p,source("READY_FOR_EXCEL_CROSSCHECK"));
  p.el("sourceConfirmed").checked=true;
  const file=new p.w.File(["synthetic"],"new-photo.jpg",{type:"image/jpeg"});
  Object.defineProperty(p.el("ocrCamera"),"files",{configurable:true,value:[file]});
  p.el("ocrCamera").dispatchEvent(new p.w.Event("change",{bubbles:true}));
  assert.equal(p.el("sourceConfirmed").checked,false);
  assert.equal(p.el("sourceConfirmBox").style.display,"none");
  assert.match(p.el("sourceMessage").textContent,/HOLD/);
  assert.equal(p.el("ack").checked,false);
  // Do not click OCR. The document is new, so old acknowledgement is invalid.
  assert.equal(p.el("salaryGross").value,"");
  assert.equal(p.el("socialInsurance").value,"");
  assert.equal(p.el("salaryIncomeReference").value,"");
  p.next();assert.equal(p.calls.length,0);
  p.type("salaryGross",7000000);p.type("socialInsurance",1000000);
  p.next();p.el("ack").checked=true;p.next();p.next();
  assert.equal(p.calls.at(-1).sourceReviewPending,true);
  assert.equal(p.el("reportAmount").textContent,"計算停止");
 }finally{p.w.close();}
});
test("clearing while a JSON reader is pending prevents a stale ready status",async()=>{
 const p=createPage();
 try{
  p.next();
  const original=p.w.FileReader;
  class DeferredReader {
   constructor(){p.w.__deferredSource=this;}
   readAsText(){this.result=JSON.stringify(source("READY_FOR_EXCEL_CROSSCHECK"));}
  }
  p.w.FileReader=DeferredReader;
  const doc=new p.w.File(["synthetic"],"reader.json",{type:"application/json"});
  Object.defineProperty(p.el("file"),"files",{configurable:true,value:[doc]});
  p.el("file").dispatchEvent(new p.w.Event("change",{bubbles:true}));
  assert.equal(p.el("sourceConfirmBox").style.display,"none");
  p.click("clearImportedFile");
  p.w.__deferredSource.onload();
  assert.equal(p.el("sourceConfirmBox").style.display,"none");
  assert.equal(p.el("sourceMessage").textContent.includes("読取データを使用していません"),true);
  assert.equal(p.el("sourceConfirmed").checked,false);
  p.w.FileReader=original;
 }finally{p.w.close();}
});
test("new camera selection invalidates delayed JSON read and old OCR",async()=>{
 const p=createPage();
 try{
  p.next();
  const old=p.w.FileReader;
  class DeferredReader {
   constructor(){p.w.__deferredSource=this;}
   readAsText(){this.result=JSON.stringify(source("READY_FOR_EXCEL_CROSSCHECK"));}
  }
  p.w.FileReader=DeferredReader;
  const doc=new p.w.File(["synthetic"],"reader.json",{type:"application/json"});
  Object.defineProperty(p.el("file"),"files",{configurable:true,value:[doc]});
  p.el("file").dispatchEvent(new p.w.Event("change",{bubbles:true}));
  const photo=new p.w.File(["synthetic"],"camera.jpg",{type:"image/jpeg"});
  Object.defineProperty(p.el("ocrCamera"),"files",{configurable:true,value:[photo]});
  p.el("ocrCamera").dispatchEvent(new p.w.Event("change",{bubbles:true}));
  p.w.__deferredSource.onload();
  assert.equal(p.el("sourceConfirmBox").style.display,"none");
  assert.match(p.el("sourceMessage").textContent,/HOLD/);
  assert.equal(p.el("sourceConfirmed").checked,false);
  p.w.FileReader=old;
 }finally{p.w.close();}
});

test("new photo and clearing source both revoke prior Google upload consent",async()=>{
 const p=createPage();
 try{
  p.next();
  p.el("ocrConsent").checked=true;
  const doc=new p.w.File(["synthetic"],"camera.jpg",{type:"image/jpeg"});
  Object.defineProperty(p.el("ocrCamera"),"files",{configurable:true,value:[doc]});
  p.el("ocrCamera").dispatchEvent(new p.w.Event("change",{bubbles:true}));
  assert.equal(p.el("ocrConsent").checked,false);
  p.el("ocrConsent").checked=true;p.click("clearImportedFile");
  assert.equal(p.el("ocrConsent").checked,false);
 }finally{p.w.close();}
});
test("salary source confirmation becomes invalid immediately on input before blur",async()=>{
 const p=createPage();
 try{
  p.next();await importJson(p,source("READY_FOR_EXCEL_CROSSCHECK"));
  p.el("sourceConfirmed").checked=true;
  p.el("salaryGross").value="7100000";
  p.el("salaryGross").dispatchEvent(new p.w.Event("input",{bubbles:true}));
  assert.equal(p.el("sourceConfirmed").checked,false);
  p.next();p.el("ack").checked=true;p.next();p.next();
  assert.equal(p.el("reportAmount").textContent,"計算停止");
 }finally{p.w.close();}
});
test("revoked consent during deferred photo load blocks upload",async()=>{
 const p=createPage();
 try{
  p.next();
  let calls=0;p.w.google.script.run.extractWithholdingOcr=function(){calls++;};
  class DeferredReader{
   constructor(){p.w.reader=this;}
   readAsDataURL(){this.result="data:image/jpeg;base64,/9j/2Q==";}
  }
  p.w.FileReader=DeferredReader;
  const doc=new p.w.File(["synthetic"],"camera.jpg",{type:"image/jpeg"});
  Object.defineProperty(p.el("ocrCamera"),"files",{configurable:true,value:[doc]});
  p.el("ocrCamera").dispatchEvent(new p.w.Event("change",{bubbles:true}));
  p.el("ocrConsent").checked=true;p.click("ocrRun");
  assert.equal(p.el("ocrRun").disabled,true);
  p.el("ocrConsent").checked=false;
  p.el("ocrConsent").dispatchEvent(new p.w.Event("change",{bubbles:true}));
  assert.equal(p.el("ocrRun").disabled,false);
  p.w.reader.onload();
  await Promise.resolve();await Promise.resolve();
  assert.equal(calls,0);
  assert.match(p.el("ocrResult").textContent,/HOLD/);
 }finally{p.w.close();}
});

(async()=>{
 let failed=0;
 for(const item of tests){
  try {await item.fn();console.log("PASS "+item.name);}
  catch(e){failed++;console.error("FAIL "+item.name+"\n"+e.stack);}
 }
 console.log("BROWSER RESULT "+(tests.length-failed)+"/"+tests.length);
 if(failed)process.exitCode=1;
})();
