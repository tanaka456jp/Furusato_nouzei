"use strict";
/**
 * Offline one-slip-per-PDF-page batch review and CSV report.
 * Only an explicitly selected local recipient name may be retained in RAM.
 * Never retain address, employer, personal number or raw OCR text.
 * A row is never automatically tax-certified: source verification and
 * unsupported-condition confirmation must be performed for EACH page.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 else root.FurusatoBatchCore=api;
}(typeof window!=="undefined"?window:this,function(){
 "use strict";
 const FIELDS=Object.freeze(["salaryGross","salaryIncomeReference",
  "deductionsReference","socialInsurance"]);
 const FLAGS=Object.freeze(["hasSpouse","hasDependents","hasLifeInsurance",
  "hasEarthquakeInsurance","hasMortgage","hasOtherIncome","hasMedical",
  "hasSplitIncome","hasIncomeAdjustment","hasNonstandardConditions"]);
 const MAX_ROWS=20;
 const PREMIUM_KEYS=Object.freeze(["generalNew","generalOld","medicalNew","pensionNew","pensionOld","earthquake","longTermOld"]);
 const PREMIUM_FIELDS=Object.freeze(["source","target"].flatMap(prefix=>PREMIUM_KEYS.map(k=>prefix+"Insurance_"+k)));
 const OTHER_FIELDS=Object.freeze(["otherSourceText","otherTargetText"]);
 const MEDICAL_FIELDS=Object.freeze(["medicalNetPaidYen"]);
 const MEDICAL_SUMMARY_KEYS=Object.freeze(["nationalDeductionYen","netEligibleYen","thresholdYen"]);
 function medicalActive(row){return row.medicalNetPaidYen!==""&&row.medicalNetPaidYen!=="0";}
 function parseMedical(row){
  const raw=row.medicalNetPaidYen;
  return typeof raw==="string"&&/^[1-9][0-9]{0,11}$/.test(raw)&&Number(raw)<=100000000000?Number(raw):null;
 }
 const MORTGAGE_FIELDS=Object.freeze(["mortgageSourceApplied","mortgageSourcePossible","mortgageMoveInYear","mortgageCapClass"]);
 const MORTGAGE_SUMMARY_KEYS=Object.freeze(["sourceAppliedYen","possibleYen","nationalHousingYen","residentHousingYen"]);
 function mortgageActive(row){return row.sourceIndicators?.hasMortgage===true||row.mortgageReviewed===true||MORTGAGE_FIELDS.some(k=>row[k]!=="");}
 const HIGH_FIELDS=Object.freeze(["sourceBasicYen","sourceAdjustmentYen","sourceAdjustmentExtras","targetAdjustmentExtras"]);
 const HIGH_SUMMARY_KEYS=Object.freeze(["sourceBasicYen","sourceAdjustmentYen","targetBasicYen","targetAdjustmentYen","targetSalaryIncomeYen"]);
 const isHigh=gross=>Number.isSafeInteger(gross)&&gross>8500000;
 function highActive(row){return isHigh(row.originalCandidates?.salaryGross)||isHigh(row.candidates?.salaryGross)||row.highReviewed===true||HIGH_FIELDS.some(k=>row[k]!=="");}
 function parseHighMoney(raw,max){return typeof raw==="string"&&/^(0|[1-9][0-9]{0,7})$/.test(raw)&&Number(raw)<=max?Number(raw):null;}
 function buildAdjustment(year,gross,household,other,premiums,raw){
  if(typeof raw!=="string"||raw.length>3000||!other||!premiums)return null;
  const special=k=>k==="special"||k==="cohabitingSpecial";
  const threshold=year===2025?580000:620000,extras=[];
  if(raw.trim()!=="")for(const line of raw.trim().split(/\r?\n/)){
   const p=line.split(",").map(x=>x.trim()),age=parseHighMoney(p[0],130),income=parseHighMoney(p[1],threshold);
   if(p.length!==3||age===null||income===null||!["0","1"].includes(p[2])||!(age<23||p[2]==="1"))return null;
   extras.push({age,income,specialDisability:p[2]==="1",relationshipReviewed:true});
  }
  if(year===2026&&premiums.generalNew>0&&extras.some(m=>m.age<23)&&!household.relatives.some(m=>m.age<23&&m.income<=threshold))return null;
  return {year,grossSalary:gross,selfSpecialDisability:other.disability.self==="special",
   spouse:household.spouse?{income:household.spouse.income,specialDisability:special(other.disability.spouse),relationshipReviewed:true}:null,
   relatives:household.relatives.map((m,i)=>({age:m.age,income:m.income,specialDisability:special(other.disability.relatives[i]),relationshipReviewed:true})).concat(extras),
   conditions:"annual-resident-salary-only-adjustment-facts-reviewed"};
 }
 const OTHER_FLAGS=Object.freeze(["hasDisability","hasWidow","hasSingleParent","hasWorkingStudent","hasSmallEnterpriseContributions"]);
 function otherActive(row){return row.otherReviewed===true||OTHER_FIELDS.some(k=>row[k]!=="");}
 function insuranceActive(row){
  return row.insuranceReviewed===true||PREMIUM_FIELDS.some(k=>row[k]!=="");
 }
 function allowedIndicators(row){
  return [...(insuranceActive(row)?["hasSpouse","hasDependents","hasLifeInsurance","hasEarthquakeInsurance"]:["hasSpouse","hasDependents"]),...(otherActive(row)?OTHER_FLAGS:[]),...(isHigh(row.originalCandidates?.salaryGross)?["hasIncomeAdjustment"]:[]),...(mortgageActive(row)?["hasMortgage"]:[])];
 }
 function parsePremiums(row,prefix){
  const values={};
  for(const k of PREMIUM_KEYS){
   const raw=row[prefix+"Insurance_"+k];
   if(typeof raw!=="string"||!(raw===""||/^(0|[1-9][0-9]{0,8})$/.test(raw)))return null;
   const n=raw===""?0:Number(raw);if(n>100000000)return null;
   values[k]=n;
  }
  return values;
 }
 function safeAmount(value){
  return Number.isSafeInteger(value)&&value>=0&&value<=1000000000000;
 }
 function holdRow(page,reason){
  return {page,label:"",year:null,sourceYear:null,candidates:null,originalCandidates:null,sourceIndicators:{},deductionsOverrideActive:false,appliedDeductionsYen:null,sourceValid:false,
   confirmed:false,noExclusions:false,forecastReviewed:false,filing:"one-stop",municipality:"",calculatedMunicipality:null,calculatedFiling:null,residentLevyYen:null,calculationBasis:null,
   trialInput:"",familySourceText:"",familyTargetText:"",familyReviewed:false,insuranceReviewed:false,otherSourceText:"",otherTargetText:"",otherReviewed:false,otherSummary:null,medicalNetPaidYen:"",medicalSummary:null,highReviewed:false,highSummary:null,mortgageReviewed:false,mortgageSummary:null,...Object.fromEntries(MORTGAGE_FIELDS.map(k=>[k,""])),...Object.fromEntries(HIGH_FIELDS.map(k=>[k,""])),...Object.fromEntries(PREMIUM_FIELDS.map(k=>[k,""])),originalYear:null,familySummary:null,insuranceSummary:null,comparison:null,calculatedSnapshot:null,status:"HOLD",donationLimitYen:null,reason:reason||"読取・確認待ち"};
 }
 function fromPage(page,review,targetYear){
  const row=holdRow(page,"原票の確認待ち");
  if(typeof review?.recipientName==="string"){
    const name=review.recipientName.normalize("NFKC").trim();
    if(name.length>=2&&name.length<=40&&!/^[=+@-]/.test(name)&&
       !/[\u0000-\u001f\u007f-\u009f]/.test(name))
      row.label=name;
  }
  if(!Number.isSafeInteger(page)||page<1||page>MAX_ROWS||
     !review||![2025,2026].includes(review.year)||
     !review.candidates||typeof review.candidates!=="object"){
    row.reason="原票の年分・必要金額を確認できません";
    return row;
  }
  row.sourceYear=review.year;
  row.originalYear=review.year;
  row.year=targetYear===undefined?review.year:targetYear;
  // Never let a checkbox or an amount edit override positive source facts.
  if(review.sourceIndicators&&typeof review.sourceIndicators==="object"&&
     !Array.isArray(review.sourceIndicators)){
    for(const [key,value] of Object.entries(review.sourceIndicators)){
     if((!FLAGS.includes(key)&&!OTHER_FLAGS.includes(key))||value!==true)
      row.sourceIndicators.hasNonstandardConditions=true;
     else row.sourceIndicators[key]=true;
    }
  }else if(review.sourceIndicators!==undefined){
   row.sourceIndicators.hasNonstandardConditions=true;
  }
  // Independently verified G-code fields may be complete even when one
  // different field (e.g. blank insurance) is absent. Let the operator
  // correct the missing field, but never treat source recognition as consent.
  row.candidates=Object.fromEntries(FIELDS.filter(k=>
    safeAmount(review.candidates[k])).map(k=>[k,review.candidates[k]]));
  // Frozen source-year snapshot, separate from editable forecast amounts.
  row.originalCandidates=Object.freeze({...row.candidates});
  row.socialZeroEligible=review.schema==="furusato-positioned-gcodes/v1"&&review.eligibleForManualTransfer===false&&Array.isArray(review.reasons)&&review.reasons.length===1&&review.reasons[0]==="CODE_G26_AMOUNT_UNVERIFIED"&&review.candidates.socialInsurance===undefined&&FIELDS.filter(k=>k!=="socialInsurance").every(k=>safeAmount(row.originalCandidates[k]));
  // Partial blank-social rows may retain review-only candidates, but
  // sourceValid, consent and estimate eligibility remain unchanged.
  const optionalReview=review.eligibleForManualTransfer===true||row.socialZeroEligible;
  const r8=review.year===2026&&review.r8VerifiedLayout===true;
  if(review.year===2025&&optionalReview&&row.sourceIndicators.hasSpouse===true&&Number.isSafeInteger(review.optionalCandidates?.sourceSpouseIncome)&&review.optionalCandidates.sourceSpouseIncome>0&&review.optionalCandidates.sourceSpouseIncome<=1330000)row.spouseIncomeHint=review.optionalCandidates.sourceSpouseIncome;
  // Read-only hints: no ages, incomes, household rows or attestations invented.
  if((review.year===2025||r8)&&optionalReview&&row.sourceIndicators.hasDependents===true){
   row.familyCountHints=Object.freeze(Object.fromEntries(["familySpecificCount","familyElderlyCount","familyOtherCount","familySpecialRelativeCount","familyUnder16Count"].filter(k=>(!r8||k==="familySpecialRelativeCount")&&Number.isSafeInteger(review.optionalCandidates?.[k])&&review.optionalCandidates[k]>0&&review.optionalCandidates[k]<=30).map(k=>[k,review.optionalCandidates[k]])));
  }
  if(optionalReview){
   for(const [key,max,active] of [["mortgageSourceApplied",600000,row.sourceIndicators.hasMortgage===true],["sourceBasicYen",1040000,isHigh(row.originalCandidates.salaryGross)],["sourceAdjustmentYen",150000,isHigh(row.originalCandidates.salaryGross)],
    ["mortgageSourcePossible",600000,(review.year===2025||r8)&&row.sourceIndicators.hasMortgage===true],
    ["mortgageMoveInYear",review.year,(review.year===2025||r8)&&row.sourceIndicators.hasMortgage===true&&!row.sourceIndicators.hasNonstandardConditions&&review.optionalCandidates?.mortgageMoveInYear>=2014],
    ...["generalNew","generalOld","medicalNew","pensionNew","pensionOld","longTermOld"].map(k=>["sourceInsurance_"+k,100000000,(review.year===2025||(r8&&["generalNew","generalOld","medicalNew"].includes(k)))&&row.sourceIndicators[k==="longTermOld"?"hasEarthquakeInsurance":"hasLifeInsurance"]===true])]){
    const n=review.optionalCandidates?.[key];if(active&&Number.isSafeInteger(n)&&n>=0&&n<=max)row[key]=String(n);
   }
  }
  row.sourceValid=review.eligibleForManualTransfer===true&&
    [2025,2026].includes(row.year)&&
    FIELDS.every(k=>safeAmount(row.candidates[k]));

  return row;
 }
 function canConfirmSocialZero(row){
  return !!row&&row.socialZeroEligible===true&&row.sourceYear===row.originalYear&&[2025,2026].includes(row.sourceYear)&&[row.sourceYear,row.sourceYear+1].includes(row.year)&&[2025,2026].includes(row.year)&&row.originalCandidates?.socialInsurance===undefined&&(row.candidates?.socialInsurance===undefined||row.candidates?.socialInsurance===null)&&FIELDS.filter(k=>k!=="socialInsurance").every(k=>safeAmount(row.originalCandidates?.[k])&&row.candidates?.[k]===row.originalCandidates[k]);
 }
 function confirmSocialZero(row){
  if(!canConfirmSocialZero(row))return false;
  edit(row,"socialInsurance","0");
  row.originalCandidates=Object.freeze({...row.originalCandidates,socialInsurance:0});
  row.socialZeroEligible=false;row.socialZeroManuallyConfirmed=true;
  row.reason="原票空欄を手動確認して0円設定しました。試算年の見込額・適用条件を確認してください";
  return true;
 }
 function canEstimate(row){
  return !!row&&row.sourceValid&&row.candidates&&
   [2025,2026].includes(row.sourceYear)&&
   [2025,2026].includes(row.year)&&
   (row.sourceYear===row.year||row.sourceYear===row.year-1)&&
   FIELDS.every(k=>safeAmount(row.candidates[k]));
 }
 // Bind every derived amount to the current row inputs, including edits
 // made outside the normal UI event path.
 function snapshot(row){
  return JSON.stringify([row.page,row.label,row.year,row.sourceYear,row.candidates,
    row.originalCandidates,row.socialZeroEligible,row.socialZeroManuallyConfirmed,row.sourceIndicators,row.familyCountHints,row.spouseIncomeHint,row.sourceValid,row.deductionsOverrideActive,
    row.confirmed,row.noExclusions,row.forecastReviewed,row.municipality,row.filing,row.trialInput,
    row.originalYear,row.familySourceText,row.familyTargetText,row.familyReviewed,row.insuranceReviewed,row.otherReviewed,...OTHER_FIELDS.map(k=>row[k]),...MEDICAL_FIELDS.map(k=>row[k]),row.highReviewed,...HIGH_FIELDS.map(k=>row[k]),row.mortgageReviewed,...MORTGAGE_FIELDS.map(k=>row[k]),
    ...PREMIUM_FIELDS.map(k=>row[k])]);
 }
 function invalidate(row){
  row.status="HOLD";row.donationLimitYen=null;row.appliedDeductionsYen=null;
  row.calculatedMunicipality=null;row.calculatedFiling=null;row.residentLevyYen=null;row.calculationBasis=null;
  row.comparison=null;row.familySummary=null;row.insuranceSummary=null;row.otherSummary=null;row.medicalSummary=null;row.highSummary=null;row.mortgageSummary=null;row.calculatedSnapshot=null;
 }
 function edit(row,key,value){
  if(!row||typeof row!=="object")throw Error("BATCH_ROW_INVALID");
  if(key==="label"){
    row.label=String(value??"").slice(0,40);
  }else if(key==="familySourceText"||key==="familyTargetText"||OTHER_FIELDS.includes(key)||MEDICAL_FIELDS.includes(key)||HIGH_FIELDS.includes(key)||MORTGAGE_FIELDS.includes(key)){
    row[key]=String(value??"").slice(0,3000);
  }else if(PREMIUM_FIELDS.includes(key)){
    row[key]=String(value??"").slice(0,12);
  }else if(key==="trialInput"){
    row.trialInput=String(value??"").slice(0,12);
    invalidate(row);row.reason="試算寄附額を変更しました。再試算してください";return row;
  }else if(key==="municipality"){
    row.municipality=["standard","designated"].includes(value)?value:"";
  }else if(key==="year"||key==="sourceYear"){
    const n=Number(value);
    row[key]=String(value)===""?null:
      Number.isSafeInteger(n)&&[2025,2026].includes(n)?n:null;
  }else if(FIELDS.includes(key)){
    const raw=String(value??"");
    const numeric=/^(0|[1-9][0-9]{0,11})$/.test(raw)?Number(raw):null;
    if(row.candidates===null)row.candidates={};
    row.candidates[key]=safeAmount(numeric)?numeric:null;
    if(key==="deductionsReference")row.deductionsOverrideActive=true;
  }else throw Error("BATCH_EDIT_FIELD_NOT_ALLOWED");
  row.sourceValid=!!row.candidates&&
    [2025,2026].includes(row.sourceYear)&&
    [2025,2026].includes(row.year)&&
    FIELDS.every(k=>safeAmount(row.candidates[k]));
  row.confirmed=false;row.noExclusions=false;row.forecastReviewed=false;row.familyReviewed=false;row.insuranceReviewed=false;row.otherReviewed=false;row.highReviewed=false;row.mortgageReviewed=false;
  invalidate(row);
  row.reason="手入力を変更しました。原票と試算対象年の見込額・控除条件を再確認してください";
  return row;
 }
 // A compact, local multiline editor: one family member per line.
 // S,age,income = spouse; R,age,income,0/1 = relative, cohabiting
 // direct ascendant. Explicit "なし" is required for an empty household.
 function parseFamily(raw){
  if(typeof raw!=="string"||raw.length>3000)return null;
  if(raw.trim()==="なし")return {spouse:null,relatives:[]};
  let spouse=null,relatives=[];
  const number=x=>/^(0|[1-9][0-9]{0,8})$/.test(x)?Number(x):null;
  const lines=raw.trim().split(/\r?\n/);
  if(lines.length>31)return null;
  for(const line of lines){
   const p=line.split(",").map(x=>x.trim()),age=number(p[1]||""),income=number(p[2]||"");
   if(age===null||income===null||age>130||income>100000000)return null;
   if(p[0]==="S"&&p.length===3&&!spouse)
    spouse={age,income,eligibilityReviewed:true};
   else if(p[0]==="R"&&p.length===4&&["0","1"].includes(p[3])&&relatives.length<30)
    relatives.push({age,income,cohabitingDirectAscendant:p[3]==="1",eligibilityReviewed:true});
   else return null;
  }
  return {spouse,relatives};
 }
 // Explicit basic confirmation, never a detail attestation.
 function confirmBasic(row){
  if(!canEstimate(row)||!["standard","designated"].includes(row.municipality)||
     !["one-stop","return"].includes(row.filing)||
     Object.entries(row.sourceIndicators||{}).some(([k,v])=>v!==true||!allowedIndicators(row).includes(k)))return false;
  row.confirmed=true;row.noExclusions=true;row.forecastReviewed=row.sourceYear!==row.year;
  invalidate(row);row.reason="基本確認済み。該当する控除の個別明細を確認して試算してください";
  return true;
 }
 function familyDetailsActive(row){
  return row.familySourceText!==""||row.familyTargetText!==""||row.familyReviewed===true||insuranceActive(row)||otherActive(row);
 }
 // Copy only the operator's entered annual premium amounts. Never copy a
 // computed deduction: the target-year engine recomputes the statutory rules.
 // Explicit copy of ordinary family facts, not tax deductions or consent.
 function copySourceFamily(row){
  if(!canEstimate(row)||row.sourceYear!==row.originalYear||
     !["","なし"].includes(row.otherSourceText.trim())||!["","なし"].includes(row.otherTargetText.trim())||
     row.sourceAdjustmentExtras!==""||row.targetAdjustmentExtras!=="")return false;
  const source=parseFamily(row.familySourceText);
  if(!source)return false;
  const delta=row.year-row.sourceYear;
  const members=[...(source.spouse?[source.spouse]:[]),...source.relatives];
  if(members.some(m=>m.age+delta>130||(m.cohabitingDirectAscendant&&m.age<70)))return false;
  const lines=[];
  if(source.spouse)lines.push(["S",source.spouse.age+delta,source.spouse.income].join(","));
  for(const m of source.relatives)lines.push(["R",m.age+delta,m.income,m.cohabitingDirectAscendant?1:0].join(","));
  edit(row,"familyTargetText",lines.join("\n")||"なし");
  row.reason="家族明細をコピーしました。試算年の所得・家族構成・適用条件を再確認してください";
  return true;
 }
 function copySourcePremiums(row){
  if(!row||!canEstimate(row)||!parsePremiums(row,"source")||
     !PREMIUM_KEYS.some(k=>row["sourceInsurance_"+k]!==""))return false;
  for(const k of PREMIUM_KEYS)edit(row,"targetInsurance_"+k,row["sourceInsurance_"+k]);
  row.reason="原票年の年間保険料を試算年へコピーしました。変更があれば訂正し、再確認してください";
  return true;
 }
 function familyActive(row){return familyDetailsActive(row)||medicalActive(row)||highActive(row)||mortgageActive(row);}
 // Six fixed fields, followed by one disability code per family relative
 // in exactly the same order as the reviewed family editor. No identity data.
 function parseOther(raw,household,combined){
  if(typeof raw!=="string"||raw.length>3000)return null;
  const count=household.relatives.length;
  if(raw.trim()==="なし")return {disability:{self:"none",spouse:"none",relatives:Array(count).fill("none")},
   maritalRelief:"none",childIndex:null,workingStudent:false,smallEnterpriseContributions:0};
  const p=raw.trim().split(",").map(v=>v.trim());
  const kinds=["none","ordinary","special","cohabitingSpecial"];
  const relief=["none","widowDivorced","widowBereaved","singleParentFather","singleParentMother"];
  if(p.length!==6+count||!kinds.slice(0,3).includes(p[0])||!kinds.includes(p[1])||!relief.includes(p[2])||
     !/^(0|[1-9][0-9]?)$/.test(p[3])||!["0","1"].includes(p[4])||
     !/^(0|[1-9][0-9]{0,8})$/.test(p[5])||Number(p[5])>combined||
     p.slice(6).some(v=>!kinds.includes(v))||Number(p[3])>count)return null;
  return {disability:{self:p[0],spouse:p[1],relatives:p.slice(6)},maritalRelief:p[2],
   childIndex:Number(p[3])===0?null:Number(p[3])-1,workingStudent:p[4]==="1",smallEnterpriseContributions:Number(p[5])};
 }
 function calculateFamily(row,engine,familyEngine,sourceEngine){
  try{
   if((familyDetailsActive(row)&&row.familyReviewed!==true)||row.originalYear!==row.sourceYear||
      !row.originalCandidates||!FIELDS.every(k=>safeAmount(row.originalCandidates[k]))||
      !familyEngine||!sourceEngine){row.reason="原票年と試算年の家族明細・原票4金額を確認してください";return row;}
   const empty={spouse:null,relatives:[]};
   const source=familyDetailsActive(row)?parseFamily(row.familySourceText):empty,target=familyDetailsActive(row)?parseFamily(row.familyTargetText):empty;
   if(!source||!target){row.reason="家族明細の形式または人数を確認してください";return row;}
   if(row.sourceYear===row.year&&JSON.stringify(source)!==JSON.stringify(target)){
    row.reason="同一年分の家族明細が一致しません";return row;
   }
   const o=row.originalCandidates,v=row.candidates;
   const sourceHigh=isHigh(o.salaryGross),targetHigh=isHigh(v.salaryGross),high=sourceHigh||targetHigh;
   if(highActive(row)&&(!high||row.highReviewed!==true||o.salaryGross>20000000||v.salaryGross>20000000||
      (!sourceHigh&&(row.sourceBasicYen!==""||row.sourceAdjustmentYen!==""||row.sourceAdjustmentExtras!==""))||
      (!targetHigh&&row.targetAdjustmentExtras!=="")||(row.sourceYear===row.year&&sourceHigh!==targetHigh))){
    row.reason="高額給与の原票・所得金額調整控除の条件を確認してください";return row;
   }
   const insured=insuranceActive(row)||high;
   const sourcePremiums=insured?parsePremiums(row,"source"):null,targetPremiums=insured?parsePremiums(row,"target"):null;
   if(insured&&((insuranceActive(row)&&row.insuranceReviewed!==true)||!sourcePremiums||!targetPremiums)){
    row.reason="原票年・試算年の保険料明細と適用条件を確認してください";return row;
   }
   if(insured&&row.sourceYear===row.year&&JSON.stringify(sourcePremiums)!==JSON.stringify(targetPremiums)){
    row.reason="同一年分の保険料明細が一致しません";return row;
   }
   const other=otherActive(row)||high;
   const sourceOther=other?parseOther(!otherActive(row)&&high?"なし":row.otherSourceText,source,o.socialInsurance):null;
   const targetOther=other?parseOther(!otherActive(row)&&high?"なし":row.otherTargetText,target,v.socialInsurance):null;
   if(other&&(!insured||(otherActive(row)&&row.otherReviewed!==true)||!sourceOther||!targetOther)){
    row.reason="原票年・試算年のその他所得控除・保険料を確認してください";return row;}
   if(other&&row.sourceYear===row.year&&JSON.stringify(sourceOther)!==JSON.stringify(targetOther)){
    row.reason="同一年分のその他所得控除明細が一致しません";return row;}
   const indicators={...row.sourceIndicators};
   const mortgage=mortgageActive(row);
   if(mortgage){
    if(row.mortgageReviewed!==true){row.reason="住宅ローン控除の原票・適用継続条件を確認してください";return row;}
    delete indicators.hasMortgage; // Only publish after separate credit reconciliation below.
   }
   let sourceFacts=null,targetFacts=null,sourceBasic=null,sourceAdjustment=null;
   if(sourceHigh){
    sourceFacts=buildAdjustment(row.sourceYear,o.salaryGross,source,sourceOther,sourcePremiums,row.sourceAdjustmentExtras);
    sourceBasic=parseHighMoney(row.sourceBasicYen,1040000);sourceAdjustment=parseHighMoney(row.sourceAdjustmentYen,150000);
    if(!sourceFacts||sourceBasic===null||sourceAdjustment===null){row.reason="原票のG46・G47と所得金額調整控除を確認してください";return row;}
    if(indicators.hasIncomeAdjustment===true){delete indicators.hasIncomeAdjustment;indicators.hasSalaryAdjustment=true;}
   }
   if(targetHigh){
    targetFacts=buildAdjustment(row.year,v.salaryGross,target,targetOther,targetPremiums,row.targetAdjustmentExtras);
    if(!targetFacts){row.reason="試算年の所得金額調整控除の条件を確認してください";return row;}
   }
   if(sourceHigh&&targetHigh&&row.sourceYear===row.year&&row.sourceAdjustmentExtras.trim()!==row.targetAdjustmentExtras.trim()){
    row.reason="同一年分の所得金額調整控除の親族明細が一致しません";return row;}
   const original=sourceEngine.reconcile({year:row.sourceYear,gross:o.salaryGross,
    salaryIncome:o.salaryIncomeReference,social:o.socialInsurance,deductions:o.deductionsReference,
    indicators,...source,reviewed:true,
    ...(Object.keys(row.familyCountHints||{}).length?{countHints:row.familyCountHints}:{}),
    ...(row.spouseIncomeHint!==undefined?{spouseIncomeHint:row.spouseIncomeHint}:{}),
    ...(insured?{premiums:sourcePremiums,insuranceReviewed:true}:{}),
    ...(other?{otherDeductions:sourceOther,otherReviewed:true,sourceContributionYen:sourceOther.smallEnterpriseContributions}:{}),
    ...(sourceHigh?{adjustmentFacts:sourceFacts,sourceBasicYen:sourceBasic,sourceAdjustmentYen:sourceAdjustment,adjustmentReviewed:true}:{})},engine);
   if(original.status!=="RECONCILED"){row.reason=original.reason;return row;}
   let housing=null,housingSource=null;
   if(mortgage){
    const applied=parseHighMoney(row.mortgageSourceApplied,600000);
    const possible=row.mortgageSourcePossible===""?null:parseHighMoney(row.mortgageSourcePossible,600000);
    const moveInYear=parseHighMoney(row.mortgageMoveInYear,2026);
    if(applied===null||(row.mortgageSourcePossible!==""&&possible===null)||moveInYear===null||
       row.year-moveInYear>=13||typeof familyEngine.reconcileMortgageSource!=="function"){
     row.reason="住宅ローン控除の原票記載額・入居年・適用継続を確認してください";return row;}
    const hr=familyEngine.reconcileMortgageSource({year:row.sourceYear,salaryIncome:original.calculation.salaryIncomeYen,
     deductions:original.calculation.deductionsYen,moveInYear,capClass:row.mortgageCapClass,appliedYen:applied,possibleYen:possible,reviewed:true});
    if(hr.status!=="RECONCILED"){row.reason=hr.reason;return row;}
    housingSource=hr.calculation;
    housing={moveInYear,capClass:row.mortgageCapClass,possibleYen:housingSource.possibleYen,eligibilityReviewed:true};
   }
   let income=targetHigh?null:engine.salaryIncome(v.salaryGross,row.year);
   if((!targetHigh&&(!safeAmount(income)||income!==v.salaryIncomeReference))||v.socialInsurance>v.salaryGross){
    row.reason="試算対象年の給与所得等が一致しません";return row;
   }
   const args={year:row.year,salaryIncome:income,socialInsurance:v.socialInsurance,
    municipality:row.municipality,...target,conditions:insured?"salary-basic-social-family-insurance-only-reviewed":"salary-basic-social-family-only-reviewed",
    ...(insured?{premiums:targetPremiums}:{})};
   const contribution=other?targetOther.smallEnterpriseContributions:0;
   if(other){delete args.socialInsurance;args.socialAndContributions=v.socialInsurance;
    args.conditions="salary-basic-social-family-insurance-other-only-reviewed";args.otherDeductions=targetOther;}
   const medical=medicalActive(row);
   if(medical){
    const amount=parseMedical(row);
    if(amount===null||row.filing!=="return"){
     row.reason="補填後の医療費支払額と確定申告方式を確認してください";return row;}
    args.medicalNetPaidYen=amount;
   }
   let request=null;
   if(targetHigh){delete args.year;delete args.salaryIncome;request={adjustment:targetFacts,tax:args};}
   const one=targetHigh?(medical?familyEngine.highSalaryMedicalFilingCalculation(request):familyEngine.highSalaryCalculate(request)):
    (medical?familyEngine.medicalFilingCalculation(args):familyEngine.calculate(args));
   if(targetHigh&&one.status==="ESTIMATE"){
    income=one.calculation?.salaryAdjustment?.salaryIncomeAfterAdjustmentYen;
    if(!safeAmount(income)||income!==v.salaryIncomeReference){row.reason="試算年の所得金額調整控除後の給与所得が一致しません";return row;}
   }
   if(one.status!=="ESTIMATE"){row.reason=one.reason;return row;}
   const c=one.calculation;
   if(!c||c.year!==row.year||c.municipality!==row.municipality||!!c.salaryAdjustment!==targetHigh||
      c.nationalTaxableYen!==Math.floor(Math.max(0,income-c.nationalDeductionsYen)/1000)*1000||
      c.residentTaxableYen!==Math.floor(Math.max(0,income-c.residentDeductionsYen)/1000)*1000||
      c.nationalDeductionsYen!==c.nationalBasicYen+v.socialInsurance+c.family.nationalFamilyDeductionYen+(c.insurance?.national.totalYen??0)+(other?c.other.nationalOtherDeductionYen-contribution:0)+(medical?c.medical?.nationalDeductionYen:0)||
      c.residentDeductionsYen!==430000+v.socialInsurance+c.family.residentFamilyDeductionYen+(c.insurance?.resident.totalYen??0)+(other?c.other.residentOtherDeductionYen-contribution:0)+(medical?c.medical?.residentDeductionYen:0)||
      (!!c.insurance!==insured)||(!!c.other!==other)||
      (other&&(c.socialAndContributionsYen!==v.socialInsurance||c.socialInsuranceOnlyYen!==v.socialInsurance-contribution||c.other.contributions.nationalYen!==contribution))||
      c.residentIncomeLevyYen!==c.city.assessedYen+c.prefecture.assessedYen||
      (!!c.medical!==medical)||
      (medical?(c.filingOnly!==true||c.oneStopAllowed!==false||one.donationLimitYen!==null||
        !safeAmount(c.medical.nationalDeductionYen)||c.medical.nationalDeductionYen!==c.medical.residentDeductionYen||
        c.medical.method!=="ordinaryNet"||c.medical.netEligibleYen!==parseMedical(row)||c.medical.thresholdYen!==Math.min(100000,Math.floor(income/20))||c.medical.nationalDeductionYen!==Math.min(2000000,Math.max(0,parseMedical(row)-Math.min(100000,Math.floor(income/20))))):
        (!safeAmount(one.donationLimitYen)||one.donationLimitYen<2000||
        one.donationLimitYen!==Math.floor(c.exactReferenceYen/1000)*1000))||
      (row.deductionsOverrideActive&&v.deductionsReference!==c.nationalDeductionsYen)){
    row.reason="家族控除・所得控除合計の整合性不一致";return row;
   }
   const prefix=targetHigh?familyEngine.highSalaryFilingPrefix(request):familyEngine.filingPrefix(args);
   if(prefix.status!=="ESTIMATE"||!safeAmount(prefix.donationLimitYen)||prefix.donationLimitYen<2000||(targetHigh&&JSON.stringify(prefix.calculation?.salaryAdjustment)!==JSON.stringify(c.salaryAdjustment))||
      (medical&&(prefix.calculation?.filingOnly!==true||prefix.calculation?.oneStopAllowed!==false||JSON.stringify(prefix.calculation?.medical)!==JSON.stringify(c.medical)))){
    row.reason="確定申告参考上限を確認できません";return row;
   }
   const donation=row.trialInput===""?(medical?prefix.donationLimitYen:one.donationLimitYen):
    /^(0|[1-9][0-9]{0,11})$/.test(row.trialInput)?Number(row.trialInput):null;
   const trial=targetHigh?familyEngine.highSalaryFilingTrial(request,donation):familyEngine.filingTrial(args,donation),t=trial.calculation;
   const comparison={oneStop:one.donationLimitYen,filing:prefix.donationLimitYen,trial:null,trialStatus:"HOLD"};
   if(trial.status==="ESTIMATE"&&t&&t.donationYen===donation&&(!targetHigh||JSON.stringify(t.salaryAdjustment)===JSON.stringify(c.salaryAdjustment))&&
      (!medical||(t.filingOnly===true&&t.oneStopAllowed===false&&JSON.stringify(t.medical)===JSON.stringify(c.medical)))&&
      safeAmount(t.donationYen)&&Number.isSafeInteger(t.selfPayYen)&&safeAmount(t.excessOver2000Yen)&&
      safeAmount(t.nationalSavingYen)&&safeAmount(t.residentSavingYen)&&
      t.selfPayYen===donation-t.nationalSavingYen-t.residentSavingYen&&
      t.excessOver2000Yen===Math.max(0,t.selfPayYen-2000)){
    comparison.trial={donation:t.donationYen,selfPay:t.selfPayYen,excess:t.excessOver2000Yen};
    comparison.trialStatus="確定申告参考";
   }
   let selectedLimit=row.filing==="return"?prefix.donationLimitYen:one.donationLimitYen;
   if(mortgage){
    // Mortgage uses the conservative first-failure prefix, not the
    // ordinary ceiling. Never substitute an ordinary limit on failure.
    const requestFor=filing=>({tax:targetHigh?request:args,housing,filing});
    const hp=familyEngine.mortgagePrefix(requestFor("return"));
    const op=medical?null:familyEngine.mortgagePrefix(requestFor("one-stop"));
    const validPrefix=p=>p?.status==="COMPONENTS_ONLY"&&p.donationLimitYen===null&&
     safeAmount(p.calculation?.conservativePrefixYen)&&p.calculation.conservativePrefixYen>=2000&&
     p.calculation.conservativePrefixYen%1000===0&&p.calculation.atPrefix?.within2000===true&&
     p.calculation.atPrefix.donationYen===p.calculation.conservativePrefixYen&&
     p.calculation.atPrefix.housingPossibleYen===housing.possibleYen;
    if(!validPrefix(hp)||(!medical&&!validPrefix(op))){
     row.reason="住宅ローン控除と寄附控除の併用計算を確認できません";return row;}
    comparison.oneStop=op?.calculation.conservativePrefixYen??null;
    comparison.filing=hp.calculation.conservativePrefixYen;
    selectedLimit=row.filing==="return"?comparison.filing:comparison.oneStop;
    const td=row.trialInput===""?selectedLimit:/^(0|[1-9][0-9]{0,11})$/.test(row.trialInput)?Number(row.trialInput):null;
    const ht=familyEngine.mortgageTrial(requestFor("return"),td),hc=ht.calculation;
    comparison.trial=null;comparison.trialStatus="HOLD";
    if(ht.status==="COMPONENTS_ONLY"&&hc?.donationYen===td&&safeAmount(hc.donationYen)&&
       Number.isSafeInteger(hc.selfPayYen)&&safeAmount(hc.excessOver2000Yen)&&
       hc.selfPayYen===td-hc.nationalSavingYen-hc.residentSavingYen&&
       hc.excessOver2000Yen===Math.max(0,hc.selfPayYen-2000)){
     comparison.trial={donation:td,selfPay:hc.selfPayYen,excess:hc.excessOver2000Yen};comparison.trialStatus="確定申告参考";
    }
    const before=hp.calculation.atPrefix.before;
    if(!safeAmount(before?.nationalHousingYen)||!safeAmount(before?.residentHousingYen)||
       before.nationalHousingYen+before.residentHousingYen>housing.possibleYen){
     row.reason="住宅ローン控除額の整合性不一致";return row;}
    row.mortgageSummary={sourceAppliedYen:housingSource.appliedYen,possibleYen:housing.possibleYen,
     nationalHousingYen:before.nationalHousingYen,residentHousingYen:before.residentHousingYen};
   }
   row.familySummary={sourceTotal:original.calculation.deductionsYen,
    national:c.family.nationalFamilyDeductionYen,resident:c.family.residentFamilyDeductionYen};
   if(insured)row.insuranceSummary={sourceTotal:original.calculation.insuranceYen,
    nationalLife:c.insurance.national.lifeYen,residentLife:c.insurance.resident.lifeYen,
    nationalEarth:c.insurance.national.earthquakeYen,residentEarth:c.insurance.resident.earthquakeYen,
    enhanced:c.insurance.enhancedGeneral};
   if(other)row.otherSummary={sourceTotal:original.calculation.otherYen,sourceContribution:original.calculation.sourceContributionYen,
    national:c.other.nationalOtherDeductionYen,resident:c.other.residentOtherDeductionYen,contribution,socialOnly:c.socialInsuranceOnlyYen};
   if(high)row.highSummary={sourceBasicYen:original.calculation.basicYen,sourceAdjustmentYen:sourceHigh?original.calculation.sourceAdjustmentYen:0,
    targetBasicYen:c.nationalBasicYen,targetAdjustmentYen:targetHigh?c.salaryAdjustment.salaryAdjustmentYen:0,targetSalaryIncomeYen:income};
   if(medical)row.medicalSummary=Object.fromEntries(MEDICAL_SUMMARY_KEYS.map(k=>[k,c.medical[k]]));
   row.comparison=comparison;row.appliedDeductionsYen=c.nationalDeductionsYen;
   row.donationLimitYen=selectedLimit;
   row.residentLevyYen=c.residentIncomeLevyYen;
   row.calculatedMunicipality=row.municipality;row.calculatedFiling=row.filing;
   row.calculationBasis=(mortgage?"住宅ローン控除併用・千円刻み保守的参考／":"")+(high?"高額給与・":"")+(medical?"家族・保険料・その他所得控除・医療費控除":other?"家族・保険料・その他所得控除":insured?"家族・保険料控除":"家族控除")+"・原票照合済／"+(row.filing==="return"?"確定申告参考":"ワンストップ参考");
   row.calculatedSnapshot=snapshot(row);
   row.status=row.sourceYear<row.year?"前年参考概算":"概算";
   row.reason=(medical?"家族・保険料・その他所得控除・医療費控除":other?"家族・保険料・その他所得控除":insured?"家族・保険料控除":"家族控除")+"の原票照合済・試算対象年の参考値（確定額ではありません）"+(mortgage&&row.sourceYear!==row.year?"。住宅ローン残高の変動は考慮していません。":"");
   return row;
  }catch(_){invalidate(row);row.reason="家族税額の計算異常";return row;}
 }
 function calculate(row,engine,displayGuard,selectedReference,localEngine,familyEngine,sourceEngine){
  invalidate(row);
  // Bad page/year/amount or a changed choice must never publish an amount.
  if(!canEstimate(row)){
    row.reason="参照源泉票の年分・試算対象年・4金額を確認できません";
    return row;
  }
  if(row.sourceYear!==row.year&&row.forecastReviewed!==true){
    row.reason="前年原票の金額を試算対象年の見込額へ補正したことを確認してください";
    return row;
  }
  if(row.confirmed!==true){row.reason="原票と4金額・年分の目視照合待ち";return row;}
  if(Object.keys(row.sourceIndicators||{}).some(k=>!allowedIndicators(row).includes(k))||
     (Object.keys(row.sourceIndicators||{}).length>0&&!familyActive(row))){
    row.reason="原票で検出した追加控除・扶養等は簡易試算の対象外です。原票の控除明細を確認してください";
    return row;
  }
  if(row.noExclusions!==true){
    row.reason="追加控除・扶養・複数給与などの適用条件が未確認";
    return row;
  }
  if(!["one-stop","return"].includes(row.filing)){
    row.reason="手続きの区分が不明";
    return row;
  }
  if(!["standard","designated"].includes(row.municipality)){
    row.reason="課税自治体の標準税率区分を確認してください";return row;
  }
  if(!engine||typeof engine.calculate!=="function"||
     typeof displayGuard!=="function"||typeof selectedReference!=="function"){
    row.reason="税額計算の検証機能を利用できません";
    return row;
  }
  if(familyActive(row))return calculateFamily(row,engine,familyEngine,sourceEngine);
  const input={
   year:String(row.year),sourceYear:String(row.sourceYear),
   forecastReviewed:row.forecastReviewed===true,
   filing:row.filing,municipality:row.municipality,incomeType:"salary",
   salaryGross:String(row.candidates.salaryGross),
   salaryIncomeReference:String(row.candidates.salaryIncomeReference),
   // No override: the shared engine recomputes basic+social on the
   // target-year tax law. Override: its typed number must pass strict
   // independent display reconciliation or remain HOLD.
   deductionsReference:row.deductionsOverrideActive?
     String(row.candidates.deductionsReference):"",
   deductionsOverride:row.deductionsOverrideActive?
     String(row.candidates.deductionsReference):"",
   sourceDeductionsReference:row.originalCandidates?.deductionsReference===undefined?
     "":String(row.originalCandidates.deductionsReference),
   socialInsurance:String(row.candidates.socialInsurance),
   acknowledgedExclusions:true,sourceReviewPending:false
  };
  if(row.originalCandidates&&FIELDS.every(k=>safeAmount(row.originalCandidates[k]))){
   input.sourceOriginalGross=String(row.originalCandidates.salaryGross);
   input.sourceOriginalSocial=String(row.originalCandidates.socialInsurance);
   input.sourceOriginalDeductions=String(row.originalCandidates.deductionsReference);
  }
  for(const key of FLAGS)input[key]=false;
  try{
   // Scope the previous-year bridge to this public Web estimator only.
   // Keep the shared private GAS engine's strict source-year contract.
   // The independent UI display guard still checks the TRUE source year.
   const taxInput=row.sourceYear===row.year-1&&row.forecastReviewed===true
    ?Object.assign({},input,{sourceYear:String(row.year)}):input;
   const result=engine.calculate(taxInput);
   if(!displayGuard(result,input)){
    row.reason="計算条件または税額整合性の不一致";
    return row;
   }
   // Commit the displayed amount atomically: malformed calculation details
   // must never leave a previously assigned donation limit visible.
   const selected=selectedReference(result,input);
   if(!selected||!safeAmount(selected.amount)||!safeAmount(selected.residentLevy)||
      typeof selected.basis!=="string"){row.reason="自治体別計算を確認できません";return row;}
   const calc=result&&result.calculation;
   const basic=calc?.basicIncomeTaxDeductionYen;
   const social=calc?.socialInsuranceYen;
   if(!safeAmount(result?.donationLimitYen)||!safeAmount(basic)||
      !safeAmount(social)||!safeAmount(basic+social)){
    row.reason="計算内訳の整合性を確認できません";
    return row;
   }
   // Separate comparison from the accepted primary ceiling. Invalid trial
   // input suppresses trial amounts, not the independently verified limits.
   let comparison=null;
   if(localEngine&&typeof localEngine.oneStopReference==="function"&&
      typeof localEngine.filingPrefix==="function"&&typeof localEngine.filingTrial==="function"){
    const args={year:row.year,salaryIncome:calc.salaryIncomeYen,socialInsurance:social,
      municipality:row.municipality,conditions:"basic-only-reviewed"};
    const one=localEngine.oneStopReference(args),prefix=localEngine.filingPrefix(args);
    if(one.status==="ESTIMATE"&&prefix.status==="ESTIMATE"&&
       safeAmount(one.donationLimitYen)&&safeAmount(prefix.donationLimitYen)){
     const donation=row.trialInput===""?one.donationLimitYen:
       /^(0|[1-9][0-9]{0,11})$/.test(row.trialInput)?Number(row.trialInput):null;
     const trial=localEngine.filingTrial(args,donation);
     comparison={oneStop:one.donationLimitYen,filing:prefix.donationLimitYen,
      trial:null,trialStatus:"HOLD"};
     const t=trial.calculation;
     if(trial.status==="ESTIMATE"&&t&&safeAmount(t.donationYen)&&t.donationYen===donation&&
        Number.isSafeInteger(t.selfPayYen)&&safeAmount(t.excessOver2000Yen)&&
        safeAmount(t.nationalSavingYen)&&safeAmount(t.residentSavingYen)&&
        t.selfPayYen===donation-t.nationalSavingYen-t.residentSavingYen&&
        t.excessOver2000Yen===Math.max(0,t.selfPayYen-2000)){
      comparison.trial={donation:t.donationYen,selfPay:t.selfPayYen,excess:t.excessOver2000Yen};
      comparison.trialStatus="確定申告参考";
     }
    }
   }
   row.comparison=comparison;
   row.calculatedSnapshot=snapshot(row);
   row.appliedDeductionsYen=basic+social;
   row.donationLimitYen=selected.amount;
   row.residentLevyYen=selected.residentLevy;
   row.calculatedMunicipality=row.municipality;row.calculatedFiling=row.filing;
   row.calculationBasis=selected.basis;
   row.status=row.sourceYear<row.year?"前年参考概算":"概算";
   row.reason=(row.deductionsOverrideActive
    ?"⚠ 所得控除合計は手入力上書き中・他の入力変更に自動追随しません。":"")+
    (row.sourceYear<row.year
    ?"前年の源泉票を参考にした当年の見込額による概算（確定額ではありません）"
    :"対応条件内の概算（確定額ではありません）");
   return row;
  }catch(_){
   invalidate(row);row.reason="計算異常";
   return row;
  }
 }
 function labelFor(row){
  const text=typeof row.label==="string"?row.label.trim().slice(0,40):"";
  return text||("対象者 "+row.page);
 }
 function csvValue(v){
  let value=String(v===null||v===undefined?"":v);
  // Spreadsheet clients interpret = + - @ and control-prefix formulas.
  // Prevent CSV formula injection in *manually entered* identity labels.
  if(/^[\u0000-\u0020\u007f-\u009f\ufeff]*[=+\-@]/u.test(value))
   value="'"+value;
  return '"'+value.replace(/"/g,'""')+'"';
 }
 // A single fail-closed output predicate for the derived amounts and status.
 function canOutputEstimate(row){
  return canEstimate(row)&&row.confirmed===true&&row.noExclusions===true&&
   (familyActive(row)?(!familyDetailsActive(row)||row.familyReviewed===true)&&row.familySummary!==null&&row.originalYear===row.sourceYear&&
     (!insuranceActive(row)||(row.insuranceReviewed===true&&row.insuranceSummary!==null))&&
     (!otherActive(row)||(row.otherReviewed===true&&row.otherSummary!==null))&&
     (!mortgageActive(row)||(row.mortgageReviewed===true&&row.mortgageSummary!==null))&&
     (!highActive(row)||(row.highReviewed===true&&row.highSummary!==null))&&
     (!medicalActive(row)||(parseMedical(row)!==null&&row.medicalSummary!==null&&row.filing==="return"&&row.comparison?.oneStop===null))&&
     Object.entries(row.sourceIndicators||{}).every(([k,v])=>allowedIndicators(row).includes(k)&&v===true):
     Object.keys(row.sourceIndicators||{}).length===0)&&
   (row.sourceYear===row.year||row.forecastReviewed===true)&&
   ["one-stop","return"].includes(row.filing)&&row.calculatedFiling===row.filing&&
   ["standard","designated"].includes(row.municipality)&&row.calculatedMunicipality===row.municipality&&
   row.calculatedSnapshot===snapshot(row)&&
   safeAmount(row.residentLevyYen)&&typeof row.calculationBasis==="string"&&
   row.status===(row.sourceYear<row.year?"前年参考概算":"概算")&&
   safeAmount(row.appliedDeductionsYen)&&safeAmount(row.donationLimitYen);
 }
 function outputComparison(row){
  return canOutputEstimate(row)&&row.comparison?row.comparison:null;
 }
 function csv(rows){
  if(!Array.isArray(rows)||rows.length>MAX_ROWS)
   throw Error("BATCH_CSV_ROWS_INVALID");
  const header=["PDFページ","氏名","参照源泉票年分","試算対象年","給与支払金額",
   "給与所得控除後の金額","所得控除合計の入力値","所得控除合計の計算使用額","所得控除合計の入力区分","社会保険料等","手続き",
   "寄附上限額の概算","状態","確認状況","課税自治体区分","住民税所得割（選択自治体）","寄附参考額の計算方式","ワンストップ参考上限","確定申告参考上限（千円刻み）","試算寄附額（入力・空欄は自動）","確定申告試算寄附額","確定申告自己負担見込額","2,000円超過額","任意寄附額試算状態","原票所得控除合計（家族照合済）","所得税家族控除","住民税家族控除","原票保険料控除合計（照合済）","所得税生命保険料控除","住民税生命保険料控除","所得税地震保険料控除","住民税地震保険料控除","23歳未満扶養親族の生命保険料特例","原票その他所得控除（掛金含む・照合済）","原票内書き掛金","所得税その他所得控除（掛金含む）","住民税その他所得控除（掛金含む）","試算内書き掛金","試算社会保険料（掛金除く）","医療費控除額（所得税・住民税）","補填後の医療費支払額","医療費控除の足切額","原票基礎控除額（G46照合）","原票所得金額調整控除額（G47照合）","試算年基礎控除額","試算年所得金額調整控除額","試算年調整後給与所得","原票住宅ローン控除額（照合済）","試算住宅ローン控除可能額","寄附前所得税住宅ローン控除","寄附前住民税住宅ローン控除"];
  const lines=[header.map(csvValue).join(",")];
  for(const r of rows){
   const v=r.sourceValid?r.candidates:null;
   const accepted=canOutputEstimate(r);
   const comparison=outputComparison(r);
   lines.push([r.page,labelFor(r),r.sourceYear??"",r.year??"",
    v?.salaryGross??"",v?.salaryIncomeReference??"",
    v?.deductionsReference??"",
    accepted?r.appliedDeductionsYen:"",
    r.deductionsOverrideActive?"手入力上書き・自動追随なし":"自動算定（原票照合）",v?.socialInsurance??"",
    r.filing==="return"?"確定申告":"ワンストップ",
    accepted?r.donationLimitYen:"",
    accepted?r.status:"HOLD",
    !accepted&&(r.status==="概算"||r.status==="前年参考概算")
      ?"確認状態が変わりました。再試算してください":r.reason,
    r.municipality==="standard"?"標準市町村":r.municipality==="designated"?"政令指定都市":"未確認",
    accepted?r.residentLevyYen:"",accepted?r.calculationBasis:"",comparison?.oneStop??"",comparison?.filing??"",
    r.trialInput,comparison?.trial?.donation??"",comparison?.trial?.selfPay??"",comparison?.trial?.excess??"",comparison?.trialStatus??"HOLD",accepted?r.familySummary?.sourceTotal??"":"",
    accepted?r.familySummary?.national??"":"",accepted?r.familySummary?.resident??"":"",
    accepted?r.insuranceSummary?.sourceTotal??"":"",accepted?r.insuranceSummary?.nationalLife??"":"",
    accepted?r.insuranceSummary?.residentLife??"":"",accepted?r.insuranceSummary?.nationalEarth??"":"",
    accepted?r.insuranceSummary?.residentEarth??"":"",accepted&&r.insuranceSummary?(r.insuranceSummary.enhanced?"適用":"対象外"):"",...["sourceTotal","sourceContribution","national","resident","contribution","socialOnly"].map(k=>accepted?r.otherSummary?.[k]??"":"") ,...MEDICAL_SUMMARY_KEYS.map(k=>accepted?r.medicalSummary?.[k]??"":"") ,...HIGH_SUMMARY_KEYS.map(k=>accepted?r.highSummary?.[k]??"":"") ,...MORTGAGE_SUMMARY_KEYS.map(k=>accepted?r.mortgageSummary?.[k]??"":"")].map(csvValue).join(","));
  }
  // UTF-8 BOM is an intentional local Excel compatibility aid.
  return "\ufeff"+lines.join("\r\n")+"\r\n";
 }
 return Object.freeze({FIELDS,MAX_ROWS,PREMIUM_FIELDS,PREMIUM_KEYS,OTHER_FIELDS,MEDICAL_FIELDS,MEDICAL_SUMMARY_KEYS,HIGH_FIELDS,HIGH_SUMMARY_KEYS,highActive,MORTGAGE_FIELDS,MORTGAGE_SUMMARY_KEYS,mortgageActive,copySourcePremiums,copySourceFamily,confirmBasic,canConfirmSocialZero,confirmSocialZero,fromPage,holdRow,edit,canEstimate,canOutputEstimate,outputComparison,invalidate,calculate,labelFor,csv});
}));
