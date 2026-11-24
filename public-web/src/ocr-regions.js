"use strict";
/**
 * Optional THIRD read of exact field regions using Tesseract line bboxes.
 * Same-line rechecks are an extra veto. The separate-cell route requires
 * two geometrically matching full-page reads plus a third numeric crop read.
 * Neither route verifies the original or approves tax results.
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
 // Conservative recovery for the printed table, not a fixed template.
 // Exact headings must be recognized, with the withholding-tax column
 // present as a right boundary; never substitute its value for G26.
 const compact=s=>clean(s).replace(/\s+/g,"");
 const headings=[
  ["salaryGross",/^(?:給与)?支払金額$/],
  ["salaryIncomeReference",/^給与所得控除後の金額(?:\(調整控除後\))?$/],
  ["deductionsReference",/^所得控除の額の合計額$/],
  ["withholdingBoundary",/^源泉徴収税額$/],
  ["socialInsurance",/^社会保険料等の金額$/],
  ["insuranceBoundary",/^生命保険料の控除額$/]
 ];
 const fail=reason=>({status:"HOLD",year:null,candidates:{},rectangles:[],reasons:[reason],autoApproved:false});
 function planSeparate(blocks,width,height,review){
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<750||
     height<400||width*height>10000000||!review||![2025,2026].includes(review.year)||
     review.yearConflict||review.yearUnsupported||
     !Array.isArray(review.reasons)||review.reasons.some(r=>!/^FIELD_MISSING_/.test(r)))
   return fail("REGION_SEPARATE_SOURCE_UNVERIFIED");
  const lines=lineRecords(blocks);
  if(!lines||!lines.length)return fail("REGION_SEPARATE_GEOMETRY_UNAVAILABLE");
  const valid=b=>b.x0>=0&&b.y0>=0&&b.x1<=width&&b.y1<=height&&
    b.x1>b.x0&&b.y1>b.y0;
  const cx=b=>(b.x0+b.x1)/2,cy=b=>(b.y0+b.y1)/2;
  const centers=[],marks={};
  for(const [key,pattern] of headings){
   const hits=lines.filter(l=>pattern.test(compact(l.str)));
   if(hits.length!==1||!valid(hits[0].bbox))return fail("REGION_SEPARATE_HEADING_"+key);
   marks[key]=hits[0].bbox;
   if(key!=="socialInsurance"&&key!=="insuranceBoundary")centers.push(cx(hits[0].bbox));
  }
  const row=headings.slice(0,4).map(([k])=>marks[k]);
  const rowHeight=Math.max(...row.map(b=>b.y1-b.y0));
  if(rowHeight>height*.08||Math.max(...row.map(cy))-Math.min(...row.map(cy))>rowHeight*.6)
   return fail("REGION_SEPARATE_ROW_ALIGNMENT");
  const gaps=centers.slice(1).map((v,i)=>v-centers[i]);
  if(gaps.some(g=>g<width*.10||g>width*.36)||Math.max(...gaps)>Math.min(...gaps)*1.6||
     row.some((b,i)=>i>0&&b.x0<row[i-1].x1))
   return fail("REGION_SEPARATE_COLUMN_ALIGNMENT");
  const sb=marks.socialInsurance,ib=marks.insuranceBoundary;
  if(sb.y0<=Math.max(...row.map(b=>b.y1))||
     Math.abs(cy(sb)-cy(ib))>Math.max(sb.y1-sb.y0,ib.y1-ib.y0)*.6||
     sb.x1>=ib.x0||cx(ib)-cx(sb)<width*.08)
   return fail("REGION_SEPARATE_SOCIAL_ALIGNMENT");
  const rectangles=[],candidates={},used=new Set();
  for(const [key,pattern] of headings.filter(([k])=>k!=="withholdingBoundary"&&k!=="insuranceBoundary")){
   const mark=marks[key],idx=headings.findIndex(([k])=>k===key);
   const center=cx(mark),isSocial=key==="socialInsurance";
   const left=isSocial?Math.max(0,center-(cx(ib)-center)/2):
    idx===0?Math.max(0,center-gaps[0]/2):(centers[idx-1]+center)/2;
   const right=isSocial?(center+cx(ib))/2:(center+centers[idx+1])/2;
   const top=mark.y1,bottom=Math.min(height,top+Math.min(height*.065,(mark.y1-mark.y0)*3.5));
   // Consider every text line that intersects the interior below the
   // heading. A second amount, a label/inner note or a malformed value
   // must stop recovery, not be selected according to plausibility.
   const inCell=lines.filter(l=>l.bbox.y0>=top-1&&l.bbox.y0<bottom&&
      l.bbox.x1>left+2&&l.bbox.x0<right-2);
   if(inCell.length!==1)return fail("REGION_SEPARATE_AMOUNT_NOT_UNIQUE_"+key);
   const hit=inCell[0],b=hit.bbox,n=yen(compact(hit.str));
   if(!valid(b)||b.x0<left||b.x1>right||b.y0<top||b.y1>bottom||
      n===null||used.has(hit)||b.x1-b.x0<8||b.y1-b.y0<6||
      n>(key==="salaryGross"?20000000:100000000))
    return fail("REGION_SEPARATE_AMOUNT_INVALID_"+key);
   if(review.candidates?.[key]!==undefined&&review.candidates[key]!==n)
    return fail("REGION_SEPARATE_TEXT_CONFLICT_"+key);
   used.add(hit);candidates[key]=n;
   const pad=3, x=Math.floor(Math.max(left,b.x0-pad)),y=Math.floor(Math.max(top,b.y0-pad));
   const w=Math.ceil(Math.min(right,b.x1+pad))-x,h=Math.ceil(Math.min(bottom,b.y1+pad))-y;
   if(w*h>100000||w<8||h<6)return fail("REGION_SEPARATE_CROP_INVALID_"+key);
   rectangles.push({key,left:x,top:y,width:w,height:h});
  }
  if(candidates.salaryGross===0||candidates.salaryIncomeReference>candidates.salaryGross||
     candidates.socialInsurance>candidates.deductionsReference)
   return fail("REGION_SEPARATE_AMOUNT_RELATION");
  return {status:"READY",year:review.year,candidates,rectangles,reasons:[],autoApproved:false};
 }
 function agreeSeparate(a,b){
  if(a?.status!=="READY"||b?.status!=="READY"||a.year!==b.year||
     a.rectangles.length!==4||b.rectangles.length!==4)return fail("REGION_SEPARATE_TWO_PASS_UNVERIFIED");
  for(const {key} of LABELS){
   const x=a.rectangles.find(r=>r.key===key),y=b.rectangles.find(r=>r.key===key);
   if(!x||!y||a.candidates[key]!==b.candidates[key])
    return fail("REGION_SEPARATE_TWO_PASS_AMOUNT_"+key);
   // Same canvas dimensions: both passes must locate the same cell.
   const ix=Math.max(0,Math.min(x.left+x.width,y.left+y.width)-Math.max(x.left,y.left));
   const iy=Math.max(0,Math.min(x.top+x.height,y.top+y.height)-Math.max(x.top,y.top));
   if(ix*iy<.6*Math.max(x.width*x.height,y.width*y.height))
    return fail("REGION_SEPARATE_TWO_PASS_GEOMETRY_"+key);
  }
  return a;
 }
 function assessSeparate(results,planned){
  if(planned?.status!=="READY"||!Array.isArray(results)||results.length!==4)
   return fail("REGION_SEPARATE_RECHECK_INCOMPLETE");
  for(const {key} of LABELS){
   const hits=results.filter(r=>r?.key===key);
   if(hits.length!==1||typeof hits[0].text!=="string"||
      yen(compact(hits[0].text))!==planned.candidates[key]||
      !Number.isFinite(hits[0].confidence)||hits[0].confidence<75)
    return fail("REGION_SEPARATE_RECHECK_"+key);
  }
  return {schema:"furusato-slip-separate-cell-review/v1",status:"REQUIRES_SOURCE_REVIEW",
   year:planned.year,candidates:{...planned.candidates},reasons:[],
   eligibleForManualTransfer:true,autoApproved:false,originalCompared:false,
   qualityScope:"INCOME_YEAR_AND_FOUR_AMOUNTS_ONLY"};
 }
 return {plan,assessRechecks,planSeparate,agreeSeparate,assessSeparate};
}));