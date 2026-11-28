"use strict";
/**
 * Salary-only + explicitly reviewed resident family, WEB review only.
 * Income tax taxable and local special credit base must remain distinct.
 * Optional explicitly reviewed insurance premiums; no UI approval,
 * source inference, mortgage or other credits.
 * https://www.city.sapporo.jp/s024/4654.html
 * https://www.city.chofu.lg.jp/030010/p014041.html
 * https://www.city.chofu.lg.jp/030010/p014042.html
 * https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1155.htm
 */
(function(root,factory){
 if(typeof module==="object"&&module.exports)module.exports=factory(require("./family-deductions.js"),require("./insurance-deductions.js"),require("./other-deductions.js"),require("./medical-deductions.js"),require("./salary-adjustment.js"));
 else root.FurusatoFamilyTax=factory(root.FurusatoFamilyDeductions,root.FurusatoInsuranceDeductions,root.FurusatoOtherDeductions,root.FurusatoMedicalDeductions,root.FurusatoSalaryAdjustment);
}(typeof window!=="undefined"?window:this,function(family,insurance,other,medical,salaryAdjustment){
 const valid=(n,max)=>Number.isSafeInteger(n)&&n>=0&&n<=max;
 const hold=reason=>({status:"HOLD",reason,calculation:null,donationLimitYen:null,release:"HOLD"});
 const floor1000=n=>Math.floor(Math.max(0,n)/1000)*1000;
 const basic=(year,income)=>year===2025?
  (income<=1320000?950000:income<=3360000?880000:income<=4890000?680000:income<=6550000?630000:580000):
  (income<=4890000?1040000:income<=6550000?670000:620000);
 function national(taxable){
  const incomeTax=taxable<=1950000?taxable*5/100:
   taxable<=3300000?taxable*10/100-97500:taxable<=6950000?taxable*20/100-427500:taxable<=9000000?taxable*23/100-636000:taxable*33/100-1536000;
  const reconstruction=Math.floor(incomeTax*21/1000);
  return {taxable,incomeTax,reconstruction,total:incomeTax+reconstruction};
 }
 function calculateCore(input,filing,highDetails=null,classifyOnly=false){
  // The new path accepts the combined amount (G26), NEVER an ambiguous
  // socialInsurance amount. G25 is included in it, not an extra deduction.
  const groupedMedical=input?.conditions==="salary-basic-social-family-insurance-other-medical-filing-reviewed";
  const netMedical=!!input&&Object.prototype.hasOwnProperty.call(input,"medicalNetPaidYen");
  const withMedical=groupedMedical||netMedical;
  if(groupedMedical&&netMedical)return hold("医療費控除の二重入力はできません");
  // Never expose a one-stop estimate with a medical deduction claim,
  // even for a zero deduction. All annual donations belong in the return.
  if(withMedical&&!filing)return hold("医療費控除を申告する場合はワンストップ特例を利用できません。確定申告方式を選択してください");
  const withOther=groupedMedical||input?.conditions==="salary-basic-social-family-insurance-other-only-reviewed";
  const keys=["year","salaryIncome",withOther?"socialAndContributions":"socialInsurance","municipality","spouse","relatives","conditions"];
  const withInsurance=withOther||input?.conditions==="salary-basic-social-family-insurance-only-reviewed";
  if(withInsurance)keys.push("premiums");
  if(withOther)keys.push("otherDeductions");
  if(groupedMedical)keys.push("medicalDeductions");
  if(netMedical)keys.push("medicalNetPaidYen");
  if(!input||typeof input!=="object"||Array.isArray(input)||
    Object.keys(input).length!==keys.length||!keys.every(k=>Object.prototype.hasOwnProperty.call(input,k))||
    ![2025,2026].includes(input.year)||!valid(input.salaryIncome,highDetails?18050000:6550000)||
    !valid(withOther?input.socialAndContributions:input.socialInsurance,8500000)||!["standard","designated"].includes(input.municipality)||
    (!withInsurance&&input.conditions!=="salary-basic-social-family-only-reviewed")||!family||
    typeof family.calculate!=="function")
    return hold("給与所得・家族・自治体・追加控除等の適用条件を確認してください");
  const household={year:input.year,taxpayerIncome:input.salaryIncome,
    spouse:input.spouse,relatives:input.relatives,conditions:"annual-resident-family-reviewed"};
  const f=family.calculate(household);
  if(f.status!=="COMPONENTS_ONLY")return hold(f.reason||"家族控除が未確認です");
  const c=f.calculation;
  if(c.ordinaryResidentIncomeLevyExempt&&!classifyOnly)return hold("住民税所得割非課税のため寄附上限試算対象外です");
  const income=input.salaryIncome;
  const nationalBasic=basic(input.year,income);
  let insuranceDetails=null;
  if(withInsurance){
   if(!insurance||typeof insurance.calculate!=="function")return hold("保険料控除の計算機能を利用できません");
   const result=insurance.calculate({year:input.year,family:household,premiums:input.premiums,
     conditions:"eligible-net-premiums-and-contract-selection-reviewed"});
   if(result.status!=="COMPONENTS_ONLY")return hold(result.reason||"保険料控除を確認できません");
   insuranceDetails=result.calculation;
  }
  let otherDetails=null,socialOnly=input.socialInsurance;
  if(withOther){
   const o=input.otherDeductions;
   const otherKeys=["disability","maritalRelief","childIndex","workingStudent","smallEnterpriseContributions"];
   if(!o||typeof o!=="object"||Array.isArray(o)||Object.keys(o).length!==otherKeys.length||
      !otherKeys.every(k=>Object.prototype.hasOwnProperty.call(o,k))||
      !valid(o.smallEnterpriseContributions,input.socialAndContributions)||
      !other||typeof other.calculate!=="function")
    return hold("社会保険料等の合計額と内書き掛金、その他控除を確認してください");
   socialOnly=input.socialAndContributions-o.smallEnterpriseContributions;
   const result=other.calculate({...o,family:household,conditions:"salary-only-adult-other-deductions-reviewed"});
   if(result.status!=="COMPONENTS_ONLY")return hold(result.reason||"その他所得控除を確認できません");
   otherDetails=result.calculation;
   if(otherDetails.residentIncomeLevyExempt)return hold("住民税所得割非課税のため寄附上限試算対象外です");
  }
  let medicalDetails=null;
  if(netMedical){
   const n=input.medicalNetPaidYen;
   if(!valid(n,100000000000)||n===0||!medical||typeof medical.calculateNet!=="function")return hold("補填後の対象医療費支払額を確認してください");
   const result=medical.calculateNet({year:input.year,salaryIncome:income,netEligibleYen:n});
   if(result.status!=="COMPONENTS_ONLY")return hold(result.reason);
   medicalDetails=result.calculation;
  }else if(groupedMedical){
   const m=input.medicalDeductions;
   const mk=["method","groups","conditions"];
   if(m?.method==="selfMedication")mk.push("healthMeasureReviewed");
   if(!m||typeof m!=="object"||Array.isArray(m)||Object.keys(m).length!==mk.length||
      !mk.every(k=>Object.prototype.hasOwnProperty.call(m,k))||!medical||typeof medical.calculate!=="function")
    return hold("医療費控除の方式・支払額・補填金・確定申告条件を確認してください");
   const result=medical.calculate({...m,year:input.year,salaryIncome:income});
   if(result.status!=="COMPONENTS_ONLY")return hold(result.reason||"医療費控除を確認できません");
   medicalDetails=result.calculation;
  }
  const nationalDeductions=nationalBasic+socialOnly+c.nationalFamilyDeductionYen+
    (insuranceDetails?.national.totalYen??0)+(otherDetails?.nationalOtherDeductionYen??0)+(medicalDetails?.nationalDeductionYen??0);
  const residentDeductions=430000+socialOnly+c.residentFamilyDeductionYen+
    (insuranceDetails?.resident.totalYen??0)+(otherDetails?.residentOtherDeductionYen??0)+(medicalDetails?.residentDeductionYen??0);
  const nationalTaxable=floor1000(income-nationalDeductions);
  const localTaxable=floor1000(income-residentDeductions);
  // Classification only, never a numeric donation estimate. Require both
  // taxable bases to be zero and every ordinary deduction to be validated.
  if(classifyOnly){
   if(withOther||withMedical||highDetails||nationalTaxable!==0||localTaxable!==0)
    return hold("所得税・住民税の両方の課税所得ゼロを確認できません");
   return {status:"NO_TAX",donationLimitYen:null,release:"HOLD",calculation:{
    year:input.year,municipality:input.municipality,family:c,...(withInsurance?{insurance:insuranceDetails}:{}),
    nationalBasicYen:nationalBasic,nationalDeductionsYen:nationalDeductions,residentDeductionsYen:residentDeductions,
    nationalTaxableYen:0,residentTaxableYen:0}};
  }
  if(nationalTaxable===0||localTaxable===0)return hold("所得税または住民税の課税所得がないケースは個別確認してください");
  // Insurance deduction differences are not personal deduction differences.
  // Keep the statutory municipal special-rate base separate from actual national taxable.
  const difference=50000+c.familyAdjustmentDifferenceYen+(otherDetails?.adjustmentDifferenceYen??0);
  const adjustmentBasis=localTaxable<=2000000?Math.min(localTaxable,difference):
   Math.max(50000,difference-(localTaxable-2000000));
  const specialBase=localTaxable-difference-Math.max(0,nationalBasic-480000);
  if(specialBase<0)return hold("特例控除割合の適用区分を個別確認してください");
  // With gross salary <=20m and salary-only income, neither national taxable
  // nor the resident special-rate base can reach the 40% band.
  if(nationalTaxable>=18000000||specialBase>18000000)return hold("高額所得の税率区分は対象外です");
  const specialRate=specialBase<=1950000?5:specialBase<=3300000?10:specialBase<=6950000?20:specialBase<=9000000?23:33;
  const ratio=90000-specialRate*1021;
  const share=input.municipality==="standard"?3:4;
  function part(s){
   const gross100=localTaxable*s*2;
   const adjustment100=Math.min(gross100,adjustmentBasis*s);
   const after100=gross100-adjustment100;
   const assessed=Math.floor(after100/10000)*100;
   const cap=assessed/5;
   return {share:s,grossYen:gross100/100,adjustmentYen:adjustment100/100,
    beforeRounding100:after100,assessedYen:assessed,conservativeSpecialCapYen:cap,
    referenceLimitYen:2000+Math.floor(cap*500000/(ratio*s))};
  }
  const city=part(share),prefecture=part(5-share);
  const levy=city.assessedYen+prefecture.assessedYen;
  // Income-levy relief near the ordinary exemption boundary is a distinct
  // post-credit adjustment, not the personal-deduction adjustment above.
  // https://www.city.osaka.lg.jp/zaisei/page/0000384084.html
  // https://www.city.imizu.toyama.jp/guide/svGuideDtl.aspx?servno=54771
  // Until the pre/post donation and housing interaction is audited, stop
  // if even the unrounded pre-credit levy could trigger that relief.
  if(city.beforeRounding100+prefecture.beforeRounding100>
     (income-c.ordinaryResidentIncomeLevyExemptionLimitYen)*100)
   return hold("住民税所得割の非課税限度額付近の調整措置は個別確認してください");
  if(levy<=0)return hold("住民税所得割がありません");
  const incomeCap=Math.floor(income*3/10);
  const exactReference=Math.min(city.referenceLimitYen,prefecture.referenceLimitYen,incomeCap);
  const rounded=Math.floor(exactReference/1000)*1000;
  if(rounded<2000)return hold("寄附控除の参考上限を確認できません");
  return {status:"ESTIMATE",donationLimitYen:rounded,release:"HOLD",calculation:{
   year:input.year,residentYear:input.year+1,municipality:input.municipality,
   ...(highDetails?{salaryAdjustment:highDetails}:{}),family:c,...(withInsurance?{insurance:insuranceDetails}:{}),
   ...(withOther?{other:otherDetails,socialInsuranceOnlyYen:socialOnly,socialAndContributionsYen:input.socialAndContributions}:{}),
   ...(withMedical?{medical:medicalDetails}:{}),
   nationalBasicYen:nationalBasic,nationalDeductionsYen:nationalDeductions,
   residentDeductionsYen:residentDeductions,nationalTaxableYen:nationalTaxable,
   residentTaxableYen:localTaxable,nationalBefore:national(nationalTaxable),
   personalDifferenceYen:difference,adjustmentBasisYen:adjustmentBasis,
   adjustmentYen:city.adjustmentYen+prefecture.adjustmentYen,
   residentSpecialBaseYen:specialBase,specialRatePercent:specialRate,specialDenominator:ratio,
   city,prefecture,residentIncomeLevyYen:levy,incomeCapYen:incomeCap,
   exactReferenceYen:exactReference,roundedReferenceYen:rounded}};
 }
 function calculate(input){return calculateCore(input,false);}
 function calculateNoTax(input){return calculateCore(input,false,null,true);}
 // Require the exact shared-engine stop reason AND independently validate
 // reviewed facts and the original-year deduction total. No GAS changes.
 function classifyBasicNoTax(result,input,engine){
  const reject=()=>hold("課税所得ゼロの適用条件を確認してください");
  const yen=s=>typeof s==="string"&&/^(0|[1-9][0-9]{0,11})$/.test(s)?Number(s):null;
  if(result?.status!=="HOLD"||result.reasons?.length!==1||result.reasons[0]!=="課税所得がゼロのため、初期版では寄附限度額を判定しません"||
     !input||input.acknowledgedExclusions!==true||input.sourceReviewPending===true||input.incomeType!=="salary"||
     !["one-stop","return"].includes(input.filing)||!["standard","designated"].includes(input.municipality)||
     ["hasSpouse","hasDependents","hasLifeInsurance","hasEarthquakeInsurance","hasMortgage","hasOtherIncome","hasMedical","hasSplitIncome","hasIncomeAdjustment","hasNonstandardConditions"].some(k=>input[k]!==false)||
     (input.sourceIndicators!==undefined&&(!input.sourceIndicators||typeof input.sourceIndicators!=="object"||Array.isArray(input.sourceIndicators)||Object.keys(input.sourceIndicators).length))||
     !engine||typeof engine.salaryIncome!=="function"||typeof engine.statutoryRows!=="function")return reject();
  const year=Number(input.year),sourceYear=Number(input.sourceYear??input.year),gross=yen(input.salaryGross),social=yen(input.socialInsurance);
  if(![2025,2026].includes(year)||![2025,2026].includes(sourceYear)||![year,year-1].includes(sourceYear)||
     (sourceYear!==year&&input.forecastReviewed!==true)||gross===null||gross<=0||gross>8500000||social===null||social>gross)return reject();
  const income=engine.salaryIncome(gross,year);
  if(!valid(income,6550000)||(input.salaryIncomeReference!==""&&yen(input.salaryIncomeReference)!==income))return reject();
  const checked=calculateNoTax({year,salaryIncome:income,socialInsurance:social,municipality:input.municipality,spouse:null,relatives:[],conditions:"salary-basic-social-family-only-reviewed"});
  if(checked.status!=="NO_TAX")return checked;
  const total=checked.calculation.nationalDeductionsYen;
  if((input.deductionsOverride!==""&&yen(input.deductionsOverride)!==total)||(input.deductionsReference!==""&&yen(input.deductionsReference)!==total))return reject();
  const imported=input.sourceYear!==undefined||["sourceOriginalGross","sourceOriginalSocial","sourceOriginalDeductions"].some(k=>input[k]!==undefined);
  if(imported){
   const og=yen(input.sourceOriginalGross),os=yen(input.sourceOriginalSocial),ot=yen(input.sourceOriginalDeductions);
   if(og===null||og<=0||og>8500000||os===null||os>og||ot===null)return reject();
   const oi=engine.salaryIncome(og,sourceYear),rule=engine.statutoryRows().find(row=>row[0]===sourceYear&&oi<=row[1]);
   if(!valid(oi,6550000)||!rule||rule[2]+os!==ot||yen(input.sourceDeductionsReference)!==ot)return reject();
  }else if(input.sourceDeductionsReference!==""&&yen(input.sourceDeductionsReference)!==total)return reject();
  return checked;
 }
 // Filing-only display basis. Do not expose the one-stop reference ceiling
 // or the component reference ceilings for medical claims.
 function medicalFilingCalculation(input){
  if(input?.conditions!=="salary-basic-social-family-insurance-other-medical-filing-reviewed"&&!Object.prototype.hasOwnProperty.call(input||{},"medicalNetPaidYen"))
   return hold("医療費控除の確定申告条件を確認してください");
  return filingDisplay(calculateCore(input,true));
 }
 function filingDisplay(ref){
  if(ref.status!=="ESTIMATE")return ref;
  const {exactReferenceYen,roundedReferenceYen,city,prefecture,...rest}=ref.calculation;
  const {referenceLimitYen:cityRef,...cityDetails}=city;
  const {referenceLimitYen:prefRef,...prefectureDetails}=prefecture;
  return {status:"ESTIMATE",release:"HOLD",donationLimitYen:null,
   calculation:{...rest,city:cityDetails,prefecture:prefectureDetails,filingOnly:true,oneStopAllowed:false}};
 }
 function medicalFilingMetadata(c){
  return c.medical?{filingOnly:true,oneStopAllowed:false,medical:c.medical,
   nationalDeductionsYen:c.nationalDeductionsYen,residentDeductionsYen:c.residentDeductionsYen,
   residentTaxableYen:c.residentTaxableYen,personalDifferenceYen:c.personalDifferenceYen,
   adjustmentYen:c.adjustmentYen,residentSpecialBaseYen:c.residentSpecialBaseYen,specialRatePercent:c.specialRatePercent}: {};
 }
 function trialFromCalculation(c,income,donation){
  if(!valid(donation,c.incomeCapYen)||donation<2000)
   return hold("試算寄附額は2,000円以上・給与所得の30%以内の整数で入力してください");
  const base=donation-2000;
  const after=national(floor1000(income-c.nationalDeductionsYen-base));
  function part(p){
   // Follow the existing filing model: unrounded levy for the special
   // cap, combined basic + special rounded up, final levy floored to 100.
   const special=Math.min(p.beforeRounding100*1000,base*c.specialDenominator*p.share);
   const regular=base*p.share*10000;
   const credit=Math.floor((regular+special+499999)/500000);
   const afterYen=Math.max(0,Math.floor((p.beforeRounding100-credit*100)/10000))*100;
   return {beforeYen:p.assessedYen,afterYen,creditYen:credit,savingYen:p.assessedYen-afterYen};
  }
  const city=part(c.city),prefecture=part(c.prefecture);
  const nationalSaving=c.nationalBefore.total-after.total;
  const residentSaving=city.savingYen+prefecture.savingYen;
  const selfPay=donation-nationalSaving-residentSaving;
  return {status:"ESTIMATE",release:"HOLD",calculation:{donationYen:donation,
   ...medicalFilingMetadata(c),nationalBefore:c.nationalBefore,nationalAfter:after,city,prefecture,
   nationalSavingYen:nationalSaving,residentSavingYen:residentSaving,selfPayYen:selfPay,
   excessOver2000Yen:Math.max(0,selfPay-2000),within2000:selfPay<=2000}};
 }
 function filingTrial(input,donation){
  const ref=calculateCore(input,true);
  return ref.status==="ESTIMATE"?trialFromCalculation(ref.calculation,input.salaryIncome,donation):ref;
 }
 function filingPrefix(input){
  const ref=calculateCore(input,true);
  if(ref.status!=="ESTIMATE")return ref;
  let ceiling=2000,firstFailure=null;
  for(let d=3000;d<=ref.calculation.incomeCapYen;d+=1000){
   const trial=trialFromCalculation(ref.calculation,input.salaryIncome,d);
   if(trial.status!=="ESTIMATE")return trial;
   if(!trial.calculation.within2000){firstFailure=d;break;}
   ceiling=d;
  }
  return {status:"ESTIMATE",donationLimitYen:ceiling,release:"HOLD",
    calculation:{...medicalFilingMetadata(ref.calculation),firstFailureYen:firstFailure,stopOnFirstFailure:true}};
 }
 // Explicit high-salary entry points: never accept an externally supplied
 // adjusted income, and never widen the existing UI's reviewed conditions.
 function highCore(request,filing){
  const exact=(x,ks)=>x&&typeof x==="object"&&!Array.isArray(x)&&
   Object.keys(x).length===ks.length&&ks.every(k=>Object.prototype.hasOwnProperty.call(x,k));
  if(!exact(request,["adjustment","tax"])||!salaryAdjustment||
     typeof salaryAdjustment.calculate!=="function")
   return hold("給与収入・所得金額調整控除の事実と税額計算条件を確認してください");
  const adj=request.adjustment,tax=request.tax;
  const medicalClaim=tax?.conditions==="salary-basic-social-family-insurance-other-medical-filing-reviewed";
  const keys=["socialAndContributions","municipality","spouse","relatives","conditions","premiums","otherDeductions"];
  if(medicalClaim)keys.push("medicalDeductions");
  if(tax&&Object.prototype.hasOwnProperty.call(tax,"medicalNetPaidYen"))keys.push("medicalNetPaidYen");
  if(!exact(tax,keys)||(!medicalClaim&&tax.conditions!=="salary-basic-social-family-insurance-other-only-reviewed")||
     !adj||!valid(adj.grossSalary,20000000)||adj.grossSalary<8500000)
   return hold("高額給与は850万円以上2,000万円以下の確認済み条件のみ試算できます");
  const result=salaryAdjustment.reconcileClaims(adj,tax);
  if(result.status!=="COMPONENTS_ONLY")return hold(result.reason);
  const facts=result.calculation;
  return calculateCore({...tax,year:adj.year,salaryIncome:facts.salaryIncomeAfterAdjustmentYen},filing,facts);
 }
 function highSalaryCalculate(request){return highCore(request,false);}
 function highSalaryMedicalFilingCalculation(request){
  if(request?.tax?.conditions!=="salary-basic-social-family-insurance-other-medical-filing-reviewed"&&!Object.prototype.hasOwnProperty.call(request?.tax||{},"medicalNetPaidYen"))
   return hold("医療費控除の確定申告条件を確認してください");
  return filingDisplay(highCore(request,true));
 }
 function highSalaryFilingTrial(request,donation){
  const ref=highCore(request,true);
  if(ref.status!=="ESTIMATE")return ref;
  const c=ref.calculation;
  const trial=trialFromCalculation(c,c.salaryAdjustment.salaryIncomeAfterAdjustmentYen,donation);
  if(trial.status==="ESTIMATE")trial.calculation.salaryAdjustment=c.salaryAdjustment;
  return trial;
 }
 function highSalaryFilingPrefix(request){
  const ref=highCore(request,true);
  if(ref.status!=="ESTIMATE")return ref;
  const c=ref.calculation;
  let ceiling=2000,firstFailure=null;
  for(let d=3000;d<=c.incomeCapYen;d+=1000){
   const trial=trialFromCalculation(c,c.salaryAdjustment.salaryIncomeAfterAdjustmentYen,d);
   if(trial.status!=="ESTIMATE")return trial;
   if(!trial.calculation.within2000){firstFailure=d;break;}
   ceiling=d;
  }
  return {status:"ESTIMATE",donationLimitYen:ceiling,release:"HOLD",calculation:{
   ...medicalFilingMetadata(c),salaryAdjustment:c.salaryAdjustment,firstFailureYen:firstFailure,stopOnFirstFailure:true}};
 }
 // Reviewed mortgage interaction engine. No OCR inference or UI approval.
 // The amount is the legally applicable full annual credit, not the
 // income-tax amount actually deducted on the slip. Forecasts hold that amount fixed.
 // https://www.city.yokohama.lg.jp/kurashi/koseki-zei-hoken/zeikin/y-shizei/kojin-shiminzei-kenminzei/kojin-shiminzei-shosai/zeigakukoujoR8.html
 // https://www.city.machida.tokyo.jp/kurashi/tax/shimin/keisan/shimin08.html
 // https://www.city.itoshima.lg.jp/s009/010/010/050/190/20261106.html
 // Source-year tax credit reconciliation is deliberately independent of
 // forecast tax credits. A blank possible amount means the applied amount
 // is the entire credit ONLY after the operator reviews the original slip.
 function reconcileMortgageSource(input){
  const keys=["year","salaryIncome","deductions","moveInYear","capClass","appliedYen","possibleYen","reviewed"];
  if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).length!==keys.length||
     !keys.every(k=>Object.prototype.hasOwnProperty.call(input,k))||
     ![2025,2026].includes(input.year)||!valid(input.salaryIncome,18050000)||
     !valid(input.deductions,100000000)||!Number.isSafeInteger(input.moveInYear)||
     input.moveInYear<2014||input.moveInYear>=input.year||input.year-input.moveInYear>=13||
     !["standard5","transitional7"].includes(input.capClass)||
     (input.capClass==="transitional7"&&input.moveInYear>2022)||
     !valid(input.appliedYen,600000)||
     (input.possibleYen!==null&&(!valid(input.possibleYen,600000)||input.possibleYen<=input.appliedYen))||
     input.reviewed!==true)return hold("原票の住宅ローン控除額・可能額・入居年・適用区分を確認してください");
  const possible=input.possibleYen===null?input.appliedYen:input.possibleYen;
  const n=national(floor1000(input.salaryIncome-input.deductions));
  // Explicit zero is not equivalent to an empty G29. A zero pre-credit
  // income tax with a housing credit is outside the audited interaction
  // scope (see mortgageContext); never infer a local housing credit.
  if(input.appliedYen===0){
   if(n.incomeTax>0&&possible>0)return hold("原票の住宅ローン控除額0円が算出所得税額・控除可能額と一致しません。原票を確認してください");
   return hold("原票の住宅ローン控除額が0円のケースは個別確認が必要です。自動試算の対象外です");
  }
  if(n.incomeTax<=0||Math.min(n.incomeTax,possible)!==input.appliedYen)
   return hold("原票の住宅ローン控除額が算出所得税額と一致しません");
  return {status:"RECONCILED",release:"HOLD",calculation:{sourceYear:input.year,
   possibleYen:possible,appliedYen:input.appliedYen,preCreditIncomeTaxYen:n.incomeTax,
   moveInYear:input.moveInYear,capClass:input.capClass,possibleFromApplied:input.possibleYen===null}};
 }
 function mortgageContext(request){
  const exact=(x,ks)=>x&&typeof x==="object"&&!Array.isArray(x)&&Object.keys(x).length===ks.length&&ks.every(k=>Object.prototype.hasOwnProperty.call(x,k));
  if(!exact(request,["tax","housing","filing"])||!exact(request.housing,["moveInYear","capClass","possibleYen","eligibilityReviewed"])||
     !["one-stop","return"].includes(request.filing))return hold("住宅ローン控除の条件を確認してください");
  const h=request.housing,high=!!request.tax&&Object.prototype.hasOwnProperty.call(request.tax,"adjustment");
  const ref=high?highCore(request.tax,true):calculateCore(request.tax,true);
  if(ref.status!=="ESTIMATE")return ref;
  const c=ref.calculation,year=c.year,income=high?c.salaryAdjustment.salaryIncomeAfterAdjustmentYen:request.tax.salaryIncome;
  if(!Number.isSafeInteger(h.moveInYear)||h.moveInYear<2009||h.moveInYear>year||
     !["standard5","transitional7"].includes(h.capClass)||
     (h.capClass==="transitional7"&&(h.moveInYear<2014||h.moveInYear>2022))||
     !valid(h.possibleYen,100000000)||h.possibleYen===0||h.eligibilityReviewed!==true||
     (request.filing==="one-stop"&&(h.moveInYear===year||c.medical)))
   return hold("住宅ローン控除の適用年・控除可能額・住民税区分・申告方法を確認してください");
  const rate=h.capClass==="transitional7"?7:5,cap=rate===7?136500:97500;
  function nationalHousing(taxable){
   const n=national(taxable);
   // Zero pre-credit national tax is outside the audited interaction scope.
   // Do not assume the local credit is available merely because unused remains.
   if(n.incomeTax===0)return null;
   const used=Math.min(n.incomeTax,h.possibleYen),after=n.incomeTax-used;
   const basis=taxable+(h.moveInYear<=2025?Math.max(0,c.nationalBasicYen-480000):0);
   const localCap=Math.min(cap,Math.floor(basis*rate/100));
   return {taxableYen:taxable,preCreditIncomeTaxYen:n.incomeTax,
    nationalHousingYen:used,unusedYen:h.possibleYen-used,localCapYen:localCap,
    residentHousingYen:Math.min(h.possibleYen-used,localCap),
    nationalTaxYen:after+Math.floor(after*21/1000)};
  }
  function localTax(p,n,base,oneStop){
   // Housing and donation credits consume the same remaining municipal levy.
   // The special donation cap itself uses the pre-housing adjusted levy.
   const special=Math.min(p.beforeRounding100*1000,base*c.specialDenominator*p.share);
   const regular=base*p.share*10000;
   const extra=oneStop?Math.floor(special*(90000-c.specialDenominator)/c.specialDenominator):0;
   const donationCredit=Math.floor((regular+special+extra+499999)/500000);
   const housing100=n.residentHousingYen*p.share*20;
   const assessed=Math.max(0,Math.floor((p.beforeRounding100-housing100-donationCredit*100)/10000))*100;
   return {assessedYen:assessed,donationCreditYen:donationCredit};
  }
  const before=nationalHousing(c.nationalTaxableYen);
  if(!before)return hold("住宅ローン控除前の所得税額が0円の条件は個別確認が必要です");
  const parts=[c.city,c.prefecture],localBefore=parts.map(p=>localTax(p,before,0,false).assessedYen);
  function trial(donation){
   if(!valid(donation,c.incomeCapYen)||donation<2000)return hold("試算寄附額が範囲外です");
   const base=donation-2000,oneStop=request.filing==="one-stop";
   const after=oneStop?before:nationalHousing(floor1000(income-c.nationalDeductionsYen-base));
   if(!after)return hold("寄附後の住宅ローン控除前所得税額が0円の条件は個別確認が必要です");
   const localAfter=parts.map(p=>localTax(p,after,base,oneStop));
   const nationalSaving=before.nationalTaxYen-after.nationalTaxYen;
   const residentSaving=localBefore.reduce((sum,v,i)=>sum+v-localAfter[i].assessedYen,0);
   const selfPay=donation-nationalSaving-residentSaving;
   return {status:"COMPONENTS_ONLY",release:"HOLD",donationLimitYen:null,calculation:{
    year,residentYear:year+1,filing:request.filing,donationYen:donation,
    housingPossibleYen:h.possibleYen,before,after,localBefore,localAfter,
    nationalSavingYen:nationalSaving,residentSavingYen:residentSaving,selfPayYen:selfPay,
    within2000:selfPay<=2000,excessOver2000Yen:Math.max(0,selfPay-2000),
    forecastNote:"前年の住宅ローン控除可能額を使用する場合、住宅ローン残高の変動は考慮していません。"}};
  }
  return {status:"COMPONENTS_ONLY",trial,max:Math.min(c.incomeCapYen,ref.donationLimitYen)};
 }
 function mortgageTrial(request,donation){
  const ctx=mortgageContext(request);
  return ctx.status==="COMPONENTS_ONLY"?ctx.trial(donation):ctx;
 }
 function mortgagePrefix(request){
  const ctx=mortgageContext(request);
  if(ctx.status!=="COMPONENTS_ONLY")return ctx;
  let last=2000,firstFailure=null;
  for(let d=3000;d<=ctx.max;d+=1000){
   const t=ctx.trial(d);
   if(t.status!=="COMPONENTS_ONLY")return t;
   if(!t.calculation.within2000){firstFailure=d;break;}
   last=d;
  }
  // Deliberately not an ESTIMATE: no UI/source reconciliation until audited.
  return {status:"COMPONENTS_ONLY",release:"HOLD",donationLimitYen:null,
   calculation:{conservativePrefixYen:last,firstFailureYen:firstFailure,stopOnFirstFailure:true,atPrefix:ctx.trial(last).calculation}};
 }
 return Object.freeze({calculate,calculateNoTax,classifyBasicNoTax,medicalFilingCalculation,filingTrial,filingPrefix,highSalaryCalculate,highSalaryMedicalFilingCalculation,highSalaryFilingTrial,highSalaryFilingPrefix,mortgageTrial,mortgagePrefix,reconcileMortgageSource});
}));
