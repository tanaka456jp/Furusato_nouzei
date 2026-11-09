"use strict";
/**
 * Negative-only layout audit of a single PDF.js text layer.
 * Detects contradictions where a printed label and nearby amount have
 * geometrical evidence. NEVER invents missing values and NEVER upgrades HOLD.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 else root.FurusatoPdfLayout=api;
}(typeof window!=="undefined"?window:this,function(){
 "use strict";
 const LABELS=[
  {key:"salaryGross",pattern:/^(?:給与)?支払金額[:：]?$/},
  {key:"salaryIncomeReference",pattern:/^給与所得控除後の金額(?:\(調整控除後\))?[:：]?$/},
  {key:"deductionsReference",pattern:/^所得控除の額の合計額[:：]?$/},
  {key:"socialInsurance",pattern:/^社会保険料等の金額[:：]?$/
  }
 ];
 function clean(v){return String(v||"").normalize("NFKC").replace(/\s+/g,"").trim();}
 function number(s){
  if(!/^(?:0|[1-9][0-9]{0,11}|[1-9][0-9]{0,2}(?:,[0-9]{3}){1,3})(?:円)?$/.test(s))
    return null;
  const n=Number(s.replace(/[円,]/g,""));
  return Number.isSafeInteger(n)&&n>=0&&n<=1000000000000?n:null;
 }
 function audit(items,expected){
  if(!Array.isArray(items)||items.length===0||items.length>4000||
     !expected||typeof expected!=="object"||Array.isArray(expected))
   return {status:"UNVERIFIED",checkedFields:[],reasons:["POSITION_DATA_NOT_VERIFIED"]};
  const spans=[];
  for(const item of items){
   if(typeof item?.str!=="string"||item.str.length>240||
      !Array.isArray(item.transform)||item.transform.length!==6)continue;
   const x=Number(item.transform[4]),y=Number(item.transform[5]);
   if(!Number.isFinite(x)||!Number.isFinite(y))continue;
   spans.push({s:clean(item.str),x,y});
  }
  const anchors=[],numbers=[];
  for(const span of spans){
   for(const f of LABELS)
    if(f.pattern.test(span.s))anchors.push({key:f.key,x:span.x,y:span.y});
   const n=number(span.s);
   if(n!==null)numbers.push({n,x:span.x,y:span.y});
  }
  const reasons=[],checked=[];
  for(const f of LABELS){
   const marks=anchors.filter(a=>a.key===f.key);
   if(marks.length>1){
    reasons.push("LAYOUT_DUPLICATE_LABEL_"+f.key);continue;
   }
   if(marks.length!==1)continue;
   const mark=marks[0];
   // PDF coordinates normally have y increasing upward.
   // Accept only a strict, small neighboring region; do NOT infer far cells.
   const candidates=numbers.filter(n=>{
     const dx=n.x-mark.x,dy=mark.y-n.y;
     return dy>=-4&&dy<=30&&dx>=-8&&dx<=110;
   });
   const unique=Array.from(new Set(candidates.map(x=>x.n)));
   if(unique.length>1||candidates.length>1){
    reasons.push("LAYOUT_AMBIGUOUS_AMOUNT_"+f.key);continue;
   }
   if(unique.length===1){
    checked.push(f.key);
    if(!Number.isSafeInteger(expected[f.key])||expected[f.key]!==unique[0])
     reasons.push("LAYOUT_VALUE_MISMATCH_"+f.key);
   }
  }
  return {status:reasons.length?"CONFLICT":
    checked.length===LABELS.length?"MATCH":"PARTIAL",
    checkedFields:checked,reasons,autoApproved:false};
 }
 return {audit:audit};
}));