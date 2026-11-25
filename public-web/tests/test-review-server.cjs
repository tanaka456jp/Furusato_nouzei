"use strict";
const assert=require("node:assert/strict"),http=require("node:http"),path=require("node:path");
const {createReviewServer,privateAddress,allowed}=require("../scripts/serve-review.cjs");
const root=path.resolve(__dirname,"../dist");
for(const host of ["0.0.0.0","8.8.8.8","169.254.1.2","172.32.0.1","::","127.0.0.1"]){
 assert.equal(privateAddress(host),false);
 assert.throws(()=>createReviewServer({root,host,lan:true}),/REVIEW_BIND_NOT_ALLOWED/);
}
for(const host of ["192.168.1.10","10.1.1.1","172.16.1.1","172.31.255.1"]){
 assert.equal(privateAddress(host),true);assert.throws(()=>createReviewServer({root,host}),/REVIEW_BIND_NOT_ALLOWED/);
}
for(const name of [".env","_headers","private.pdf","vendor/","scripts/serve-review.cjs","vendor/secret.js"])assert.equal(allowed(name),false);
(async()=>{
 const {server,listen}=createReviewServer({root,port:0});
 const address=await listen();
 function req(url,method="GET",headers={}){
  return new Promise((resolve,reject)=>{
   const request=http.request({host:"127.0.0.1",port:address.port,path:url,method,headers},response=>{
    let length=0;response.on("data",x=>length+=x.length);response.on("end",()=>resolve({status:response.statusCode,headers:response.headers,length}));
   });request.on("error",reject);request.end();
  });
 }
 try{
  for(const url of ["/","/index.html","/terms.html","/engine.js","/vendor/pdf.worker.mjs","/vendor/tesseract/lang/jpn.traineddata.gz"]){
   const r=await req(url,"HEAD");assert.equal(r.status,200);assert.equal(r.length,0);assert.equal(r.headers["cache-control"],"no-store");assert.match(r.headers["content-security-policy"],/connect-src 'self'/);assert.equal(r.headers["x-robots-tag"],"noindex, nofollow, noarchive");
  }
  const home=await req("/");assert.equal(home.status,200);assert.ok(home.length>0);
  for(const url of ["/../index.html","/%2e%2e/index.html","/index.html?x=1","/vendor/","/_headers","/private.pdf","/scripts/serve-review.cjs"])assert.equal((await req(url)).status,404);
  assert.equal((await req("/","POST")).status,405);
  assert.equal((await req("/","GET",{host:"foreign.example"})).status,403);
  console.log("PUBLIC_LOCAL_REVIEW_SERVER_READ_ONLY_PASS; synthetic only; no deploy");
 }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
