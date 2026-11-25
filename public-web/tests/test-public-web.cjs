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
 "engine.js","robots.txt","_headers", "ocr.js","batch.js","batch-name.js","batch-core.js","ocr-review.js","ocr-quality.js","ocr-layout.js","ocr-regions.js","ocr-image-header.js","pdf-compat.js","pdf-gcodes.js",
 "vendor/tesseract/tesseract.min.js","vendor/tesseract/worker.min.js",
 "vendor/tesseract/lang/jpn.traineddata.gz","vendor/pdf.mjs","vendor/pdf.worker.mjs",
 "licenses/THIRD_PARTY_NOTICES.txt"])
 assert.ok(fs.statSync(path.join(out,name)).size>10,name);
const engine=fs.readFileSync(path.join(out,"engine.js"),"utf8");
assert.equal(engine,fs.readFileSync(path.join(root,"..","gas","Engine.gs"),"utf8"));
const html=fs.readFileSync(path.join(out,"index.html"),"utf8");
const app=fs.readFileSync(path.join(out,"app.js"),"utf8");
const headers=fs.readFileSync(path.join(out,"_headers"),"utf8");
const printCss=fs.readFileSync(path.join(out,"style.css"),"utf8");
// Only reviewed tax results and their basis may be printed. Source filenames,
// OCR preview and personal identity fields must remain outside saved PDFs.
assert.match(printCss,/\.ocr-panel,\.fields/);
assert.match(printCss,/\.result details>summary/);
assert.match(printCss,/#result\[hidden\]/);
assert.match(html,/class="print-only"/);
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
assert.match(html,/id="batchPdf"/);
assert.match(html,/id="batchScan"/);
assert.match(html,/id="batchRows"/);
assert.match(html,/id="batchCalculate"[^>]*disabled/);
assert.match(html,/id="batchDownload"[^>]*disabled/);
assert.match(html,/src="\.\/batch-name\.js"/);
assert.match(html,/src="\.\/batch-core\.js"/);
assert.match(html,/name="forecastReviewed"/);
assert.match(html,/src="\.\/batch\.js"/);
const batchJavaScript=fs.readFileSync(path.join(out,"batch.js"),"utf8");
assert.doesNotMatch(batchJavaScript,/XMLHttpRequest|sendBeacon|localStorage|sessionStorage|\bfetch\s*\(/);
assert.match(batchJavaScript,/FurusatoEstimateGuard/);

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
dom.window.eval(fs.readFileSync(path.join(out,"resident-levy.js"),"utf8"));
dom.window.eval(fs.readFileSync(path.join(out,"family-deductions.js"),"utf8"));
dom.window.eval(fs.readFileSync(path.join(out,"insurance-deductions.js"),"utf8"));
for(const moduleName of ["other-deductions.js","medical-deductions.js","salary-adjustment.js"])
 dom.window.eval(fs.readFileSync(path.join(out,moduleName),"utf8"));
dom.window.eval(fs.readFileSync(path.join(out,"family-tax.js"),"utf8"));
dom.window.eval(fs.readFileSync(path.join(out,"family-source.js"),"utf8"));
dom.window.eval(app);
const form=document.querySelector("#calculator"),view=document.querySelector("#result");
function field(name){return form.elements.namedItem(name);}
function rawSubmit(){form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));}
function submit(){
 // Every pre-existing synthetic success case explicitly selects a standard municipality.
 if(field("municipality").value==="")field("municipality").value="standard";
 rawSubmit();
}
// Verified low-income manual case: no numeric ceiling, stale print blocked.
field("year").value="2025";field("salaryGross").value="900000";
field("socialInsurance").value="0";field("municipality").value="standard";
field("acknowledgedExclusions").checked=true;rawSubmit();
assert.match(view.textContent,/控除余地なし（課税所得ゼロ）/);
assert.equal(view.querySelector(".amount"),null);
field("salaryGross").value="900001";
dom.window.dispatchEvent(new Event("beforeprint"));
assert.match(view.textContent,/HOLD/);
form.reset();
field("year").value="2026";
field("salaryGross").value="7000000";
field("socialInsurance").value="1000000";
field("acknowledgedExclusions").checked=true;
assert.equal(field("municipality").value,"");
rawSubmit();
assert.equal(view.className,"result hold");
assert.doesNotMatch(view.textContent,/109,000円/);
submit();
assert.equal(view.hidden,false);
assert.equal(view.className,"result");
assert.match(view.textContent,/109,000円/);
const localComparison=view.querySelector(".municipal-comparison");
assert.ok(localComparison);
assert.match(localComparison.textContent,/標準市町村：所得割 374,500円/);
assert.match(localComparison.textContent,/政令指定都市：所得割 374,500円/);
assert.match(localComparison.textContent,/市町村 224,700円・道府県 149,800円/);
assert.match(localComparison.textContent,/市町村 299,600円・道府県 74,900円/);
assert.equal((localComparison.textContent.match(/寄附参考額 109,000円/g)||[]).length,2);
assert.match(view.textContent,/標準市町村 ／ 自治体別ワンストップ参考/);
field("municipality").value="designated";
field("municipality").dispatchEvent(new Event("change",{bubbles:true}));
assert.equal(view.hidden,true);
assert.equal(field("acknowledgedExclusions").checked,false);
rawSubmit();assert.equal(view.className,"result hold");
field("acknowledgedExclusions").checked=true;rawSubmit();
assert.match(view.textContent,/政令指定都市 ／ 自治体別ワンストップ参考/);
field("municipality").value="standard";
field("municipality").dispatchEvent(new Event("change",{bubbles:true}));
field("acknowledgedExclusions").checked=true;rawSubmit();

