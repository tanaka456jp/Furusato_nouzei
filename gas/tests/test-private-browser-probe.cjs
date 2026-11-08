"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,"..");
const browser=fs.readFileSync(path.join(root,"tests","test-real-browser.cjs"),"utf8");
const launcher=fs.readFileSync(path.join(root,"scripts","check-live-ocr-readiness.cjs"),"utf8");
const guard=browser.indexOf("if(probe){results.push({id:'PRIVATE-WEBAPP-REACHABLE',status:'PASS'});return;}");
const firstMutation=browser.indexOf("await frame.locator('#next').click()");
assert.ok(guard>0&&firstMutation>guard,"Probe must exit before all app workflow interactions");
assert.ok(browser.includes("googleAcceptance:live&&!authorize&&!probe?status:'HOLD'"),"Probe must not claim real Google OCR acceptance");
assert.ok(browser.includes("probe?'browser-probe-evidence.json':authorize?"),"Probe must not overwrite previous OCR evidence");
assert.ok(browser.includes("probe?'REAL_GOOGLE_WEB_APP_PROBE':authorize?"),"Probe must distinguish test scope");
assert.ok(launcher.includes('if(process.env.CI&&(opt.run||opt.probe||opt.authorizeOwner))'),
 "CI must never run private owner consent, live probe or OCR");
assert.ok(launcher.includes('Number(choices.has("--probe-only"))+Number(choices.has("--run-synthetic"))+Number(choices.has("--authorize-owner"))'),
 "Probe, OCR and owner consent must be exclusive");
assert.ok(launcher.includes('OWNER_SYSTEM_BROWSER_OPENED: MANUAL_REVIEW_REQUIRED; OCR NOT EXECUTED'),
 "Native browser launch must not be reported as authentication PASS");
assert.ok(!launcher.includes('OWNER_WEB_APP_SESSION: PASS'),
 "Unverified owner authentication must never be labeled PASS");
assert.ok(launcher.includes('openOwnerSystemBrowser(receipt.webAppUrl)'),
 "Owner browser must open only the attested private URL");
assert.ok(browser.includes("if(live&&authorize)throw Error('OWNER_LOGIN_REQUIRES_SYSTEM_BROWSER')"),
 "Playwright sign-in must be refused before browser start");
assert.ok(!launcher.includes('"--token-auth"'),"The verified owner browser session must be reused");
const firstClick=browser.indexOf("await frame.locator('#next').click()");
const authorizeStart=browser.indexOf("if(authorize){");
const secondNavigation=browser.indexOf("await secondPage.goto(receipt.webAppUrl)");
const revalidate=browser.indexOf("const verified=await waitForWizard(()=>[secondPage],secondPage,30)");
const ownerPass=browser.indexOf("results.push({id:'OWNER-SAME-SESSION-PROBE',status:'PASS'})");
assert.ok(authorizeStart>0&&secondNavigation>authorizeStart&&revalidate>secondNavigation&&
 ownerPass>revalidate&&firstClick>ownerPass,
 "Owner consent must verify a second app navigation in same context before PASS, without wizard clicks");
assert.ok(browser.includes("headless:!(process.argv.includes('--headed')||authorize||(live&&!tokenAuth))"),
 "Live owner browser profile must stay headed across separate processes");
assert.ok(browser.includes("candidate.locator('#salaryGross').count()"),
 "Furusato wizard detection must not match generic Google consent buttons");
assert.ok(browser.includes("launchPersistentContext(path.join(root,'.private/furusato/browser-profile')"),
 "Private consent profile must be isolated and persistent");
assert.ok(browser.includes("authorize?'owner-auth-evidence.json':'browser-evidence.json'"),
 "Owner consent must not overwrite earlier OCR evidence");
assert.ok(launcher.includes('REAL_GOOGLE_WEB_APP_PROBE: PASS; OCR NOT EXECUTED'),"Probe console must state limited scope");
console.log("PRIVATE_GOOGLE_WEB_APP_PROBE_CONTRACT_PASS: no OCR, no Google mutation; synthetic test only");
