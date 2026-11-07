"use strict";
/** Only real Excel COM results can validate parity; MOCK never passes. */
const fs=require("node:fs"),path=require("node:path"),cases=require("./cases.cjs");
const OFFICIAL_ZIP_SHA="f534882f56461ea23a75474f24e68ad364d557091609c994341c179e9a655f25";
function sameInt(v){return Number.isSafeInteger(v)&&v>=0&&v<=1000000000000;}
function fail(m){throw new Error("PARITY_ORACLE_INVALID: "+m);}
function validate(doc,{allowMock=false}={}){
 if(!doc||doc.schema!=="furusato-excel-oracle/v1"||!Array.isArray(doc.results))fail("schema/results");
 if(doc.source!=="OFFICIAL_RELEASE"&&!(allowMock&&doc.source==="MOCK"))fail("source must be independently calculated Excel");
 if(doc.source==="OFFICIAL_RELEASE"){
  if(doc.releaseTag!=="v4.18.2"||doc.releaseZipSha256!==OFFICIAL_ZIP_SHA)fail("official distribution SHA mismatch");
  if(!/^[0-9a-f]{64}$/.test(doc.excelWorkbookSha256||""))fail("missing Excel workbook SHA");
  if(doc.calculationProvider!=="EXCEL_COM"||doc.macrosDisabled!==true)fail("not a macro-disabled Excel calculation");
 }
 const required=new Map(cases.map(x=>[x.id,x]));
 if(doc.results.length!==required.size)fail("case count expected "+required.size+" received "+doc.results.length);
 const seen=new Set();
 doc.results.forEach(row=>{
  if(!row||typeof row!=="object"||Array.isArray(row))fail("invalid row");
  const original=required.get(row.id);
  if(!original||seen.has(row.id))fail("unexpected or duplicate case");
  seen.add(row.id);
  for(const k of ["year","salaryGross","socialInsurance","filing"])
   if(row[k]!==original[k])fail("case input mismatch "+row.id+" "+k);
  if(row.status!=="NORMAL"&&row.status!=="HOLD")fail("invalid Excel status");
  if(row.status==="NORMAL"){
   if(!sameInt(row.donationLimitYen))fail("invalid Excel donation limit");
   if(!sameInt(row.salaryIncomeYen))fail("missing/invalid Excel salary income");
   if(!sameInt(row.residentIncomeLevyYen))fail("missing/invalid Excel resident levy");
  }else if(row.donationLimitYen!==null||row.salaryIncomeYen!==null||row.residentIncomeLevyYen!==null)fail("HOLD must not contain financial outputs");
 });
 return true;
}
function compare(doc,engine,{allowMock=false}={}){
 validate(doc,{allowMock});
 const excel=new Map(doc.results.map(r=>[r.id,r]));
 const mismatches=[];let matched=0;
 for(const input of cases){
  const row=excel.get(input.id);
  const result=engine.calculate({year:input.year,incomeType:"salary",filing:input.filing,
   salaryGross:input.salaryGross,socialInsurance:input.socialInsurance,
   salaryIncomeReference:"",deductionsReference:"",acknowledgedExclusions:true});
  const gasStatus=result.status==="ESTIMATE"?"NORMAL":"HOLD",fields=[];
  if(gasStatus!==row.status)fields.push("status");
  if(gasStatus==="NORMAL"&&row.status==="NORMAL"){
   if(result.donationLimitYen!==row.donationLimitYen)fields.push("donationLimitYen");
   if(row.salaryIncomeYen!=null&&result.calculation.salaryIncomeYen!==row.salaryIncomeYen)fields.push("salaryIncomeYen");
   if(row.residentIncomeLevyYen!=null&&result.calculation.residentIncomeLevyYen!==row.residentIncomeLevyYen)fields.push("residentIncomeLevyYen");
  }
  if(fields.length)mismatches.push({id:input.id,fields,excelStatus:row.status,gasStatus,
    excelLimitYen:row.donationLimitYen,gasLimitYen:result.donationLimitYen});
  else matched++;
 }
 return {schema:"furusato-parity-report/v1",release:"HOLD",
  verification:doc.source==="OFFICIAL_RELEASE"?"EXCEL_COM_V4_18_2":"MOCK_CONTRACT_ONLY",
  checked:cases.length,matched,mismatchCount:mismatches.length,mismatches,
  verdict:doc.source==="OFFICIAL_RELEASE"&&mismatches.length===0?"COVERED_CASES_MATCH":"HOLD",
  fullTaxAcceptance:false,realCustomerData:false};
}
function main(args){
 if(args.length!==2||args[0]!=="--oracle")fail("--oracle <path> required");
 const doc=JSON.parse(fs.readFileSync(path.resolve(args[1]),"utf8").replace(/^\uFEFF/,""));
 const result=compare(doc,require("../Engine.gs"));
 process.stdout.write(JSON.stringify(result,null,2)+"\n");
 if(result.verdict!=="COVERED_CASES_MATCH")process.exitCode=2;
}
if(require.main===module){try{main(process.argv.slice(2));}catch(e){console.error("HOLD: "+e.message);process.exitCode=2;}}
module.exports={validate,compare,OFFICIAL_ZIP_SHA};
