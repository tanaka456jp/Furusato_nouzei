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
  const marks=spans.filter(i=>i.s==="E03");
  if(marks.length!==1)return null;
  const anchor=marks[0],endX=anchor.x+Math.max(5,Math.min(80,anchor.width));
  const found=spans.filter(i=>i!==anchor&&i.x>endX-1&&
    i.x<endX+205&&Math.abs(i.y-anchor.y)<=9&&normalize(i.s))
    .sort((a,b)=>a.x-b.x);
  if(!found.length||found.length>4)return null;
  if(found[0].x-endX>25)return null;
  for(let i=1;i<found.length;i++)
   if(found[i].x-(found[i-1].x+found[i-1].width)>30||
      found[i].x<found[i-1].x)return null;
  // Adjacent data columns, employers and household relatives must never
  // be guessed as the recipient. Require one narrow header run only.
  return normalize(found.map(i=>i.s).join(" "));
 }
 return Object.freeze({normalize,extract});
}));
