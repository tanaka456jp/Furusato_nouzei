"use strict";
/**
 * Optional THIRD read of exact field regions using Tesseract line bboxes.
 * This is an extra veto only: NEVER creates new positive OCR candidates.
 * If geometry cannot be trusted, skip extra read; retain existing HOLD gates.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  else root.FurusatoOcrRegions=api;
}(typeof window!=="undefined"?window:this,function(){
 "use strict";
 const LABELS=Object.freeze([
  {key:"salaryGross",pattern:/^(?:給与)?支払金額\s*[:：]?\s*(.+)$/},
  {key:"salaryIncomeReference",pattern:/^給与所得控除後の金額(?:\s*\(調整控除後\))?\s*[:：]?\s*(.+)$/},
  {key:"deductionsReference",pattern:/^所得控除の額の合計額\s*[:：]?\s*(.+)$/},
  {key:"socialInsurance",pattern:/^社会保険料等の金額\s*[:：]?\s*(.+)$/}
 ]);
 const AMOUNT=/^(?:0|[1-9][0-9]{0,11}|[1-9][0-9]{0,2}(?:,[0-9]{3}){1,3})\s*(?:円)?$/;
 function clean(v){return String(v??"").normalize("NFKC").replace(/[\t ]+/g," ").trim();}
 function yen(raw){
  const str=clean(raw);
  if(!AMOUNT.test(str))return null;
  const n=Number(str.replace(/[,円\s]/g,""));
  return Number.isSafeInteger(n)&&n>=0&&n<=1000000000000?n:null;
 }
 function lineRecords(blocks){
  if(!Array.isArray(blocks)||blocks.length>200)return null;
  const out=[];
  try{
   for(const block of blocks){
    if(!Array.isArray(block.paragraphs)||block.paragraphs.length>100)return null;
    for(const para of block.paragraphs){
     if(!Array.isArray(para.lines)||para.lines.length>160)return null;
     for(const line of para.lines){
      if(typeof line.text!=="string"||line.text.length>240)continue;
      const b=line.bbox;
      if(!b||!Number.isFinite(b.x0)||!Number.isFinite(b.x1)||
         !Number.isFinite(b.y0)||!Number.isFinite(b.y1))continue;
      out.push({str:clean(line.text),bbox:b});
      if(out.length>600)return null;
     }
    }
   }
   return out;
  }catch(_){return null;}
 }
 function plan(blocks,width,height,expected){
  const skipped={status:"SKIPPED",rectangles:[],reasons:["FIELD_REGIONS_UNAVAILABLE"],autoApproved:false};
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||
    width<750||height<400||width*height>10000000||!expected||
    typeof expected!=="object")return skipped;
  const lines=lineRecords(blocks);
  if(!lines||!lines.length)return skipped;
  const rectangles=[],used=new Set();
  for(const f of LABELS){
   const matches=[];
   for(const l of lines){
    const m=f.pattern.exec(l.str);
    if(m)matches.push({line:l,amount:yen(m[1])});
   }
   if(matches.length!==1)return matches.length>1?
     {status:"CONFLICT",rectangles:[],reasons:["REGION_DUPLICATE_LABEL_"+f.key],autoApproved:false}:skipped;
   const m=matches[0];
   // OCR line with a recognizable but different amount is negative evidence.
   if(m.amount!==null&&m.amount!==expected[f.key])return {
    status:"CONFLICT",rectangles:[],
    reasons:["REGION_SOURCE_AMOUNT_MISMATCH_"+f.key],autoApproved:false
   };
   if(m.amount===null)return skipped;
   const box=m.line.bbox;
   const left=Math.max(0,Math.floor(box.x0-14));
   const top=Math.max(0,Math.floor(box.y0-10));
   const right=Math.min(width,Math.ceil(box.x1+14));
   const bottom=Math.min(height,Math.ceil(box.y1+10));
   const w=right-left,h=bottom-top;
   if(w<50||h<12||w>width*.85||h>height*.20||w*h>450000)return skipped;
   const identity=[left,top,w,h].join(":");
   if(used.has(identity))return skipped;
   used.add(identity);
   rectangles.push({key:f.key,left,top,width:w,height:h});
  }
  return {status:"READY",rectangles,reasons:[],autoApproved:false};
 }
 function assessRechecks(results,expected){
  const reasons=[];
  if(!Array.isArray(results)||results.length!==LABELS.length||
     !expected||typeof expected!=="object")return {
       status:"HOLD",reasons:["FIELD_RECHECK_INCOMPLETE"],autoApproved:false
     };
  for(const f of LABELS){
   const matches=results.filter(r=>r&&r.key===f.key);
   if(matches.length!==1||typeof matches[0].text!=="string"){
    reasons.push("FIELD_RECHECK_MISSING_"+f.key);continue;
   }
   // Never accept additional numbers or words on a cropped line.
   const text=clean(matches[0].text).replace(/\s+/g,"");
   const match=f.pattern.exec(text);
   if(!match||yen(match[1])!==expected[f.key]||
      !Number.isFinite(matches[0].confidence)||matches[0].confidence<75)
    reasons.push("FIELD_RECHECK_MISMATCH_"+f.key);
  }
  return {status:reasons.length?"HOLD":"CORROBORATED",reasons,
    // A regional reread from the same engine is NOT an independent truth.
    autoApproved:false,sourceVerified:false};
 }
 return {plan,assessRechecks};
}));