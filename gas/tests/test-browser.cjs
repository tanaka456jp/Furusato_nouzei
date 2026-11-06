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
  assert.ok(p.el("formulaDetails").textContent.includes("計算式"));
  assert.equal(p.el("print").disabled,false);
 } finally {p.w.close();}
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

(async()=>{
 let failed=0;
 for(const item of tests){
  try {await item.fn();console.log("PASS "+item.name);}
  catch(e){failed++;console.error("FAIL "+item.name+"\n"+e.stack);}
 }
 console.log("BROWSER RESULT "+(tests.length-failed)+"/"+tests.length);
 if(failed)process.exitCode=1;
})();
