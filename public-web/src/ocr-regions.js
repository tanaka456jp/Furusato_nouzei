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

 // A narrowly scoped geometry probe of the code-layer form's two amount
 // bands. Coordinates are dimensionless printed-rule ratios, NOT a year
 // identifier or a verified document type. A similar grid may be unrelated.
 // This diagnostic can NEVER enable transfer, infer zero, or emit money.
 const gridHold=()=>({status:"HOLD",rectangles:[],layoutLocated:false,autoApproved:false,eligibleForManualTransfer:false});
 function planGridPixels(data,width,height){
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||
     width<750||height<400||width*height>10000000||
     !ArrayBuffer.isView(data)||data.BYTES_PER_ELEMENT!==1||data.length!==width*height*4)
   return gridHold();
  const dark=(x,y)=>{
   const i=(y*width+x)*4;
   return data[i+3]===255&&data[i]<150&&data[i+1]<150&&data[i+2]<150;
  };
  const rows=[];
  for(let y=0;y<height;y++){
   let start=-1,bestL=0,bestR=-1;
   for(let x=0;x<=width;x++){
    if(x<width&&dark(x,y)){if(start<0)start=x;}
    else if(start>=0){
     if(x-1-start>bestR-bestL){bestL=start;bestR=x-1;}
     start=-1;
    }
   }
   if(bestR-bestL+1<width*.75)continue;
   const last=rows[rows.length-1];
   if(last&&y===last.bottom+1&&Math.abs(bestL-last.left)<=3&&Math.abs(bestR-last.right)<=3)last.bottom=y;
   else rows.push({left:bestL,right:bestR,top:y,bottom:y});
   if(rows.length>256)return gridHold();
  }
  const center=v=>(v.top+v.bottom)/2;
  const matches=[];
  for(const start of rows){
   const l=start.left,w=start.right-l,t=center(start),tol=Math.max(3,w*.004),thick=Math.max(3,w*.007);
   if(start.bottom-start.top>thick)continue;
   const hits=[];
   for(const off of [0,32,96,192,212,276]){
    const a=rows.filter(v=>Math.abs(v.left-l)<=tol&&Math.abs(v.right-start.right)<=tol&&
      Math.abs(center(v)-(t+off*w/1080))<=tol&&v.bottom-v.top<=thick);
    if(a.length!==1)break;
    hits.push(a[0]);
   }
   if(hits.length!==6||new Set(hits).size!==6)continue;
   const ys=hits.map(v=>Math.round(center(v)));
   function vertical(frac,top,bottom){
    const x=Math.round(l+w*frac/1080),rad=Math.max(2,Math.round(w*.003));
    let n=0,seen=0;
    for(let y=top+3;y<bottom-3;y++){
     n++;
     for(let a=Math.max(0,x-rad);a<=Math.min(width-1,x+rad);a++)
      if(dark(a,y)){seen++;break;}
    }
    return n>0&&seen/n>=.9;
   }
   if(![0,144,397,618,838,1080].every(v=>vertical(v,ys[0],ys[2]))||
      ![0,210,452,662,872,1080].every(v=>vertical(v,ys[3],ys[5]))||
      ![166,420,639].every(v=>vertical(v,ys[1],ys[2]))||
      !vertical(232,ys[4],ys[5]))continue;
   // Verify the inner-note/total dividers, not just the outer bands.
   // The salary and social-insurance totals are BELOW their half rules.
   function innerRule(x1,x2,y1,y2){
    const lo=Math.ceil(l+w*x1/1080)+4,hi=Math.floor(l+w*x2/1080)-4;
    const mid=(y1+y2)/2,found=[];
    for(let y=Math.max(y1+2,Math.floor(mid-tol));y<=Math.min(y2-2,Math.ceil(mid+tol));y++){
     let ink=0;
     for(let x=lo;x<=hi;x++)if(dark(x,y))ink++;
     if(hi>=lo&&ink/(hi-lo+1)>=.94)found.push(y);
    }
    if(!found.length||found[found.length-1]-found[0]+1!==found.length||found.length>thick+1)return null;
    return found[found.length-1];
   }
   const grossDivider=innerRule(144,397,ys[1],ys[2]);
   const socialDivider=innerRule(210,452,ys[4],ys[5]);
   if(grossDivider===null||socialDivider===null)continue;
   // Small right inset preserves right-aligned terminal digits. Wider
   // left margin avoids the adjacent printed slot identifiers.
   const leftInset=Math.max(3,Math.round(w*.004)),edge=Math.max(1,Math.round(w*.001));
   const specs=[
    ["salaryGross",166,397,grossDivider,ys[2]],
    ["salaryIncomeReference",420,618,ys[1],ys[2]],
    ["deductionsReference",639,838,ys[1],ys[2]],
    ["socialInsurance",232,452,socialDivider,ys[5]]
   ];
   const rectangles=specs.map(([key,x1,x2,y1,y2])=>{
    const left=Math.ceil(l+w*x1/1080)+leftInset,top=y1+edge+1;
    return {key,left,top,width:Math.floor(l+w*x2/1080)-edge-left,height:y2-edge-top};
   });
   if(rectangles.some(v=>v.width<20||v.height<12||v.width*v.height>100000||
      v.left<0||v.top<0||v.left+v.width>width||v.top+v.height>height))continue;
   matches.push(rectangles);
   if(matches.length>1)return gridHold();
  }
  return matches.length===1?{status:"LAYOUT_ONLY",layoutLocated:true,rectangles:matches[0],
    autoApproved:false,eligibleForManualTransfer:false}:gridHold();
 }
 function planGridCanvas(canvas){
  if(!canvas||!Number.isSafeInteger(canvas.width)||!Number.isSafeInteger(canvas.height)||
     canvas.width<750||canvas.height<400||canvas.width*canvas.height>10000000)return gridHold();
  try{
   const ctx=canvas.getContext("2d",{willReadFrequently:true});
   if(!ctx)return gridHold();
   return planGridPixels(ctx.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height);
  }catch(_){return gridHold();}
 }
 // Diagnostic only. Never join separate digit strings or infer zero from
 // a blank. Counts deliberately omit all recognized amounts and confidence.
 function gridDigit(raw){
  if(typeof raw!=="string"||raw.length>80)return null;
  const s=raw.normalize("NFKC").trim().replace(/[ \t]*,[ \t]*/g,",");
  if(!/^(?:0|[1-9][0-9]{0,8}|[1-9][0-9]{0,2}(?:,[0-9]{3}){1,2})$/.test(s))return null;
  const n=Number(s.replace(/,/g,""));
  return Number.isSafeInteger(n)&&n>=0&&n<=100000000? n:null;
 }
 // Fixed per-field read variants. Keep thin/low-contrast social-insurance
 // digits on original pixels; use a different scale rather than clipping
 // them with the page contrast transform. No confidence-based cherry picking.
 function gridReadVariant(key,pass){
  if(!LABELS.some(f=>f.key===key)||![0,1].includes(pass))return null;
  return pass===0?{source:"original",scale:3}:
    key==="socialInsurance"?{source:"original",scale:2}:{source:"enhanced",scale:3};
 }
 function assessGridDigits(left,right){
  if(!Array.isArray(left)||!Array.isArray(right)||left.length!==4||right.length!==4||
     !LABELS.every(({key})=>left.filter(v=>v?.key===key).length===1&&right.filter(v=>v?.key===key).length===1))
   return {status:"HOLD",matchedFields:0,eligibleForManualTransfer:false,autoApproved:false};
  let matchedFields=0;
  for(const {key} of LABELS){
   const a=gridDigit(left.find(v=>v.key===key).text),b=gridDigit(right.find(v=>v.key===key).text);
   if(a!==null&&a===b)matchedFields++;
  }
  return {status:"DIAGNOSTIC_ONLY",matchedFields,eligibleForManualTransfer:false,autoApproved:false};
 }
 return {plan,assessRechecks,planSeparate,agreeSeparate,assessSeparate,planGridPixels,planGridCanvas,assessGridDigits,gridReadVariant};
}));