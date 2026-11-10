"use strict";
/*
 * Offline aggregate-only quality scoring. Run with private truth records
 * ONLY on the owner's machine. Never upload real source documents, names,
 * truth values or OCR outputs to GitHub/CI/Artifacts.
 */
const FIELDS=Object.freeze([
 "salaryGross","salaryIncomeReference","deductionsReference","socialInsurance"
]);
const FORMATS=Object.freeze(["digital-pdf","scan-pdf","photo"]);
const DEVICES=Object.freeze(["windows-edge","iphone-safari","other"]);
const CASE_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RECORDS=100000;
function wilsonLower(success,total){
 if(total===0)return null;
 const z=1.959963984540054,p=success/total,v=z*z;
 return Math.max(0,(p+v/(2*total)-z*Math.sqrt(
  (p*(1-p)+v/(4*total))/total))/(1+v/total));
}
function category(){
 return {slips:0,fieldCount:0,fieldCorrect:0,yearCorrect:0,
  wholeSlipCorrect:0,unsafeTransfer:0,held:0,auditedReal:0};
}
function summarize(records){
 if(!Array.isArray(records)||records.length===0||
    records.length>MAX_RECORDS)throw Error("BENCHMARK_RECORD_COUNT_INVALID");
 const overall=category(),groups=Object.fromEntries(
  FORMATS.map(f=>[f,category()])),
  devices=Object.fromEntries(DEVICES.map(d=>[d,category()])),
  seenCases=new Set(),seenFingerprints=new Set();
 for(const item of records){
  if(!item||!FORMATS.includes(item.format)||!item.truth||
     typeof item.truth!=="object"||Array.isArray(item.truth)||
     !item.result||typeof item.result!=="object"||
     ![2025,2026].includes(item.truth.year))
    throw Error("BENCHMARK_SCHEMA_INVALID");
  for(const key of FIELDS){
   const value=item.truth[key];
   if(!Number.isSafeInteger(value)||value<0||value>1000000000000)
    throw Error("BENCHMARK_TRUTH_INVALID");
  }
  const result=item.result;
  // Missing or malformed OCR output must never be counted as a legitimate
  // deliberate HOLD: otherwise a broken integration can inflate safety.
  if(typeof result.eligibleForManualTransfer!=="boolean"||
     (result.eligibleForManualTransfer&&
       (![2025,2026].includes(result.year)||
        !result.candidates||typeof result.candidates!=="object"||
        FIELDS.some(k=>!Number.isSafeInteger(result.candidates[k])))))
    throw Error("BENCHMARK_RESULT_INVALID");
  const audit=item.audit;
  let auditedReal=false;
  if(audit!==undefined){
    if(!audit||typeof audit!=="object"||Array.isArray(audit)||
      !CASE_ID.test(audit.caseId||"")||
      !/^[0-9a-f]{64}$/i.test(audit.sourceFingerprint||"")||
      !DEVICES.includes(audit.device)||
      !["real","synthetic"].includes(audit.sourceKind)||
      typeof audit.independentTruthVerified!=="boolean")
      throw Error("BENCHMARK_AUDIT_INVALID");
    // Random local IDs only: never derive them from names, paths or hashes.
    if(seenCases.has(audit.caseId))throw Error("BENCHMARK_DUPLICATE_CASE");
    seenCases.add(audit.caseId);
    // A keyed HMAC digest of the original local file detects accidentally
    // counting repeated reads under different random case IDs.
    if(seenFingerprints.has(audit.sourceFingerprint))
      throw Error("BENCHMARK_DUPLICATE_SOURCE");
    seenFingerprints.add(audit.sourceFingerprint);
    if(audit.independentTruthVerified){
      const second=audit.secondEntry;
      if(!second||typeof second!=="object"||
        second.year!==item.truth.year||
        FIELDS.some(k=>second[k]!==item.truth[k]))
        throw Error("BENCHMARK_TRUTH_DISAGREEMENT");
    }
    auditedReal=audit.sourceKind==="real"&&
      audit.independentTruthVerified===true;
  }
  const transfer=result.eligibleForManualTransfer===true;
  const yearMatch=transfer&&result.year===item.truth.year;
  let exact=0;
  for(const key of FIELDS)if(transfer&&
    Number.isSafeInteger(result.candidates?.[key])&&
    result.candidates[key]===item.truth[key])exact++;
  const whole=yearMatch&&exact===FIELDS.length;
  for(const c of [overall,groups[item.format],
    ...(audit?[devices[audit.device]]:[])]){
   c.slips++;
   if(auditedReal)c.auditedReal++;
   c.fieldCount+=FIELDS.length;
   c.fieldCorrect+=exact;
   if(yearMatch)c.yearCorrect++;
   if(whole)c.wholeSlipCorrect++;
   if(transfer&&!whole)c.unsafeTransfer++;
   if(!transfer)c.held++;
  }
 }
 const prepare=c=>({
  slipCount:c.slips,
  fieldCount:c.fieldCount,
  fieldCorrect:c.fieldCorrect,
  fieldExactRate:c.fieldCount?c.fieldCorrect/c.fieldCount:null,
  fieldWilson95Lower:wilsonLower(c.fieldCorrect,c.fieldCount),
  yearCorrect:c.yearCorrect,
  fullSlipCorrect:c.wholeSlipCorrect,
  fullSlipExactRate:c.slips?c.wholeSlipCorrect/c.slips:null,
  fullSlipWilson95Lower:wilsonLower(c.wholeSlipCorrect,c.slips),
  unsafeTransferCount:c.unsafeTransfer,
  holdCount:c.held,
  holdRate:c.slips?c.held/c.slips:null,
  independentlyCheckedRealCount:c.auditedReal,
  targetRate:0.995,
  // These are descriptive numbers, not proof of independent truth
  // provenance, device coverage, or achieved commercial accuracy.
  statisticalTargetMet:c.slips>0&&c.auditedReal===c.slips&&
   c.unsafeTransfer===0&&
   wilsonLower(c.fieldCorrect,c.fieldCount)>=.995&&
   wilsonLower(c.wholeSlipCorrect,c.slips)>=.995
 });
 const byFormat=Object.fromEntries(FORMATS.map(f=>[f,prepare(groups[f])]));
 const byDevice=Object.fromEntries(DEVICES.map(d=>[d,prepare(devices[d])]));
 const overallResult=prepare(overall);
 // Accuracy inferred from a single PDF type or only desktop tests is not
 // a scientifically valid 99.5%-across-formats/devices claim.
 overallResult.statisticalTargetMet=
   overallResult.statisticalTargetMet&&
   FORMATS.every(f=>byFormat[f].statisticalTargetMet)&&
   ["windows-edge","iphone-safari"].every(d=>byDevice[d].statisticalTargetMet);
 return {
  schema:"furusato-private-ocr-aggregate/v2",
  overall:overallResult,
  byFormat,
  byDevice,
  sourceTextPersisted:false,sourceValuesIncluded:false,
  accuracyCertified:false,
  // Self-declared independent truth entry and device metadata remain
  // subject to external audit; numerical thresholds never authorize release.
  release:"HOLD_INDEPENDENT_TRUTH_AND_DEVICE_AUDIT_REQUIRED"
 };
}
module.exports={summarize,wilsonLower,FIELDS,FORMATS};
if(require.main===module){
 let body="",over=false;
 process.stdin.setEncoding("utf8");
 process.stdin.on("data",chunk=>{
  body+=chunk;
  if(body.length>6*1024*1024){over=true;body="";process.stdin.destroy();}
 });
 process.stdin.on("end",()=>{
  try{
   if(over)throw Error("TOO_LARGE");
   const json=JSON.parse(body);
   console.log(JSON.stringify(summarize(json.records)));
  }catch(_){
   // Never log the input or individual sensitive values.
   console.error("PRIVATE_BENCHMARK_INPUT_INVALID");
   process.exitCode=2;
  }
 });
 process.stdin.on("error",()=>{
  console.error("PRIVATE_BENCHMARK_INPUT_INVALID");
  process.exitCode=2;
 });
}