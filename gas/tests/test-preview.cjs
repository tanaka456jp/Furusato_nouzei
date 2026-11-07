"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {JSDOM}=require("jsdom");
const root=path.resolve(__dirname,"..");
const dest=path.join(root,"dist","Furusato_GAS_LocalPreview.html");
assert.ok(fs.existsSync(dest),"Build offline preview before testing");
const html=fs.readFileSync(dest,"utf8");
assert.ok(html.includes("ローカル検証プレビュー"));
assert.ok(!html.includes('src="http'));
assert.ok(!html.includes("googleapis.com"));
assert.ok(!html.includes("fetch("));
const dom=new JSDOM(html,{runScripts:"dangerously",url:"file:///tmp/Furusato_GAS_LocalPreview.html",
  pretendToBeVisual:true,beforeParse(win){win.scrollTo=()=>{};}});
const w=dom.window,el=id=>w.document.getElementById(id),next=()=>el("next").click();
(async()=>{
 try{
  assert.ok(w.google&&w.google.script&&w.FurusatoEngine);
  next();
  el("salaryGross").value="7000000";
  el("socialInsurance").value="1000000";
  next();
  el("ack").checked=true;
  next();
  next();
  await new Promise(resolve=>w.setTimeout(resolve,50));
  assert.equal(el("reportAmount").textContent,"109,000 円");
  assert.equal(el("print").disabled,false);
  assert.ok(el("footer").textContent.includes("gas-mvp-0.1.9"));
  console.log("PASS: local HTML preview computes standard 109,000 JPY without Google APIs");
 } catch(e){console.error(e.stack);process.exitCode=1;}
 finally{dom.window.close();}
})();
