"use strict";
/**
 * E03 recipient label for a LOCAL multi-person digital PDF only.
 * This is intentionally not used by the single-slip tax engine or OCR
 * reliability scoring. Names never leave browser memory except when the
 * operator explicitly downloads/prints their own list.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 else root.FurusatoBatchName=api;
}(typeof window!=="undefined"?window:this,function(){
 "use strict";
 const TOKEN=/^[A-Za-z\u3040-\u30ff\u3400-\u9fff々〆ヵヶ・ -]+$/u;
 function normalize(raw){
  if(typeof raw!=="string"||/[\u0000-\u001f\u007f-\u009f]/.test(raw))
   return null;
  const s=raw.normalize("NFKC").replace(/\s+/g," ").trim();
  if(!TOKEN.test(s)||s.length<2||s.length>40||!/[A-Za-z\u3040-\u30ff\u3400-\u9fff]/u.test(s))
   return null;
  if(/^[・ -]|[・ -]$/.test(s))return null;
  return s;
 }
 function extract(items){
  if(!Array.isArray(items)||items.length>4000)return null;
  const spans=items.filter(i=>typeof i?.str==="string"&&
   i.str.length<160&&Array.isArray(i.transform)&&i.transform.length===6&&
   Number.isFinite(i.transform[4])&&Number.isFinite(i.transform[5]))
   .map(i=>({s:i.str.trim(),x:i.transform[4],y:i.transform[5],
     width:Number.isFinite(i.width)?i.width:12}));
  // PDF.js sometimes emits E03 as THREE overlapping character spans,
  // even though PyMuPDF reports one word. Reconstruct only the precise
  // consecutive code; never guess from a generic "氏名" in family sections.
  const marks=spans.filter(i=>i.s==="E03").map(i=>({x:i.x,y:i.y,end:i.x+i.width}));
  for(const e of spans.filter(i=>i.s==="E")){
   const zeros=spans.filter(i=>i.s==="0"&&
     i.y===e.y&&i.x>e.x&&i.x-e.x<7);
   for(const zero of zeros){
    const threes=spans.filter(i=>i.s==="3"&&
      i.y===e.y&&i.x>zero.x&&i.x-zero.x<7);
    for(const three of threes)
     marks.push({x:e.x,y:e.y,end:three.x+three.width});
   }
  }
  if(marks.length!==1)return null;
  const anchor=marks[0],endX=anchor.end;
  // PDF.js sometimes emits a single *huge* CJK placeholder covering the
  // rest of the line. It is not the payee; reject abnormal glyph widths.
  const found=spans.filter(i=>i.x>endX-1&&i.x<endX+170&&
    Math.abs(i.y-anchor.y)<=8&&
    i.s.length>0&&i.width>=0&&i.width<=i.s.length*24&&
    TOKEN.test(i.s)).sort((a,b)=>a.x-b.x);
  if(!found.length||found.length>7)return null;
  if(found[0].x-endX>17)return null;
  let value=found[0].s;
  for(let i=1;i<found.length;i++){
   const gap=found[i].x-(found[i-1].x+found[i-1].width);
   if(gap>25||gap< -5)return null;
   value+=(gap>2?" ":"")+found[i].s;
  }
  // Only one compact recipient-field run. Do not include employer,
  // parent/spouse names or any code-like values.
  return normalize(value);
 }
 return Object.freeze({normalize,extract});
}));
