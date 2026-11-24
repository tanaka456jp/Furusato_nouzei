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
  const openFamilyRows=new Set([...body.children].map((tr,i)=>tr.querySelector(".batch-family-editor:not(.batch-insurance-editor):not(.batch-other-editor) details")?.open?i:-1));
  const openInsuranceRows=new Set([...body.children].map((tr,i)=>tr.querySelector(".batch-insurance-editor details")?.open?i:-1));
  const openOtherRows=new Set([...body.children].map((tr,i)=>tr.querySelector(".batch-other-editor details")?.open?i:-1));
  const openMedicalRows=new Set([...body.children].map((tr,i)=>tr.querySelector(".batch-medical-editor details")?.open?i:-1));
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
   const isEstimate=core.canOutputEstimate(r);
   const applied=cell(tr,"","batch-deduction-applied");
   // Keep the physical cell order identical to the column headings.
   tr.insertBefore(applied,tr.children[7]);
   applied.textContent=isEstimate?yen(r.appliedDeductionsYen):"—";
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
   cell(tr,isEstimate?yen(r.donationLimitYen):"—","batch-result");
   cell(tr,isEstimate?r.status:("HOLD："+((r.status==="概算"||r.status==="前年参考概算")?
     "確認状態が変わりました。再試算してください":r.reason)),"batch-reason");
   const municipality=cell(tr,"");
   const municipalitySelect=formControl("select",{"aria-label":"対象者 "+r.page+" の課税自治体区分","data-row":String(i),"data-field":"municipality"});
   for(const [value,text] of [["","未確認"],["standard","標準市町村"],["designated","政令指定都市"]])
    municipalitySelect.appendChild(formControl("option",{value,text}));
   municipalitySelect.value=r.municipality;municipality.appendChild(municipalitySelect);
   cell(tr,isEstimate?yen(r.residentLevyYen):"—","batch-resident-levy");
   const comparison=core.outputComparison(r);
   cell(tr,yen(comparison?.oneStop),"batch-comparison");
   cell(tr,yen(comparison?.filing),"batch-comparison");
   const trialCell=cell(tr,"","batch-trial-input");
   const trialControl=formControl("input",{type:"text",inputMode:"numeric",maxLength:"12",autocomplete:"off",
    "aria-label":"対象者 "+r.page+" の試算寄附額（円、空欄は自動）",
    "data-row":String(i),"data-field":"trialInput",placeholder:"空欄は自動"});
   trialControl.value=r.trialInput;trialCell.appendChild(trialControl);
   cell(tr,yen(comparison?.trial?.donation),"batch-comparison");
   cell(tr,yen(comparison?.trial?.selfPay),"batch-comparison");
   cell(tr,yen(comparison?.trial?.excess),"batch-comparison");
   cell(tr,comparison?.trialStatus??"HOLD","batch-trial-status");
   const familyCell=cell(tr,"","batch-family-editor");
   const details=formControl("details");details.open=openFamilyRows.has(i);
   details.appendChild(formControl("summary",{text:"家族明細を入力・確認"}));
   for(const [key,title] of [["familySourceText","原票年の家族"],["familyTargetText","試算年の家族"]]){
    const label=formControl("label",{text:title});
    const area=formControl("textarea",{"data-row":String(i),"data-field":key,
     "aria-label":"対象者 "+r.page+" "+title,rows:"4",maxlength:"3000",
     autocomplete:"off",spellcheck:"false",placeholder:"S,40,600000\nR,20,600000,0"});
    area.value=r[key];label.appendChild(area);details.appendChild(label);
   }
   const review=formControl("label",{text:" 原票年・試算年の全家族と控除条件を確認済み"});
   const familyCheck=formControl("input",{type:"checkbox","data-row":String(i),"data-field":"familyReviewed",
    checked:r.familyReviewed,"aria-label":"対象者 "+r.page+" の家族明細照合済み"});
   review.prepend(familyCheck);details.appendChild(review);familyCell.appendChild(details);
   cell(tr,isEstimate?yen(r.familySummary?.sourceTotal):"—","batch-family-result");
   cell(tr,isEstimate?yen(r.familySummary?.national):"—","batch-family-result");
   cell(tr,isEstimate?yen(r.familySummary?.resident):"—","batch-family-result");
   const insuranceCell=cell(tr,"","batch-family-editor batch-insurance-editor");
   const insuranceDetails=formControl("details");insuranceDetails.open=openInsuranceRows.has(i);
   insuranceDetails.appendChild(formControl("summary",{text:"保険料明細を入力・確認"}));
   const premiumLabels=["新一般生命","旧一般生命","介護医療","新個人年金","旧個人年金","地震","旧長期損害"];
   for(const prefix of ["source","target"]){
    const group=formControl("fieldset");
    group.appendChild(formControl("legend",{text:prefix==="source"?"原票年の年間保険料":"試算年の年間保険料"}));
    core.PREMIUM_KEYS.forEach((k,n)=>{
     const key=prefix+"Insurance_"+k;
     const label=formControl("label",{text:premiumLabels[n]+"（円）"});
     const field=formControl("input",{type:"text",inputmode:"numeric",maxlength:"12",autocomplete:"off",
      "data-row":String(i),"data-field":key,placeholder:"0",
      "aria-label":"対象者 "+r.page+" "+(prefix==="source"?"原票年":"試算年")+" "+premiumLabels[n]});
     field.value=r[key];label.appendChild(field);group.appendChild(label);
    });
    insuranceDetails.appendChild(group);
   }
   const insuranceReview=formControl("label",{text:" 原票年・試算年の保険料区分・金額・重複なし・適用条件を確認済み"});
   insuranceReview.prepend(formControl("input",{type:"checkbox","data-row":String(i),"data-field":"insuranceReviewed",
    checked:r.insuranceReviewed,"aria-label":"対象者 "+r.page+" の保険料明細照合済み"}));
   insuranceDetails.appendChild(insuranceReview);insuranceCell.appendChild(insuranceDetails);
   for(const k of ["sourceTotal","nationalLife","residentLife","nationalEarth","residentEarth"])
    cell(tr,isEstimate?yen(r.insuranceSummary?.[k]):"—","batch-insurance-result");
   cell(tr,isEstimate&&r.insuranceSummary?(r.insuranceSummary.enhanced?"適用":"対象外"):"—","batch-insurance-result");
   const otherCell=cell(tr,"","batch-family-editor batch-other-editor");
   const otherDetails=formControl("details");otherDetails.open=openOtherRows.has(i);
   otherDetails.appendChild(formControl("summary",{text:"その他所得控除明細を入力・確認"}));
   otherDetails.appendChild(formControl("p",{text:"該当なしは「なし」。本人,配偶者,寡婦等,子番号,学生,掛金,親族ごとの障害区分（家族明細順）。障害: none/ordinary/special/cohabitingSpecial。寡婦等: none/widowDivorced/widowBereaved/singleParentFather/singleParentMother。子なし=0、学生なし=0・あり=1、掛金は社会保険料等の内書き。例（親族なし）: ordinary,none,none,0,0,120000"}));
   for(const [key,title] of [["otherSourceText","原票年"],["otherTargetText","試算年"]]){
    const label=formControl("label",{text:title+"のその他所得控除"});
    const field=formControl("textarea",{"data-row":String(i),"data-field":key,rows:"3",maxlength:"3000",autocomplete:"off","aria-label":"対象者 "+r.page+" "+title+"のその他所得控除"});
    field.value=r[key];label.appendChild(field);otherDetails.appendChild(label);
   }
   const otherReview=formControl("label",{text:" 原票年・試算年の障害区分・婚姻・子・学校・所得・内書き掛金・全適用要件を確認済み"});
   otherReview.prepend(formControl("input",{type:"checkbox","data-row":String(i),"data-field":"otherReviewed",checked:r.otherReviewed,"aria-label":"対象者 "+r.page+" のその他所得控除確認済み"}));
   otherDetails.appendChild(otherReview);otherCell.appendChild(otherDetails);
   for(const k of ["sourceTotal","sourceContribution","national","resident","contribution","socialOnly"])
    cell(tr,isEstimate?yen(r.otherSummary?.[k]):"—","batch-other-result");
   const medicalCell=cell(tr,"","batch-medical-editor");
   const medicalDetails=formControl("details");medicalDetails.open=openMedicalRows.has(i);
   medicalDetails.appendChild(formControl("summary",{text:"試算年の医療費控除"}));
   medicalDetails.appendChild(formControl("p",{text:"確定申告を選択し、家族・保険料・その他所得控除も確認してください。原票年の所得控除合計には医療費控除を含めません。"}));
   const method=formControl("select",{"data-row":String(i),"data-field":"medicalMethod","aria-label":"対象者 "+r.page+" 医療費控除方式"});
   for(const [value,text] of [["","申告なし"],["ordinary","通常の医療費控除"],["selfMedication","セルフメディケーション税制"]])method.appendChild(formControl("option",{value,text}));
   method.value=r.medicalMethod;medicalDetails.appendChild(method);
   const groupsLabel=formControl("label",{text:"補填対象ごとに1行：支払額,補填金（円）"});
   const groups=formControl("textarea",{"data-row":String(i),"data-field":"medicalGroupsText",rows:"4",maxlength:"3000",autocomplete:"off","aria-label":"対象者 "+r.page+" 医療費・補填金明細",placeholder:"100000,0"});
   groups.value=r.medicalGroupsText;groupsLabel.appendChild(groups);medicalDetails.appendChild(groupsLabel);
   for(const [key,title] of [["medicalHealthReviewed","健康保持増進等の取組要件を確認（セルフメディケーションのみ）"],["medicalReviewed","対象年・費用・補填対象の対応・重複なし・適用条件を確認し、全寄附を確定申告する"]]){
    const label=formControl("label",{text:" "+title});
    label.prepend(formControl("input",{type:"checkbox","data-row":String(i),"data-field":key,checked:r[key],"aria-label":"対象者 "+r.page+" "+title}));
    medicalDetails.appendChild(label);
   }
   medicalCell.appendChild(medicalDetails);
   for(const k of core.MEDICAL_SUMMARY_KEYS)
    cell(tr,isEstimate&&r.medicalSummary?(k==="method"?(r.medicalSummary.method==="ordinary"?"通常":"セルフメディケーション"):yen(r.medicalSummary[k])):"—","batch-medical-result");
   for(const select of tr.querySelectorAll("select:not([data-field=medicalMethod])")){
    const span=document.createElement("span");span.className="batch-print-value";
    span.textContent=select.selectedOptions[0]?.textContent??"未確認";select.parentNode.appendChild(span);
   }
   body.appendChild(tr);
  });
  updateButtons();
 }
 function clearEstimates(){
  computed=false;
  for(const row of rows){
   core.invalidate(row);
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
  core.invalidate(row);
  row.reason="入力が変更されました。対象年見込額・控除条件の再確認待ち";
  computed=false;
  // Do not rebuild the table while typing (that would steal focus).
  // Immediately erase the prior number from the LIVE DOM so native Ctrl+P
  // and screenshots cannot retain an estimate for an edited recipient.
  const index=rows.indexOf(row),tr=body.children[index];
  if(tr){
   const amounts=tr.querySelectorAll(".batch-result,.batch-deduction-applied,.batch-resident-levy,.batch-comparison,.batch-family-result,.batch-insurance-result,.batch-other-result,.batch-medical-result");
   const reason=tr.querySelector(".batch-reason");
   amounts.forEach(el=>{el.textContent="—";});
   if(reason)reason.textContent="HOLD："+row.reason;
   for(const checkbox of tr.querySelectorAll('input[type="checkbox"][data-field]'))
    checkbox.checked=row[checkbox.dataset.field]===true;
   const trialStatus=tr.querySelector(".batch-trial-status");if(trialStatus)trialStatus.textContent="HOLD";
  }
  updateButtons();
 }
 body.addEventListener("input",ev=>{
  const idx=Number(ev.target?.dataset?.row);
  const key=ev.target?.dataset?.field;
  if(!Number.isSafeInteger(idx)||!rows[idx])return;
  if(key==="label"||key==="trialInput"||key==="familySourceText"||key==="familyTargetText"||(core.PREMIUM_FIELDS.includes(key)||core.OTHER_FIELDS.includes(key)||core.MEDICAL_FIELDS.includes(key))||monetary.includes(key)){
   core.edit(rows[idx],key,ev.target.value);
   invalidateEditedRow(rows[idx]);
  }
 });
 body.addEventListener("change",ev=>{
  const idx=Number(ev.target?.dataset?.row);
  const key=ev.target?.dataset?.field;
  if(!Number.isSafeInteger(idx)||!rows[idx])return;
  const row=rows[idx];
  if(key==="familySourceText"||key==="familyTargetText"||(core.PREMIUM_FIELDS.includes(key)||core.OTHER_FIELDS.includes(key)||core.MEDICAL_FIELDS.includes(key))){
   // The input listener already records typing; avoid replacing the editor
   // on blur, which could swallow a click on the confirmation checkbox.
   if(row[key]!==ev.target.value){core.edit(row,key,ev.target.value);invalidateEditedRow(row);}
   return;
  }
  if(key==="label"||key==="trialInput"||(core.PREMIUM_FIELDS.includes(key)||core.OTHER_FIELDS.includes(key)||core.MEDICAL_FIELDS.includes(key))||monetary.includes(key)){
   core.edit(row,key,ev.target.value);
  }else if(key==="sourceYear"||key==="year"||key==="municipality"){
   core.edit(row,key,ev.target.value);
  }else if(key==="filing"&&["one-stop","return"].includes(ev.target.value)){
   row.filing=ev.target.value;
   row.confirmed=false;row.noExclusions=false;row.forecastReviewed=false;row.familyReviewed=false;row.insuranceReviewed=false;row.otherReviewed=false;row.medicalReviewed=false;
  }else if(["confirmed","noExclusions","forecastReviewed","familyReviewed","insuranceReviewed","otherReviewed","medicalReviewed","medicalHealthReviewed"].includes(key)){
   row[key]=ev.target.checked===true;
   if(key==="medicalHealthReviewed")row.medicalReviewed=false;
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
  if(running||!rows.length||!reconcileLiveInputs())return;
  const engine=window.FurusatoEngine;
  const guard=window.FurusatoEstimateGuard?.canDisplayEstimate;
  const selectedReference=window.FurusatoEstimateGuard?.selectedReference;
  rows.forEach(row=>core.calculate(row,engine,guard,selectedReference,window.FurusatoResidentLevy,window.FurusatoFamilyTax,window.FurusatoFamilySource));
  computed=true;render();
  const allowed=rows.filter(core.canOutputEstimate).length;
  say("対象 "+rows.length+"件：概算 "+allowed+"件、HOLD "+(rows.length-allowed)+
    "件。前年資料は見込額としての確認が必要です。HOLDの金額は空欄です。");
 });
 // Browser autofill or programmatic edits may bypass input/change events.
 function reconcileLiveInputs(){
  let changed=false;
  for(const element of body.querySelectorAll("[data-row][data-field]")){
   const row=rows[Number(element.dataset.row)],key=element.dataset.field;
   if(!row)continue;
   const actual=element.type==="checkbox"?element.checked:element.value;
   const expected=monetary.includes(key)?String(row.candidates?.[key]??""):
    element.type==="checkbox"?row[key]:String(row[key]??"");
   // Missing target year is visually represented by the default 2026.
   if(key==="year"&&row.year===null&&actual==="2026")continue;
   if(actual!==expected){
    if(element.type==="checkbox")row[key]=false;
    else if(key==="filing"){row.filing=actual;row.confirmed=false;row.noExclusions=false;row.forecastReviewed=false;row.familyReviewed=false;row.insuranceReviewed=false;row.otherReviewed=false;row.medicalReviewed=false;}
    else core.edit(row,key,actual);
    invalidateEditedRow(row);changed=true;
   }
  }
  if(changed)render();
  return !changed;
 }
 function validOutput(){
  return reconcileLiveInputs()&&computed&&!running&&rows.length>0;
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
 window.addEventListener("beforeprint",()=>{reconcileLiveInputs();});
 window.addEventListener("afterprint",()=>{
  document.body.classList.remove("batch-print");
 });
 render();
}());
