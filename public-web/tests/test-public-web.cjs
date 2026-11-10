"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),cp=require("node:child_process");
const root=path.resolve(__dirname,".."),out=path.join(root,"dist");
const build=cp.spawnSync(process.execPath,[path.join(root,"scripts","build.cjs")],
 {cwd:root,encoding:"utf8",timeout:30000});
assert.equal(build.status,0,build.stderr||build.stdout);
const result=JSON.parse(build.stdout);
assert.equal(result.status,"STATIC_REVIEW_BUILD_PASS");
assert.equal(result.engineVersion,"v0.1.23");
assert.equal(result.release,"HOLD");
assert.equal(result.ads,"NOT_ENABLED");
assert.equal(result.ocr,"LOCAL_ONLY_REVIEW");
assert.equal(result.deployment,"NOT_RUN");
for(const name of ["index.html","style.css","app.js","about.html","privacy.html",
 "engine.js","robots.txt","_headers", "ocr.js","ocr-review.js","ocr-quality.js","ocr-layout.js","ocr-regions.js","ocr-image-header.js","pdf-compat.js",
 "vendor/tesseract/tesseract.min.js","vendor/tesseract/worker.min.js",
 "vendor/tesseract/lang/jpn.traineddata.gz","vendor/pdf.mjs","vendor/pdf.worker.mjs",
 "licenses/THIRD_PARTY_NOTICES.txt"])
 assert.ok(fs.statSync(path.join(out,name)).size>10,name);
const engine=fs.readFileSync(path.join(out,"engine.js"),"utf8");
assert.equal(engine,fs.readFileSync(path.join(root,"..","gas","Engine.gs"),"utf8"));
const html=fs.readFileSync(path.join(out,"index.html"),"utf8");
const app=fs.readFileSync(path.join(out,"app.js"),"utf8");
const headers=fs.readFileSync(path.join(out,"_headers"),"utf8");
assert.match(html,/noindex,nofollow,noarchive/);
assert.match(headers,/connect-src 'self'/);
assert.match(headers,/worker-src 'self'/);
assert.match(headers,/wasm-unsafe-eval/);
assert.match(headers,/X-Robots-Tag: noindex/);
assert.match(headers,/frame-ancestors 'none'/);
assert.match(fs.readFileSync(path.join(out,"robots.txt"),"utf8"),/Disallow: \/$/m);
assert.doesNotMatch(html+app,/adsbygoogle|googlesyndication|googletagmanager|google-analytics|\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage/);
assert.doesNotMatch(html,/https?:\/\/[^"']+\.js["']/);
assert.match(html,/id="slipFile"/);
assert.match(html,/id="slipTransfer"/);
assert.match(html,/id="slipConfirm"[^>]*disabled/);
assert.match(html,/src="\.\/ocr-review\.js"/);
assert.match(html,/src="\.\/ocr-quality\.js"/);
assert.match(html,/src="\.\/ocr-image-header\.js"/);
assert.match(html,/src="\.\/ocr-layout\.js"/);
assert.match(html,/src="\.\/vendor\/tesseract\/tesseract\.min\.js"/);
const {JSDOM}=require("../../gas/node_modules/jsdom");
const dom=new JSDOM(html,{url:"https://review.invalid/",runScripts:"outside-only"});
const {document,Event}=dom.window;
dom.window.fetch=()=>{throw Error("no network allowed");};
dom.window.eval(engine);
dom.window.eval(app);
const form=document.querySelector("#calculator"),view=document.querySelector("#result");
function field(name){return form.elements.namedItem(name);}
function submit(){form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));}
field("salaryGross").value="7000000";
field("socialInsurance").value="1000000";
field("acknowledgedExclusions").checked=true;
submit();
assert.equal(view.hidden,false);
assert.equal(view.className,"result");
assert.match(view.textContent,/109,000円/);
assert.match(view.textContent,/寄附上限額の概算/);
// Even if a future tax engine misreports success, mismatched output year,
// resident year, or internal yen-cap arithmetic must never reach the UI.
const actualCalculate=dom.window.FurusatoEngine.calculate;
for(const variant of ["year","residentYear","donationAmount","specialCap",
 "residentCap","grossMismatch","socialMismatch","salaryIncomeMismatch",
 "incomeTaxableMismatch","residentTaxableMismatch","preliminaryLimit",
 "denominatorMismatch","residentLevyInvalid","negativeIncome",
 "fractionalDonation","nonemptyReasons"]){
 dom.window.FurusatoEngine.calculate=function(payload){
   const actual=actualCalculate(payload);
   assert.equal(actual.status,"ESTIMATE");
   const bad={...actual,calculation:{...actual.calculation}};
   if(variant==="year")bad.year=2025;
   if(variant==="residentYear")bad.residentYear=2028;
   if(variant==="donationAmount")bad.calculation.donationLimitYen+=1000;
   if(variant==="specialCap")bad.calculation.specialCreditCapYen+=1;
   if(variant==="residentCap")bad.calculation.residentDonationIncomeCapYen=1;
   if(variant==="grossMismatch")bad.calculation.salaryGrossYen+=1000;
   if(variant==="socialMismatch")bad.calculation.socialInsuranceYen+=1000;
   if(variant==="salaryIncomeMismatch")bad.calculation.salaryIncomeYen+=1000;
   if(variant==="incomeTaxableMismatch")bad.calculation.incomeTaxTaxableYen+=1000;
   if(variant==="residentTaxableMismatch")bad.calculation.residentTaxTaxableYen+=1000;
   if(variant==="preliminaryLimit")bad.calculation.preliminaryLimitYen+=1000;
   if(variant==="denominatorMismatch")bad.calculation.denominator+=.1;
   if(variant==="residentLevyInvalid")bad.calculation.residentIncomeLevyYen=0;
   if(variant==="negativeIncome")bad.calculation.salaryIncomeYen=-1000;
   if(variant==="fractionalDonation"){
     bad.donationLimitYen+=.5;bad.calculation.donationLimitYen+=.5;
   }
   if(variant==="nonemptyReasons")bad.reasons=["SYNTHETIC_WARNING"];
   return bad;
 };
 submit();
 assert.equal(view.className,"result hold",variant);
 assert.doesNotMatch(view.textContent,/109,000円/,variant);
 assert.equal(view.querySelector("button"),null,variant);
}
dom.window.FurusatoEngine.calculate=actualCalculate;
submit();
assert.equal(view.className,"result");
assert.match(view.textContent,/109,000円/);
// Force an engine regression returning the old valid ESTIMATE regardless
// of current user input; the renderer must still refuse unreviewed sources,
// new income values, unsupported deductions, and absent confirmations.
const validInput={year:"2026",filing:"one-stop",incomeType:"salary",
 salaryGross:"7000000",socialInsurance:"1000000",
 salaryIncomeReference:"",deductionsReference:"",
 acknowledgedExclusions:true};
