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
  return {page,label:"",year:null,sourceYear:null,candidates:null,sourceValid:false,
   confirmed:false,noExclusions:false,forecastReviewed:false,filing:"one-stop",
   status:"HOLD",donationLimitYen:null,reason:reason||"読取・確認待ち"};
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
     !review||review.eligibleForManualTransfer!==true||
     ![2025,2026].includes(review.year)||!review.candidates||
     FIELDS.some(k=>!safeAmount(review.candidates[k]))){
    row.reason="原票を安全に読み取れませんでした";
    return row;
  }
  row.sourceYear=review.year;
  row.year=targetYear===undefined?review.year:targetYear;
  row.candidates=Object.fromEntries(FIELDS.map(k=>[k,review.candidates[k]]));
  row.sourceValid=[2025,2026].includes(row.year);

  return row;
 }
 function canEstimate(row){
  return !!row&&row.sourceValid&&row.candidates&&
   [2025,2026].includes(row.sourceYear)&&
   [2025,2026].includes(row.year)&&
   (row.sourceYear===row.year||row.sourceYear===row.year-1)&&
   FIELDS.every(k=>safeAmount(row.candidates[k]));
 }
 function edit(row,key,value){
  if(!row||typeof row!=="object")throw Error("BATCH_ROW_INVALID");
  if(key==="label"){
    row.label=String(value??"").slice(0,40);
  }else if(key==="year"||key==="sourceYear"){
    const n=Number(value);
    row[key]=String(value)===""?null:
      Number.isSafeInteger(n)&&[2025,2026].includes(n)?n:null;
  }else if(FIELDS.includes(key)){
    const raw=String(value??"");
    const numeric=/^(0|[1-9][0-9]{0,11})$/.test(raw)?Number(raw):null;
    if(row.candidates===null)row.candidates={};
    row.candidates[key]=safeAmount(numeric)?numeric:null;
  }else throw Error("BATCH_EDIT_FIELD_NOT_ALLOWED");
  row.sourceValid=!!row.candidates&&
    [2025,2026].includes(row.sourceYear)&&
    [2025,2026].includes(row.year)&&
    FIELDS.every(k=>safeAmount(row.candidates[k]));
  row.confirmed=false;row.noExclusions=false;row.forecastReviewed=false;
  row.status="HOLD";row.donationLimitYen=null;
  row.reason="手入力を変更しました。原票と試算対象年の見込額・控除条件を再確認してください";
  return row;
 }
 function calculate(row,engine,displayGuard){
  row.status="HOLD";row.donationLimitYen=null;
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
  if(row.noExclusions!==true){
    row.reason="追加控除・扶養・複数給与などの適用条件が未確認";
    return row;
  }
  if(!["one-stop","return"].includes(row.filing)){
    row.reason="手続きの区分が不明";
    return row;
  }
  if(!engine||typeof engine.calculate!=="function"||
     typeof displayGuard!=="function"){
    row.reason="税額計算の検証機能を利用できません";
    return row;
  }
  const input={
   year:String(row.year),sourceYear:String(row.sourceYear),
   forecastReviewed:row.forecastReviewed===true,
   filing:row.filing,incomeType:"salary",
   salaryGross:String(row.candidates.salaryGross),
   salaryIncomeReference:String(row.candidates.salaryIncomeReference),
   deductionsReference:String(row.candidates.deductionsReference),
   socialInsurance:String(row.candidates.socialInsurance),
   acknowledgedExclusions:true,sourceReviewPending:false
  };
  for(const key of FLAGS)input[key]=false;
  try{
   const result=engine.calculate(input);
   if(!displayGuard(result,input)){
    row.reason="計算条件または税額整合性の不一致";
    return row;
   }
   row.status=row.sourceYear<row.year?"前年参考概算":"概算";
   row.donationLimitYen=result.donationLimitYen;
   row.reason=row.sourceYear<row.year
    ?"前年の源泉票を参考にした当年の見込額による概算（確定額ではありません）"
    :"対応条件内の概算（確定額ではありません）";
   return row;
  }catch(_){
   row.reason="計算異常";
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
 function csv(rows){
  if(!Array.isArray(rows)||rows.length>MAX_ROWS)
   throw Error("BATCH_CSV_ROWS_INVALID");
  const header=["PDFページ","氏名","参照源泉票年分","試算対象年","給与支払金額",
   "給与所得控除後の金額","所得控除合計","社会保険料等","手続き",
   "寄附上限額の概算","状態","確認状況"];
  const lines=[header.map(csvValue).join(",")];
  for(const r of rows){
   const v=r.sourceValid?r.candidates:null;
   lines.push([r.page,labelFor(r),r.sourceYear??"",r.year??"",
    v?.salaryGross??"",v?.salaryIncomeReference??"",
    v?.deductionsReference??"",v?.socialInsurance??"",
    r.filing==="return"?"確定申告":"ワンストップ",
    (r.status==="概算"||r.status==="前年参考概算")&&
      Number.isSafeInteger(r.donationLimitYen)
      ?r.donationLimitYen:"",
    r.status,r.reason].map(csvValue).join(","));
  }
  // UTF-8 BOM is an intentional local Excel compatibility aid.
  return "\ufeff"+lines.join("\r\n")+"\r\n";
 }
 return Object.freeze({FIELDS,MAX_ROWS,fromPage,holdRow,edit,canEstimate,calculate,labelFor,csv});
}));
