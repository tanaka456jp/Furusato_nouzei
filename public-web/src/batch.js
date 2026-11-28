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
 const headerCells=[...table.querySelectorAll("thead th")];
 headerCells.forEach((th,i)=>{th.id="batch-col-"+i;th.setAttribute("role","columnheader");});
 const optionalMobileResults=".batch-family-result,.batch-insurance-result,.batch-other-result,.batch-medical-result,.batch-high-result,.batch-mortgage-result";
 function refreshMobileEmpty(td){if(td.matches(optionalMobileResults))td.dataset.mobileEmpty=String(td.textContent==="—");}
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
  const openHighRows=new Set([...body.children].map((tr,i)=>tr.querySelector(".batch-high-editor details")?.open?i:-1));
  const openMortgageRows=new Set([...body.children].map((tr,i)=>tr.querySelector(".batch-mortgage-editor details")?.open?i:-1));
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
     if(field==="socialInsurance"&&core.canConfirmSocialZero(r)){
      td.appendChild(formControl("p",{class:"batch-basic-note",text:"原票が本当に空欄（控除対象額なし）の場合だけ押してください。"}));
      td.appendChild(formControl("button",{type:"button",class:"secondary batch-confirm-basic","data-confirm-social-zero":String(i),text:"原票空欄を確認し0円設定"}));
     }
     if(field==="socialInsurance"&&r.socialZeroManuallyConfirmed===true)td.appendChild(formControl("span",{class:"batch-basic-note",text:"原票年：空欄を手動確認して0円"}));
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
    if(field==="confirmed"){
     const complete=r.confirmed&&r.noExclusions&&(r.sourceYear===r.year||r.forecastReviewed);
     td.appendChild(formControl("span",{class:"batch-basic-note",text:r.sourceYear===r.year?
      "原票の年分・4金額・追加控除や未対応条件の有無を確認済みの場合に押してください。":
      "原票の年分・4金額、試算年への見込額補正、追加控除や未対応条件の有無を確認済みの場合に押してください。"}));
     td.appendChild(formControl("button",{type:"button",class:"secondary batch-confirm-basic","data-confirm-basic":String(i),disabled:!r.sourceValid||complete,text:complete?"基本確認済み":"原票・見込額・適用条件をまとめて確認"}));
    }
   }
   cell(tr,isEstimate?yen(r.donationLimitYen):"—","batch-result");
   cell(tr,isEstimate?r.status:core.canOutputNoTax(r)?r.status+"："+r.reason:("HOLD："+((r.status==="概算"||r.status==="前年参考概算"||r.status==="控除余地なし")?
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
   const details=formControl("details");details.open=openFamilyRows.has(i)||Object.keys(r.familyCountHints||{}).length>0||r.spouseIncomeHint!==undefined;
   details.appendChild(formControl("summary",{text:"家族明細を入力・確認"}));
   const countLabels={"familySpecificCount":"特定扶養親族","familyElderlyCount":"老人扶養親族","familyOtherCount":"その他の控除対象扶養親族","familySpecialRelativeCount":"特定親族","familyUnder16Count":"16歳未満の扶養親族"};
   if(r.spouseIncomeHint!==undefined)details.appendChild(formControl("p",{text:"原票の配偶者合計所得（G43）候補："+yen(r.spouseIncomeHint)+"。年齢とともに原票年の家族明細へ入力してください。"}));
   const hints=Object.entries(r.familyCountHints||{}).map(([k,n])=>countLabels[k]+"："+n+"人");
   if(hints.length)details.appendChild(formControl("p",{class:"batch-family-count-hint",text:"原票年の人数候補："+hints.join("／")+"。原票と照合し、個々の年齢・所得を入力してください。記載なしは0人と断定しません。"}));
   for(const [key,title] of [["familySourceText","原票年の家族"],["familyTargetText","試算年の家族"]]){
    const label=formControl("label",{text:title});
    const area=formControl("textarea",{"data-row":String(i),"data-field":key,
     "aria-label":"対象者 "+r.page+" "+title,rows:"4",maxlength:"3000",
     autocomplete:"off",spellcheck:"false",placeholder:"S,40,600000\nR,20,600000,0"});
    area.value=r[key];label.appendChild(area);details.appendChild(label);
   }
   details.appendChild(formControl("button",{type:"button",class:"secondary",text:"原票年の家族を試算年へコピー（上書き・年齢更新）","data-copy-family":String(i)}));
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
   const deductionHints=[["sourceLifeDeductionHint","生命保険料控除額"],["sourceEarthDeductionHint","地震保険料控除額"]].filter(([k])=>Number.isSafeInteger(r.insuranceDeductionHints?.[k])&&r.insuranceDeductionHints[k]>0).map(([k,l])=>l+"："+yen(r.insuranceDeductionHints[k]));
   if(deductionHints.length)insuranceDetails.appendChild(formControl("p",{text:"原票の控除額候補："+deductionHints.join("／")+"。年間支払保険料ではありません。原票年の計算額と照合します。"}));
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
    const flagKey=prefix+"Insurance_otherClaimUnder23";
    const label=formControl("label",{text:"令和8年：本人の扶養明細に含めない、他の所得者が扶養控除等を受ける23歳未満の扶養親族による生命保険料控除特例"});
    const field=formControl("select",{"data-row":String(i),"data-field":flagKey,"aria-label":"対象者 "+r.page+" "+(prefix==="source"?"原票年":"試算年")+" の生命保険料控除特例（他の所得者の扶養）"});
    for(const [value,text] of [["","該当なし"],["yes","該当あり（年齢・所得62万円以下等を確認済み）"]])field.appendChild(formControl("option",{value,text}));
    field.value=r[flagKey];label.appendChild(field);group.appendChild(label);
    insuranceDetails.appendChild(group);
   }
   const copyPremiums=formControl("button",{type:"button",text:"原票年の保険料を試算年へコピー（上書き）","data-copy-premiums":String(i),class:"secondary"});
   insuranceDetails.appendChild(copyPremiums);
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
   const amount=formControl("input",{type:"text",inputmode:"numeric",maxlength:"12",autocomplete:"off","data-row":String(i),"data-field":"medicalNetPaidYen","aria-label":"対象者 "+r.page+" 補填後の対象医療費支払額（任意）",placeholder:"空欄＝なし",title:"補填対象ごとの差引残額の合計。補填金の余りは他の医療費から差し引かない。通常の医療費控除を自動計算"});
   amount.value=r.medicalNetPaidYen;medicalCell.appendChild(amount);
   for(const key of core.MEDICAL_SUMMARY_KEYS)cell(tr,isEstimate?yen(r.medicalSummary?.[key]):"—","batch-medical-result");
   const highCell=cell(tr,"","batch-high-editor");
   const highDetails=formControl("details");highDetails.hidden=!core.highActive(r);highDetails.open=openHighRows.has(i);
   highDetails.appendChild(formControl("summary",{text:"高額給与の確認（850万円超）"}));
   highDetails.appendChild(formControl("p",{text:"該当する家族・保険料・その他控除を入力し、原票年のG46・G47を確認。該当しない控除は空欄で可。"}));
   for(const [key,title] of [["sourceBasicYen","原票の基礎控除（G46）"],["sourceAdjustmentYen","原票の所得金額調整控除（G47・該当なしは0）"],["sourceAdjustmentExtras","原票年：他方が扶養控除を適用する該当親族"],["targetAdjustmentExtras","試算年：他方が扶養控除を適用する該当親族"]]){
    const label=formControl("label",{text:title});
    const extras=key.endsWith("Extras"),field=formControl(extras?"textarea":"input",{"data-row":String(i),"data-field":key,"aria-label":"対象者 "+r.page+" "+title,autocomplete:"off",maxlength:extras?"3000":"8",...(extras?{rows:"2",placeholder:"年齢,合計所得,特別障害者(0/1)"}:{type:"text",inputmode:"numeric"})});
    field.value=r[key];label.appendChild(field);highDetails.appendChild(label);
   }
   const highReview=formControl("label",{text:" 原票・試算年の所得金額調整控除条件（該当なし含む）・他の控除の有無を確認済み"});
   highReview.prepend(formControl("input",{type:"checkbox","data-row":String(i),"data-field":"highReviewed",checked:r.highReviewed}));highDetails.appendChild(highReview);highCell.appendChild(highDetails);
   for(const key of core.HIGH_SUMMARY_KEYS)cell(tr,isEstimate?yen(r.highSummary?.[key]):"—","batch-high-result");
   const mortgageCell=cell(tr,"","batch-mortgage-editor");
   const mortgageDetails=formControl("details");mortgageDetails.open=openMortgageRows.has(i);
   mortgageDetails.appendChild(formControl("summary",{text:"住宅ローン控除（該当者のみ）"}));
   mortgageDetails.appendChild(formControl("p",{text:"控除額（G29）と控除可能額（G36）は別項目です。G29が空欄なら0円と推定せず、年末調整の適用状況を確認してください。G29が正の金額でG36が原票上空欄の場合のみG36は入力不要です。G29が0円のケースは個別確認が必要です。前年の控除可能額を使用し、ローン残高の変動は考慮しません。"}));
   for(const [key,title] of [["mortgageSourceApplied","原票の住宅借入金等特別控除額（円）"],["mortgageSourcePossible","原票の住宅借入金等特別控除可能額（円・原票空欄なら空欄）"],["mortgageMoveInYear","入居年（西暦）"],["mortgageCapClass","住民税の控除限度額区分"]]){
    const label=formControl("label",{text:title});
    const field=formControl(key==="mortgageCapClass"?"select":"input",{"data-row":String(i),"data-field":key,"aria-label":"対象者 "+r.page+" "+title,autocomplete:"off",...(key==="mortgageCapClass"?{}:{type:"text",inputmode:"numeric",maxlength:key==="mortgageMoveInYear"?"4":"6"})});
    if(key==="mortgageCapClass")for(const [value,text] of [["","選択"],["standard5","5％・97,500円"],["transitional7","7％・136,500円（経過措置）"]])field.appendChild(formControl("option",{value,text}));
    field.value=r[key];label.appendChild(field);mortgageDetails.appendChild(label);
   }
   const mortgageReview=formControl("label",{text:" 原票記載・適用区分・控除期間内で継続適用・他の税額控除なしを確認済み"});
   mortgageReview.prepend(formControl("input",{type:"checkbox","data-row":String(i),"data-field":"mortgageReviewed",checked:r.mortgageReviewed}));mortgageDetails.appendChild(mortgageReview);mortgageCell.appendChild(mortgageDetails);
   for(const key of core.MORTGAGE_SUMMARY_KEYS)cell(tr,isEstimate?yen(r.mortgageSummary?.[key]):"—","batch-mortgage-result");
   for(const select of tr.querySelectorAll("select:not([data-field=mortgageCapClass])")){
    const span=document.createElement("span");span.className="batch-print-value";
    span.textContent=select.selectedOptions[0]?.textContent??"未確認";select.parentNode.appendChild(span);
   }
   // The mobile layout uses the very same editable cells and audit snapshot.
   // Header text is static UI copy, never derived from source documents.
   tr.setAttribute("role","row");
   [...tr.children].forEach((td,i)=>{
    const heading=headerCells[i];
    if(heading){td.setAttribute("headers",heading.id);td.dataset.columnLabel=heading.textContent.trim();}
    td.setAttribute("role","cell");refreshMobileEmpty(td);
   });
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
 // History restoration is a fresh session: discard rows and cancel
 // pending reads. Generation checks also reject late OCR completions.
 function clearHistorySession(){
  document.body.classList.remove("batch-print");
  reset();
 }
 window.addEventListener("pagehide",clearHistorySession);
 window.addEventListener("pageshow",event=>{if(event.persisted===true)clearHistorySession();});
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
   const amounts=tr.querySelectorAll(".batch-result,.batch-deduction-applied,.batch-resident-levy,.batch-comparison,.batch-family-result,.batch-insurance-result,.batch-other-result,.batch-medical-result,.batch-high-result,.batch-mortgage-result");
   const highDetails=tr.querySelector(".batch-high-editor details");if(highDetails)highDetails.hidden=!core.highActive(row);
   const reason=tr.querySelector(".batch-reason");
   amounts.forEach(el=>{el.textContent="—";refreshMobileEmpty(el);});
   if(reason)reason.textContent="HOLD："+row.reason;
   for(const checkbox of tr.querySelectorAll('input[type="checkbox"][data-field]'))
    checkbox.checked=row[checkbox.dataset.field]===true;
   const basic=tr.querySelector("[data-confirm-basic]");if(basic){const complete=row.confirmed&&row.noExclusions&&(row.sourceYear===row.year||row.forecastReviewed);basic.disabled=!row.sourceValid||complete;basic.textContent=complete?"基本確認済み":"原票・見込額・適用条件をまとめて確認";}
   const trialStatus=tr.querySelector(".batch-trial-status");if(trialStatus)trialStatus.textContent="HOLD";
  }
  updateButtons();
 }
 body.addEventListener("click",ev=>{
  const zero=ev.target?.closest?.("[data-confirm-social-zero]");
  if(zero){
   if(running||!body.contains(zero)||!reconcileLiveInputs())return;
   const row=rows[Number(zero.dataset.confirmSocialZero)];
   if(!core.confirmSocialZero(row)){say("原票年の金額を確認してください。空欄確認の対象外です。");return;}
   invalidateEditedRow(row);render();say("対象者 "+row.page+" の原票空欄を手動確認して0円設定しました。見込額・適用条件を再確認してください。");return;
  }
  const basic=ev.target?.closest?.("[data-confirm-basic]");
  if(basic){
   if(running||!body.contains(basic)||!reconcileLiveInputs())return;
   const i=Number(basic.dataset.confirmBasic),row=rows[i];
   if(!Number.isSafeInteger(i)||!row||!core.confirmBasic(row)){say("原票年分・金額・自治体区分・未対応条件を確認してください。");return;}
   invalidateEditedRow(row);render();say("対象者 "+row.page+" の基本確認を反映しました。該当する個別控除は別途確認してください。");return;
  }
  const family=ev.target?.closest?.("[data-copy-family]");
  if(family){
   if(running||!body.contains(family)||!reconcileLiveInputs())return;
   const i=Number(family.dataset.copyFamily),row=rows[i];
   if(!Number.isSafeInteger(i)||!row||!core.copySourceFamily(row)){say("原票年の家族明細を確認してください。その他控除・所得金額調整控除の親族明細がある場合は個別入力してください。");return;}
   invalidateEditedRow(row);render();say("対象者 "+row.page+" の家族明細をコピーしました。試算年の所得・家族構成・適用条件を確認してください。");return;
  }
  const button=ev.target?.closest?.("[data-copy-premiums]");
  if(!button||running||!body.contains(button)||!reconcileLiveInputs())return;
  const i=Number(button.dataset.copyPremiums),row=rows[i];
  if(!Number.isSafeInteger(i)||!row)return;
  if(!core.copySourcePremiums(row)){say("原票年の年間保険料を正しく入力してください。");return;}
  invalidateEditedRow(row);render();
  say("対象者 "+row.page+" の原票年の年間保険料を試算年にコピーしました。変更があれば訂正し、再確認してください。");
 });
 body.addEventListener("input",ev=>{
  const idx=Number(ev.target?.dataset?.row);
  const key=ev.target?.dataset?.field;
  if(!Number.isSafeInteger(idx)||!rows[idx])return;
  if(key==="label"||key==="trialInput"||key==="familySourceText"||key==="familyTargetText"||(core.PREMIUM_FIELDS.includes(key)||core.OTHER_FIELDS.includes(key)||core.MEDICAL_FIELDS.includes(key)||core.HIGH_FIELDS.includes(key)||core.MORTGAGE_FIELDS.includes(key))||monetary.includes(key)){
   core.edit(rows[idx],key,ev.target.value);
   if(key==="medicalNetPaidYen"&&/^[1-9][0-9]{0,11}$/.test(ev.target.value)&&Number(ev.target.value)<=100000000000){
    rows[idx].filing="return";body.children[idx].querySelector('[data-field="filing"]').value="return";
   }
   invalidateEditedRow(rows[idx]);
  }
 });
 body.addEventListener("change",ev=>{
  const idx=Number(ev.target?.dataset?.row);
  const key=ev.target?.dataset?.field;
  if(!Number.isSafeInteger(idx)||!rows[idx])return;
  const row=rows[idx];
  if(key==="familySourceText"||key==="familyTargetText"||(core.PREMIUM_FIELDS.includes(key)||core.OTHER_FIELDS.includes(key)||core.MEDICAL_FIELDS.includes(key)||core.HIGH_FIELDS.includes(key)||core.MORTGAGE_FIELDS.includes(key))){
   // The input listener already records typing; avoid replacing the editor
   // on blur, which could swallow a click on the confirmation checkbox.
   if(row[key]!==ev.target.value){core.edit(row,key,ev.target.value);
    if(key==="medicalNetPaidYen"&&/^[1-9][0-9]{0,11}$/.test(ev.target.value)&&Number(ev.target.value)<=100000000000){
     row.filing="return";body.children[idx].querySelector('[data-field="filing"]').value="return";
    }
    invalidateEditedRow(row);}
   return;
  }
  if(key==="label"||key==="trialInput"||(core.PREMIUM_FIELDS.includes(key)||core.OTHER_FIELDS.includes(key)||core.MEDICAL_FIELDS.includes(key)||core.HIGH_FIELDS.includes(key)||core.MORTGAGE_FIELDS.includes(key))||monetary.includes(key)){
   core.edit(row,key,ev.target.value);
  }else if(key==="sourceYear"||key==="year"||key==="municipality"){
   core.edit(row,key,ev.target.value);
  }else if(key==="filing"&&["one-stop","return"].includes(ev.target.value)){
   row.filing=ev.target.value;
   row.confirmed=false;row.noExclusions=false;row.forecastReviewed=false;row.familyReviewed=false;row.insuranceReviewed=false;row.otherReviewed=false;row.highReviewed=false;row.mortgageReviewed=false;
  }else if(["confirmed","noExclusions","forecastReviewed","familyReviewed","insuranceReviewed","otherReviewed","highReviewed","mortgageReviewed"].includes(key)){
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
  if(running||!rows.length||!reconcileLiveInputs())return;
  const engine=window.FurusatoEngine;
  const guard=window.FurusatoEstimateGuard?.canDisplayEstimate;
  const selectedReference=window.FurusatoEstimateGuard?.selectedReference;
  rows.forEach(row=>core.calculate(row,engine,guard,selectedReference,window.FurusatoResidentLevy,window.FurusatoFamilyTax,window.FurusatoFamilySource));
  computed=true;render();
  const allowed=rows.filter(core.canOutputEstimate).length,noTax=rows.filter(core.canOutputNoTax).length;
  say("対象 "+rows.length+"件：概算 "+allowed+"件、控除余地なし "+noTax+"件、HOLD "+(rows.length-allowed-noTax)+
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
    else if(key==="filing"){row.filing=actual;row.confirmed=false;row.noExclusions=false;row.forecastReviewed=false;row.familyReviewed=false;row.insuranceReviewed=false;row.otherReviewed=false;row.highReviewed=false;row.mortgageReviewed=false;}
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
  const a=document.createElement("a");
  try{
   a.href=url;a.download="furusato_batch_review.csv";
   a.hidden=true;document.body.appendChild(a);
   a.click();
  }finally{
   a.remove();
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