assert.match(view.textContent,/寄附上限額の概算/);
// Even if a future tax engine misreports success, mismatched output year,
// resident year, or internal yen-cap arithmetic must never reach the UI.
const actualCalculate=dom.window.FurusatoEngine.calculate;
for(const variant of ["year","residentYear","donationAmount","specialCap",
 "residentCap","grossMismatch","socialMismatch","salaryIncomeMismatch",
 "incomeTaxableMismatch","residentTaxableMismatch","preliminaryLimit",
 "denominatorMismatch","residentLevyInvalid","negativeIncome",
 "fractionalDonation","nonemptyReasons","residentRate",
 "residentSpecialBase","nationalIncomeTax","reconstructionTax","nationalTaxTotal"]){
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
   if(variant==="residentRate"){
     // Make all derived values internally self-consistent. The separate
     // official municipal rate-table guard must still reject a wrong band.
     bad.calculation.marginalIncomeTaxRate=.10;
     bad.calculation.denominator=.9-.10*1.021;
     bad.calculation.preliminaryLimitYen=Math.floor(2000+
       bad.calculation.specialCreditCapYen/bad.calculation.denominator);
   }
   if(variant==="residentSpecialBase")bad.calculation.residentSpecialRateBaseYen+=1000;
   if(variant==="nationalIncomeTax")bad.calculation.nationalIncomeTaxYen+=1000;
   if(variant==="reconstructionTax")bad.calculation.reconstructionIncomeTaxYen+=100;
   if(variant==="nationalTaxTotal")bad.calculation.nationalIncomeTaxTotalYen+=100;
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
// No input event: a browser autofill or script can alter a live form after
// an estimate. Printing must NOT reuse the old conditions or visible amount.
let syntheticPrintCalls=0;
dom.window.print=()=>{syntheticPrintCalls++;};
const printBasis=view.querySelector("details");
assert.equal(printBasis.open,false);
dom.window.dispatchEvent(new Event("beforeprint"));
assert.equal(printBasis.open,true,"PDF print must expand the calculation basis");
dom.window.dispatchEvent(new Event("afterprint"));
assert.equal(printBasis.open,false,"print preview must not alter screen state");
printBasis.open=true;
dom.window.dispatchEvent(new Event("beforeprint"));
dom.window.dispatchEvent(new Event("afterprint"));
assert.equal(printBasis.open,true,"previously expanded details stay expanded");
printBasis.open=false;
view.querySelector("button").click();
assert.equal(syntheticPrintCalls,1,"normal print remains available");
const priorPrintButton=view.querySelector("button");
field("salaryGross").value="7100000"; // intentionally no input event
priorPrintButton.click();
assert.equal(syntheticPrintCalls,1,"changed salary must block stale printing");
assert.equal(view.className,"result hold");
assert.doesNotMatch(view.textContent,/109,000円/);
assert.equal(view.querySelector("button"),null);
// Ctrl+P routes through beforeprint and must reject a silent change too.
field("salaryGross").value="7000000";
submit();
assert.equal(view.className,"result");
field("socialInsurance").value="1050000"; // silent autofill
dom.window.dispatchEvent(new Event("beforeprint"));
assert.equal(view.className,"result hold");
assert.equal(view.querySelector("button"),null);
assert.doesNotMatch(view.textContent,/109,000円/);
field("socialInsurance").value="1000000";
submit();
assert.equal(view.className,"result");
view.querySelector("button").click();
assert.equal(syntheticPrintCalls,2,"print allowed again after fresh calculation");
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
// 2025 source slip is allowed to support a 2026 forecast only after
// the user has revised the 2026 salary/deductions and re-attested it.
field("year").value="2026";
field("filing").value="one-stop";
field("salaryGross").value="5000000";
field("socialInsurance").value="750000";
field("salaryIncomeReference").value="3560000";
field("deductionsReference").value="1790000";
form.dataset.ocrYear="2025";
field("forecastReviewed").checked=false;
field("acknowledgedExclusions").checked=true;
submit();
assert.equal(view.className,"result hold");
assert.doesNotMatch(view.textContent,/57,000円/);
field("forecastReviewed").checked=true;
field("acknowledgedExclusions").checked=true;
submit();
assert.equal(view.className,"result");
assert.match(view.textContent,/57,000円/);
// An OCR source's detected mortgage/insurance amounts remain a hard HOLD
// regardless of the UI exclusion checkbox or forecast re-attestation.
form.dataset.ocrSourceIndicators="hasMortgage,hasLifeInsurance";
submit();
assert.equal(view.className,"result hold");
assert.doesNotMatch(view.textContent,/57,000円/);
delete form.dataset.ocrSourceIndicators;
submit();
assert.equal(view.className,"result");
assert.match(view.textContent,/57,000円/);
field("deductionsReference").value="1430000"; // stale 2025 basic deduction
submit();
assert.equal(view.className,"result hold");
assert.doesNotMatch(view.textContent,/57,000円/);
// A corrected imported slip keeps its year. A failed/cancelled OCR must not
// be resumable via this checkbox, only an edited previously-transferred source.
field("deductionsReference").value="1790000";
form.dataset.ocrReviewPending="true";
form.dataset.ocrManualReviewRequired="true";
field("correctedSourceReviewed").checked=false;
submit();
assert.equal(view.className,"result hold");
field("correctedSourceReviewed").checked=true;
submit();
assert.equal(view.className,"result");
assert.match(view.textContent,/57,000円/);
delete form.dataset.ocrManualReviewRequired;
submit();
assert.equal(view.className,"result hold","aborted-source marker cannot be bypassed");
delete form.dataset.ocrReviewPending;
delete form.dataset.ocrYear;
form.reset();
// Explicit override is always visible and is NOT an automatic recomputation.
field("year").value="2026";
field("filing").value="one-stop";
field("salaryGross").value="7000000";
field("socialInsurance").value="1000000";
field("deductionsReference").value="1670000";
form.dataset.ocrYear="2026";
form.dataset.ocrOriginalGross="7000000";
form.dataset.ocrOriginalSocial="1000000";
form.dataset.ocrOriginalDeductions="1670000";
field("deductionsOverride").value="1670000";
field("deductionsOverride").dispatchEvent(new Event("input",{bubbles:true}));
assert.equal(document.getElementById("deductionsOverrideStatus").hidden,false);
assert.ok(form.classList.contains("deduction-override-active"));
field("acknowledgedExclusions").checked=true;
submit();
assert.equal(view.className,"result");
assert.match(view.textContent,/手入力上書き中/);
// A social-insurance edit must not automatically change the override total.
field("socialInsurance").value="1050000";
field("socialInsurance").dispatchEvent(new Event("input",{bubbles:true}));
assert.equal(field("acknowledgedExclusions").checked,false);
field("acknowledgedExclusions").checked=true;
submit();
assert.equal(view.className,"result hold");
assert.doesNotMatch(view.textContent,/109,000円/);
field("deductionsOverride").value="1720000";
field("deductionsOverride").dispatchEvent(new Event("input",{bubbles:true}));
field("acknowledgedExclusions").checked=true;
submit();
assert.equal(view.className,"result");
assert.match(view.textContent,/手入力上書き中/);
// With independently verified ORIGINAL source figures, deleting a manual
// override restores automatic current-year total (1.72m), even though the
// historic source reference remains 1.67m.
field("deductionsOverride").value="";
field("deductionsOverride").dispatchEvent(new Event("input",{bubbles:true}));
assert.equal(document.getElementById("deductionsOverrideStatus").hidden,true);
field("acknowledgedExclusions").checked=true;
submit();
assert.equal(view.className,"result");
assert.match(view.textContent,/1,720,000円/);
form.dataset.ocrOriginalDeductions="1900000"; // source had unknown extra deductions
submit();
assert.equal(view.className,"result hold");
assert.doesNotMatch(view.textContent,/109,000円/);
form.dataset.ocrOriginalDeductions="1670000";
submit();
assert.equal(view.className,"result");
// Without original-source evidence, a stale reference remains a hard HOLD.
delete form.dataset.ocrYear;
delete form.dataset.ocrOriginalGross;
delete form.dataset.ocrOriginalSocial;
delete form.dataset.ocrOriginalDeductions;
submit();
assert.equal(view.className,"result hold");
field("deductionsReference").value="";
field("deductionsReference").dispatchEvent(new Event("input",{bubbles:true}));
field("acknowledgedExclusions").checked=true;
submit();
assert.equal(view.className,"result");
form.reset();
assert.equal(view.hidden,true);
assert.equal(view.textContent,"");
assert.equal(document.querySelectorAll("script[src^='http']").length,0);
assert.equal(document.querySelectorAll("iframe").length,0);
assert.equal(document.getElementById("slipTransfer").disabled,true);
// A case where municipality selection changes the PRIMARY amount by ¥1,000.
field("year").value="2026";
field("filing").value="one-stop";
field("salaryGross").value="7000000";
field("socialInsurance").value="601000";
field("municipality").value="standard";
field("acknowledgedExclusions").checked=true;
rawSubmit();
assert.equal(view.className,"result");
assert.equal(view.querySelector(".amount").textContent,"121,000円");
field("municipality").value="designated";
field("municipality").dispatchEvent(new Event("change",{bubbles:true}));
assert.equal(view.hidden,true);
field("acknowledgedExclusions").checked=true;
rawSubmit();
assert.equal(view.className,"result");
assert.equal(view.querySelector(".amount").textContent,"120,000円");
// A silent select mutation must not print the previous jurisdiction.
field("municipality").value="standard";
dom.window.dispatchEvent(new Event("beforeprint"));
assert.equal(view.className,"result hold");
assert.equal(view.querySelector(".amount"),null);
form.reset();
// Filing trial is independent of the primary one-stop reference.
field("year").value="2026";field("filing").value="one-stop";
field("salaryGross").value="7000000";field("socialInsurance").value="1000000";
field("municipality").value="standard";field("acknowledgedExclusions").checked=true;
field("donationTrial").value="120000";rawSubmit();
assert.equal(view.className,"result");
assert.equal(view.querySelector(".amount").textContent,"109,000円");
const trialView=()=>view.querySelector(".filing-trial");
function trialValue(label){
 const item=[...trialView().querySelectorAll("dt")].find(x=>x.textContent===label);
 return item?.nextElementSibling?.textContent;
}
assert.equal(trialValue("試算寄附額"),"120,000円");
assert.equal(trialValue("実質自己負担見込額"),"9,104円");
assert.equal(trialValue("2,000円超過額"),"7,104円");
assert.equal(trialValue("所得税（寄附前）"),"278,500円");
assert.equal(trialValue("所得税（寄附後）"),"254,900円");
assert.equal(trialValue("住民税所得割（寄附後）"),"287,700円");
field("donationTrial").value="3000";
field("donationTrial").dispatchEvent(new Event("input",{bubbles:true}));
assert.equal(view.hidden,true);
rawSubmit();
assert.equal(trialValue("試算寄附額"),"3,000円");
assert.equal(trialValue("実質自己負担見込額"),"1,896円");
assert.equal(trialValue("2,000円超過額"),"0円");
// A silent amount mutation must prevent printing the previous trial.
field("donationTrial").value="5000";
dom.window.dispatchEvent(new Event("beforeprint"));
assert.equal(view.className,"result hold");
assert.equal(view.querySelector(".filing-trial"),null);
field("donationTrial").value="1999";rawSubmit();
assert.equal(view.className,"result");
assert.match(trialView().textContent,/任意寄附額の試算：HOLD/);
assert.equal(trialValue("実質自己負担見込額"),undefined);
field("donationTrial").value="";rawSubmit();
assert.equal(trialValue("試算寄附額"),"109,000円");
field("hasMortgage").checked=true;rawSubmit();
assert.equal(view.className,"result hold");
assert.equal(view.querySelector(".filing-trial"),null);
form.reset();
// Manual family route. Never remove the original OCR source conditions.
field("year").value="2025";field("filing").value="one-stop";
field("municipality").value="standard";field("salaryGross").value="6500000";
field("socialInsurance").value="1340000";field("hasSpouse").checked=true;
field("hasDependents").checked=true;
field("familySpouseAge").value="40";field("familySpouseIncome").value="600000";
document.getElementById("familyAdd").click();
const member=key=>document.querySelector('#familyRelatives [data-family="'+key+'"]');
member("age").value="20";member("income").value="600000";
field("acknowledgedExclusions").checked=true;
rawSubmit();assert.equal(view.className,"result hold");
field("familyReviewed").checked=true;rawSubmit();
assert.equal(view.className,"result");
assert.equal(view.querySelector(".amount").textContent,"56,000円");
assert.match(view.textContent,/家族控除・手入力検証/);
field("year").value="2026";field("year").dispatchEvent(new Event("change",{bubbles:true}));
assert.equal(view.hidden,true);
assert.equal(field("familyReviewed").checked,false);
assert.equal(field("acknowledgedExclusions").checked,false);
field("familyReviewed").checked=true;field("acknowledgedExclusions").checked=true;rawSubmit();
assert.equal(view.className,"result");
assert.equal(view.querySelector(".amount").textContent,"53,000円");
assert.match(view.textContent,/1,010,000円/);
assert.match(view.textContent,/3,500円/);
// Silent edits cannot print the prior household result.
member("income").value="850001";
dom.window.dispatchEvent(new Event("beforeprint"));
assert.equal(view.className,"result hold");assert.equal(view.querySelector(".amount"),null);
member("income").value="600000";
member("income").dispatchEvent(new Event("input",{bubbles:true}));
assert.equal(field("familyReviewed").checked,false);
field("familyReviewed").checked=true;field("acknowledgedExclusions").checked=true;
field("deductionsReference").value="1";rawSubmit();
assert.equal(view.className,"result hold");
field("deductionsReference").value="3390000";rawSubmit();
assert.equal(view.className,"result");
field("hasMortgage").checked=true;rawSubmit();assert.equal(view.className,"result hold");
field("hasMortgage").checked=false;
form.dataset.ocrYear="2026";rawSubmit();assert.equal(view.className,"result hold");
delete form.dataset.ocrYear;
form.dataset.ocrReviewPending="true";field("correctedSourceReviewed").checked=true;rawSubmit();
assert.equal(view.className,"result hold");
delete form.dataset.ocrReviewPending;
field("hasDependents").checked=false;rawSubmit();assert.equal(view.className,"result hold");
field("hasDependents").checked=true;
field("deductionsReference").value="";
field("familySpouseAge").value="";rawSubmit();assert.equal(view.className,"result hold");
field("familySpouseAge").value="40";rawSubmit();assert.equal(view.className,"result");
document.querySelector("#familyRelatives button").click();
assert.equal(view.hidden,true);assert.equal(field("familyReviewed").checked,false);
field("familyReviewed").checked=true;field("acknowledgedExclusions").checked=true;
rawSubmit();assert.equal(view.className,"result hold");
form.reset();assert.equal(document.querySelectorAll("#familyRelatives .family-relative").length,0);
assert.equal(field("familySpouseAge").value,"");assert.equal(field("familyReviewed").checked,false);
// Synthetic transferred original (2025) and separately entered forecast (2026).
field("year").value="2026";field("municipality").value="standard";
field("salaryGross").value="6500000";field("socialInsurance").value="1340000";
field("salaryIncomeReference").value="4760000";field("deductionsReference").value="3030000";
form.dataset.ocrYear="2025";form.dataset.ocrOriginalGross="6500000";
form.dataset.ocrOriginalIncome="4760000";form.dataset.ocrOriginalSocial="1340000";
form.dataset.ocrOriginalDeductions="3030000";form.dataset.ocrSourceIndicators="hasDependents";
field("hasSpouse").checked=true;field("hasDependents").checked=true;
field("familySpouseAge").value="41";field("familySpouseIncome").value="600000";
document.getElementById("familyAdd").click();member("age").value="21";member("income").value="600000";
field("sourceSpouseAge").value="40";field("sourceSpouseIncome").value="600000";
document.getElementById("sourceFamilyAdd").click();
const originalMember=key=>document.querySelector('#sourceFamilyRelatives [data-family="'+key+'"]');
originalMember("age").value="20";originalMember("income").value="600000";
field("familyReviewed").checked=true;field("forecastReviewed").checked=true;
field("acknowledgedExclusions").checked=true;rawSubmit();assert.equal(view.className,"result hold");
field("sourceFamilyReviewed").checked=true;rawSubmit();assert.equal(view.className,"result");
assert.equal(view.querySelector(".amount").textContent,"53,000円");
assert.match(view.textContent,/参照源泉票：2025年分 ／ 試算対象：2026年分/);
assert.match(view.textContent,/3,030,000円/);assert.match(view.textContent,/3,390,000円/);
form.dataset.ocrSourceIndicators="hasDependents,hasMortgage";rawSubmit();assert.equal(view.className,"result hold");
form.dataset.ocrSourceIndicators="hasDependents";
form.dataset.ocrOriginalDeductions="3030001";rawSubmit();assert.equal(view.className,"result hold");
form.dataset.ocrOriginalDeductions="3030000";
field("forecastReviewed").checked=false;rawSubmit();assert.equal(view.className,"result hold");
field("forecastReviewed").checked=true;
originalMember("income").value="950001";rawSubmit();assert.equal(view.className,"result hold");
originalMember("income").value="600000";rawSubmit();assert.equal(view.className,"result");
originalMember("age").value="22";originalMember("age").dispatchEvent(new Event("input",{bubbles:true}));
assert.equal(field("sourceFamilyReviewed").checked,false);assert.equal(view.hidden,true);
form.dispatchEvent(new Event("family-source-reset"));
assert.equal(document.querySelectorAll("#sourceFamilyRelatives .family-relative").length,0);
assert.equal(field("sourceSpouseAge").value,"");assert.equal(field("familyReviewed").checked,false);
form.reset();assert.equal(form.dataset.ocrOriginalIncome,undefined);
// Insurance-only manual calculation must also use explicitly reviewed family facts.
field("year").value="2026";field("municipality").value="standard";
field("salaryGross").value="7000000";field("socialInsurance").value="1000000";
field("hasLifeInsurance").checked=true;field("targetInsurance_generalNew").value="120000";
field("familyReviewed").checked=true;field("acknowledgedExclusions").checked=true;
rawSubmit();assert.equal(view.className,"result hold");
field("insuranceReviewed").checked=true;rawSubmit();assert.equal(view.className,"result");
assert.match(view.textContent,/特例：対象外/);
field("hasLifeInsurance").checked=false;rawSubmit();assert.equal(view.className,"result hold");
field("hasLifeInsurance").checked=true;
field("targetInsurance_generalNew").value="bad";rawSubmit();assert.equal(view.className,"result hold");
form.reset();
// Shared-child relief affects insurance only, never the family deduction.
field("year").value="2026";field("municipality").value="standard";
field("salaryGross").value="7000000";field("socialInsurance").value="1000000";
field("hasLifeInsurance").checked=true;field("targetInsurance_generalNew").value="120000";
field("targetInsurance_otherClaimUnder23").checked=true;
field("familyReviewed").checked=true;field("insuranceReviewed").checked=true;field("acknowledgedExclusions").checked=true;
rawSubmit();assert.equal(view.className,"result",view.textContent);
assert.match(view.textContent,/特例：適用/);
assert.match(view.textContent,/実際の納付・還付額とは異なります/);
const sharedChildValues=Object.fromEntries([...view.querySelectorAll("details dt")].map(dt=>[dt.textContent,dt.nextElementSibling.textContent]));
assert.equal(sharedChildValues["生命保険料控除（所得税）"],"60,000円");
assert.equal(sharedChildValues["生命保険料控除（住民税）"],"28,000円");
assert.equal(sharedChildValues["所得税家族控除"],"0円");
assert.equal(sharedChildValues["住民税家族控除"],"0円");
field("targetInsurance_otherClaimUnder23").checked=false;
field("targetInsurance_otherClaimUnder23").dispatchEvent(new Event("change",{bubbles:true}));
assert.equal(field("insuranceReviewed").checked,false);assert.equal(view.hidden,true);
field("familyReviewed").checked=true;field("insuranceReviewed").checked=true;field("acknowledgedExclusions").checked=true;
rawSubmit();assert.equal(view.className,"result");assert.match(view.textContent,/特例：対象外/);
form.reset();
// Synthetic prior-year source with both family and insurance deductions.
field("year").value="2026";field("municipality").value="standard";
field("salaryGross").value="6500000";field("socialInsurance").value="1340000";
field("salaryIncomeReference").value="4760000";field("deductionsReference").value="3120000";
form.dataset.ocrYear="2025";form.dataset.ocrOriginalGross="6500000";
form.dataset.ocrOriginalIncome="4760000";form.dataset.ocrOriginalSocial="1340000";
form.dataset.ocrOriginalDeductions="3120000";form.dataset.ocrSourceIndicators="hasDependents,hasLifeInsurance,hasEarthquakeInsurance";
field("hasSpouse").checked=true;field("hasDependents").checked=true;
field("hasLifeInsurance").checked=true;field("hasEarthquakeInsurance").checked=true;
field("familySpouseAge").value="41";field("familySpouseIncome").value="600000";
document.getElementById("familyAdd").click();member("age").value="21";member("income").value="600000";
field("sourceSpouseAge").value="40";field("sourceSpouseIncome").value="600000";
document.getElementById("sourceFamilyAdd").click();
originalMember("age").value="20";originalMember("income").value="600000";
field("sourceInsurance_generalNew").value="120000";
field("sourceInsurance_earthquake").value="50000";
field("targetInsurance_generalOld").value="12345";
field("insuranceReviewed").checked=true;field("acknowledgedExclusions").checked=true;
document.getElementById("copySourcePremiums").click();
assert.equal(field("targetInsurance_generalNew").value,"120000");
assert.equal(field("targetInsurance_earthquake").value,"50000");
assert.equal(field("targetInsurance_generalOld").value,"");
assert.equal(field("insuranceReviewed").checked,false);
assert.equal(field("acknowledgedExclusions").checked,false);
assert.equal(field("hasLifeInsurance").checked,true);assert.equal(field("hasEarthquakeInsurance").checked,true);
field("sourceInsurance_generalNew").value="bad";document.getElementById("copySourcePremiums").click();
assert.equal(field("targetInsurance_generalNew").value,"120000");
field("sourceInsurance_generalNew").value="120000";
for(const name of ["familyReviewed","sourceFamilyReviewed","forecastReviewed","insuranceReviewed","acknowledgedExclusions"])
 field(name).checked=true;
rawSubmit();assert.equal(view.className,"result hold");
field("sourceInsuranceReviewed").checked=true;rawSubmit();assert.equal(view.className,"result");
assert.equal(view.querySelector(".amount").textContent,"51,000円");
assert.match(view.textContent,/特例：適用/);
assert.match(view.textContent,/3,120,000円/);assert.match(view.textContent,/3,500,000円/);
const insuredValues=Object.fromEntries([...view.querySelectorAll("details dt")].map(dt=>[dt.textContent,dt.nextElementSibling.textContent]));
assert.equal(insuredValues["生命保険料控除（所得税）"],"60,000円");
assert.equal(insuredValues["生命保険料控除（住民税）"],"28,000円");
assert.equal(insuredValues["地震保険料控除（所得税）"],"50,000円");
assert.equal(insuredValues["地震保険料控除（住民税）"],"25,000円");
assert.equal(insuredValues["原票年の保険料控除合計（照合済）"],"90,000円");
field("sourceInsurance_generalNew").value="0";rawSubmit();assert.equal(view.className,"result hold");
field("sourceInsurance_generalNew").value="120000";rawSubmit();assert.equal(view.className,"result");
field("targetInsurance_generalNew").value="80000";
dom.window.dispatchEvent(new Event("beforeprint"));
assert.equal(view.className,"result hold");assert.equal(view.querySelector(".amount"),null);
field("targetInsurance_generalNew").value="120000";
field("targetInsurance_generalNew").dispatchEvent(new Event("input",{bubbles:true}));
for(const name of ["familyReviewed","sourceFamilyReviewed","forecastReviewed","insuranceReviewed","sourceInsuranceReviewed","acknowledgedExclusions"])
 assert.equal(field(name).checked,false);
for(const name of ["familyReviewed","sourceFamilyReviewed","forecastReviewed","insuranceReviewed","sourceInsuranceReviewed","acknowledgedExclusions"])
 field(name).checked=true;
rawSubmit();assert.equal(view.className,"result");
form.dataset.ocrSourceIndicators+=",hasMortgage";rawSubmit();assert.equal(view.className,"result hold");
form.dispatchEvent(new Event("family-source-reset"));
assert.equal(field("sourceInsurance_generalNew").value,"");
assert.equal(field("sourceInsuranceReviewed").checked,false);
assert.equal(view.hidden,true);
form.reset();assert.equal(field("targetInsurance_generalNew").value,"");
assert.equal(field("insuranceReviewed").checked,false);
// Reviewed manual other deductions. A partial entry or a stale attestation
// never falls back to the simpler engine, and an imported source stays HOLD.
field("year").value="2026";field("municipality").value="standard";
field("salaryGross").value="7000000";field("socialInsurance").value="1000000";
field("targetOther_self").value="ordinary";field("targetOther_contribution").value="120000";
for(const name of ["familyReviewed","insuranceReviewed","acknowledgedExclusions"])field(name).checked=true;
rawSubmit();assert.equal(view.className,"result hold");
field("otherReviewed").checked=true;rawSubmit();assert.equal(view.className,"result");
const otherValues=Object.fromEntries([...view.querySelectorAll("details dt")].map(dt=>[dt.textContent,dt.nextElementSibling.textContent]));
assert.equal(otherValues["社会保険料（内書き掛金を除く）"],"880,000円");
assert.equal(otherValues["小規模企業共済等掛金（内書き）"],"120,000円");
assert.equal(otherValues["その他所得控除（所得税・掛金含む）"],"390,000円");
assert.equal(otherValues["所得控除合計（自動算定）"],"1,940,000円");
assert.equal(otherValues["住民税所得控除合計"],"1,690,000円");
field("targetOther_contribution").value="1000001";rawSubmit();assert.equal(view.className,"result hold");
field("targetOther_contribution").value="120000";rawSubmit();assert.equal(view.className,"result");
field("medicalNetPaidYen").value="bad";rawSubmit();assert.equal(view.className,"result hold");
field("medicalNetPaidYen").value="";rawSubmit();assert.equal(view.className,"result");
form.dataset.ocrYear="2025";rawSubmit();assert.equal(view.className,"result hold");delete form.dataset.ocrYear;
rawSubmit();assert.equal(view.className,"result");
field("targetOther_contribution").value="130000";dom.window.dispatchEvent(new Event("beforeprint"));
assert.equal(view.className,"result hold");assert.equal(view.querySelector(".amount"),null);
field("targetOther_contribution").dispatchEvent(new Event("input",{bubbles:true}));
assert.equal(view.hidden,true);assert.equal(field("otherReviewed").checked,false);
assert.equal(field("insuranceReviewed").checked,false);assert.equal(field("acknowledgedExclusions").checked,false);
form.reset();assert.equal(field("targetOther_contribution").value,"");assert.equal(field("targetOther_self").value,"none");
assert.equal(field("otherReviewed").checked,false);
field("year").value="2026";field("municipality").value="standard";
field("salaryGross").value="7000000";field("socialInsurance").value="1000000";
field("hasDependents").checked=true;document.getElementById("familyAdd").click();
member("age").value="15";member("income").value="0";
const disability=document.querySelector("#familyRelatives [data-other-disability]");
disability.value="ordinary";
for(const name of ["familyReviewed","insuranceReviewed","otherReviewed","acknowledgedExclusions"])field(name).checked=true;
rawSubmit();assert.equal(view.className,"result");
assert.match(view.textContent,/その他所得控除（所得税・掛金含む）270,000円/);
disability.value="special";disability.dispatchEvent(new Event("change",{bubbles:true}));
assert.equal(field("otherReviewed").checked,false);assert.equal(view.hidden,true);
form.reset();
// Prior-year reviewed other deductions: retain the original tax year and
// the G26 combined amount, independently of the current-year estimate.
field("year").value="2026";field("municipality").value="standard";
field("salaryGross").value="7000000";field("socialInsurance").value="1000000";
field("deductionsReference").value="1900000";
form.dataset.ocrYear="2025";form.dataset.ocrOriginalGross="7000000";
form.dataset.ocrOriginalIncome="5200000";form.dataset.ocrOriginalSocial="1000000";
form.dataset.ocrOriginalDeductions="1900000";
for(const prefix of ["target","source"]){
 field(prefix+"Other_self").value="ordinary";field(prefix+"Other_contribution").value="120000";
}
for(const name of ["familyReviewed","sourceFamilyReviewed","forecastReviewed","insuranceReviewed","sourceInsuranceReviewed","otherReviewed","acknowledgedExclusions"])field(name).checked=true;
rawSubmit();assert.equal(view.className,"result hold",view.textContent);
field("sourceOtherReviewed").checked=true;rawSubmit();assert.equal(view.className,"result",view.textContent);
const srcValues=Object.fromEntries([...view.querySelectorAll("details dt")].map(dt=>[dt.textContent,dt.nextElementSibling.textContent]));
assert.equal(srcValues["原票年の所得控除合計（照合済）"],"1,900,000円");
assert.equal(srcValues["所得控除合計（自動算定）"],"1,940,000円");
assert.equal(srcValues["原票年の内書き掛金（照合済）"],"120,000円");
field("sourceOther_self").value="none";rawSubmit();assert.equal(view.className,"result hold");
field("sourceOther_self").value="ordinary";rawSubmit();assert.equal(view.className,"result");
form.dataset.ocrSourceIndicators="hasNonstandardConditions";rawSubmit();assert.equal(view.className,"result hold");
delete form.dataset.ocrSourceIndicators;
field("sourceOther_contribution").value="120001";field("sourceOther_contribution").dispatchEvent(new Event("input",{bubbles:true}));
assert.equal(field("sourceOtherReviewed").checked,false);assert.equal(field("otherReviewed").checked,false);assert.equal(view.hidden,true);
form.dispatchEvent(new Event("family-source-reset"));
assert.equal(field("sourceOther_contribution").value,"");assert.equal(field("sourceOther_self").value,"none");
form.reset();
// Net medical expenses only, no additional family/insurance review for basic salary.
field("year").value="2026";field("municipality").value="standard";
field("salaryGross").value="7000000";field("socialInsurance").value="1000000";
field("medicalNetPaidYen").value="300000";
field("acknowledgedExclusions").checked=true;rawSubmit();assert.equal(view.className,"result hold");
field("medicalNetPaidYen").dispatchEvent(new Event("input",{bubbles:true}));
assert.equal(field("filing").value,"return");
field("acknowledgedExclusions").checked=true;rawSubmit();assert.equal(view.className,"result",view.textContent);
const medicalValues=()=>Object.fromEntries([...view.querySelectorAll("details dt")].map(dt=>[dt.textContent,dt.nextElementSibling.textContent]));
assert.equal(medicalValues()["医療費控除額（所得税・住民税）"],"200,000円");
assert.equal(medicalValues()["補填後の医療費支払額"],"300,000円");
assert.equal(medicalValues()["医療費控除の足切額"],"100,000円");
assert.equal(medicalValues()["所得控除合計（自動算定）"],"1,870,000円");
assert.equal(medicalValues()["住民税所得控除合計"],"1,630,000円");
assert.equal(medicalValues()["ワンストップ参考上限"],undefined);
assert.match(view.textContent,/ワンストップ特例は利用できません/);
for(const bad of ["-1","100000000001","1.5","abc"]){field("medicalNetPaidYen").value=bad;rawSubmit();assert.equal(view.className,"result hold");}
field("medicalNetPaidYen").value="188000";rawSubmit();assert.equal(view.className,"result",view.textContent);
assert.equal(medicalValues()["医療費控除額（所得税・住民税）"],"88,000円");
field("medicalNetPaidYen").value="300000";
form.dataset.ocrYear="2025";form.dataset.ocrOriginalGross="7000000";
form.dataset.ocrOriginalIncome="5200000";form.dataset.ocrOriginalSocial="1000000";
form.dataset.ocrOriginalDeductions="1630000";field("deductionsReference").value="1630000";
field("forecastReviewed").checked=true;rawSubmit();assert.equal(view.className,"result",view.textContent);
assert.equal(medicalValues()["原票年の所得控除合計（照合済）"],"1,630,000円");
assert.equal(medicalValues()["所得控除合計（自動算定）"],"1,870,000円");
form.dataset.ocrOriginalDeductions="1830000";rawSubmit();assert.equal(view.className,"result hold");
form.dataset.ocrOriginalDeductions="1630000";rawSubmit();assert.equal(view.className,"result");
field("medicalNetPaidYen").value="100001";
dom.window.dispatchEvent(new Event("beforeprint"));assert.equal(view.className,"result hold");
field("medicalNetPaidYen").dispatchEvent(new Event("input",{bubbles:true}));
assert.equal(view.hidden,true);
form.reset();assert.equal(field("medicalNetPaidYen").value,"");
// High salary manual UI: derived income, independent adjustment witnesses,
 // no high salary imported source until the source UI is connected.
field("year").value="2026";field("municipality").value="standard";
field("salaryGross").value="9000000";field("socialInsurance").value="1000000";
function attestHigh(){for(const name of ["familyReviewed","insuranceReviewed","otherReviewed","adjustmentReviewed","acknowledgedExclusions"])field(name).checked=true;}
attestHigh();field("adjustmentReviewed").checked=false;rawSubmit();assert.equal(view.className,"result hold");
field("adjustmentReviewed").checked=true;rawSubmit();assert.equal(view.className,"result",view.textContent);
const highValues=()=>Object.fromEntries([...view.querySelectorAll("details dt")].map(dt=>[dt.textContent,dt.nextElementSibling.textContent]));
assert.equal(highValues()["所得金額調整控除後の給与所得"],"7,050,000円");
assert.equal(highValues()["所得金額調整控除"],"0円");
field("hasIncomeAdjustment").checked=true;rawSubmit();assert.equal(view.className,"result hold");
document.getElementById("adjustmentAdd").click();
const extra=document.querySelector("#adjustmentRelatives .adjustment-relative");
extra.querySelector('[data-adjustment="age"]').value="10";
extra.querySelector('[data-adjustment="income"]').value="0";
attestHigh();rawSubmit();assert.equal(view.className,"result",view.textContent);
assert.equal(highValues()["所得金額調整控除"],"50,000円");
assert.equal(highValues()["所得金額調整控除後の給与所得"],"7,000,000円");
assert.equal(highValues()["所得税家族控除"],"0円");
field("salaryIncomeReference").value="7050000";rawSubmit();assert.equal(view.className,"result hold");
field("salaryIncomeReference").value="";
field("salaryGross").value="20000000";rawSubmit();assert.equal(view.className,"result",view.textContent);
assert.equal(highValues()["所得金額調整控除"],"150,000円");
assert.equal(highValues()["所得金額調整控除後の給与所得"],"17,900,000円");
field("salaryGross").value="20000001";rawSubmit();assert.equal(view.className,"result hold");
field("salaryGross").value="20000000";
form.dataset.ocrYear="2025";rawSubmit();assert.equal(view.className,"result hold");delete form.dataset.ocrYear;
field("medicalNetPaidYen").value="300000";field("filing").value="return";attestHigh();
rawSubmit();assert.equal(view.className,"result",view.textContent);
assert.equal(highValues()["医療費控除額（所得税・住民税）"],"200,000円");
assert.equal(highValues()["ワンストップ参考上限"],undefined);
field("filing").value="one-stop";rawSubmit();assert.equal(view.className,"result hold");
field("filing").value="return";rawSubmit();assert.equal(view.className,"result");
extra.querySelector('[data-adjustment="age"]').value="23";
extra.querySelector('[data-adjustment="age"]').dispatchEvent(new Event("input",{bubbles:true}));
assert.equal(field("adjustmentReviewed").checked,false);assert.equal(view.hidden,true);
form.reset();assert.equal(document.getElementById("adjustmentRelatives").children.length,0);
assert.equal(field("adjustmentReviewed").checked,false);
// High-salary source-year review uses independent G46/G47 and retains
// positive OCR evidence, even if the current-year claim no longer applies.
field("year").value="2026";field("municipality").value="standard";
field("salaryGross").value="9000000";field("socialInsurance").value="1000000";
form.dataset.ocrYear="2025";form.dataset.ocrOriginalGross="9000000";
form.dataset.ocrOriginalIncome="7000000";form.dataset.ocrOriginalSocial="1000000";
form.dataset.ocrOriginalDeductions="1580000";form.dataset.ocrSourceIndicators="hasIncomeAdjustment";
field("deductionsReference").value="1580000";
document.getElementById("sourceAdjustmentAdd").click();
const sourceExtra=document.querySelector("#sourceAdjustmentRelatives .adjustment-relative");
sourceExtra.querySelector('[data-adjustment="age"]').value="10";
sourceExtra.querySelector('[data-adjustment="income"]').value="0";
function attestHighSource(){attestHigh();for(const name of ["sourceFamilyReviewed","sourceInsuranceReviewed","sourceOtherReviewed","sourceAdjustmentReviewed","forecastReviewed"])field(name).checked=true;}
attestHighSource();rawSubmit();assert.equal(view.className,"result hold");
field("sourceAdjustment_basic").value="580000";field("sourceAdjustment_amount").value="50000";
attestHighSource();rawSubmit();assert.equal(view.className,"result",view.textContent);
assert.equal(highValues()["原票年の給与所得（照合済）"],"7,000,000円");
assert.equal(highValues()["原票年の基礎控除額（G46・照合済）"],"580,000円");
assert.equal(highValues()["原票年の所得金額調整控除額（G47・照合済）"],"50,000円");
assert.equal(highValues()["所得金額調整控除"],"0円");
assert.equal(highValues()["所得控除合計（自動算定）"],"1,620,000円");
field("sourceAdjustment_amount").value="0";rawSubmit();assert.equal(view.className,"result hold");
field("sourceAdjustment_amount").value="50000";field("sourceAdjustment_basic").value="620000";rawSubmit();assert.equal(view.className,"result hold");
field("sourceAdjustment_basic").value="580000";rawSubmit();assert.equal(view.className,"result");
form.dataset.ocrSourceIndicators="hasIncomeAdjustment,hasMortgage";rawSubmit();assert.equal(view.className,"result hold");
form.dataset.ocrSourceIndicators="hasIncomeAdjustment";rawSubmit();assert.equal(view.className,"result");
field("sourceAdjustment_amount").value="50001";dom.window.dispatchEvent(new Event("beforeprint"));assert.equal(view.className,"result hold");
field("sourceAdjustment_amount").dispatchEvent(new Event("input",{bubbles:true}));
assert.equal(field("sourceAdjustmentReviewed").checked,false);assert.equal(view.hidden,true);
form.dispatchEvent(new Event("family-source-reset"));
assert.equal(field("sourceAdjustment_basic").value,"");assert.equal(field("sourceAdjustment_amount").value,"");
assert.equal(document.getElementById("sourceAdjustmentRelatives").children.length,0);
form.reset();
// Continuing mortgage: only the original source and four credit fields,
// no blank household or premium review and no loan balance entry.
field("year").value="2026";field("municipality").value="standard";
field("salaryGross").value="7000000";field("socialInsurance").value="1000000";
form.dataset.ocrYear="2025";form.dataset.ocrOriginalGross="7000000";
form.dataset.ocrOriginalIncome="5200000";form.dataset.ocrOriginalSocial="1000000";
form.dataset.ocrOriginalDeductions="1630000";form.dataset.ocrSourceIndicators="hasMortgage";
field("deductionsReference").value="1630000";
field("mortgageSourceApplied").value="286500";field("mortgageSourcePossible").value="500000";
field("mortgageMoveInYear").value="2021";field("mortgageCapClass").value="standard5";
field("forecastReviewed").checked=true;field("acknowledgedExclusions").checked=true;
rawSubmit();assert.equal(view.className,"result hold");
field("mortgageReviewed").checked=true;rawSubmit();assert.equal(view.className,"result",view.textContent);
const housingValues=()=>Object.fromEntries([...view.querySelectorAll("details dt")].map(dt=>[dt.textContent,dt.nextElementSibling.textContent]));
assert.equal(housingValues()["原票住宅ローン控除額（照合済）"],"286,500円");
assert.equal(housingValues()["寄附前所得税住宅ローン控除"],"278,500円");
assert.equal(housingValues()["寄附前住民税住宅ローン控除"],"97,500円");
assert.match(view.textContent,/住宅ローン残高の変動は考慮していません/);
assert.equal(field("familyReviewed").checked,false);
for(const [applied,possible,reason] of [["","500000",/G29.*未入力/],["0","500000",/0円.*一致しません/],["0","",/0円.*個別確認/]]){
 field("mortgageSourceApplied").value=applied;field("mortgageSourcePossible").value=possible;rawSubmit();
 assert.equal(view.className,"result hold");assert.match(view.textContent,reason);assert.equal(view.querySelector(".amount"),null);
}
field("mortgageSourcePossible").value="500000";
field("mortgageSourceApplied").value="286499";rawSubmit();assert.equal(view.className,"result hold");
field("mortgageSourceApplied").value="10000";field("mortgageSourcePossible").value="";
rawSubmit();assert.equal(view.className,"result",view.textContent);
assert.equal(housingValues()["試算住宅ローン控除可能額"],"10,000円");
field("medicalNetPaidYen").value="300000";field("filing").value="return";
rawSubmit();assert.equal(view.className,"result",view.textContent);
assert.equal(housingValues()["医療費控除額（所得税・住民税）"],"200,000円");
assert.equal(housingValues()["ワンストップ参考上限"],undefined);
field("mortgageSourceApplied").value="10001";dom.window.dispatchEvent(new Event("beforeprint"));assert.equal(view.className,"result hold");
field("mortgageSourceApplied").dispatchEvent(new Event("input",{bubbles:true}));
assert.equal(field("mortgageReviewed").checked,false);assert.equal(view.hidden,true);
form.dispatchEvent(new Event("family-source-reset"));
assert.equal(field("mortgageSourceApplied").value,"");assert.equal(field("mortgageSourcePossible").value,"");
form.reset();
// Cross-route acceptance: use real single-form DOM + batch core on the
// same synthetic mortgage facts. Never use an actual tax slip in CI.
const parityBatch=require("../src/batch-core.js");
const parityYen=n=>n.toLocaleString("ja-JP")+"円";
let mortgageParityCases=0;
for(const sy of [2025,2026])for(const y of [sy,...(sy===2025?[2026]:[])])
for(const municipality of ["standard","designated"])for(const filing of ["one-stop","return"])
for(const capClass of ["standard5","transitional7"])for(const possible of [10000,500000])
for(const medical of [false,true]){
 if(medical&&filing==="one-stop")continue;
 form.reset();
 const applied=possible===10000?10000:sy===2025?286500:278500;
 const deductions=sy===2025?1630000:1670000;
 const credit={mortgageSourceApplied:String(applied),mortgageSourcePossible:possible===10000?"":String(possible),mortgageMoveInYear:"2021",mortgageCapClass:capClass};
 Object.assign(form.dataset,{ocrYear:String(sy),ocrOriginalGross:"7000000",ocrOriginalIncome:"5200000",ocrOriginalSocial:"1000000",ocrOriginalDeductions:String(deductions),ocrSourceIndicators:"hasMortgage"});
 for(const [k,v] of Object.entries({year:String(y),municipality,filing,salaryGross:"7000000",salaryIncomeReference:"5200000",socialInsurance:"1000000",deductionsReference:String(deductions),...credit}))field(k).value=v;
 if(medical)field("medicalNetPaidYen").value="300000";
 field("forecastReviewed").checked=y!==sy;field("acknowledgedExclusions").checked=true;field("mortgageReviewed").checked=true;
 rawSubmit();assert.equal(view.className,"result",view.textContent);
 const row=parityBatch.fromPage(1,{year:sy,eligibleForManualTransfer:true,sourceIndicators:{hasMortgage:true},candidates:{salaryGross:7000000,salaryIncomeReference:5200000,socialInsurance:1000000,deductionsReference:deductions}},y);
 row.municipality=municipality;row.filing=filing;
 for(const [k,v] of Object.entries(credit))parityBatch.edit(row,k,v);
 if(medical)parityBatch.edit(row,"medicalNetPaidYen","300000");
 Object.assign(row,{confirmed:true,noExclusions:true,forecastReviewed:y!==sy,mortgageReviewed:true});
 const w=dom.window;
 const calculateParity=()=>parityBatch.calculate(row,w.FurusatoEngine,w.FurusatoEstimateGuard.canDisplayEstimate,w.FurusatoEstimateGuard.selectedReference,w.FurusatoResidentLevy,w.FurusatoFamilyTax,w.FurusatoFamilySource);
 calculateParity();assert.equal(parityBatch.canOutputEstimate(row),true,row.reason);
 assert.equal(view.querySelector(".amount").textContent,parityYen(row.donationLimitYen));
 const values=housingValues();
 assert.equal(values["確定申告参考上限（千円刻み）"],parityYen(row.comparison.filing));
 assert.equal(values["ワンストップ参考上限"],medical?undefined:parityYen(row.comparison.oneStop));
 assert.equal(values["原票住宅ローン控除額（照合済）"],parityYen(row.mortgageSummary.sourceAppliedYen));
 assert.equal(values["試算住宅ローン控除可能額"],parityYen(row.mortgageSummary.possibleYen));
 assert.equal(values["寄附前所得税住宅ローン控除"],parityYen(row.mortgageSummary.nationalHousingYen));
 assert.equal(values["寄附前住民税住宅ローン控除"],parityYen(row.mortgageSummary.residentHousingYen));
 assert.equal(values["実質自己負担見込額"],parityYen(row.comparison.trial.selfPay));
 assert.equal(values["2,000円超過額"],parityYen(row.comparison.trial.excess));
 if(y!==sy){assert.match(view.textContent,/住宅ローン残高の変動は考慮していません/);assert.match(row.reason,/住宅ローン残高の変動は考慮していません/);}
 // Revoking the mortgage review must block both routes including CSV.
 field("mortgageReviewed").checked=false;rawSubmit();
 row.mortgageReviewed=false;assert.equal(parityBatch.canOutputEstimate(row),false);
 assert.equal(view.className,"result hold");assert.equal(view.querySelector(".amount"),null);
 const csv=parityBatch.csv([row]).split("\r\n")[1].split(",");
 assert.equal(csv[11],'""');assert.equal(csv[12],'"HOLD"');
 calculateParity();assert.equal(row.status,"HOLD");assert.equal(row.donationLimitYen,null);
 mortgageParityCases++;
}
assert.equal(mortgageParityCases,72);
form.reset();
// Native disclosure is presentation only: required source/target inputs remain auditable.
const foldIds=["familyPanelFold","sourceFamilyPanelFold","targetInsurancePanelFold","targetOtherPanelFold","salaryAdjustmentPanelFold","sourceAdjustmentPanelFold","sourceOtherPanelFold","sourceInsurancePanelFold","mortgagePanel"];
for(const id of foldIds)assert.equal(document.getElementById(id).open,false,id);
field("hasLifeInsurance").checked=true;field("hasLifeInsurance").dispatchEvent(new Event("change",{bubbles:true}));
assert.equal(document.getElementById("targetInsurancePanelFold").open,true);
assert.equal(document.getElementById("sourceInsurancePanelFold").open,false);
field("year").value="2026";field("municipality").value="standard";
field("salaryGross").value="7000000";field("socialInsurance").value="1000000";
field("targetInsurance_generalNew").value="120000";
field("familyReviewed").checked=true;field("insuranceReviewed").checked=true;field("acknowledgedExclusions").checked=true;
rawSubmit();assert.equal(view.className,"result",view.textContent);
const visibleAmount=view.querySelector(".amount").textContent;
document.getElementById("targetInsurancePanelFold").open=false;
rawSubmit();assert.equal(view.className,"result");assert.equal(view.querySelector(".amount").textContent,visibleAmount);
field("targetInsurance_generalNew").value="bad";rawSubmit();assert.equal(view.className,"result hold");
form.reset();
form.dataset.ocrYear="2025";form.dataset.ocrOriginalGross="9000000";form.dataset.ocrSourceIndicators="hasMortgage,hasLifeInsurance,hasDependents";
form.dispatchEvent(new Event("ocr-source-transferred"));
for(const id of ["mortgagePanel","familyPanelFold","sourceFamilyPanelFold","targetInsurancePanelFold","sourceInsurancePanelFold","sourceAdjustmentPanelFold","sourceOtherPanelFold"])assert.equal(document.getElementById(id).open,true,id);
assert.equal(field("mortgageReviewed").checked,false);assert.equal(field("sourceInsuranceReviewed").checked,false);
form.reset();
for(const id of foldIds)assert.equal(document.getElementById(id).open,false,id);
// Explicit prior-year basic confirmation never approves detailed deductions.
field("year").value="2026";field("municipality").value="standard";
field("salaryGross").value="7000000";field("socialInsurance").value="1000000";
form.dataset.ocrYear="2025";form.dataset.ocrOriginalGross="7000000";
form.dataset.ocrOriginalIncome="5200000";form.dataset.ocrOriginalSocial="1000000";form.dataset.ocrOriginalDeductions="1630000";
form.dispatchEvent(new Event("ocr-source-transferred"));
assert.equal(document.getElementById("confirmBasicForecast").hidden,false);
document.getElementById("confirmBasicForecast").click();
assert.equal(field("forecastReviewed").checked,true);assert.equal(field("acknowledgedExclusions").checked,true);
assert.equal(field("sourceFamilyReviewed").checked,false);assert.equal(field("mortgageReviewed").checked,false);
assert.equal(field("correctedSourceReviewed").checked,false);
field("socialInsurance").value="1100000";field("socialInsurance").dispatchEvent(new Event("input",{bubbles:true}));
assert.equal(field("forecastReviewed").checked,false);assert.equal(field("acknowledgedExclusions").checked,false);
form.dataset.ocrReviewPending="true";document.getElementById("confirmBasicForecast").click();
assert.equal(field("forecastReviewed").checked,false);assert.equal(field("acknowledgedExclusions").checked,false);
form.reset();assert.equal(document.getElementById("confirmBasicForecast").hidden,true);
// Source-year counts survive the transfer and are removed on reset.
form.dataset.ocrYear="2025";form.dataset.ocrSourceIndicators="hasDependents";
form.dataset.ocrFamilyCountHints=JSON.stringify({familySpecificCount:1,familyUnder16Count:2});
form.dispatchEvent(new Event("ocr-source-transferred"));
assert.match(document.getElementById("sourceFamilyCountHints").textContent,/16歳未満の扶養親族：2人/);
assert.equal(document.getElementById("sourceFamilyPanelFold").open,true);
assert.equal(field("sourceFamilyReviewed").checked,false);
form.dispatchEvent(new Event("family-source-reset"));
assert.equal(form.dataset.ocrFamilyCountHints,undefined);
assert.equal(document.getElementById("sourceFamilyCountHints").textContent,"");
form.reset();
field("year").value="2026";form.dataset.ocrYear="2025";
field("sourceSpouseAge").value="40";field("sourceSpouseIncome").value="600000";
document.getElementById("sourceFamilyAdd").click();originalMember("age").value="15";originalMember("income").value="0";
field("familyReviewed").checked=true;field("forecastReviewed").checked=true;
document.getElementById("copySourceFamily").click();
assert.equal(field("familySpouseAge").value,"41");assert.equal(field("familySpouseIncome").value,"600000");
assert.equal(member("age").value,"16");assert.equal(originalMember("age").value,"15");
assert.equal(field("familyReviewed").checked,false);assert.equal(field("forecastReviewed").checked,false);
originalMember("age").value="130";document.getElementById("copySourceFamily").click();assert.equal(member("age").value,"16");
form.reset();
// Simulate page lifecycle without claiming physical browser BFCache evidence.
function historyEvent(type,persisted){
 const ev=new dom.window.Event(type);Object.defineProperty(ev,"persisted",{value:persisted});
 dom.window.dispatchEvent(ev);
}
for(const type of ["pagehide","pageshow"]){
 field("year").value="2026";field("municipality").value="standard";
 field("salaryGross").value="7000000";field("socialInsurance").value="1000000";
 field("acknowledgedExclusions").checked=true;rawSubmit();
 assert.equal(view.className,"result");assert.equal(view.hidden,false);
 form.dataset.ocrOriginalGross="7000000";
 historyEvent(type,true);
 assert.equal(field("salaryGross").value,"");
 assert.equal(field("socialInsurance").value,"");
 assert.equal(field("acknowledgedExclusions").checked,false);
 assert.equal(form.dataset.ocrOriginalGross,undefined);
 assert.equal(view.hidden,true);assert.equal(view.textContent,"");
}
field("salaryGross").value="7000000";historyEvent("pageshow",false);
assert.equal(field("salaryGross").value,"7000000");
form.reset();dom.window.close();
console.log("PUBLIC_WEB_STATIC_AND_BROWSER_SYNTHETIC_PASS; no network; ads off; deploy off");
