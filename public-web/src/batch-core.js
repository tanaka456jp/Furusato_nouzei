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
 function safeAmount(value){
  return Number.isSafeInteger(value)&&value>=0&&value<=1000000000000;
 }
 function holdRow(page,reason){
  return {page,label:"",year:null,sourceYear:null,candidates:null,originalCandidates:null,sourceIndicators:{},deductionsOverrideActive:false,appliedDeductionsYen:null,sourceValid:false,
   confirmed:false,noExclusions:false,forecastReviewed:false,filing:"one-stop",municipality:"",calculatedMunicipality:null,calculatedFiling:null,residentLevyYen:null,calculationBasis:null,
   trialInput:"",comparison:null,calculatedSnapshot:null,status:"HOLD",donationLimitYen:null,reason:reason||"読取・確認待ち"};
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
  row.year=targetYear===undefined?review.year:targetYear;
  // Never let a checkbox or an amount edit override positive source facts.
  if(review.sourceIndicators&&typeof review.sourceIndicators==="object"&&
     !Array.isArray(review.sourceIndicators)){
    for(const [key,value] of Object.entries(review.sourceIndicators)){
     if(!FLAGS.includes(key)||value!==true)
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
  row.sourceValid=review.eligibleForManualTransfer===true&&
    [2025,2026].includes(row.year)&&
    FIELDS.every(k=>safeAmount(row.candidates[k]));

  return row;
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
    row.originalCandidates,row.sourceIndicators,row.sourceValid,row.deductionsOverrideActive,
    row.confirmed,row.noExclusions,row.forecastReviewed,row.municipality,row.filing,row.trialInput]);
 }
 function invalidate(row){
  row.status="HOLD";row.donationLimitYen=null;row.appliedDeductionsYen=null;
  row.calculatedMunicipality=null;row.calculatedFiling=null;row.residentLevyYen=null;row.calculationBasis=null;
  row.comparison=null;row.calculatedSnapshot=null;
 }
 function edit(row,key,value){
  if(!row||typeof row!=="object")throw Error("BATCH_ROW_INVALID");
  if(key==="label"){
    row.label=String(value??"").slice(0,40);
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
  row.confirmed=false;row.noExclusions=false;row.forecastReviewed=false;
  invalidate(row);
  row.reason="手入力を変更しました。原票と試算対象年の見込額・控除条件を再確認してください";
  return row;
 }
 function calculate(row,engine,displayGuard,selectedReference,localEngine){
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
  if(Object.keys(row.sourceIndicators||{}).length>0){
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
   Object.keys(row.sourceIndicators||{}).length===0&&
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
   "寄附上限額の概算","状態","確認状況","課税自治体区分","住民税所得割（選択自治体）","寄附参考額の計算方式","ワンストップ参考上限","確定申告参考上限（千円刻み）","試算寄附額（入力・空欄は自動）","確定申告試算寄附額","確定申告自己負担見込額","2,000円超過額","任意寄附額試算状態"];
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
    r.trialInput,comparison?.trial?.donation??"",comparison?.trial?.selfPay??"",comparison?.trial?.excess??"",comparison?.trialStatus??"HOLD"].map(csvValue).join(","));
  }
  // UTF-8 BOM is an intentional local Excel compatibility aid.
  return "\ufeff"+lines.join("\r\n")+"\r\n";
 }
 return Object.freeze({FIELDS,MAX_ROWS,fromPage,holdRow,edit,canEstimate,canOutputEstimate,outputComparison,invalidate,calculate,labelFor,csv});
}));
