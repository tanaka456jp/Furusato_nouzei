"use strict";
// Read-only local QA server. Never use real slips over LAN HTTP.
const http=require("node:http"),fs=require("node:fs"),path=require("node:path"),net=require("node:net");
const mime=Object.freeze({".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".wasm":"application/wasm",".gz":"application/gzip",".txt":"text/plain; charset=utf-8"});
const top=new Set(["index.html","about.html","privacy.html","terms.html","style.css","app.js","engine.js","ocr.js","ocr-review.js","ocr-quality.js","ocr-image-header.js","ocr-layout.js","ocr-perspective.js","ocr-regions.js","pdf-compat.js","pdf-gcodes.js","batch-name.js","batch-core.js","batch.js","resident-levy.js","family-deductions.js","family-tax.js","family-source.js","insurance-deductions.js","other-deductions.js","medical-deductions.js","salary-adjustment.js","robots.txt"]);
function privateAddress(host){
 if(!net.isIPv4(host))return false;
 const [a,b]=host.split(".").map(Number);
 return a===10||(a===172&&b>=16&&b<=31)||(a===192&&b===168);
}
function allowed(name){
 return top.has(name)||/^vendor\/pdf(?:\.worker)?\.mjs$/.test(name)||
 /^vendor\/tesseract\/(?:tesseract\.min\.js|worker\.min\.js|lang\/jpn\.traineddata\.gz|core\/tesseract-core[\w-]*\.wasm(?:\.js)?)$/.test(name)||
 /^licenses\/[A-Za-z0-9_.-]+\.txt$/.test(name);
}
function createReviewServer({root,host="127.0.0.1",port=8765,lan=false}){
 if(!(host==="127.0.0.1"&&!lan)&&!(lan===true&&privateAddress(host)))throw Error("REVIEW_BIND_NOT_ALLOWED");
 if(!Number.isInteger(port)||port<0||port>65535)throw Error("REVIEW_PORT_INVALID");
 const base=fs.realpathSync(root);
 for(const name of ["index.html","_headers","robots.txt","vendor/pdf.worker.mjs","vendor/tesseract/lang/jpn.traineddata.gz"]){
  const file=path.join(base,name);
  if(!fs.statSync(file).isFile()||!fs.realpathSync(file).startsWith(base+path.sep))throw Error("REVIEW_BUILD_INCOMPLETE");
 }
 const headers=Object.freeze({
  "Content-Security-Policy":"default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'none'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","Referrer-Policy":"no-referrer",
  "Permissions-Policy":"camera=(), microphone=(), geolocation=()","X-Robots-Tag":"noindex, nofollow, noarchive","Cache-Control":"no-store"
 });
 const server=http.createServer({maxHeaderSize:8192,requestTimeout:10000,headersTimeout:10000},(req,res)=>{
  for(const [key,value] of Object.entries(headers))res.setHeader(key,value);
  function deny(status){res.writeHead(status,{"Content-Type":"text/plain; charset=utf-8","Connection":"close"});res.end("Review request refused");}
  const expected=host+":"+server.address().port;
  if(req.headers.host!==expected)return deny(403);
  if(!["GET","HEAD"].includes(req.method)||req.headers["transfer-encoding"]||("content-length" in req.headers&&req.headers["content-length"]!=="0"))return deny(405);
  // No query strings, encoded path segments, traversal, or directory lists.
  if(typeof req.url!=="string"||!/^\/[A-Za-z0-9_./-]*$/.test(req.url)||req.url.split("/").some(x=>x===".."||x==="."))return deny(404);
  const name=req.url==="/"?"index.html":req.url.slice(1);
  if(!allowed(name))return deny(404);
  let file,stat;
  try{
   file=fs.realpathSync(path.join(base,name));stat=fs.statSync(file);
   if(!file.startsWith(base+path.sep)||!stat.isFile())return deny(404);
  }catch(_){return deny(404);}
  res.writeHead(200,{"Content-Type":mime[path.extname(file)]||"application/octet-stream","Content-Length":stat.size});
  if(req.method==="HEAD")return res.end();
  const stream=fs.createReadStream(file);
  stream.on("error",()=>res.destroy());res.on("close",()=>stream.destroy());stream.pipe(res);
 });
 server.on("checkContinue",(req,res)=>{res.writeHead(405,{"Connection":"close"});res.end();});
 return {server,listen:()=>new Promise((resolve,reject)=>{server.once("error",reject);server.listen(port,host,()=>resolve(server.address()));})};
}
module.exports={createReviewServer,privateAddress,allowed};
if(require.main===module){
 const args=process.argv.slice(2),options={root:path.resolve(__dirname,"../dist")};
 try{
  if(args.length===2&&args[0]==="--root")options.root=path.resolve(args[1]);
  else if(args.length===4&&args[0]==="--root"&&args[2]==="--lan-synthetic-only"){
   options.root=path.resolve(args[1]);options.lan=true;options.host=args[3];
  }else if(args.length)throw Error("REVIEW_ARGUMENTS_INVALID");
  const instance=createReviewServer(options);
  instance.listen().then(addr=>{
   console.log("SYNTHETIC QA ONLY - NO DEPLOY");
   console.log("http://"+addr.address+":"+addr.port+"/");
   if(options.lan)console.log("LAN HTTP is NOT encrypted. Use fictional files only. Stop with Ctrl+C.");
  }).catch(()=>{console.error("REVIEW_START_FAILED");process.exitCode=1;});
 }catch(_){console.error("REVIEW_START_FAILED: use --root <dist> [--lan-synthetic-only <private IPv4>]");process.exitCode=1;}
}
