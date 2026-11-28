"use strict";
// Synthetic-only browser screenshots; never capture the Windows desktop.
// Use the same built assets and fictional PDFs as the offline QA package.
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const os=require("node:os");
const {chromium}=require("../../gas/node_modules/playwright");
const {createReviewServer}=require("../scripts/serve-review.cjs");
const {summarizeAmountCrop}=require("./synthetic-amount-crop-metrics.cjs");
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
  assert.equal(await page.locator("#result .result-tax-year").textContent(),"試算対象：2026年分 ／ 住民税：2027年度");
  assert.equal(await page.locator("#result .result-source-year").textContent(),"参照源泉票：2026年分（同年）");
  await save("confirmed-result",page.locator("#result"));
  await field("salaryGross").fill("7100000");
  assert.equal(await page.locator("#result").isVisible(),false);
  await page.locator('#calculator button[type="reset"]').click();
  await page.locator("#slipFile").setInputFiles(path.join(fixtures,"01-electronic-not-slip.pdf"));
  await page.locator("#slipScan").click();
  await page.waitForFunction(()=>!document.getElementById("slipScan").disabled,null,{timeout:60000});
  assert.equal(await page.locator("#slipTransfer").isEnabled(),false);
  assert.equal(await page.locator("#result").isVisible(),false);
  const holdText=await page.locator("#slipReview").textContent();
  assert.match(holdText,/停止理由：/);
  assert.match(holdText,/所得年の読み取り結果が一致しません/);
  assert.doesNotMatch(holdText,/YEAR_DISAGREEMENT|FIELD_DISAGREEMENT_|INCOMPLETE_OCR/);
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
  for(const width of [390,360]){
    await page.setViewportSize({width,height:900});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),"Populated batch page overflow at "+width);
    const row=page.locator("#batchRows tr").first();
    assert.ok(await row.isVisible());
    assert.ok((await row.boundingBox()).width<=width);
    await save("mixed-batch-"+width,page.locator("#batchRows"));
  }
  await page.setViewportSize({width:1280,height:900});
  const pending=page.waitForEvent("download");
  await page.locator("#batchDownload").click();
  const download=await pending;
  const lines=fs.readFileSync(await download.path(),"utf8").trim().split(/\r?\n/).map(line=>line.split('","').map(value=>value.replace(/^"|"$/g,"")));
  assert.equal(lines.length,3);assert.equal(lines[1][11],"109000");
  assert.equal(lines[2][11],"");assert.equal(lines[2][12],"HOLD");
  await download.delete();
  await page.locator("#batchClear").click();
  const repeatReads=[];
  // Use the unmodified, real browser OCR path (no worker mocks).
  // A negative synthetic image is a safety/availability test, not accuracy.
  for(let i=0;i<10;i++){
    await page.locator('#calculator button[type="reset"]').click();
    await page.locator("#slipFile").setInputFiles(path.join(fixtures,"03-photo-not-slip.png"));
    const started=Date.now();
    await page.locator("#slipScan").click();
    await page.waitForFunction(()=>!document.getElementById("slipScan").disabled&&!document.getElementById("slipReview").hidden,null,{timeout:90000});
    assert.equal(await page.locator("#slipTransfer").isEnabled(),false,"negative image must not transfer, cycle "+i);
    assert.equal(await page.locator("#slipConfirm").isEnabled(),false);
    assert.equal(await page.locator("#result").isVisible(),false);
    assert.equal(await field("salaryGross").inputValue(),"");
    repeatReads.push({cycle:i+1,elapsedMs:Date.now()-started,status:"HOLD"});
    console.log("SYNTHETIC_REPEAT_READ "+(i+1)+"/10 HOLD");
  }
  await save("repeat-negative-image-hold",page.locator(".ocr-panel"));
  // After ten negative reads, a fresh valid PDF must remain usable.
  await page.locator('#calculator button[type="reset"]').click();
  await field("year").selectOption("2026");
  await page.locator("#slipFile").setInputFiles(path.join(fixtures,"06-positive-electronic.pdf"));
  await page.locator("#slipScan").click();
  await page.waitForFunction(()=>!document.getElementById("slipScan").disabled,null,{timeout:60000});
  assert.equal(await page.locator("#slipTransfer").isEnabled(),true);
  assert.equal(await page.locator("#slipConfirm").isChecked(),false);
  assert.equal(await field("salaryGross").inputValue(),"");
  await page.locator("#slipConfirm").check();
  await page.locator("#slipTransfer").click();
  await field("municipality").selectOption("standard");
  await field("acknowledgedExclusions").check();
  await page.locator('#calculator button[type="submit"]').click();
  assert.equal(await page.locator("#result .amount").textContent(),"109,000円");
  await save("recovery-after-repeat",page.locator("#result"));
  await page.locator('#calculator button[type="reset"]').click();
  const batch20=path.join(fixtures,"04-batch-20-pages.pdf");
  const cancelled=[];
  // Cancel only after real page processing has begun. No mocks, no uploads.
  for(let i=0;i<3;i++){
    await page.locator("#batchPdf").setInputFiles(batch20);
    await page.locator("#batchScan").click();
    await page.waitForFunction(()=>document.getElementById("batchScan").disabled&&document.querySelectorAll("#batchRows tr").length>=1,null,{timeout:90000});
    const start=Date.now();
    await page.locator("#batchClear").click();
    assert.equal(await page.locator("#batchRows tr").count(),0);
    await page.waitForFunction(()=>!document.getElementById("batchScan").disabled,null,{timeout:90000});
    assert.equal(await page.locator("#batchRows tr").count(),0);
    assert.equal(await page.locator("#batchCalculate").isEnabled(),false);
    assert.equal(await page.locator("#batchDownload").isEnabled(),false);
    assert.equal(await page.locator("#batchPrint").isEnabled(),false);
    cancelled.push({cycle:i+1,elapsedMs:Date.now()-start});
  }
  await save("batch-cancelled",page.locator("#batchStatus"));
  await page.locator("#batchPdf").setInputFiles(batch20);
  const batchStarted=Date.now();
  await page.locator("#batchScan").click();
  await page.waitForFunction(()=>!document.getElementById("batchScan").disabled&&document.querySelectorAll("#batchRows tr").length===20,null,{timeout:600000});
  const batchElapsedMs=Date.now()-batchStarted;
  await page.locator("#batchCalculate").click();
  assert.deepEqual(await page.locator("#batchRows .batch-result").allTextContents(),Array(20).fill("—"));
  assert.deepEqual(await page.locator("#batchRows tr td:first-child").allTextContents(),Array.from({length:20},(_,i)=>String(i+1)));
  assert.match(await page.locator("#batchStatus").textContent(),/HOLD 20件/);
  await save("batch20-all-hold",page.locator("#batchStatus"));
  const batchCsvPending=page.waitForEvent("download");
  await page.locator("#batchDownload").click();
  const batchCsv=await batchCsvPending;
  const batchLines=fs.readFileSync(await batchCsv.path(),"utf8").trim().split(/\r?\n/).map(line=>line.split('","').map(value=>value.replace(/^"|"$/g,"")));
  assert.equal(batchLines.length,21);
  for(const line of batchLines.slice(1)){assert.equal(line[11],"");assert.equal(line[12],"HOLD");}
  await batchCsv.delete();
  await page.locator("#batchClear").click();
  // Prove the batch lock is released after cancellation and complete read.
  await page.locator("#batchPdf").setInputFiles(path.join(fixtures,"07-positive-mixed-batch.pdf"));
  await page.locator("#batchScan").click();
  await page.waitForFunction(()=>!document.getElementById("batchScan").disabled&&document.querySelectorAll("#batchRows tr").length===2,null,{timeout:90000});
  await page.locator('#batchRows select[data-field="municipality"]').first().selectOption("standard");
  await page.locator('#batchRows input[data-field="confirmed"]').first().check();
  await page.locator('#batchRows input[data-field="noExclusions"]').first().check();
  await page.locator("#batchCalculate").click();
  assert.deepEqual(await page.locator("#batchRows .batch-result").allTextContents(),["109,000円","—"]);
  await save("batch-recovery",page.locator("#batchStatus"));
  await page.locator("#batchClear").click();
  console.log("SYNTHETIC_BATCH_20_AND_CANCEL_PASS");
  // Actual Japanese image recognition, separate from safety-only negatives.
  // HOLD is a measured failure to extract, not a successful recognition.
  // A wrong transferable candidate always fails the job.
  const positiveImageResults=[];
  // Instrument ONLY this isolated synthetic-fixture browser. Delegate to
  // the real worker without modifying results or recognition parameters.
  // No diagnostic hook in production code; never use this on user slips.
  await page.evaluate(()=>{
    window.__syntheticOcrTrace=[];
    const create=Tesseract.createWorker;
    Tesseract.createWorker=async function(...args){
      const worker=await create.apply(this,args);
      const recognize=worker.recognize.bind(worker);
      const set=worker.setParameters?.bind(worker);
      if(set)worker.setParameters=async function(parameters,...rest){
        window.__syntheticOcrTrace.push({kind:"parameters",parameters:{...parameters}});
        return set(parameters,...rest);
      };
      worker.recognize=async function(image,...rest){
        const pending=recognize(image,...rest);
        // Test-only gate around a REAL English recognition. Do not alter
        // OCR results or the production worker; let cancellation occur
        // while a recognition promise is outstanding.
        if(args[0]==="eng"&&window.__pauseSyntheticEnglish){
          window.__pauseSyntheticEnglish=false;
          window.__syntheticEnglishStarted=true;
          pending.catch(()=>{});
          await new Promise(resolve=>{window.__releaseSyntheticEnglish=resolve;});
        }
        const result=await pending;
        const data=result?.data;
        const lines=[];
        for(const block of data?.blocks||[])
          for(const para of block.paragraphs||[])
            for(const line of para.lines||[])
              if(lines.length<100)lines.push({text:String(line.text||"").slice(0,240),bbox:line.bbox});
        window.__syntheticOcrTrace.push({kind:"recognize",width:image?.width||null,height:image?.height||null,
          text:String(data?.text||"").slice(0,3000),confidence:data?.confidence??null,lines});
        return result;
      };
      return worker;
    };
  });
  const expected={salaryGross:"7000000",salaryIncomeReference:"5200000",deductionsReference:"1670000",socialInsurance:"1000000"};
  for(const name of ["08-positive-image.png","09-positive-lines.png"]){
    await page.locator('#calculator button[type="reset"]').click();
    await field("year").selectOption("2026");
    await page.locator("#slipFile").setInputFiles(path.join(fixtures,name));
    await page.evaluate(()=>{window.__syntheticOcrTrace=[];});
    const started=Date.now();
    await page.locator("#slipScan").click();
    await page.waitForFunction(()=>!document.getElementById("slipScan").disabled&&!document.getElementById("slipReview").hidden,null,{timeout:90000});
    const elapsedMs=Date.now()-started;
    const eligible=await page.locator("#slipTransfer").isEnabled();
    const report=await page.locator("#slipReview").textContent();
    assert.equal(await page.locator("#slipConfirm").isChecked(),false);
    assert.equal(await page.locator("#result").isVisible(),false);
    for(const key of Object.keys(expected))assert.equal(await field(key).inputValue(),"");
    await save(name.slice(0,2)+"-image-review",page.locator(".ocr-panel"));
    if(eligible){
      await page.locator("#slipTransfer").click();
      for(const key of Object.keys(expected))assert.equal(await field(key).inputValue(),"");
      await page.locator("#slipConfirm").check();
      await page.locator("#slipTransfer").click();
      for(const [key,value] of Object.entries(expected))assert.equal(await field(key).inputValue(),value,"Wrong transferable candidate: "+name+" "+key);
      assert.equal(await page.locator("#calculator").getAttribute("data-ocr-year"),"2026");
      await field("municipality").selectOption("standard");
      await field("acknowledgedExclusions").check();
      await page.locator('#calculator button[type="submit"]').click();
      assert.equal(await page.locator("#result .amount").textContent(),"109,000円");
      positiveImageResults.push({fixture:name,status:"EXACT_CANDIDATE",elapsedMs});
    }else{
      assert.equal(await page.locator("#slipConfirm").isEnabled(),false);
      assert.match(report,/保留|OCRを完了できません/);
      positiveImageResults.push({fixture:name,status:"HOLD",elapsedMs});
    }
    const trace=await page.evaluate(()=>window.__syntheticOcrTrace);
    assert.ok(trace.some(x=>x.kind==="recognize"),"No real OCR observations: "+name);
    fs.writeFileSync(path.join(out,name.slice(0,2)+"-synthetic-ocr-trace.json"),JSON.stringify({fixture:name,scope:"synthetic only",observations:trace},null,2));
    console.log("SYNTHETIC_POSITIVE_IMAGE "+name+" "+positiveImageResults.at(-1).status);
    if(name==="08-positive-image.png"&&!eligible){
      // A fixed-fixture research experiment, NOT a production fallback.
      // The OCR bounding boxes supply the amount regions, not a template
      // or the expected numbers. Preserve period and minus as recognized.
      const runCropExperiment=(language,margin)=>page.evaluate(async ({trace,language,margin})=>{
        if(!["jpn","eng"].includes(language)||![6,10].includes(margin))throw Error("unexpected research configuration");
        const first=trace.find(o=>o.kind==="recognize"&&o.lines?.length);
        const lines=first?.lines||[];
        const fields=FurusatoSlipReview.FIELDS;
        const norm=s=>FurusatoSlipReview.normalize(s);
        const plans=fields.map(field=>{
          const hits=lines.map((line,i)=>({line,i})).filter(x=>norm(x.line.text)===field.label);
          if(hits.length!==1)throw Error("synthetic label not unique");
          const next=lines[hits[0].i+1];
          if(!next||!next.bbox||!/^[0-9][0-9,.]+$/.test(norm(next.text)))throw Error("synthetic amount line missing");
          return {key:field.key,bbox:next.bbox};
        });
        const file=document.getElementById("slipFile").files[0];
        if(file?.name!=="08-positive-image.png")throw Error("unexpected research source");
        const bitmap=await createImageBitmap(file);
        let worker;
        const observations=[];
        try{
          if(bitmap.width!==first.width||bitmap.height!==first.height)throw Error("research dimensions mismatch");
          worker=await Tesseract.createWorker(language,Tesseract.OEM.LSTM_ONLY,{
            workerPath:new URL("./vendor/tesseract/worker.min.js",location.href).href,
            corePath:new URL("./vendor/tesseract/core",location.href).href,
            langPath:new URL("./vendor/tesseract/lang",location.href).href,
            workerBlobURL:false,cacheMethod:"none"
          });
          for(const variant of [{mode:"7",scale:1},{mode:"7",scale:2},{mode:"13",scale:1},{mode:"13",scale:2}]){
            await worker.setParameters({tessedit_pageseg_mode:variant.mode,tessedit_char_whitelist:"0123456789,.-"});
            for(const region of plans){
              const {x0,y0,x1,y1}=region.bbox;
              const x=Math.max(0,x0-margin),y=Math.max(0,y0-margin);
              const w=Math.min(bitmap.width,x1+margin)-x,h=Math.min(bitmap.height,y1+margin)-y;
              if(w<8||h<8||w*h>100000)throw Error("research crop out of bounds");
              const canvas=document.createElement("canvas"),pad=20;
              try{
                canvas.width=w*variant.scale+2*pad;canvas.height=h*variant.scale+2*pad;
                const ctx=canvas.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);
                ctx.drawImage(bitmap,x,y,w,h,pad,pad,w*variant.scale,h*variant.scale);
                const started=Date.now();
                const res=await worker.recognize(canvas);
                const text=norm(res?.data?.text);
                observations.push({key:region.key,mode:variant.mode,scale:variant.scale,text,
                  confidence:res?.data?.confidence??null,elapsedMs:Date.now()-started,
                  strictAmount:FurusatoSlipReview.parseYen(text)});
              }finally{canvas.width=0;canvas.height=0;}
            }
          }
          return observations;
        }finally{bitmap.close();if(worker)await worker.terminate();}
      },{trace,language,margin});
      const experiment=await runCropExperiment("jpn",6);
      assert.equal(experiment.length,16);
      const byVariant=summarizeAmountCrop(experiment,expected);
      for(const variant of byVariant){
        console.log("SYNTHETIC_AMOUNT_CROP_PSM_"+variant.mode+"_SCALE_"+variant.scale+" "+variant.exact+"/4");
        // Only fixed-fixture aggregate diagnostics: no document text or amounts in logs.
        console.log("SYNTHETIC_AMOUNT_CROP_METRICS "+JSON.stringify(variant));
      }
      fs.writeFileSync(path.join(out,"08-synthetic-amount-crop-experiment.json"),JSON.stringify({scope:"synthetic only; not production transfer",observations:experiment,byVariant},null,2));
      // A test-only local route: the production server, build and package
      // never expose this model. No CDN, no user data, no transfer path.
      const model=process.env.FURUSATO_ENGLISH_RESEARCH_MODEL;
      assert.ok(model&&fs.statSync(model).isFile(),"Isolated research model missing");
      const modelUrl=origin+"/vendor/tesseract/lang/eng.traineddata.gz";
      let served=0;
      const serveModel=async route=>{
        assert.equal(route.request().method(),"GET");
        assert.equal(route.request().url(),modelUrl);
        served++;
        await route.fulfill({path:model,contentType:"application/gzip"});
      };
      await context.route(modelUrl,serveModel);
      try{
        const english=await runCropExperiment("eng",10);
        assert.equal(english.length,16);
        assert.ok(served>0,"English model was not served locally");
        const englishVariants=summarizeAmountCrop(english,expected);
        for(const variant of englishVariants)console.log("SYNTHETIC_ENGLISH_AMOUNT_CROP_METRICS "+JSON.stringify(variant));
        fs.writeFileSync(path.join(out,"08-synthetic-english-amount-crop-experiment.json"),JSON.stringify({
          scope:"synthetic only; not production transfer",model:"@tesseract.js-data/eng@1.0.0/4.0.0_best_int",
          margin:10,observations:english,byVariant:englishVariants
        },null,2));
      }finally{await context.unroute(modelUrl,serveModel);}
      assert.equal(await page.locator("#slipConfirm").isEnabled(),false);
      assert.equal(await page.locator("#slipTransfer").isEnabled(),false);
      for(const key of Object.keys(expected))assert.equal(await field(key).inputValue(),"");

    }
  }
  // Fixed research suite, including actually printed malformed tokens.
  // Keep experimental evidence separate from UI/transfer eligibility.
  const {assessProbe,bilingualProbeInBrowser}=require("./synthetic-bilingual-probe.cjs");
  const researchCases=[
    ["08-positive-image.png",2026,expected],
    ["10-bilingual-varied.png",2025,{salaryGross:"6431200",salaryIncomeReference:"4704960",deductionsReference:"1389240",socialInsurance:"824600"}],
    ["11-bilingual-printed-period.png",null,null],
    ["12-bilingual-printed-minus.png",null,null],
    ["13-bilingual-duplicate-label.png",null,null],
    ["14-bilingual-conflicting-year.png",null,null]
  ];
  const model=process.env.FURUSATO_ENGLISH_RESEARCH_MODEL,modelUrl=origin+"/vendor/tesseract/lang/eng.traineddata.gz";
  assert.ok(model&&fs.statSync(model).isFile());
  const serve=route=>route.fulfill({path:model,contentType:"application/gzip"});
  const results=[];
  await context.route(modelUrl,serve);
  try{
    for(const [name,year,truth] of researchCases){
      await page.locator('#calculator button[type="reset"]').click();
      await field("year").selectOption("2026");
      await page.locator("#slipFile").setInputFiles(path.join(fixtures,name));
      const probe=await page.evaluate(bilingualProbeInBrowser);
      const assessment=assessProbe(probe);
      const correct=!!truth&&assessment.status==="RESEARCH_MATCH"&&assessment.year===year&&Object.entries(truth).every(([k,v])=>assessment.values[k]===Number(v));
      const outcome=assessment.status==="RESEARCH_MATCH"?(correct?"EXACT_RESEARCH_MATCH":"WRONG_RESEARCH_MATCH"):"HOLD";
      // No experimental values are ever written to the actual calculator.
      assert.equal(assessment.eligibleForManualTransfer,false);
      assert.equal(assessment.autoApproved,false);
      for(const key of Object.keys(expected))assert.equal(await field(key).inputValue(),"");
      // Negative source files also have to remain nontransferable in the existing product.
      if(!truth){
        await page.locator("#slipScan").click();
        await page.waitForFunction(()=>!document.getElementById("slipScan").disabled&&!document.getElementById("slipReview").hidden,null,{timeout:90000});
        assert.equal(await page.locator("#slipTransfer").isEnabled(),false,"Existing product unsafe: "+name);
        await save(name.slice(0,2)+"-bilingual-negative-hold",page.locator(".ocr-panel"));
      }
      results.push({fixture:name,outcome,assessment,probe});
      console.log("SYNTHETIC_BILINGUAL_PROBE "+name+" "+outcome);
      fs.writeFileSync(path.join(out,"synthetic-bilingual-probe.json"),JSON.stringify({scope:"synthetic research only; NEVER transfer",results},null,2));
    }
  }finally{await context.unroute(modelUrl,serve);}
  // A wrong research match is evidence to reject the experimental method,
  // not a product transfer. Preserve observations instead of hiding them.
  console.log("SYNTHETIC_BILINGUAL_PROBE_SUMMARY "+JSON.stringify({exact:results.filter(x=>x.outcome==="EXACT_RESEARCH_MATCH").length,wrong:results.filter(x=>x.outcome==="WRONG_RESEARCH_MATCH").length,hold:results.filter(x=>x.outcome==="HOLD").length}));
  // Exercise the actual bundled model and ordinary product UI for the
  // second positive fixture too, after removing the research route.
  await page.locator('#calculator button[type="reset"]').click();
  await field("year").selectOption("2026");
  await page.locator("#slipFile").setInputFiles(path.join(fixtures,"10-bilingual-varied.png"));
  await page.locator("#slipScan").click();
  await page.waitForFunction(()=>!document.getElementById("slipScan").disabled&&!document.getElementById("slipReview").hidden,null,{timeout:90000});
  await save("10-bilingual-product-review",page.locator(".ocr-panel"));
  assert.equal(await page.locator("#slipTransfer").isEnabled(),true,"10 must recover");
  assert.equal(await page.locator("#slipConfirm").isChecked(),false);
  await page.locator("#slipTransfer").click();
  for(const key of Object.keys(expected))assert.equal(await field(key).inputValue(),"");
  await page.locator("#slipConfirm").check();
  await page.locator("#slipTransfer").click();
  for(const [key,value] of Object.entries(researchCases[1][2]))assert.equal(await field(key).inputValue(),value);
  assert.equal(await page.locator("#calculator").getAttribute("data-ocr-year"),"2025");
  assert.equal(await field("year").inputValue(),"2026");
  console.log("BILINGUAL_PRODUCT_PREVIOUS_YEAR_REVIEW_PASS");
  // Format diversity: never count HOLD as recognition success. A wrong
  // transferable candidate fails, even for an exploratory fixture.
  const formatResults=[];
  const priorTruth={salaryGross:"5000000",salaryIncomeReference:"3560000",deductionsReference:"1430000",socialInsurance:"750000"};
  for(const [name,year,truth] of [
    ["15-bilingual-jpeg.jpg",2026,expected],
    ["16-bilingual-low-contrast.png",2026,expected],
    ["17-bilingual-raster.pdf",2026,expected],
    ["19-bilingual-previous-year.png",2025,priorTruth],
    ["24-raster-prior-year.pdf",2025,priorTruth],
    ["29-jpeg-prior-year.jpg",2025,priorTruth]
  ]){
    await page.locator('#calculator button[type="reset"]').click();
    await field("year").selectOption("2026");
    await page.locator("#slipFile").setInputFiles(path.join(fixtures,name));
    await page.evaluate(()=>{window.__syntheticOcrTrace=[];});
    const started=Date.now();
    await page.locator("#slipScan").click();
    await page.waitForFunction(()=>!document.getElementById("slipScan").disabled&&!document.getElementById("slipReview").hidden,null,{timeout:90000});
    const eligible=await page.locator("#slipTransfer").isEnabled();
    const formatTrace=await page.evaluate(()=>window.__syntheticOcrTrace);
    fs.writeFileSync(path.join(out,name.slice(0,2)+"-format-ocr-trace.json"),JSON.stringify({scope:"fixed synthetic only",fixture:name,observations:formatTrace},null,2));
    await save(name.slice(0,2)+"-format-review",page.locator(".ocr-panel"));
    if(name==="17-bilingual-raster.pdf"||name==="24-raster-prior-year.pdf"){
      assert.ok(formatTrace.some(t=>t.kind==="recognize"&&t.width===1190&&t.height===1684),"Fixed 2x PDF rendering not observed");
      assert.equal(eligible,true,"Previously recovered raster must work in product: "+name);
    }
    if(name==="15-bilingual-jpeg.jpg"||name==="29-jpeg-prior-year.jpg"){
      assert.ok(formatTrace.some(t=>t.kind==="recognize"&&t.width===1194&&t.height===1690),"Fixed JPEG resampling not observed");
      assert.equal(eligible,true,"Previously recovered JPEG must work in product: "+name);
    }
    assert.equal(await page.locator("#slipConfirm").isChecked(),false);
    assert.equal(await page.locator("#result").isVisible(),false);
    for(const key of Object.keys(truth))assert.equal(await field(key).inputValue(),"");
    if(eligible){
      await page.locator("#slipTransfer").click();
      for(const key of Object.keys(truth))assert.equal(await field(key).inputValue(),"");
      await page.locator("#slipConfirm").check();
      await page.locator("#slipTransfer").click();
      for(const [key,value] of Object.entries(truth))assert.equal(await field(key).inputValue(),value,"Wrong format candidate "+name+" "+key);
      assert.equal(await page.locator("#calculator").getAttribute("data-ocr-year"),String(year));
      if(year===2026){
        await field("municipality").selectOption("standard");
        await field("acknowledgedExclusions").check();
        await page.locator('#calculator button[type="submit"]').click();
        assert.equal(await page.locator("#result .amount").textContent(),"109,000円");
      }else{
        await field("municipality").selectOption("standard");
        await field("acknowledgedExclusions").check();
        await page.locator('#calculator button[type="submit"]').click();
        assert.equal(await page.locator("#result").getAttribute("class"),"result hold");
        await page.locator("#confirmBasicForecast").click();
        assert.equal(await field("forecastReviewed").isChecked(),true);
        await page.locator('#calculator button[type="submit"]').click();
        assert.equal(await page.locator("#result .amount").textContent(),"57,000円");
        assert.equal(await field("deductionsReference").inputValue(),"1430000");
        assert.equal(await page.locator("#result .result-tax-year").textContent(),"試算対象：2026年分 ／ 住民税：2027年度");
        assert.equal(await page.locator("#result .result-source-year").textContent(),"参照源泉票：2025年分（前年参考・対象年の見込額で試算）");
        assert.equal(await page.locator("#result details").first().getAttribute("open"),null);
        await save(name.slice(0,2)+"-forecast-confirmed",page.locator("#result"));
        await page.setViewportSize({width:360,height:900});
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
        await save(name.slice(0,2)+"-forecast-confirmed-360",page.locator("#result"));
        await page.emulateMedia({media:"print"});
        await page.evaluate(()=>window.dispatchEvent(new Event("beforeprint")));
        assert.equal(await page.locator("#result .result-tax-year").isVisible(),true);
        assert.equal(await page.locator("#result .result-source-year").isVisible(),true);
        await save(name.slice(0,2)+"-forecast-print-css",page.locator("#result"));
        await page.evaluate(()=>window.dispatchEvent(new Event("afterprint")));
        await page.emulateMedia({media:null});
        await page.setViewportSize({width:1280,height:900});
        console.log("SYNTHETIC_PRIOR_YEAR_FORECAST_57000_PASS");
      }
    }else{
      assert.equal(await page.locator("#slipConfirm").isEnabled(),false);
    }
    formatResults.push({fixture:name,status:eligible?"EXACT_CANDIDATE":"HOLD",elapsedMs:Date.now()-started});
    console.log("SYNTHETIC_FORMAT_RESULT "+name+" "+formatResults.at(-1).status);
    fs.writeFileSync(path.join(out,"synthetic-format-results.json"),JSON.stringify({scope:"synthetic only",results:formatResults},null,2));
  }
  // Exercise all eight PDF/JPEG negatives through the production reader,
  // not just the experimental region assessment.
  for(const name of ["20-raster-period.pdf","21-raster-minus.pdf","22-raster-duplicate.pdf","23-raster-year-conflict.pdf",
    "25-jpeg-period.jpg","26-jpeg-minus.jpg","27-jpeg-duplicate.jpg","28-jpeg-year-conflict.jpg"]){
    await page.locator('#calculator button[type="reset"]').click();
    await field("year").selectOption("2026");
    await page.locator("#slipFile").setInputFiles(path.join(fixtures,name));
    await page.locator("#slipScan").click();
    await page.waitForFunction(()=>!document.getElementById("slipScan").disabled&&!document.getElementById("slipReview").hidden,null,{timeout:90000});
    assert.equal(await page.locator("#slipTransfer").isEnabled(),false,name);
    assert.equal(await page.locator("#slipConfirm").isEnabled(),false,name);
    assert.equal(await page.locator("#result").isVisible(),false,name);
    for(const key of Object.keys(expected))assert.equal(await field(key).inputValue(),"",name);
    await save(name.slice(0,2)+"-"+(name.endsWith(".jpg")?"jpeg":"raster")+"-product-hold",page.locator(".ocr-panel"));
    console.log((name.endsWith(".jpg")?"SYNTHETIC_JPEG_PRODUCT_NEGATIVE_HOLD ":"SYNTHETIC_RASTER_PRODUCT_NEGATIVE_HOLD ")+name);
  }
  // Test-only candidate configurations. Do not substitute a research
  // result for the ordinary product decision, or tune by expected amounts.
  const {probeFormatInBrowser}=require("./synthetic-format-probe.cjs");
  const variantReports=[];
  for(const [name,year,truth,count] of [
    ["15-bilingual-jpeg.jpg",2026,expected,3],
    ["17-bilingual-raster.pdf",2026,expected,2],
    ["20-raster-period.pdf",null,null,1],
    ["21-raster-minus.pdf",null,null,1],
    ["22-raster-duplicate.pdf",null,null,1],
    ["23-raster-year-conflict.pdf",null,null,1],
    ["24-raster-prior-year.pdf",2025,priorTruth,1],
    ["25-jpeg-period.jpg",null,null,1],
    ["26-jpeg-minus.jpg",null,null,1],
    ["27-jpeg-duplicate.jpg",null,null,1],
    ["28-jpeg-year-conflict.jpg",null,null,1],
    ["29-jpeg-prior-year.jpg",2025,priorTruth,1]
  ]){
    await page.locator('#calculator button[type="reset"]').click();
    await page.locator("#slipFile").setInputFiles(path.join(fixtures,name));
    const reports=await page.evaluate(probeFormatInBrowser);
    assert.equal(reports.length,count);
    for(const report of reports){
      const match=report.status==="RESEARCH_MATCH";
      if(report.assessment){
        assert.equal(report.assessment.eligibleForManualTransfer,false);
        assert.equal(report.assessment.autoApproved,false);
      }
      const exact=match&&!!truth&&report.assessment?.year===year&&Object.entries(truth).every(([k,v])=>report.assessment.candidates[k]===Number(v));
      const outcome=match?(exact?"EXACT_RESEARCH_MATCH":"WRONG_RESEARCH_MATCH"):"HOLD";
      variantReports.push({fixture:name,outcome,report});
      console.log("SYNTHETIC_FORMAT_VARIANT "+JSON.stringify({fixture:name,id:report.id,outcome,reason:report.reason||null,dimensions:report.dimensions,years:report.pages.map(p=>p.year),plans:report.pages.map(p=>p.plan.status)}));
    }
    for(const key of Object.keys(expected))assert.equal(await field(key).inputValue(),"");
    assert.equal(await page.locator("#slipTransfer").isEnabled(),false);
    fs.writeFileSync(path.join(out,"synthetic-format-variant-research.json"),JSON.stringify({scope:"synthetic research only; NEVER transfer",results:variantReports},null,2));
  }
  // Mixed raster PDF: both rows are processed independently; no result
  // before review, no incorrect value in the positive row or negative CSV.
  await page.locator('#calculator button[type="reset"]').click();
  await field("year").selectOption("2026");
  await page.locator("#batchPdf").setInputFiles(path.join(fixtures,"18-bilingual-raster-mixed.pdf"));
  await page.locator("#batchScan").click();
  await page.waitForFunction(()=>!document.getElementById("batchScan").disabled&&document.querySelectorAll("#batchRows tr").length===2,null,{timeout:120000});
  const rows=page.locator("#batchRows tr");
  await page.locator("#batchCalculate").click();
  assert.deepEqual(await page.locator("#batchRows .batch-result").allTextContents(),["—","—"]);
  assert.equal(await rows.nth(1).locator('[data-field="confirmed"]').isEnabled(),false);
  const rasterBatchEligible=await rows.first().locator('[data-field="confirmed"]').isEnabled();
  assert.equal(rasterBatchEligible,true,"Normal raster batch page must recover");
  if(rasterBatchEligible){
    for(const [key,value] of Object.entries(expected))assert.equal(await rows.first().locator('[data-field="'+key+'"]').inputValue(),value);
    assert.equal(await rows.first().locator('[data-field="sourceYear"]').inputValue(),"2026");
    await rows.first().locator('[data-field="municipality"]').selectOption("standard");
    await rows.first().locator('[data-field="confirmed"]').check();
    await rows.first().locator('[data-field="noExclusions"]').check();
    await page.locator("#batchCalculate").click();
    assert.deepEqual(await page.locator("#batchRows .batch-result").allTextContents(),["109,000円","—"]);
  }
  const mixedPending=page.waitForEvent("download");
  await page.locator("#batchDownload").click();
  const mixedDownload=await mixedPending;
  const mixedLines=fs.readFileSync(await mixedDownload.path(),"utf8").trim().split(/\r?\n/).map(line=>line.split('","').map(value=>value.replace(/^"|"$/g,"")));
  assert.equal(mixedLines.length,3);
  assert.equal(mixedLines[1][11],rasterBatchEligible?"109000":"");
  assert.equal(mixedLines[2][11],"");assert.equal(mixedLines[2][12],"HOLD");
  await mixedDownload.delete();
  await save("18-raster-batch",page.locator("#batchStatus"));
  await page.locator("#batchClear").click();
  console.log("SYNTHETIC_RASTER_BATCH "+(rasterBatchEligible?"EXACT_CANDIDATE":"HOLD")+" NEGATIVE_HOLD");
  // Cancel during the English worker recognition itself, then prove a
  // replacement slip is the only source eligible for manual transfer.
  await page.locator('#calculator button[type="reset"]').click();
  await field("year").selectOption("2026");
  await page.locator("#slipFile").setInputFiles(path.join(fixtures,"08-positive-image.png"));
  await page.evaluate(()=>{window.__syntheticEnglishStarted=false;window.__pauseSyntheticEnglish=true;});
  await page.locator("#slipScan").click();
  await page.waitForFunction(()=>window.__syntheticEnglishStarted===true,null,{timeout:90000});
  await page.locator("#slipFile").setInputFiles(path.join(fixtures,"06-positive-electronic.pdf"));
  await page.evaluate(()=>{window.__releaseSyntheticEnglish?.();window.__releaseSyntheticEnglish=null;});
  await page.waitForFunction(()=>!document.getElementById("slipScan").disabled,null,{timeout:90000});
  assert.equal(await page.locator("#slipTransfer").isEnabled(),false);
  assert.equal(await page.locator("#slipConfirm").isEnabled(),false);
  for(const key of Object.keys(expected))assert.equal(await field(key).inputValue(),"");
  await page.locator("#slipScan").click();
  await page.waitForFunction(()=>!document.getElementById("slipScan").disabled&&!document.getElementById("slipReview").hidden,null,{timeout:90000});
  assert.equal(await page.locator("#slipTransfer").isEnabled(),true);
  assert.equal(await page.locator("#slipConfirm").isChecked(),false);
  await page.locator("#slipConfirm").check();
  await page.locator("#slipTransfer").click();
  for(const [key,value] of Object.entries(expected))assert.equal(await field(key).inputValue(),value);
  await save("english-cancel-recovery",page.locator(".ocr-panel"));
  console.log("SYNTHETIC_ENGLISH_CANCEL_AND_REPLACEMENT_PASS");
  // 09 has two exact full-page readings on the previous physical Edge
  // baseline. Require recovery of that positive fixture, without weakening
  // the third-read check. Preserve traces/screenshots even if this fails.
  fs.writeFileSync(path.join(out,"positive-image-baseline-comparison.json"),JSON.stringify({baselineSha:"74f791200efeb83fbfc713e6e0d77730cc1bf9de",baseline:["HOLD","HOLD"],current:positiveImageResults},null,2));
  assert.equal(positiveImageResults.find(x=>x.fixture==="08-positive-image.png")?.status,"EXACT_CANDIDATE","08 must recover with exact bilingual corroboration");
  assert.equal(positiveImageResults.find(x=>x.fixture==="09-positive-lines.png")?.status,"EXACT_CANDIDATE","09 must recover with exact regional corroboration");
  await page.goto(origin+"/terms.html");
  await save("terms");
  await page.goto(origin+"/privacy.html");
  await save("privacy");
  assert.deepEqual(external,[]);
  fs.writeFileSync(path.join(out,"result.json"),JSON.stringify({
   status:"PASS",scope:"synthetic headless Edge, not interactive desktop or mobile device",
   sha:process.env.GITHUB_SHA||null,os:os.release(),browser:browser.version(),checks,repeatReads,batch20:{elapsedMs:batchElapsedMs,cancelled,holdRows:20,recovered:true},positiveImageResults,formatResults,rasterBatchEligible,englishCancelRecovery:true,externalRequests:external.length
  },null,2));
  console.log("WINDOWS_EDGE_SYNTHETIC_SCREENSHOT_ACCEPTANCE_PASS");
  await context.close();
 }finally{
  if(browser)await browser.close();
  await new Promise(resolve=>review.server.close(resolve));
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
