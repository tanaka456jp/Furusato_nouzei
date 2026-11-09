"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {pathToFileURL} = require("node:url");
const {chromium} = require("playwright");
const source = pathToFileURL(path.resolve(__dirname, "../dist/Furusato_GAS_LocalPreview.html")).href;
const out = path.resolve(__dirname, "../dist/acceptance/separate-ui");
const profiles = [
  {name:"1920x1080-100", width:1920,height:1080,dpi:1},
  {name:"1920x1080-125", width:1536,height:864,dpi:1.25},
  {name:"1366x768-150", width:910,height:512,dpi:1.5}
];
(async () => {
  fs.mkdirSync(out, {recursive:true});
  const browser = await chromium.launch({headless:true, ...(process.env.FURUSATO_BROWSER_CHANNEL ? {channel:process.env.FURUSATO_BROWSER_CHANNEL} : {})});
  const evidence = [];
  try {
    for (const profile of profiles) {
      const page = await browser.newPage({viewport:{width:profile.width,height:profile.height},deviceScaleFactor:profile.dpi});
      await page.goto(source);
      await page.locator("#splitMode").click();
      await page.locator("#split-listedStock").fill("5000000");
      await page.locator("#split-nationalDeductions").fill("1000000");
      await page.locator("#split-residentDeductions").fill("1000000");
      await page.locator("#split-personalDifference").fill("50000");
      await page.locator("#split-donation").fill("30000");
      await page.locator("#splitReviewed").check();
      await page.locator("#splitFiling").selectOption("one-stop");
      await page.locator("#splitRun").click();
      await page.locator("#splitOutput").getByText(/SAFE-TAX-012/).waitFor();
      assert.ok(!/55,000/.test(await page.locator("#splitOutput").innerText()));
      await page.locator("#splitFiling").selectOption("return");
      await page.locator("#splitRun").click();
      await page.locator("#splitOutput").getByText(/寄附目安 55,000/).waitFor();
      assert.match(await page.locator("#splitOutput").innerText(), /最大寄附額 55,771/);
      assert.match(await page.locator("#splitOutput").innerText(), /1,911/);
      await page.emulateMedia({media:"print"});
      assert.equal(await page.locator("#splitForm").isVisible(), false);
      assert.equal(await page.locator("#resultScreen").isVisible(), false);
      assert.equal(await page.locator("#splitOutput").isVisible(), true);
      assert.ok((await page.locator("#splitOutput").innerText()).includes("GAS検証版 v"+require("../package.json").version));
      await page.emulateMedia({media:"screen"});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, profile.name);
      await page.screenshot({path:path.join(out,profile.name+".png"),fullPage:true});
      await page.locator("#split-listedStock").fill("4000000");
      assert.ok(!/55,000/.test(await page.locator("#splitOutput").innerText()));
      evidence.push({...profile, status:"PASS", scope:"synthetic Chromium viewport and scale"});
      await page.close();
    }
    const draftPage = await browser.newPage();
    let approveDraftChange=true;
    draftPage.on("dialog",dialog=>approveDraftChange?dialog.accept():dialog.dismiss());
    await draftPage.goto(source);
    await draftPage.locator("#draftPanel summary").click();
    const downloadDraft = async mode => {
      const download = draftPage.waitForEvent("download");
      await draftPage.locator("#saveDraft").click();
      const saved = await download;
      assert.equal(saved.suggestedFilename(),"furusato-input-"+mode+".json");
      return JSON.parse(fs.readFileSync(await saved.path(),"utf8"));
    };
    const restoreDraft = async payload => {
      await draftPage.locator("#draftFile").setInputFiles({name:"draft.json",mimeType:"application/json",
        buffer:Buffer.from(JSON.stringify(payload))});
      await draftPage.locator("#loadDraft").click();
    };
    await draftPage.locator("#next").click();
    await draftPage.locator("#salaryGross").fill("7000000");
    await draftPage.locator("#socialInsurance").fill("1000000");
    await draftPage.locator("#ocrConsent").check();
    const salaryDraft = await downloadDraft("salary");
    assert.equal(salaryDraft.schema,"furusato-input-draft/v1");
    assert.equal(salaryDraft.values.salaryGross,"7000000");
    assert.equal(salaryDraft.values.ocrConsent,undefined);
    assert.equal(salaryDraft.values.ack,undefined);
    await draftPage.locator("#salaryGross").fill("5000000");
    await restoreDraft({...salaryDraft,values:{...salaryDraft.values,ack:true}});
    await draftPage.locator("#draftStatus").getByText(/不明な項目/).waitFor();
    assert.equal(await draftPage.locator("#salaryGross").inputValue(),"5000000");
    approveDraftChange=false;
    await restoreDraft(salaryDraft);
    await draftPage.locator("#draftStatus").getByText(/取り消しました/).waitFor();
    assert.equal(await draftPage.locator("#salaryGross").inputValue(),"5000000");
    await draftPage.locator("#newDraft").click();
    assert.equal(await draftPage.locator("#salaryGross").inputValue(),"5000000");
    approveDraftChange=true;
    await draftPage.locator("#newDraft").click();
    assert.equal(await draftPage.locator("#salaryGross").inputValue(),"");
    await restoreDraft(salaryDraft);
    await draftPage.locator("#draftStatus").getByText(/読み込みました/).waitFor();
    assert.equal(await draftPage.locator("#screen0").isVisible(),true);
    assert.equal(await draftPage.locator("#salaryGross").inputValue(),"7000000");
    assert.equal(await draftPage.locator("#ocrConsent").isChecked(),false);
    await draftPage.locator("#splitMode").click();
    await draftPage.locator("#split-listedStock").fill("5000000");
    await draftPage.locator("#splitReviewed").check();
    const splitDraft = await downloadDraft("separate");
    await draftPage.locator("#salaryMode").click();
    await restoreDraft(splitDraft);
    await draftPage.locator("#splitScreen").waitFor();
    assert.equal(await draftPage.locator("#split-listedStock").inputValue(),"5000000");
    assert.equal(await draftPage.locator("#splitReviewed").isChecked(),false);
    assert.equal(await draftPage.locator("#splitPrint").isVisible(),false);
    await draftPage.close();
    evidence.push({name:"local-draft-download-and-restore",status:"PASS"});
    // An old salary callback must not publish a result after entering another case.
    const page = await browser.newPage();
    await page.goto(source);
    await page.evaluate(() => {
      const run = window.google.script.run;
      const original = run.runFurusatoSimulation;
      run.runFurusatoSimulation = function (data) {
        const callback = this.onSuccess;
        run.runFurusatoSimulation = original;
        window.releaseSalary = () => callback(window.FurusatoEngine.calculate(data));
      };
    });
    await page.locator("#next").click();
    await page.locator("#salaryGross").fill("7000000");
    await page.locator("#socialInsurance").fill("1000000");
    await page.locator("#next").click();
    await page.locator("#ack").check();
    await page.locator("#next").click();
    await page.locator("#next").click();
    await page.locator("#splitMode").click();
    await page.locator("#salaryMode").click();
    await page.locator("#back").click();
    await page.locator("#back").click();
    await page.locator("#salaryGross").fill("5000000");
    await page.evaluate(() => window.releaseSalary());
    assert.equal(await page.locator("#resultScreen").isVisible(), false);
    evidence.push({name:"stale-salary-response",status:"PASS"});
    await page.locator("#splitMode").click();
    const edge = require("../../taxdata/separate-tax-local-v1.json").at(-1);
    for (const [key, value] of Object.entries(edge.input)) {
      const field = page.locator("#split-"+key);
      if (await field.count()) await field.fill(String(value));
    }
    await page.locator("#splitReviewed").check();
    await page.locator("#splitMunicipality").selectOption("other");
    await page.locator("#splitRun").click();
    await page.locator("#splitOutput").getByText(/SAFE-TAX-019/).waitFor();
    await page.locator("#splitMunicipality").selectOption("standard");
    await page.locator("#splitRun").click();
    await page.locator("#splitOutput").getByText(/430,000.*2,000円超/).waitFor();
    assert.match(await page.locator("#splitOutput").innerText(), /寄附目安 429,000/);
    evidence.push({name:"locality-hold-and-infeasible-rounded-amount",status:"PASS"});
    await page.evaluate(() => {
      window.google.script.run.runFurusatoSimulation = function () { this.onSuccess({status:"ESTIMATE", donationLimitYen:99999}); };
    });
    await page.locator("#splitRun").click();
    await page.locator("#splitOutput").getByText(/SAFE-TAX-017/).waitFor();
    assert.equal(await page.locator("#splitPrint").isVisible(),false);
    await page.evaluate(() => {
      const run = window.google.script.run;
      const input = {mode:"separate",year:2025,filing:"return",conditions:"reviewed",ordinary:0,shortLand:0,longLand:0,
        listedDividend:0,generalStock:0,listedStock:5000000,futures:0,nationalDeductions:1000000,
        residentDeductions:1000000,personalDifference:50000,donation:30000};
      const malformed = window.FurusatoEngine.calculate(input);
      malformed.calculation.atInput.residentAfter.pop();
      run.runFurusatoSimulation = function () { this.onSuccess(malformed); };
    });
    await page.locator("#splitRun").click();
    await page.locator("#splitOutput").getByText(/SAFE-TAX-017/).waitFor();
    assert.doesNotMatch(await page.locator("#splitOutput").innerText(), /NaN|55,000/);
    assert.equal(await page.locator("#splitPrint").isVisible(),false);
    await page.evaluate(() => {
      window.splitAttempts = 0;
      window.google.script.run.runFurusatoSimulation = function () {
        window.splitAttempts++;
        this.onFailure(new Error("temporary failure"));
      };
    });
    await page.locator("#splitRun").click();
    await page.locator("#splitOutput").getByText(/SAFE-ENV-003/).waitFor();
    assert.equal(await page.evaluate(() => window.splitAttempts),2);
    evidence.push({name:"malformed-response-and-bounded-retry",status:"PASS"});
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(out,"evidence.json"),JSON.stringify(evidence,null,2)+"\n");
  console.log("SEPARATE_UI_PASS 3 synthetic viewport and print profiles, HOLD recovery, response validation, bounded retry");
})().catch(error => {console.error(error.message);process.exitCode=1;});
