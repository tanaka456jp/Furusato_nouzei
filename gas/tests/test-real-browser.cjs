"use strict";
// Chromium rendering is real. Offline runs use the local preview's simulated GAS
// transport. --live uses the actual private Google deployment and server calls.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),cp=require('node:child_process');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),live=process.argv.includes('--live'),authorize=process.argv.includes('--authorize');
const {source,digest,accessToken}=require('../deployment/private-gas.cjs');
const tokenAuth=live&&process.argv.includes('--token-auth');
const {installOriginAuthorization}=require('../deployment/browser-auth.cjs');
const dest=path.join(root,live?'.private/furusato/evidence':'dist/acceptance');fs.mkdirSync(dest,{recursive:true});
const results=[];
async function main(){
 let context,browser;
 const launch={headless:!process.argv.includes('--headed')};
 if(process.env.FURUSATO_BROWSER_CHANNEL)launch.channel=process.env.FURUSATO_BROWSER_CHANNEL;
 let receipt;
 if(live){
  cp.execFileSync(process.execPath,[path.join(root,'deployment/private-gas.cjs'),'verify',
   ...(process.argv.includes('--attest-head')?['--attest-head']:[])],{stdio:'pipe'});
  receipt=JSON.parse(fs.readFileSync(path.join(root,'.private/furusato/receipt.json'),'utf8'));
  if(authorize)launch.headless=false;
  if(tokenAuth){
   assert.equal(authorize,false,'Token mode does not automate owner consent');
   const token=await accessToken();browser=await chromium.launch(launch);context=await browser.newContext();
   // Bearer is attached ONLY to script.google.com, never third-party requests.
   await installOriginAuthorization(context,'https://script.google.com',token);
  }else context=await chromium.launchPersistentContext(path.join(root,'.private/furusato/browser-profile'),launch);
 }else{browser=await chromium.launch(launch);context=await browser.newContext();}
 try{
  const page=await context.newPage();await page.setViewportSize({width:1280,height:900});
  await page.goto(live?receipt.webAppUrl:require('node:url').pathToFileURL(path.join(root,'dist/Furusato_GAS_LocalPreview.html')).href);
  let frame=page;
  if(live){
   // OAuth screens are never automated. The owner completes them, then reruns.
   if(authorize)console.log('OWNER_ACTION: complete Google login/app consent in dedicated browser (up to 10 minutes).');
   for(let i=0;i<(authorize?1200:20);i++){
    frame=undefined;
    for(const candidate of page.frames())if(await candidate.locator('#next').count()){frame=candidate;break;}
    if(frame)break;
    frame=undefined;await page.waitForTimeout(500);
   }
   if(!frame)throw new Error('AUTH_REQUIRED: rerun --live --authorize and complete owner login/consent');
   if(authorize){results.push({id:'OWNER-AUTHENTICATED-PAGE',status:'PASS'});return;}
  }
  await frame.locator('#next').click();await frame.locator('#salaryGross').fill('7000000');await frame.locator('#socialInsurance').fill('1000000');
  await frame.locator('#next').click();await frame.locator('#ack').check();await frame.locator('#next').click();await frame.locator('#next').click();
  await frame.locator('#reportAmount').filter({hasText:'109,000 円'}).waitFor({timeout:30000});results.push({id:'TAX-700',status:'PASS'});
  await page.screenshot({path:path.join(dest,'desktop-result.png'),fullPage:true});
  // Verify the actual print button dispatches print; export the print stylesheet.
  await frame.evaluate(()=>{window.__printCalled=false;window.print=()=>{window.__printCalled=true;};});
  await frame.locator('#print').click();assert.equal(await frame.evaluate(()=>window.__printCalled),true);
  await page.emulateMedia({media:'print'});await page.pdf({path:path.join(dest,'synthetic-report.pdf'),format:'A4',printBackground:true});
  assert.equal(fs.readFileSync(path.join(dest,'synthetic-report.pdf')).subarray(0,5).toString(),'%PDF-');
  cp.execFileSync(process.env.FURUSATO_PYTHON||'python',[path.join(__dirname,'assert-print-pdf.py'),path.join(dest,'synthetic-report.pdf')],{stdio:'pipe'});
  results.push({id:'PRINT-PDF',status:'PASS',boundary:'Chromium PDF export; physical printer/dialog HOLD'});
  await page.emulateMedia({media:'screen'});await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(dest,'mobile-result.png'),fullPage:true});
  const overflow=await frame.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1);
  assert.equal(overflow,false,'Mobile horizontal overflow');results.push({id:'MOBILE',status:'PASS'});
  await frame.locator('#edit').click();await frame.locator('#back').click();
  await frame.locator('[data-key="hasMortgage"]').check();await frame.locator('#next').click();await frame.locator('#next').click();
  await frame.locator('#reportAmount').filter({hasText:'計算停止'}).waitFor({timeout:30000});results.push({id:'HOLD-MORTGAGE',status:'PASS'});
  if(live){
   await frame.locator('#edit').click();await frame.locator('#back').click();await frame.locator('[data-key="hasMortgage"]').uncheck();await frame.locator('#back').click();
   const diagnostics=()=>frame.evaluate(()=>new Promise((resolve,reject)=>google.script.run.withSuccessHandler(resolve).withFailureHandler(()=>reject(new Error('Google runtime diagnostics failed'))).getFurusatoPrivateDiagnostics()));
   const before=await diagnostics();assert.equal(before.driveApi,'PASS');assert.equal(before.temporaryOcrFiles,0);assert.equal(before.hasMore,false);
   results.push({id:'GOOGLE-DRIVE-API',status:'PASS'});
   // Generate genuine PNG/JPEG/PDF synthetic fixtures using local font rendering.
   const fixture=await context.newPage();await fixture.setViewportSize({width:1100,height:900});
   await fixture.setContent('<meta charset="utf-8"><style>body{font:32px sans-serif;line-height:2;white-space:pre-wrap}</style>合成データ・試験専用\n令和8年分 給与所得の源泉徴収票\n支払金額 7,000,000 円\n社会保険料等の金額 1,000,000 円\n給与所得控除後の金額 5,200,000 円');
   await fixture.screenshot({path:path.join(dest,'synthetic-slip.png'),fullPage:true});
   await fixture.screenshot({path:path.join(dest,'synthetic-slip.jpeg'),fullPage:true,quality:95});
   await fixture.pdf({path:path.join(dest,'synthetic-slip.pdf'),format:'A4'});await fixture.close();
   for(const ext of ['png','pdf','jpeg']){
    // A zero-candidate OCR response must not inherit earlier manual/PNG values.
    if(await frame.locator('#clearImportedFile').isVisible())await frame.locator('#clearImportedFile').click();
    await frame.locator('#salaryGross').fill('');await frame.locator('#socialInsurance').fill('');
    await frame.locator('#back').click();await frame.locator('#year').selectOption('2025');await frame.locator('#next').click();
    await frame.locator('#ocrFile').setInputFiles(path.join(dest,'synthetic-slip.'+ext));await frame.locator('#ocrConsent').check();await frame.locator('#ocrRun').click();
    await frame.locator('#ocrResult').filter({hasText:/OCR完了|失敗|不正/}).waitFor({timeout:120000});
    assert.ok((await frame.locator('#ocrResult').textContent()).startsWith('OCR完了'),'Google OCR '+ext+' failed; inspect private app error and temporary-file status');
    assert.equal(await frame.locator('#salaryGross').inputValue(),'7000000');assert.equal(await frame.locator('#socialInsurance').inputValue(),'1000000');assert.equal(await frame.locator('#year').inputValue(),'2026');
    await frame.locator('#next').click();await frame.locator('#ack').check();await frame.locator('#next').click();await frame.locator('#next').click();
    await frame.locator('#reportAmount').filter({hasText:'計算停止'}).waitFor({timeout:30000});
    const after=await diagnostics();assert.equal(after.temporaryOcrFiles,0);assert.equal(after.hasMore,false);
    await page.screenshot({path:path.join(dest,'google-ocr-'+ext+'-hold.png'),fullPage:true});
    results.push({id:'GOOGLE-OCR-'+ext.toUpperCase(),status:'PASS',cleanup:'PASS',data:'SYNTHETIC'});
    await frame.locator('#edit').click();await frame.locator('#back').click();await frame.locator('#back').click();
   }
   await frame.locator('#splitMode').click();
   for(const [field,value] of Object.entries({listedStock:'5000000',nationalDeductions:'1000000',
      residentDeductions:'1000000',personalDifference:'50000',donation:'30000'}))
     await frame.locator('#split-'+field).fill(value);
   await frame.locator('#splitReviewed').check();
   await frame.locator('#splitFiling').selectOption('one-stop');
   await frame.locator('#splitRun').click();
   await frame.locator('#splitOutput').getByText(/SAFE-TAX-012/).waitFor({timeout:30000});
   assert.equal(await frame.locator('#splitPrint').isVisible(),false);
   await frame.locator('#splitFiling').selectOption('return');
   await frame.locator('#splitRun').click();
   await frame.locator('#splitOutput').getByText(/最大寄附額 55,771 円/).waitFor({timeout:30000});
   assert.match(await frame.locator('#splitOutput').innerText(),/1,911 円/);
   await page.screenshot({path:path.join(dest,'google-split-exact.png'),fullPage:true});
   results.push({id:'GOOGLE-SPLIT-EXACT-HOLD-RECOVERY',status:'PASS'});
   await frame.locator('#splitMunicipality').selectOption('designated');
   await frame.locator('#splitRun').click();
   await frame.locator('#splitOutput').getByText(/標準指定都市/).waitFor({timeout:30000});
   assert.match(await frame.locator('#splitOutput').innerText(),/最大寄附額 55,771 円/);
   results.push({id:'GOOGLE-SPLIT-DESIGNATED-CITY',status:'PASS'});
  }
 }finally{await context.close();if(browser)await browser.close();}
}
main().then(()=>finish('PASS')).catch(e=>{console.error(e.message);finish('HOLD');process.exitCode=1;});
function finish(status){
 const evidence={status,release:'HOLD',data:'SYNTHETIC',environment:authorize?'GOOGLE_OWNER_AUTH_ONLY':live?'REAL_GOOGLE_WEB_APP':'LOCAL_CHROMIUM_PREVIEW',capture:'Playwright browser rendering (not interactive desktop capture)',sourceDigest:digest(source()),workingTreeDirty:!!cp.execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:root,encoding:'utf8'}).trim(),sourceCommit:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),timestamp:new Date().toISOString(),tests:results,googleAcceptance:live&&!authorize?status:'HOLD',physicalPrint:'HOLD'};
 fs.writeFileSync(path.join(dest,authorize?'owner-auth-evidence.json':'browser-evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}
