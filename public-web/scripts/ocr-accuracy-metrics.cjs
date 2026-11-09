"use strict";
/**
 * Aggregate-only recognition accuracy evaluator.
 * No source images are read. Never print field values, paths, filenames or IDs.
 * A local truth dataset must NEVER be checked into GitHub.
 */
const fs=require("node:fs"),path=require("node:path");
const FIELDS=["salaryGross","salaryIncomeReference",
 "deductionsReference","socialInsurance"];
const KINDS=["digital_pdf","mfp_scan","mobile_photo","other"];
function wilsonLower(k,n){
 if(!Number.isSafeInteger(k)||!Number.isSafeInteger(n)||n<=0||k<0||k>n)return 0;
 const z=1.959963984540054,p=k/n,z2=z*z;
 return Math.max(0,(p+z2/(2*n)-z*Math.sqrt((p*(1-p)+z2/(4*n))/n))/
   (1+z2/n));
}
function empty(){
 return {documents:0,fields:0,exactFields:0,exactDocuments:0,
  eligible:0,held:0,incorrectEligible:0,wrongFieldCandidates:0};
}
function summarize(rows){
 if(!Array.isArray(rows)||rows.length===0||rows.length>100000)
  throw Error("INVALID_PRIVATE_BENCHMARK_INPUT");
 const total=empty(),categories={};
 for(const kind of KINDS)categories[kind]=empty();
 for(const row of rows){
  if(!row||!KINDS.includes(row.kind)||!row.truth||!row.review||
     ![2025,2026].includes(row.truth.year))
    throw Error("UNVERIFIED_BENCHMARK_RECORD");
  const t=row.truth,r=row.review;
  if(FIELDS.some(field=>!Number.isSafeInteger(t[field])||
        t[field]<0||t[field]>1000000000000))
    throw Error("UNVERIFIED_TRUTH_VALUES");
  if(typeof r.eligibleForManualTransfer!=="boolean"||
      !r.candidates||typeof r.candidates!=="object")
    throw Error("UNVERIFIED_OCR_REVIEW_RESULT");
  const eligible=r.eligibleForManualTransfer===true;
  const correctYear=r.year===t.year;
  const fullyCorrect=correctYear&&FIELDS.every(f=>r.candidates[f]===t[f]);
  for(const stat of [total,categories[row.kind]]){
   stat.documents++;
   stat.fields+=FIELDS.length;
   if(eligible)stat.eligible++;else stat.held++;
   if(eligible&&!fullyCorrect)stat.incorrectEligible++;
   if(eligible&&fullyCorrect)stat.exactDocuments++;
   for(const field of FIELDS){
    if(eligible&&r.candidates[field]===t[field])stat.exactFields++;
    if(Object.hasOwn(r.candidates,field)&&
        r.candidates[field]!==t[field])stat.wrongFieldCandidates++;
   }
  }
 }
 function out(stat){
  const documents=stat.documents,fields=stat.fields;
  return {
   documents,fields,
   exactFields:stat.exactFields,
   exactFieldRate:fields?Math.round(1000000*stat.exactFields/fields)/1000000:null,
   exactFieldLower95:fields?Math.round(1000000*wilsonLower(stat.exactFields,fields))/1000000:null,
   exactDocuments:stat.exactDocuments,
   exactDocumentRate:documents?Math.round(1000000*stat.exactDocuments/documents)/1000000:null,
   exactDocumentLower95:documents?Math.round(1000000*wilsonLower(stat.exactDocuments,documents))/1000000:null,
   eligible:stat.eligible,held:stat.held,incorrectEligible:stat.incorrectEligible,
   wrongFieldCandidates:stat.wrongFieldCandidates
  };
 }
 const segments={};
 for(const kind of KINDS)if(categories[kind].documents)segments[kind]=out(categories[kind]);
 return {
  schema:"furusato-local-ocr-accuracy-aggregate/v1",
  status:"MEASURED_NOT_CERTIFIED",release:"HOLD",syntheticOrPrivate:"CALLER_DECLARED",
  overall:out(total),byKind:segments,
  warnings:["AGGREGATES_NOT_PROOF_OF_AI_OCR_EQUIVALENCE",
    "INDEPENDENT_SOURCE_TRUTH_AND_DEVICE_VALIDATION_REQUIRED",
    "NO_UNREVIEWED_AUTO_ACCEPTANCE"]
 };
}
function cli(){
 const root=path.resolve(__dirname,"..",".private","ocr-benchmark");
 const arg=process.argv[2];
 if(typeof arg!=="string"||!arg.endsWith(".json")){
  process.stderr.write("Use one PRIVATE .json truth fixture stored under public-web/.private/ocr-benchmark.\n");
  process.exitCode=2;return;
 }
 const file=path.resolve(arg);
 if(!file.startsWith(root+path.sep)){
  process.stderr.write("Benchmark source must stay inside private local directory.\n");
  process.exitCode=2;return;
 }
 try{
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024)
    throw Error("UNSAFE_SOURCE");
  const source=JSON.parse(fs.readFileSync(file,"utf8"));
  const result=summarize(source);
  process.stdout.write(JSON.stringify(result,null,2)+"\n");
 }catch(_){
  // Never print source path or any user-derived content on failure.
  process.stderr.write("Private benchmark validation failed.\n");
  process.exitCode=1;
 }
}
if(require.main===module)cli();
module.exports={summarize,wilsonLower};
