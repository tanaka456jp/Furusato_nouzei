"use strict";
// Synthetic research only. Never imported by the production browser bundle.
const assert=require("node:assert/strict");
const {parseYen,normalize}=require("../src/ocr-review.js");
const keys=["salaryGross","salaryIncomeReference","deductionsReference","socialInsurance"];
// Two independent geometrical observations are required; malformed Japanese
// text is NOT repaired or used as positive numeric evidence.
function assessProbe(probe){
 const hold=reason=>({status:"HOLD",reason,eligibleForManualTransfer:false,autoApproved:false});
 if(!probe||!Array.isArray(probe.plans)||probe.plans.length!==2)return hold("PLAN_COUNT");
 const [a,b]=probe.plans;
 if(!a||!b||![2025,2026].includes(a.year)||a.year!==b.year)return hold("YEAR");
 if(!Array.isArray(a.fields)||!Array.isArray(b.fields)||a.fields.length!==4||b.fields.length!==4)return hold("FIELD_COUNT");
 if(!Array.isArray(probe.reads)||probe.reads.length!==8)return hold("READ_COUNT");
 const values={};
 for(const key of keys){
  const xs=a.fields.filter(v=>v.key===key),ys=b.fields.filter(v=>v.key===key);
  if(xs.length!==1||ys.length!==1)return hold("DUPLICATE_FIELD");
  const x=xs[0],y=ys[0];
  const valid=q=>q&&[q.x0,q.x1,q.y0,q.y1].every(Number.isFinite)&&q.x0>=0&&q.y0>=0&&q.x1>q.x0&&q.y1>q.y0;
  for(const prop of ["bbox","labelBox"]){
   const p=x[prop],q=y[prop];
   if(!valid(p)||!valid(q))return hold("GEOMETRY");
   const ix=Math.max(0,Math.min(p.x1,q.x1)-Math.max(p.x0,q.x0)),iy=Math.max(0,Math.min(p.y1,q.y1)-Math.max(p.y0,q.y0));
   if(ix*iy<.8*Math.max((p.x1-p.x0)*(p.y1-p.y0),(q.x1-q.x0)*(q.y1-q.y0)))return hold("GEOMETRY_DISAGREEMENT");
  }
  const rr=[0,1].map(pass=>probe.reads.filter(v=>v.key===key&&v.pass===pass));
  if(rr.some(v=>v.length!==1))return hold("DUPLICATE_READ");
  const [u,v]=rr.map(v=>v[0]);
  const n=parseYen(normalize(u.text)),m=parseYen(normalize(v.text));
  if(n===null||n!==m||[u,v].some(z=>!Number.isFinite(z.confidence)||z.confidence<75||z.confidence>100))return hold("AMOUNT_DISAGREEMENT");
  for(const p of [x,y]){
   const raw=normalize(p.raw);
   if(!/^[0-9][0-9,.]*$/.test(raw))return hold("INVALID_SOURCE_TOKEN");
   const parsed=parseYen(raw);
   if(parsed!==null&&parsed!==n)return hold("VALID_SOURCE_CONFLICT");
   // No conversion of malformed punctuation to a number, even for comparison.
  }
  values[key]=n;
 }
 if(values.salaryGross===0||values.salaryIncomeReference>values.salaryGross||values.socialInsurance>values.deductionsReference)return hold("AMOUNT_RELATION");
 return {status:"RESEARCH_MATCH",year:a.year,values,eligibleForManualTransfer:false,autoApproved:false};
}
// Executed via Playwright serialization; no eval, no remote OCR, no user file.
async function bilingualProbeInBrowser(){
 const file=document.getElementById("slipFile").files[0];
 if(!file||! /^(08-positive-image|10-bilingual-varied|11-bilingual-printed-period|12-bilingual-printed-minus|13-bilingual-duplicate-label|14-bilingual-conflicting-year)\.png$/.test(file.name))throw Error("Not a fixed synthetic source");
 const bitmap=await createImageBitmap(file),canvases=[],workers=[];
 const norm=s=>FurusatoSlipReview.normalize(s);
 const paths={workerPath:new URL("./vendor/tesseract/worker.min.js",location.href).href,corePath:new URL("./vendor/tesseract/core",location.href).href,langPath:new URL("./vendor/tesseract/lang",location.href).href,workerBlobURL:false,cacheMethod:"none"};
 const canvas=(w,h)=>{const c=document.createElement("canvas");c.width=w;c.height=h;canvases.push(c);return c;};
 const getWorker=async lang=>{const w=await Tesseract.createWorker(lang,Tesseract.OEM.LSTM_ONLY,paths);workers.push(w);return w;};
 const plan=d=>{
  const review=FurusatoSlipReview.reviewText(d?.text);
  if(![2025,2026].includes(review.year)||review.yearConflict||review.yearUnsupported||review.documentTypeConflict||review.reasons.some(x=>!/^FIELD_MISSING_/.test(x)))return null;
  const lines=[];
  for(const block of d?.blocks||[])for(const para of block.paragraphs||[])for(const l of para.lines||[]){if(lines.length>=200)return null;lines.push({text:norm(l.text),bbox:l.bbox});}
  const valid=b=>b&&[b.x0,b.y0,b.x1,b.y1].every(Number.isFinite)&&b.x0>=0&&b.y0>=0&&b.x1<=bitmap.width&&b.y1<=bitmap.height&&b.x1>b.x0&&b.y1>b.y0;
  const fields=[];
  for(const f of FurusatoSlipReview.FIELDS){
   const hit=lines.map((v,i)=>({v,i})).filter(x=>x.v.text===f.label);
   if(hit.length!==1)return null;
   const label=hit[0].v,amount=lines[hit[0].i+1];
   if(!amount||!valid(label.bbox)||!valid(amount.bbox)||! /^[0-9][0-9,.]*$/.test(amount.text))return null;
   const l=label.bbox,q=amount.bbox;
   if(q.y0<l.y1||q.y0-l.y1>Math.max(12,(l.y1-l.y0)*2)||q.x0<l.x0-10||q.x0>l.x1+10||q.x1-q.x0<8||q.y1-q.y0<8||(q.x1-q.x0+20)*(q.y1-q.y0+20)>100000)return null;
   // A second numeric line or overlapping label/amount cannot be selected.
   if(fields.some(x=>x.bbox.y1>=l.y0))return null;
   fields.push({key:f.key,bbox:q,labelBox:l,raw:amount.text});
  }
  return {year:review.year,fields};
 };
 try{
  if(bitmap.width<750||bitmap.height<400||bitmap.width*bitmap.height>10000000)throw Error("Research dimensions");
  const base=canvas(bitmap.width,bitmap.height),enhanced=canvas(bitmap.width,bitmap.height);
  base.getContext("2d").drawImage(bitmap,0,0);
  const ctx=enhanced.getContext("2d");ctx.drawImage(bitmap,0,0);
  const image=ctx.getImageData(0,0,bitmap.width,bitmap.height);
  for(let i=0;i<image.data.length;i+=4){const v=Math.max(0,Math.min(255,Math.round((.299*image.data[i]+.587*image.data[i+1]+.114*image.data[i+2]-128)*1.15+128)));image.data[i]=image.data[i+1]=image.data[i+2]=v;}
  ctx.putImageData(image,0,0);
  const jpn=await getWorker("jpn"),plans=[];
  for(const src of [base,enhanced]){const rec=await jpn.recognize(src,{}, {text:true,blocks:true});plans.push(plan(rec.data));}
  if(plans.some(x=>!x))return {plans,reads:[]};
  const eng=await getWorker("eng"),reads=[];
  await eng.setParameters({tessedit_pageseg_mode:"7",tessedit_char_whitelist:"0123456789,.-"});
  for(const pass of [0,1])for(const f of plans[pass].fields){
   const {x0,y0,x1,y1}=f.bbox,scale=pass===0?1:2,x=Math.max(0,x0-10),y=Math.max(0,y0-10),w=Math.min(bitmap.width,x1+10)-x,h=Math.min(bitmap.height,y1+10)-y;
   const crop=canvas(w*scale+40,h*scale+40),c=crop.getContext("2d");c.fillStyle="#fff";c.fillRect(0,0,crop.width,crop.height);
   c.drawImage(pass===0?base:enhanced,x,y,w,h,20,20,w*scale,h*scale);
   const res=await eng.recognize(crop);
   reads.push({key:f.key,pass,text:norm(res.data.text),confidence:res.data.confidence});
   crop.width=crop.height=0;
  }
  return {plans,reads};
 }finally{
  for(const w of workers.reverse())try{await w.terminate();}catch(_){}
  for(const c of canvases)c.width=c.height=0;
  bitmap.close();
 }
}
module.exports={assessProbe,bilingualProbeInBrowser};
