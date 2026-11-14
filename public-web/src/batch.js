"use strict";
/**
 * Local-only, serial batch processor for a PDF of one slip per page.
 * Recipient labels stay local to the browser/CSV; never upload source or OCR text.
 * No auto-approval, no auto-merge of separate slips for the same taxpayer.
 */
(function(){
 const input=document.getElementById("batchPdf");
 const scan=document.getElementById("batchScan");
 const clear=document.getElementById("batchClear");
 const calculate=document.getElementById("batchCalculate");
 const download=document.getElementById("batchDownload");
 const print=document.getElementById("batchPrint");
 const status=document.getElementById("batchStatus");
 const table=document.getElementById("batchTable");
 const body=document.getElementById("batchRows");
 const targetYear=document.querySelector('#calculator select[name="year"]');
 if(!input||!scan||!clear||!calculate||!download||!print||
    !status||!table||!body)return;
 const core=window.FurusatoBatchCore;
 const reader=window.FurusatoBatchPdf;
 if(!core||!reader)return;
 let rows=[],generation=0,running=false,computed=false;
 const monetary=["salaryGross","salaryIncomeReference",
  "deductionsReference","socialInsurance"];
 const yen=v=>Number.isSafeInteger(v)?
    v.toLocaleString("ja-JP")+"円":"—";
 function say(text){status.textContent=text;}
 function updateButtons(){
  scan.disabled=running;
  calculate.disabled=running||!rows.length;
  download.disabled=running||!rows.length||!computed;
  print.disabled=running||!rows.length||!computed;
 }
 function cell(tr,content,className){
  const td=document.createElement("td");
  if(typeof content==="string")td.textContent=content;
  if(className)td.className=className;
  tr.appendChild(td);
  return td;
 }
 function formControl(tag,attrs){
  const el=document.createElement(tag);
  for(const [name,value] of Object.entries(attrs||{})){
   if(name==="text")el.textContent=value;
   else if(name==="checked"||name==="disabled")el[name]=Boolean(value);
   else el.setAttribute(name,value);
  }
  return el;
 }
 function render(){
  body.replaceChildren();
  table.hidden=rows.length===0;
  rows.forEach((r,i)=>{
   const tr=document.createElement("tr");
   cell(tr,String(r.page));
   const label=cell(tr,"");
   const name=formControl("input",{
    type:"text",autocomplete:"off",maxLength:"40",
    "aria-label":"PDF "+r.page+" ページの受給者氏名（訂正可）",
    "data-row":String(i),"data-field":"label",
    placeholder:"氏名を入力"
   });
   name.value=r.label;
   label.appendChild(name);
   const source=cell(tr,"");
   const sourceSelect=formControl("select",{
     "aria-label":"PDF "+r.page+" ページの参照源泉票年分",
     "data-row":String(i),"data-field":"sourceYear"
   });
   for(const [value,text] of [["","未読取"],["2025","2025"],["2026","2026"]])
     sourceSelect.appendChild(formControl("option",{value,text}));
   sourceSelect.value=r.sourceYear===null?"":String(r.sourceYear);
   source.appendChild(sourceSelect);
   const target=cell(tr,"");
   const yearSelect=formControl("select",{
     "aria-label":"PDF "+r.page+" ページの試算対象年",
     "data-row":String(i),"data-field":"year"
   });
   for(const val of ["2025","2026"])
     yearSelect.appendChild(formControl("option",{value:val,text:val}));
   yearSelect.value=String(r.year??2026);
   target.appendChild(yearSelect);
   const v=r.candidates;
   for(const field of monetary){
     const td=cell(tr,"","batch-candidate");
     const control=formControl("input",{
       type:"text",inputMode:"numeric",maxLength:"12",
       autocomplete:"off",spellcheck:"false",
       "data-row":String(i),"data-field":field,
       "aria-label":"PDF "+r.page+" ページの"+field+"（円、対象年の見込額）"
     });
     control.value=Number.isSafeInteger(v?.[field])?String(v[field]):"";
     td.appendChild(control);
     if(field==="deductionsReference"&&r.deductionsOverrideActive){
      td.classList.add("batch-deduction-manual");
      const warn=document.createElement("span");
      warn.className="batch-override-tag";
      warn.textContent="⚠ 手入力上書き中・自動追随なし";
      td.appendChild(warn);
     }
   }
   const applied=cell(tr,"","batch-deduction-applied");
   applied.textContent=Number.isSafeInteger(r.appliedDeductionsYen)?
     yen(r.appliedDeductionsYen):"—";
   const filing=cell(tr,"");
   const select=formControl("select",{
    "aria-label":"対象者 "+r.page+" の手続き",
    "data-row":String(i),"data-field":"filing"
   });
   for(const [value,text] of [["one-stop","ワンストップ"],
                               ["return","確定申告"]]){
    const o=formControl("option",{value,text});
    select.appendChild(o);
   }
   select.value=r.filing;select.disabled=false;
   filing.appendChild(select);
   for(const field of ["confirmed","noExclusions","forecastReviewed"]){
    const td=cell(tr,"","batch-check");
    const checkbox=formControl("input",{
     type:"checkbox", "data-row":String(i),"data-field":field,
     "aria-label":"対象者 "+r.page+" "+(field==="confirmed"?
       "原票と対象年見込額を照合済み":field==="forecastReviewed"?
       "前年参考の値を対象年の見込額に補正済み":
       "追加控除など未対応条件なしを確認済み"),
     checked:r[field],
     disabled:!r.sourceValid||(field==="forecastReviewed"&&r.sourceYear===r.year)
    });
    td.appendChild(checkbox);
   }
   const isEstimate=r.status==="概算"||r.status==="前年参考概算";
   cell(tr,isEstimate?yen(r.donationLimitYen):"—","batch-result");
   cell(tr,isEstimate?r.status:("HOLD："+r.reason),"batch-reason");
   body.appendChild(tr);
  });
  updateButtons();
 }
 function clearEstimates(){
  computed=false;
  for(const row of rows){
   row.status="HOLD";row.donationLimitYen=null;row.appliedDeductionsYen=null;
   row.reason=row.sourceValid?"再試算・個別確認待ち":
     "原票を安全に読み取れませんでした";
  }
  updateButtons();
 }
 function reset(){
  generation++;
  if(running)reader.cancel();
  input.value="";
  rows=[];computed=false;
  say("一覧を消去しました。PDF・個人情報は保存していません。");
  render();
 }
 clear.addEventListener("click",reset);
 input.addEventListener("change",()=>{
  generation++;
  if(running)reader.cancel();
  rows=[];computed=false;
  say("新しいPDFを選択しました。前の対象者一覧は破棄しました。");
  render();
 });
 scan.addEventListener("click",async()=>{
  if(running)return;
  const file=input.files&&input.files.length===1?input.files[0]:null;
  if(!file||file.type!=="application/pdf"||
     file.size<=0||file.size>reader.maxBytes){
   say("1～20ページのPDFを1件選択してください（8MB以下）。");
   return;
  }
  if(!reader.beginBatch()){
   say("別のOCRが実行中です。完了後に再試行してください。");
   return;
  }
  const requested=++generation;
  const plannedYear=Number(targetYear?.value||"2026");
  const stale=()=>requested!==generation||
    Number(targetYear?.value||"2026")!==plannedYear||
    !(input.files&&input.files[0]===file);
  rows=[];computed=false;running=true;
  render();
  let opened=null;
  try{
   say("PDFを端末内で解析中です。ページごとに一人ずつ確認してください。");
   opened=await reader.open(file,stale);
   if(stale())return;
   const doc=opened.document;
   if(doc.numPages<1||doc.numPages>core.MAX_ROWS){
    say("PDFのページ数は1～20までです。読取は停止しました。");
    return;
   }
   for(let page=1;page<=doc.numPages;page++){
    if(stale())break;
    say("端末内で "+page+" / "+doc.numPages+" ページを確認中…");
    let row;
    try{
     const review=await reader.readPage(doc,opened.session,page,stale);
     if(stale())break;
     row=core.fromPage(page,review,plannedYear);
    }catch(_){
     if(stale())break;
     row=core.holdRow(page,"読取不能：手入力・原票確認が必要");
     row.year=plannedYear;
    }
    rows.push(row);
    render();
   }
   if(!stale())
    say(doc.numPages+"ページを処理しました。受給者氏名、参照原票年分、対象年見込額と追加控除を個別に確認してください。");
  }catch(_){
   if(!stale())say("PDFを解析できません。1～20ページ、8MB以下、各ページ1人分か確認してください。数値は表示しません。");
  }finally{
   if(opened){
    try{await reader.close(opened.session);}catch(_){}
   }
   running=false;reader.endBatch();
   updateButtons();
  }
 });
 function invalidateEditedRow(row){
  row.status="HOLD";row.donationLimitYen=null;row.appliedDeductionsYen=null;
  row.reason="入力が変更されました。対象年見込額・控除条件の再確認待ち";
  computed=false;
  // Do not rebuild the table while typing (that would steal focus).
  // Immediately erase the prior number from the LIVE DOM so native Ctrl+P
  // and screenshots cannot retain an estimate for an edited recipient.
  const index=rows.indexOf(row),tr=body.children[index];
  if(tr){
   const amounts=tr.querySelectorAll(".batch-result,.batch-deduction-applied");
   const reason=tr.querySelector(".batch-reason");
   amounts.forEach(el=>{el.textContent="—";});
   if(reason)reason.textContent="HOLD："+row.reason;
  }
  updateButtons();
 }
 body.addEventListener("input",ev=>{
  const idx=Number(ev.target?.dataset?.row);
  const key=ev.target?.dataset?.field;
  if(!Number.isSafeInteger(idx)||!rows[idx])return;
  if(key==="label"||monetary.includes(key)){
   core.edit(rows[idx],key,ev.target.value);
   invalidateEditedRow(rows[idx]);
  }
 });
 body.addEventListener("change",ev=>{
  const idx=Number(ev.target?.dataset?.row);
  const key=ev.target?.dataset?.field;
  if(!Number.isSafeInteger(idx)||!rows[idx])return;
  const row=rows[idx];
  if(key==="label"||monetary.includes(key)){
   core.edit(row,key,ev.target.value);
  }else if(key==="sourceYear"||key==="year"){
   core.edit(row,key,ev.target.value);
  }else if(key==="filing"&&["one-stop","return"].includes(ev.target.value)){
   row.filing=ev.target.value;
   row.confirmed=false;row.noExclusions=false;row.forecastReviewed=false;
  }else if(["confirmed","noExclusions","forecastReviewed"].includes(key)){
   row[key]=ev.target.checked===true;
  }else return;
  invalidateEditedRow(row);
  render();
 });
 if(targetYear)targetYear.addEventListener("change",()=>{
  if(running){generation++;reader.cancel();}
  rows.forEach(row=>core.edit(row,"year",targetYear.value));
  computed=false;render();
 });
 calculate.addEventListener("click",()=>{
  if(running||!rows.length)return;
  const engine=window.FurusatoEngine;
  const guard=window.FurusatoEstimateGuard?.canDisplayEstimate;
  rows.forEach(row=>core.calculate(row,engine,guard));
  computed=true;render();
  const allowed=rows.filter(row=>row.status==="概算"||row.status==="前年参考概算").length;
  say("対象 "+rows.length+"件：概算 "+allowed+"件、HOLD "+(rows.length-allowed)+
    "件。前年資料は見込額としての確認が必要です。HOLDの金額は空欄です。");
 });
 function validOutput(){
  return computed&&!running&&rows.length>0;
 }
 download.addEventListener("click",()=>{
  if(!validOutput())return;
  const blob=new Blob([core.csv(rows)],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  try{
   const a=document.createElement("a");
   a.href=url;a.download="furusato_batch_review.csv";
   a.style.display="none";document.body.appendChild(a);
   a.click();a.remove();
  }finally{
   setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
 });
 print.addEventListener("click",()=>{
  if(!validOutput())return;
  document.body.classList.add("batch-print");
  try{window.print();}catch(_){document.body.classList.remove("batch-print");}
 });
 window.addEventListener("afterprint",()=>{
  document.body.classList.remove("batch-print");
 });
 render();
}());
