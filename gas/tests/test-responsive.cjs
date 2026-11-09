"use strict";
// Offline browser emulation for shared HTML UI; not physical iOS/Android QA.
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {pathToFileURL}=require("node:url"),{chromium}=require("playwright");
const root=path.resolve(__dirname,".."),dir=path.join(root,"dist/acceptance/responsive");
const preview=path.join(root,"dist/Furusato_GAS_LocalPreview.html");
assert.ok(fs.existsSync(preview),"Build local preview first");
const profiles=[
 ["phone-320",320,568,2,true],["phone-375",375,667,2,true],
 ["phone-390",390,844,3,true],["phone-430",430,932,3,true],
 ["tablet-768",768,1024,2,true],["desktop-1280",1280,800,1,false],
 ["desktop-1920-100",1920,1080,1,false],
 ["desktop-1920-125-equivalent",1536,864,1.25,false],
 ["desktop-1920-150-equivalent",1280,720,1.5,false],
 ["desktop-1366-100",1366,768,1,false],
 ["desktop-1366-125-equivalent",1092,614,1.25,false],
 ["desktop-1366-150-equivalent",910,512,1.5,false]
];
async function measure(page,name,width,mobile){
 const m=await page.evaluate(()=>{
  const root=document.documentElement;
  return {vw:window.innerWidth,client:root.clientWidth,scroll:root.scrollWidth,
    font:parseFloat(getComputedStyle(document.querySelector("#salaryGross")).fontSize),
    button:document.querySelector("#next").getBoundingClientRect().height,
    mode:document.querySelector("#salaryMode").getBoundingClientRect().height,
    columns:getComputedStyle(document.querySelector("#screen1 .field-grid")).gridTemplateColumns};
 });
 assert.equal(m.vw,width,name+" mobile viewport meta");
 assert.ok(m.scroll<=m.client+1,name+" horizontal overflow: "+JSON.stringify(m));
 if(mobile){
  assert.ok(m.font>=16,name+" iOS text field font");
  assert.ok(m.mode>=44,name+" mode-switch touch target");
  if(m.button>0)assert.ok(m.button>=44,name+" visible next-button touch target");
 }
 return m;
}
(async()=>{
 fs.mkdirSync(dir,{recursive:true});
 const browser=await chromium.launch({headless:true,...(process.env.FURUSATO_BROWSER_CHANNEL?{channel:process.env.FURUSATO_BROWSER_CHANNEL}:{})});
 const results=[];
 try{
  for(const [name,width,height,dpr,mobile] of profiles){
   const capture=name==="phone-390"||name.startsWith("desktop-1920")||name.startsWith("desktop-1366");
   const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:dpr,isMobile:mobile,hasTouch:mobile});
   const page=await context.newPage();const errors=[];page.on("pageerror",e=>errors.push(e.message));
   try{
    await page.goto(pathToFileURL(preview).href);
    await measure(page,name+" home",width,mobile);
    if(capture)
      await page.screenshot({path:path.join(dir,name+"-home.png"),fullPage:true});
    await page.locator("#next").click();
    const layout=await measure(page,name+" inputs",width,mobile);
    const columns=layout.columns.trim().split(/\s+/).length;
    assert.equal(columns,width<=680?1:width>=1100?3:2,name+" input columns");
    if(capture)
      await page.screenshot({path:path.join(dir,name+"-inputs.png"),fullPage:true});
    await page.locator("#salaryGross").fill("7000000");
    await page.locator("#socialInsurance").fill("1000000");
    await page.locator("#next").click();
    await page.locator("#ack").check();
    await measure(page,name+" controls",width,mobile);
    await page.locator("#next").click();await page.locator("#next").click();
    await page.locator("#reportAmount").filter({hasText:"109,000 円"}).waitFor({timeout:15000});
    await measure(page,name+" salary result",width,mobile);
    if(capture)
      await page.screenshot({path:path.join(dir,name+"-salary-result.png"),fullPage:true});
    await page.locator("#splitMode").click();
    for(const [key,value] of Object.entries({listedStock:"5000000",nationalDeductions:"1000000",
      residentDeductions:"1000000",personalDifference:"50000",donation:"30000"}))
      await page.locator("#split-"+key).fill(value);
    await page.locator("#splitReviewed").check();await page.locator("#splitRun").click();
    await page.locator("#splitOutput").getByText(/最大寄附額 55,771/).waitFor({timeout:15000});
    await measure(page,name+" split result",width,mobile);
    if(capture)
      await page.screenshot({path:path.join(dir,name+"-split.png"),fullPage:true});
    assert.deepEqual(errors,[],name+" page errors");
    results.push({profile:name,viewport:{width,height,dpr,mobile},status:"PASS",salaryEstimate:109000,splitMaximum:55771});
   }finally{await context.close();}
  }
 }finally{await browser.close();}
 fs.writeFileSync(path.join(dir,"evidence.json"),JSON.stringify({schema:"furusato-responsive/v1",
  environment:"SYNTHETIC_CHROMIUM_EMULATION",googleDeployment:"NOT_DEPLOYED",
  scaleMethod:"Effective CSS viewport and deviceScaleFactor; Windows scaling and browser zoom were not changed",
  physicalMobile:"NOT_TESTED",release:"HOLD",profiles:results},null,2)+"\n");
 console.log("GAS_RESPONSIVE_PASS "+results.length+" layouts, calculations & horizontal overflow; release HOLD");
})().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
