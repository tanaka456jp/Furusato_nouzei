"use strict";
// Synthetic-only browser screenshots; never capture the Windows desktop.
// Use the same built assets and fictional PDFs as the offline QA package.
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const os=require("node:os");
const {chromium}=require("../../gas/node_modules/playwright");
const {createReviewServer}=require("../scripts/serve-review.cjs");
async function main(){
 const out=process.env.FURUSATO_SCREENSHOT_DIR;
 assert.ok(out,"Explicit screenshot output directory required");
 assert.equal(process.platform,"win32","Windows Edge required");
 fs.mkdirSync(out,{recursive:true});
 const review=createReviewServer({root:path.resolve(__dirname,"../dist"),port:0});
 await review.listen();
 const origin="http://127.0.0.1:"+review.server.address().port;
 let browser;
 const checks=[],external=[];
 try{
  browser=await chromium.launch({channel:"msedge",headless:true});
  const context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});
  await context.route("**/*",route=>{
   const url=route.request().url();
   if(url.startsWith(origin+"/")||url.startsWith("blob:")||url.startsWith("data:"))return route.continue();
   external.push("blocked");return route.abort();
  });
  const page=await context.newPage();
  const field=n=>page.locator('#calculator [name="'+n+'"]');
  const save=async(name,locator)=>{
   if(locator)await locator.screenshot({path:path.join(out,name+".png"),animations:"disabled"});
   else await page.screenshot({path:path.join(out,name+".png"),fullPage:true,animations:"disabled"});
   checks.push(name);
  };
  await page.goto(origin+"/index.html",{waitUntil:"load"});
  for(const width of [1280,768,390,360]){
   await page.setViewportSize({width,height:900});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),"Horizontal page overflow at "+width);
   for(const id of ["#slipFile","#slipScan","#calculator button[type=submit]","#batchPdf","#batchScan"]){
    const el=page.locator(id);assert.ok(await el.isVisible(),id+" not visible at "+width);
    const box=await el.boundingBox();
    assert.ok(box&&box.x>=-1&&box.x+box.width<=width+1,id+" clipped at "+width);
   }
   await save("layout-"+width);
  }
  await page.setViewportSize({width:1280,height:900});
  await field("year").selectOption("2026");
  await field("municipality").selectOption("standard");
  const fixtures=path.resolve(__dirname,"../qa-fixtures");
  await page.locator("#slipFile").setInputFiles(path.join(fixtures,"06-positive-electronic.pdf"));
  await page.locator("#slipScan").click();
  await page.waitForFunction(()=>!document.getElementById("slipScan").disabled,null,{timeout:60000});
  assert.equal(await page.locator("#slipTransfer").isEnabled(),true);
  assert.equal(await field("salaryGross").inputValue(),"");
  await save("positive-ocr-review",page.locator(".ocr-panel"));
  await page.locator("#slipTransfer").click();
  assert.equal(await field("salaryGross").inputValue(),"");
  await page.locator("#slipConfirm").check();
  await page.locator("#slipTransfer").click();
  assert.equal(await field("salaryGross").inputValue(),"7000000");
  await field("municipality").selectOption("standard");
  await field("acknowledgedExclusions").check();
  await page.locator('#calculator button[type="submit"]').click();
  assert.equal(await page.locator("#result .amount").textContent(),"109,000円");
  await save("confirmed-result",page.locator("#result"));
  await field("salaryGross").fill("7100000");
  assert.equal(await page.locator("#result").isVisible(),false);
  await page.locator('#calculator button[type="reset"]').click();
  await page.locator("#slipFile").setInputFiles(path.join(fixtures,"01-electronic-not-slip.pdf"));
  await page.locator("#slipScan").click();
  await page.waitForFunction(()=>!document.getElementById("slipScan").disabled,null,{timeout:60000});
  assert.equal(await page.locator("#slipTransfer").isEnabled(),false);
  assert.equal(await page.locator("#result").isVisible(),false);
  await save("invalid-source-hold",page.locator(".ocr-panel"));
  await page.locator("#batchPdf").setInputFiles(path.join(fixtures,"07-positive-mixed-batch.pdf"));
  await page.locator("#batchScan").click();
  await page.waitForFunction(()=>!document.getElementById("batchScan").disabled&&document.querySelectorAll("#batchRows tr").length===2,null,{timeout:60000});
  await page.locator("#batchCalculate").click();
  assert.deepEqual(await page.locator("#batchRows .batch-result").allTextContents(),["—","—"]);
  await page.locator('#batchRows select[data-field="municipality"]').first().selectOption("standard");
  await page.locator('#batchRows input[data-field="confirmed"]').first().check();
  await page.locator('#batchRows input[data-field="noExclusions"]').first().check();
  await page.locator("#batchCalculate").click();
  assert.deepEqual(await page.locator("#batchRows .batch-result").allTextContents(),["109,000円","—"]);
  await save("mixed-batch",page.locator("#batchRows"));
  const pending=page.waitForEvent("download");
  await page.locator("#batchDownload").click();
  const download=await pending;
  const lines=fs.readFileSync(await download.path(),"utf8").trim().split(/\r?\n/).map(line=>line.split('","').map(value=>value.replace(/^"|"$/g,"")));
  assert.equal(lines.length,3);assert.equal(lines[1][11],"109000");
  assert.equal(lines[2][11],"");assert.equal(lines[2][12],"HOLD");
  await download.delete();
  await page.locator("#batchClear").click();
  await page.goto(origin+"/terms.html");
  await save("terms");
  await page.goto(origin+"/privacy.html");
  await save("privacy");
  assert.deepEqual(external,[]);
  fs.writeFileSync(path.join(out,"result.json"),JSON.stringify({
   status:"PASS",scope:"synthetic headless Edge, not interactive desktop or mobile device",
   sha:process.env.GITHUB_SHA||null,os:os.release(),browser:browser.version(),checks,externalRequests:external.length
  },null,2));
  console.log("WINDOWS_EDGE_SYNTHETIC_SCREENSHOT_ACCEPTANCE_PASS");
  await context.close();
 }finally{
  if(browser)await browser.close();
  await new Promise(resolve=>review.server.close(resolve));
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
