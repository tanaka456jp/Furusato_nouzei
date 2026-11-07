"use strict";
const http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {installOriginAuthorization}=require('../deployment/browser-auth.cjs');
const token='SYNTHETIC_TOKEN_FOR_REDIRECT_TEST';
async function listen(server){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return 'http://127.0.0.1:'+server.address().port;}
(async()=>{
 let sourceOrigin,targetOrigin,browser,context;const seen=[];
 const target=http.createServer((req,res)=>{seen.push({site:'target',auth:req.headers.authorization});res.end('target');});
 const source=http.createServer((req,res)=>{
  seen.push({site:req.url,auth:req.headers.authorization});
  if(req.url==='/cross'){res.writeHead(302,{Location:targetOrigin+'/landing'});res.end();}
  else if(req.url==='/same'){res.writeHead(302,{Location:sourceOrigin+'/landing'});res.end();}
  else if(req.url==='/fail')req.socket.destroy();else res.end('source');
 });
 try{
  sourceOrigin=await listen(source);targetOrigin=await listen(target);
  const opts={headless:true};if(process.env.FURUSATO_BROWSER_CHANNEL)opts.channel=process.env.FURUSATO_BROWSER_CHANNEL;
  browser=await chromium.launch(opts);context=await browser.newContext();
  const guard=await installOriginAuthorization(context,sourceOrigin,token),page=await context.newPage();
  await page.goto(sourceOrigin+'/cross');
  assert.equal(seen.find(x=>x.site==='/cross').auth,'Bearer '+token,'Initial allowed-origin request must carry synthetic bearer');
  assert.equal(seen.find(x=>x.site==='target').auth,undefined,'Bearer must not reach cross-origin redirect');
  // Fulfilled redirects keep the browser's original headers, which contain no
  // bearer. A new direct navigation to the allowed origin is authorized again.
  await page.goto(sourceOrigin+'/same');assert.equal(seen.find(x=>x.site==='/landing').auth,undefined);
  await page.goto(sourceOrigin+'/direct');assert.equal(seen.find(x=>x.site==='/direct').auth,'Bearer '+token);
  let message='';try{await page.goto(sourceOrigin+'/fail');}catch(e){message=e.message;}
  assert.equal(guard.failed,true);assert.ok(!message.includes(token),'Fetch failure must never expose bearer');
  console.log('PASS synthetic bearer stays on exact origin across redirects and is absent from failure messages');
 }finally{if(context)await context.close();if(browser)await browser.close();await new Promise(resolve=>source.close(resolve));await new Promise(resolve=>target.close(resolve));}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
