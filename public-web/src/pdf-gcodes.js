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
 // Accept compact PDF numeric text as well as separate glyphs. Reject
 // competing representations; do not mistake digits of a neighbouring code
 // for money. A small width tolerance accounts for glyph advance/bearings.
 function strictSlotAmount(spans,anchor,low=45,high=125){
  const next=spans.filter(i=>/^G(?:[0-9]{2})?$/.test(i.s)&&Math.abs(i.y-anchor.y)<=3.5&&i.x>anchor.x+14).map(i=>i.x-anchor.x);
  const bound=Math.min(high,...next.map(x=>x-1));
  const nearby=spans.filter(i=>Math.abs(i.y-anchor.y)<=3.5&&i.x-anchor.x>=low&&i.x-anchor.x<=bound&&/^[0-9,]+$/.test(i.s)&&
   !spans.some(g=>g.s==="G"&&g.y===i.y&&i.x>=g.x&&i.x<g.x+14));
  const compact=nearby.filter(i=>i.s.length>1),digits=nearby.filter(i=>i.s.length===1);
  if(compact.length>1||(compact.length&&digits.length))return null;
  if(compact.length===1){
   const i=compact[0];
   if(next.length&&i.x-anchor.x+i.w>Math.min(...next)+4)return null;
   return toYen(i.s);
  }
  return toYen(numericGroup(spans,anchor,low,bound));
 }
 function toYen(value){
  if(typeof value!=="string"||
    !/^(?:0|[1-9][0-9]{0,11}|[1-9][0-9]{0,2}(?:,[0-9]{3}){1,3})$/.test(value))
    return null;
  const yen=Number(value.replace(/,/g,""));
  return Number.isSafeInteger(yen)&&yen>=0&&yen<=1000000000000?yen:null;
 }
 // R7 form: exact heading and three printed column markers establish
 // the first date row. Dates are never inferred from arbitrary page numbers.
 // Only the Gregorian YEAR is returned; a second acquisition is unsupported.
 function housingDate(spans,year){
  if(year!==2025)return {};
  const heading=spans.filter(s=>s.s==="居住開始年月日");
  if(heading.length!==1)return {};
  const a=heading[0];
  function near(dx,dy,rx,ry){return spans.filter(s=>Math.abs(s.x-a.x-dx)<=rx&&Math.abs(s.y-a.y-dy)<=ry);}
  const markers=[[22,"年"],[44,"月"],[66,"日"]];
  if(markers.some(([dx,text])=>near(dx,-8.5,4,2).filter(s=>s.s===text).length!==1))return {};
  const era=near(-9,-22.5,5,2).filter(s=>["令和","平成"].includes(s.s));
  // Multiple dates/loans are not supported. Any second-row date evidence
  // blocks calculation rather than guessing which credit to use.
  const second=spans.filter(s=>s.x>=a.x-14&&s.x<=a.x+73&&Math.abs(s.y-a.y+39)<=3&&/^(?:令和|平成|[0-9]{1,2})$/.test(s.s));
  if(second.length)return {detected:true,multiple:true};
  if(era.length!==1)return era.length?{detected:true}:{};
  function read(dx){
   const group=near(dx,-22.5,5,2).filter(s=>/^[0-9]{1,2}$/.test(s.s)).sort((x,y)=>x.x-y.x);
   if(group.length===1)return Number(group[0].s);
   if(group.length===2&&group.every(s=>s.s.length===1)&&group[1].x-group[0].x>=2&&group[1].x-group[0].x<=7)return Number(group.map(s=>s.s).join(""));
   return null;
  }
  const eraYear=read(22),month=read(44),day=read(66);
  if(!eraYear||!month||!day||eraYear>31||month>12||day>31)return {detected:true};
  const y=(era[0].s==="令和"?2018:1988)+eraYear;
  if(y<2014||y>year||(era[0].s==="平成"&&(y>2019||(y===2019&&month>4)))||
     (era[0].s==="令和"&&y===2019&&month<5))return {detected:true};
  const date=new Date(Date.UTC(y,month-1,day));
  return date.getUTCFullYear()===y&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?{detected:true,moveInYear:y}:{detected:true};
 }
 // R7 count slots use their own narrow window; the monetary 45-125pt
 // window would include several neighbouring people-count columns.
 const R7_COUNTS=Object.freeze({"G13":["familySpecificCount",187.22],"G16":["familyElderlyCount",269.78],"G18":["familyOtherCount",324.7],"G72":["familySpecialRelativeCount",379.98],"G20":["familyUnder16Count",435.25]});
 function familyCounts(spans,year){
  if(year!==2025)return {values:{},flags:{}};
  const values={},flags={};
  const layout=Object.entries(R7_COUNTS).map(([code,[key,x]])=>({key,x,marks:anchors(spans,code)}));
  // Require the complete known column geometry, not an isolated G-code.
  if(layout.some(v=>v.marks.length!==1))return {values,flags};
  const base=layout[0].marks[0];
  if(layout.some(v=>Math.abs(v.marks[0].x-base.x-(v.x-layout[0].x))>1.5||Math.abs(v.marks[0].y-base.y)>1.5))return {values,flags};
  function count(mark){
   const candidates=spans.filter(s=>s.x-mark.x>=12&&s.x-mark.x<=23&&Math.abs(s.y-mark.y)<=3.5&&/^[0-9]{1,2}$/.test(s.s)).sort((a,b)=>a.x-b.x);
   if(candidates.length===0)return null;
   const raw=candidates.length===1?candidates[0].s:candidates.length===2&&candidates.every(s=>s.s.length===1)&&candidates[1].x-candidates[0].x>=2&&candidates[1].x-candidates[0].x<=7?candidates.map(s=>s.s).join(""):"";
   return /^(?:0|[1-9][0-9]?)$/.test(raw)&&Number(raw)<=30?Number(raw):null;
  }
  for(const v of layout){
   const n=count(v.marks[0]);
   if(n!==null&&n>0){values[v.key]=n;flags.hasDependents=true;}
  }
  // Positive count of non-resident relatives or secondary salary claims
  // is outside the supported ordinary household route. No inferred zero.
  for(const [code,x,flag] of [["G14",214.5,"hasNonstandardConditions"],["G17",297.42,"hasNonstandardConditions"],["G19",352.34,"hasNonstandardConditions"],["G73",407.61,"hasNonstandardConditions"],["G21",462.54,"hasDisability"],["G22",490.17,"hasDisability"],["G23",517.81,"hasDisability"],["G24",545.45,"hasNonstandardConditions"]]){
   const marks=anchors(spans,code);
   if(marks.length>1){flags.hasNonstandardConditions=true;continue;}
   if(marks.length===1&&Math.abs(marks[0].x-base.x-(x-layout[0].x))<=1.5&&Math.abs(marks[0].y-base.y)<=1.5&&count(marks[0])>0)flags[flag]=true;
  }
  return {values,flags};
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
   const yen=strictSlotAmount(spans,marks[0]);
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
  // R7 G43: spouse total income, not salary receipts or deduction.
  // The heading and neighbouring G44 must match the verified printed layout.
  if(year===2025){
   const marks=anchors(spans,"G43"),next=anchors(spans,"G44");
   const heading=spans.filter(i=>i.s==="配偶者の合計所得");
   if(marks.length===1&&next.length===1&&heading.length===1){
    const x=marks[0],n=next[0],h=heading[0];
    if(Math.abs(n.x-x.x-104.18)<=2&&Math.abs(n.y-x.y-15.94)<=2&&
       Math.abs(h.x-x.x-28.46)<=2&&Math.abs(h.y-x.y-31.93)<=2){
     const nearby=spans.filter(i=>Math.abs(i.y-x.y)<=3.5&&i.x-x.x>=45&&i.x-x.x<=103&&/^[0-9,]+$/.test(i.s));
     const compact=nearby.filter(i=>i.s.length>1),digits=nearby.filter(i=>i.s.length===1);
     if(compact.length<=1&&!(compact.length&&digits.length)){
      const income=optionalAmount(x,103);
      if(income!==null&&income>0&&income<=1330000){
       optionalCandidates.sourceSpouseIncome=income;sourceIndicators.hasSpouse=true;
      }
     }
    }
   }
  }
  const counts=familyCounts(spans,year);
  Object.assign(sourceIndicators,counts.flags);Object.assign(optionalCandidates,counts.values);
  const date=housingDate(spans,year);
  if(date.detected)sourceIndicators.hasMortgage=true;
  if(date.multiple)sourceIndicators.hasNonstandardConditions=true;
  if(date.moveInYear!==undefined)optionalCandidates.mortgageMoveInYear=date.moveInYear;
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
  if(coded.year===2025&&coded.sourceIndicators?.hasDependents===true)for(const [key] of Object.values(R7_COUNTS)){
   const n=coded.optionalCandidates?.[key];if(Number.isSafeInteger(n)&&n>0&&n<=30)result[key]=n;
  }
  const spouse=coded.optionalCandidates?.sourceSpouseIncome;
  if(coded.year===2025&&coded.sourceIndicators?.hasSpouse===true&&Number.isSafeInteger(spouse)&&spouse>0&&spouse<=1330000)result.sourceSpouseIncome=spouse;
  const moveIn=coded.optionalCandidates?.mortgageMoveInYear;
  if(coded.year===2025&&coded.sourceIndicators?.hasMortgage===true&&!coded.sourceIndicators?.hasNonstandardConditions&&
     Number.isSafeInteger(moveIn)&&moveIn>=2014&&moveIn<=2025)result.mortgageMoveInYear=moveIn;
  return result;
 }
 // A human, not the parser, may attest that an unreadable G26 is blank.
 // Only the precise partial review with all other required fields present
 // is eligible. Missing/duplicate anchors or any other failure stay HOLD.
 function canConfirmSocialZero(r){
  return r?.schema==="furusato-positioned-gcodes/v1"&&r.eligibleForManualTransfer===false&&
   [2025,2026].includes(r.year)&&Array.isArray(r.reasons)&&r.reasons.length===1&&
   r.reasons[0]==="CODE_G26_AMOUNT_UNVERIFIED"&&r.candidates&&
   r.candidates.socialInsurance===undefined&&Object.values(FIELDS).filter(k=>k!=="socialInsurance").every(k=>Number.isSafeInteger(r.candidates[k])&&r.candidates[k]>=0&&r.candidates[k]<=1000000000000);
 }
 function confirmSocialZero(r){
  if(!canConfirmSocialZero(r))return null;
  return {...r,candidates:{...r.candidates,socialInsurance:0},reasons:[],
   eligibleForManualTransfer:true,autoApproved:false,originalCompared:false,
   socialZeroManuallyConfirmed:true};
 }
 return Object.freeze({review,verifiedOptional,canConfirmSocialZero,confirmSocialZero});
}));
