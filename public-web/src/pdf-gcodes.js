"use strict";
/**
 * PDF.js positioned tax-slot extraction for CODE-LAYER withholding slips.
 * Numeric fields only (L01, G04, G05, G06, G26). No names, addresses,
 * personal numbers, employer, raw page text, or network access.
 * Strictly fail-closed on duplicate code anchors, malformed digit layouts
 * or mismatched/ambiguous amounts. Every result requires original review.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 else root.FurusatoPdfGCodes=api;
}(typeof window!=="undefined"?window:this,function(){
 "use strict";
 const FIELDS=Object.freeze({
  G04:"salaryGross",G05:"salaryIncomeReference",
  G06:"deductionsReference",G26:"socialInsurance"
 });
 const CODES=Object.freeze(["L01",...Object.keys(FIELDS)]);
 const token=/^[0-9,]$/;
 function spansOf(items){
  if(!Array.isArray(items)||items.length<1||items.length>4000)return [];
  return items.filter(i=>typeof i?.str==="string"&&i.str.length>0&&
   i.str.length<=36&&Array.isArray(i.transform)&&i.transform.length===6&&
   Number.isFinite(i.transform[4])&&Number.isFinite(i.transform[5])&&
   Number.isFinite(i.width)&&i.width>=0&&i.width<=70)
   .map(i=>({s:i.str,x:i.transform[4],y:i.transform[5],w:i.width}));
 }
 function anchors(spans,code){
  const matched=spans.filter(i=>i.s===code).map(i=>({x:i.x,y:i.y,end:i.x+i.w}));
  // Tax forms often split G04 and L01 into 3 adjacent glyphs.
  for(const first of spans.filter(i=>i.s===code[0])){
   for(const second of spans.filter(i=>i.s===code[1]&&
     i.y===first.y&&i.x>first.x&&i.x-first.x<=7)){
    for(const third of spans.filter(i=>i.s===code[2]&&
      i.y===first.y&&i.x>second.x&&i.x-second.x<=7))
      matched.push({x:first.x,y:first.y,end:third.x+third.w});
   }
  }
  return matched;
 }
 function numericGroup(spans,anchor,low,high){
  const candidates=spans.filter(i=>token.test(i.s)&&
    Math.abs(i.y-anchor.y)<=3.5&&
    i.x-anchor.x>=low&&i.x-anchor.x<=high&&
    // The NEXT G-code may share this same baseline; its own '0' and
    // final digit are NOT part of the previous amount.
    !spans.some(g=>g.s==="G"&&g.y===i.y&&
       i.x>=g.x&&i.x<g.x+14))
    .sort((a,b)=>a.x-b.x);
  if(!candidates.length||candidates.length>16)return null;
  for(let j=1;j<candidates.length;j++)
   if(candidates[j].x-candidates[j-1].x>13||
      candidates[j].x-candidates[j-1].x<=0)return null;
  return candidates.map(i=>i.s).join("");
 }
 function toYen(value){
  if(typeof value!=="string"||
    !/^(?:0|[1-9][0-9]{0,11}|[1-9][0-9]{0,2}(?:,[0-9]{3}){1,3})$/.test(value))
    return null;
  const yen=Number(value.replace(/,/g,""));
  return Number.isSafeInteger(yen)&&yen>=0&&yen<=1000000000000?yen:null;
 }
 function review(items){
  const spans=spansOf(items),reasons=[],candidates={};
  const sourceYearAnchor=anchors(spans,"L01");
  let year=null;
  if(sourceYearAnchor.length===1){
   const raw=numericGroup(spans,sourceYearAnchor[0],35,95);
   if(raw==="7"||raw==="8")year=2018+Number(raw);
  }
  if(year===null)reasons.push("CODE_YEAR_UNVERIFIED");
  for(const [code,key] of Object.entries(FIELDS)){
   const marks=anchors(spans,code);
   if(marks.length!==1){
    reasons.push("CODE_"+code+(marks.length?"_AMBIGUOUS":"_MISSING"));
    continue;
   }
   const raw=numericGroup(spans,marks[0],45,125);
   const yen=toYen(raw);
   if(yen===null)reasons.push("CODE_"+code+"_AMOUNT_UNVERIFIED");
   else candidates[key]=yen;
  }
  return {
   schema:"furusato-positioned-gcodes/v1",
   status:"REQUIRES_SOURCE_REVIEW",year,
   candidates:reasons.length?{}:candidates,
   reasons,
   eligibleForManualTransfer:reasons.length===0,
   autoApproved:false,originalCompared:false
  };
 }
 return Object.freeze({review});
}));