for(const name of ["hasSpouse","hasDependents","hasLifeInsurance",
 "hasEarthquakeInsurance","hasMortgage","hasOtherIncome","hasMedical",
 "hasSplitIncome","hasIncomeAdjustment","hasNonstandardConditions"])
 validInput[name]=false;
const validResult=actualCalculate(validInput);
assert.equal(validResult.status,"ESTIMATE");
dom.window.FurusatoEngine.calculate=()=>validResult;
for(const [name,value] of [["salaryGross","7100000"],
 ["socialInsurance","950000"],["hasMortgage",true],
 ["acknowledgedExclusions",false]]){
 const target=field(name),old=target.type==="checkbox"?target.checked:target.value;
 if(target.type==="checkbox")target.checked=value;else target.value=value;
 submit();
 assert.equal(view.className,"result hold",name);
 assert.doesNotMatch(view.textContent,/109,000円/,name);
 if(target.type==="checkbox")target.checked=old;else target.value=old;
}
for(const [key,value] of [["ocrReviewPending","true"],["ocrYear","2025"]]){
 form.dataset[key]=value;
 submit();
 assert.equal(view.className,"result hold",key);
 delete form.dataset[key];
}
dom.window.FurusatoEngine.calculate=actualCalculate;
submit();
assert.equal(view.className,"result");
assert.match(view.textContent,/109,000円/);
const detail=view.querySelector("details");
assert.ok(detail);
assert.match(detail.textContent,/住民税所得割の概算/);
assert.equal(view.querySelector("button").type,"button");
field("hasMortgage").checked=true;
field("hasMortgage").dispatchEvent(new Event("change",{bubbles:true}));
assert.equal(field("acknowledgedExclusions").checked,false,
 "changing exclusion flags must revoke the prior confirmation");
submit();
assert.equal(view.className,"result hold");
assert.doesNotMatch(view.textContent,/109,000円/);
assert.match(view.textContent,/住宅借入金等特別控除/);
field("hasMortgage").checked=false;
field("acknowledgedExclusions").checked=false;
submit();
assert.equal(view.className,"result hold");
assert.doesNotMatch(view.textContent,/109,000円/);
field("acknowledgedExclusions").checked=true;
field("salaryGross").value='<img src=x onerror=alert(1)>';
submit();
assert.equal(view.className,"result hold");
assert.equal(view.querySelectorAll("img").length,0);
field("salaryGross").value="7000000";
field("year").value="2025";
field("year").dispatchEvent(new Event("change",{bubbles:true}));
assert.equal(field("acknowledgedExclusions").checked,false);
field("acknowledgedExclusions").checked=true;
field("filing").value="return";
field("filing").dispatchEvent(new Event("change",{bubbles:true}));
assert.equal(field("acknowledgedExclusions").checked,false);
field("acknowledgedExclusions").checked=true;
submit();
assert.match(view.textContent,/109,000円/);
form.reset();
assert.equal(view.hidden,true);
assert.equal(view.textContent,"");
assert.equal(document.querySelectorAll("script[src^='http']").length,0);
assert.equal(document.querySelectorAll("iframe").length,0);
assert.equal(document.getElementById("slipTransfer").disabled,true);
dom.window.close();
console.log("PUBLIC_WEB_STATIC_AND_BROWSER_SYNTHETIC_PASS; no network; ads off; deploy off");
