"use strict";
/** Local-only browser DOM acceptance with FICTIONAL taxpayers, never user data. */
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const {JSDOM}=require("../../gas/node_modules/jsdom");
const root=path.resolve(__dirname,"../dist");
const win=new JSDOM(fs.readFileSync(path.join(root,"index.html"),"utf8"),{
 url:"https://offline.invalid/",runScripts:"outside-only"
}).window;
const script=name=>fs.readFileSync(path.join(root,name),"utf8");
win.fetch=()=>{throw Error("NO_EXTERNAL_NETWORK_ALLOWED");};
win.eval(script("engine.js"));
win.eval(script("app.js"));
win.eval(script("batch-core.js"));
const candidatesA={salaryGross:5000000,salaryIncomeReference:3560000,
 deductionsReference:1430000,socialInsurance:750000};
const candidatesB={salaryGross:7000000,salaryIncomeReference:5200000,
 deductionsReference:1670000,socialInsurance:1000000};
const reviews=[
 {year:2025,eligibleForManualTransfer:true,
  candidates:candidatesA,recipientName:"架空一郎"},
 {year:2026,eligibleForManualTransfer:true,
  candidates:candidatesB,recipientName:"架空二郎"}
];
win.FurusatoBatchPdf={
 maxBytes:8*1024*1024,
 beginBatch:()=>true,endBatch:()=>{},
 open:async()=>({session:{},document:{numPages:2}}),
 readPage:async(_doc,_session,page)=>reviews[page-1],
 close:async()=>{},cancel:()=>{}
};
win.eval(script("batch.js"));
const d=win.document;
const choose=(idx,key)=>d.querySelector(
 '#batchRows [data-row="'+idx+'"][data-field="'+key+'"]');
const ev=(type,element)=>element.dispatchEvent(
 new win.Event(type,{bubbles:true,cancelable:true}));
function change(idx,key,value){
 const field=choose(idx,key);
 if(field.type==="checkbox")field.checked=!!value;
 else field.value=String(value);
 ev("change",field);
}
function type(idx,key,value){
 const field=choose(idx,key);field.value=String(value);
 ev("input",field);
}
(async()=>{
 const year=d.querySelector('#calculator select[name="year"]');
 year.value="2026";
 const pdf=d.getElementById("batchPdf");
 Object.defineProperty(pdf,"files",{configurable:true,value:[{
  type:"application/pdf",size:1024
 }]});
 d.getElementById("batchScan").click();
 // Two async pages and final UI render must complete.
 for(let n=0;n<12&&d.querySelectorAll("#batchRows tr").length<2;n++)
  await new Promise(resolve=>setImmediate(resolve));
 assert.equal(d.querySelectorAll("#batchRows tr").length,2);
 assert.equal(choose(0,"label").value,"架空一郎");
 assert.equal(choose(1,"label").value,"架空二郎");
 assert.equal(choose(0,"sourceYear").value,"2025");
 assert.equal(choose(0,"year").value,"2026");
 assert.equal(choose(0,"deductionsReference").value,"1430000");
 change(0,"deductionsReference","1790000");
 change(0,"confirmed",true);
 change(0,"noExclusions",true);
 d.getElementById("batchCalculate").click();
 assert.match(d.querySelector("#batchRows tr").textContent,/HOLD/);
 assert.doesNotMatch(d.querySelector("#batchRows tr").textContent,/57,000円/);
 change(0,"forecastReviewed",true);
 d.getElementById("batchCalculate").click();
 assert.match(d.querySelector("#batchRows tr").textContent,/57,000円/);
 assert.match(d.querySelector("#batchRows tr").textContent,/前年参考概算/);
 assert.doesNotMatch(d.querySelector("#batchRows tr:nth-child(2)").textContent,/109,000円/);
 change(1,"confirmed",true);
 change(1,"noExclusions",true);
 d.getElementById("batchCalculate").click();
 assert.match(d.querySelector("#batchRows tr:nth-child(2)").textContent,/109,000円/);
 type(0,"label","架空改姓");
 assert.doesNotMatch(d.querySelector("#batchRows tr:nth-child(1)").textContent,/57,000円/,
  "A name edit must erase stale amount without losing keyboard focus");
 assert.match(d.querySelector("#batchRows tr:nth-child(1)").textContent,/HOLD/);
 assert.match(d.querySelector("#batchRows tr:nth-child(2)").textContent,/109,000円/,
  "Unrelated taxpayer retains their last estimate");
 assert.equal(d.getElementById("batchDownload").disabled,true);
 change(0,"label","架空改姓");
 assert.equal(choose(0,"confirmed").checked,false);
 assert.equal(choose(0,"forecastReviewed").checked,false);
 assert.equal(d.getElementById("batchDownload").disabled,true);
 win.close();
 console.log("PUBLIC_WEB_EDITABLE_BATCH_DOM_FICTIONAL_NAME_2026_PASS");
})().catch(e=>{console.error(e);process.exitCode=1;win.close();});
