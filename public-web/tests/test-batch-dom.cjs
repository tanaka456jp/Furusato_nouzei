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
win.eval(script("resident-levy.js"));
win.eval(script("family-deductions.js"));
win.eval(script("insurance-deductions.js"));
win.eval(script("family-tax.js"));
win.eval(script("family-source.js"));
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
 assert.equal(choose(0,"municipality").value,"");
 change(0,"municipality","standard");
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
 change(1,"municipality","designated");
 change(1,"confirmed",true);
 change(1,"noExclusions",true);
 d.getElementById("batchCalculate").click();
 assert.match(d.querySelector("#batchRows tr:nth-child(2)").textContent,/109,000円/);
 const second=d.querySelector("#batchRows tr:nth-child(2)");
 assert.equal(second.children[7].className,"batch-deduction-applied");
 assert.equal(second.children[7].textContent,"1,670,000円");
 assert.equal(second.children[8].querySelector("input").dataset.field,"socialInsurance");
 assert.equal(second.children[8].querySelector("input").value,"1000000");
 assert.equal(second.querySelector(".batch-resident-levy").textContent,"374,500円");
 assert.equal(second.children.length,d.querySelectorAll("#batchTable th").length);
 assert.equal(second.querySelector(".batch-trial-status").textContent,"確定申告参考");
 type(1,"trialInput","120000");
 assert.equal(choose(1,"confirmed").checked,true);
 assert.equal(d.querySelector("#batchRows tr:nth-child(2) .batch-result").textContent,"—");
 assert.equal(d.getElementById("batchDownload").disabled,true);
 d.getElementById("batchCalculate").click();
 const current=()=>d.querySelector("#batchRows tr:nth-child(2)");
 assert.deepEqual([...current().querySelectorAll(".batch-comparison")].map(x=>x.textContent),
 ["109,000円","109,000円","120,000円","9,104円","7,104円"]);
 choose(1,"trialInput").value="3000";
 win.dispatchEvent(new win.Event("beforeprint"));
 assert.equal(current().querySelector(".batch-trial-status").textContent,"HOLD");
 assert.ok([...current().querySelectorAll(".batch-comparison")].every(x=>x.textContent==="—"));
 d.getElementById("batchCalculate").click();
 assert.equal(current().querySelector(".batch-trial-status").textContent,"確定申告参考");
 assert.match(current().textContent,/1,896円/);
 assert.equal(current().querySelectorAll(".batch-print-value").length,4);
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
 change(1,"municipality","standard");
 assert.equal(choose(1,"confirmed").checked,false);
 assert.equal(d.querySelector("#batchRows tr:nth-child(2) .batch-result").textContent,"—");
 assert.equal(d.querySelector("#batchRows tr:nth-child(2) .batch-resident-levy").textContent,"—");
 // A newly read family slip is independent of the previous two rows.
 reviews[0]={year:2025,eligibleForManualTransfer:true,sourceIndicators:{hasDependents:true},
  candidates:{salaryGross:6500000,salaryIncomeReference:4760000,socialInsurance:1340000,deductionsReference:3030000}};
 d.getElementById("batchScan").click();
 for(let n=0;n<12&&d.querySelectorAll("#batchRows tr").length<2;n++)
  await new Promise(resolve=>setImmediate(resolve));
 change(0,"municipality","standard");
 change(0,"familySourceText","S,40,600000\nR,20,600000,0");
 change(0,"familyTargetText","S,41,600000\nR,21,600000,0");
 change(0,"confirmed",true);change(0,"noExclusions",true);change(0,"forecastReviewed",true);
 d.getElementById("batchCalculate").click();
 assert.equal(d.querySelector("#batchRows tr .batch-result").textContent,"—");
 change(0,"familyReviewed",true);
 d.getElementById("batchCalculate").click();
 assert.equal(d.querySelector("#batchRows tr .batch-result").textContent,"53,000円");
 assert.deepEqual([...d.querySelectorAll("#batchRows tr:first-child .batch-family-result")].map(x=>x.textContent),
  ["3,030,000円","1,010,000円","780,000円"]);
 assert.equal(d.querySelector("#batchRows tr:nth-child(2) .batch-result").textContent,"—");
 choose(0,"familySourceText").value="なし";
 win.dispatchEvent(new win.Event("beforeprint"));
 assert.equal(d.querySelector("#batchRows tr .batch-result").textContent,"—");
 assert.ok([...d.querySelectorAll("#batchRows tr:first-child .batch-family-result")].every(x=>x.textContent==="—"));
 assert.equal(d.getElementById("batchDownload").disabled,true);
 reviews[0]={year:2025,eligibleForManualTransfer:true,sourceIndicators:{hasDependents:true,hasLifeInsurance:true,hasEarthquakeInsurance:true},
  candidates:{salaryGross:6500000,salaryIncomeReference:4760000,socialInsurance:1340000,deductionsReference:3120000}};
 d.getElementById("batchScan").click();
 for(let n=0;n<12&&d.querySelectorAll("#batchRows tr").length<2;n++)
  await new Promise(resolve=>setImmediate(resolve));
 change(0,"municipality","standard");
 change(0,"familySourceText","S,40,600000\nR,20,600000,0");
 change(0,"familyTargetText","S,41,600000\nR,21,600000,0");
 for(const prefix of ["source","target"]){
  change(0,prefix+"Insurance_generalNew","120000");change(0,prefix+"Insurance_earthquake","50000");
 }
 change(0,"confirmed",true);change(0,"noExclusions",true);change(0,"forecastReviewed",true);change(0,"familyReviewed",true);
 d.getElementById("batchCalculate").click();
 assert.equal(d.querySelector("#batchRows tr .batch-result").textContent,"—");
 change(0,"insuranceReviewed",true);
 change(1,"municipality","standard");change(1,"confirmed",true);change(1,"noExclusions",true);
 d.getElementById("batchCalculate").click();
 assert.equal(d.querySelector("#batchRows tr .batch-result").textContent,"51,000円");
 assert.equal(current().querySelector(".batch-result").textContent,"109,000円");
 assert.deepEqual([...d.querySelectorAll("#batchRows tr:first-child .batch-insurance-result")].map(x=>x.textContent),
  ["90,000円","60,000円","28,000円","50,000円","25,000円","適用"]);
 assert.equal(d.querySelector("#batchRows tr").children.length,d.querySelectorAll("#batchTable th").length);
 choose(0,"sourceInsurance_generalNew").value="0";
 win.dispatchEvent(new win.Event("beforeprint"));
 assert.equal(d.querySelector("#batchRows tr .batch-result").textContent,"—");
 assert.ok([...d.querySelectorAll("#batchRows tr:first-child .batch-insurance-result")].every(x=>x.textContent==="—"));
 assert.equal(current().querySelector(".batch-result").textContent,"109,000円");
 assert.equal(choose(0,"insuranceReviewed").checked,false);
 assert.equal(d.getElementById("batchDownload").disabled,true);
 win.close();
 console.log("PUBLIC_WEB_EDITABLE_BATCH_DOM_FICTIONAL_NAME_2026_PASS");
})().catch(e=>{console.error(e);process.exitCode=1;win.close();});
