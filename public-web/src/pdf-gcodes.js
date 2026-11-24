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
 // Positive statutory amounts found in a digital withholding slip are
 // independently preserved as unsupported-condition evidence. Missing or
 // unreadable fields never certify the absence of a deduction.
 const ADDITIONAL=Object.freeze({
  G27:"hasLifeInsurance",G28:"hasEarthquakeInsurance",
  G29:"hasMortgage",G47:"hasIncomeAdjustment",G74:"hasDependents"
 });
 const REVIEW_AMOUNTS=Object.freeze({G29:["mortgageSourceApplied",600000],G46:["sourceBasicYen",1040000],G47:["sourceAdjustmentYen",150000]});
 // R7 code-layer layout checked locally. No original amounts retained.
 const R7_AMOUNTS=Object.freeze({"G30":["sourceInsurance_generalNew",100000000,"hasLifeInsurance"],"G31":["sourceInsurance_generalOld",100000000,"hasLifeInsurance"],"G32":["sourceInsurance_medicalNew",100000000,"hasLifeInsurance"],"G33":["sourceInsurance_pensionNew",100000000,"hasLifeInsurance"],"G34":["sourceInsurance_pensionOld",100000000,"hasLifeInsurance"],"G45":["sourceInsurance_longTermOld",100000000,"hasEarthquakeInsurance"],"G36":["mortgageSourcePossible",600000,"hasMortgage"]});
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
  function optionalAmount(anchor,high=125){
   const split=toYen(numericGroup(spans,anchor,45,high));
   if(split!==null)return split;
   // Some PDF.js text layers keep the entire amount in one text item.
   // Unlike the required four fields, optional evidence may be read from
   // a uniquely anchored compact number without promoting an estimate.
   const compact=spans.filter(i=>i.s.length>1&&
     /^[0-9][0-9,]*$/.test(i.s)&&
     Math.abs(i.y-anchor.y)<=3.5&&
     i.x-anchor.x>=45&&i.x-anchor.x<=high);
   return compact.length===1?toYen(compact[0].s):null;
  }
  const sourceIndicators={};
  for(const [code,flag] of Object.entries(ADDITIONAL)){
   const marks=anchors(spans,code);
   if(marks.length>1){
    sourceIndicators.hasNonstandardConditions=true;
    continue;
   }
   if(marks.length!==1)continue;
   const amount=optionalAmount(marks[0]);
   if(amount!==null&&amount>0)sourceIndicators[flag]=true;
  }
  const optionalCandidates={};
  // Unlike a positive warning flag, a prefilled amount must have an
  // unambiguous numeric representation. Reject overlapping representations,
  // duplicate compact tokens and conflicting nearby digit sequences.
  for(const [code,[key,max,flag]] of Object.entries({...REVIEW_AMOUNTS,...(year===2025?R7_AMOUNTS:{})})){
   const marks=anchors(spans,code);
   if(marks.length!==1)continue;
   const anchor=marks[0];
   const next=spans.filter(i=>/^G(?:[0-9]{2})?$/.test(i.s)&&Math.abs(i.y-anchor.y)<=3.5&&i.x>anchor.x+14).map(i=>i.x-anchor.x);
   const high=Math.min(125,...next.map(x=>x-1));
   const nearby=spans.filter(i=>Math.abs(i.y-anchor.y)<=3.5&&i.x-anchor.x>=45&&i.x-anchor.x<=high&&/^[0-9,]+$/.test(i.s));
   const compact=nearby.filter(i=>i.s.length>1);
   const digits=nearby.filter(i=>i.s.length===1);
   if(compact.length>1||(compact.length&&digits.length))continue;
   const amount=optionalAmount(anchor,high);
   if(amount!==null&&amount<=max&&(!flag||amount>0)){optionalCandidates[key]=amount;if(flag)sourceIndicators[flag]=true;}
  }
  return {
   schema:"furusato-positioned-gcodes/v1",
   status:"REQUIRES_SOURCE_REVIEW",year,
   candidates, // Each numeric field independently validated; missing fields stay blank.
   sourceIndicators, // Only categorical flags; no raw OCR or identifying fields.
   optionalCandidates, // Review-only, never evidence of an absent deduction.
   reasons,
   eligibleForManualTransfer:reasons.length===0,
   autoApproved:false,originalCompared:false
  };
 }
 function verifiedOptional(coded,selected){
  if(!coded?.eligibleForManualTransfer||!selected?.eligibleForManualTransfer||
     ![2025,2026].includes(coded.year)||coded.year!==selected.year||
     Object.values(FIELDS).some(k=>!Number.isSafeInteger(coded.candidates?.[k])||coded.candidates[k]!==selected.candidates?.[k]))
   return {};
  const result={};
  for(const [key,max,flag] of Object.values({...REVIEW_AMOUNTS,...(coded.year===2025?R7_AMOUNTS:{})})){
   const n=coded.optionalCandidates?.[key];
   if(Number.isSafeInteger(n)&&n>=0&&n<=max&&(!flag||(n>0&&coded.sourceIndicators?.[flag]===true)))result[key]=n;
  }
  return result;
 }
 return Object.freeze({review,verifiedOptional});
}));
