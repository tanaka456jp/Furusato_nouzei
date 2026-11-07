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
      assert.match(await page.locator("#splitOutput").innerText(), /1,911/);
      await page.emulateMedia({media:"print"});
      assert.equal(await page.locator("#splitForm").isVisible(), false);
      assert.equal(await page.locator("#resultScreen").isVisible(), false);
      assert.equal(await page.locator("#splitOutput").isVisible(), true);
      await page.emulateMedia({media:"screen"});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, profile.name);
      await page.screenshot({path:path.join(out,profile.name+".png"),fullPage:true});
      await page.locator("#split-listedStock").fill("4000000");
      assert.ok(!/55,000/.test(await page.locator("#splitOutput").innerText()));
      evidence.push({...profile, status:"PASS", scope:"synthetic Chromium viewport and scale"});
      await page.close();
    }
    // An old salary callback must not publish a result after entering another case.
    const page = await browser.newPage();
    await page.goto(source);
    await page.evaluate(() => {
      const run = window.google.script.run;
      run.runFurusatoSimulation = function (data) {
        const callback = this.onSuccess;
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
    await page.evaluate(() => {
      window.google.script.run.runFurusatoSimulation = function () { this.onSuccess({status:"ESTIMATE", donationLimitYen:99999}); };
    });
    await page.locator("#splitRun").click();
    await page.locator("#splitOutput").getByText(/SAFE-TAX-017/).waitFor();
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
