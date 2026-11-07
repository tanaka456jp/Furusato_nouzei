"use strict";
/** Compare raw synthetic Excel COM observations, never approve parity. */
const fs=require("node:fs"),cases=require("./cases.cjs");
const engine=require("../Engine.gs");
const EXPECTED="f534882f56461ea23a75474f24e68ad364d557091609c994341c179e9a655f25";
function reject(msg){throw new Error("OBSERVED_41_HOLD: "+msg);}
function compare(data,model=engine){
 if(!data||data.schema!=="furusato-excel-oracle/v1"||
  data.source!=="OBSERVED_GLOBAL_PENDING"||
  data.releaseTag!=="v4.18.2"||data.releaseZipSha256!==EXPECTED||
  data.calculationProvider!=="EXCEL_COM"||data.macrosDisabled!==true||
  !/^[0-9a-f]{64}$/.test(data.excelWorkbookSha256||""))
  reject("untrusted or incomplete Excel evidence");
 if(!Array.isArray(data.results)||data.results.length!==cases.length)reject("case count");
 const expected=new Map(cases.map(c=>[c.id,c])),seen=new Set(),results=[];
 let changedAcrossInputs=false; const salaryValues=new Set();
 for(const row of data.results){
  const input=expected.get(row.id);
  if(!input||seen.has(row.id))reject("unknown or repeated case");
  seen.add(row.id);
  for(const f of ["year","salaryGross","socialInsurance","filing"]){
   if(input[f]!==row[f])reject("case input changed: "+row.id);
  }
  if(![0,2].includes(row.calcState))reject("calculation still running or absent");
  if(row.status!=="HOLD"&&row.status!=="NORMAL")reject("status invalid");
  if(typeof row.statusText!=="string"||row.statusText.length===0)reject("missing statusText");
  if((row.status==="NORMAL")!==(row.statusText==="正常"))reject("status disagreement");
  if(row.status==="NORMAL"){
   for(const f of ["donationLimitYen","salaryIncomeYen","residentIncomeLevyYen"])
    if(!Number.isSafeInteger(row[f])||row[f]<0)reject("invalid Excel "+f);
   salaryValues.add(row.salaryIncomeYen);
  }else if(row.donationLimitYen!==null||
    row.salaryIncomeYen!==null||row.residentIncomeLevyYen!==null)
    reject("HOLD leaked amount");
  const candidate=model.calculate({year:input.year,incomeType:"salary",filing:input.filing,
   salaryGross:input.salaryGross,socialInsurance:input.socialInsurance,
   salaryIncomeReference:"",deductionsReference:"",acknowledgedExclusions:true});
  const gasStatus=candidate.status==="ESTIMATE"?"NORMAL":"HOLD";
  const fields=[];
  if(row.status!==gasStatus)fields.push("status");
  if(row.status==="NORMAL"&&gasStatus==="NORMAL"){
   if(row.donationLimitYen!==candidate.donationLimitYen)fields.push("donationLimitYen");
   if(row.salaryIncomeYen!==candidate.calculation.salaryIncomeYen)fields.push("salaryIncomeYen");
   if(row.residentIncomeLevyYen!==candidate.calculation.residentIncomeLevyYen)
    fields.push("residentIncomeLevyYen");
  }
  results.push({id:row.id,year:row.year,excelStatus:row.status,gasStatus,
   excelLimitYen:row.donationLimitYen,gasLimitYen:candidate.donationLimitYen,
   fields,calcState:row.calcState});
 }
 const anchor=results.find(r=>r.id==="Y2026_G7000000");
 if(!anchor||anchor.excelStatus!=="NORMAL"||anchor.excelLimitYen!==109000)
  reject("2026 reference anchor missing or invalid");
 for(const year of [2025,2026]){
  if(data.results.filter(r=>r.year===year&&r.status==="NORMAL").length<5)
   reject("insufficient NORMAL rows for "+year);
 }
 if(salaryValues.size<4)reject("Excel calculations did not respond across input set");
 const mismatches=results.filter(x=>x.fields.length);
 return {schema:"furusato-observed-comparison/v1",verdict:"HOLD",
  fullCalculationConfirmed:false,releaseApproved:false,realCustomerData:false,
  source:"EXCEL_COM_GLOBAL_PENDING",checked:cases.length,
  matched:cases.length-mismatches.length,mismatchCount:mismatches.length,
  globalPendingCount:results.filter(r=>r.calcState===2).length,
  mismatches};
}
if(require.main===module){
 try{
  if(process.argv.length!==3)reject("usage: compare-observed.cjs <observations.json>");
  const report=compare(JSON.parse(fs.readFileSync(process.argv[2],"utf8")));
  process.stdout.write(JSON.stringify(report,null,2)+"\n");
 }catch(e){console.error(e.message);process.exitCode=2;}
}
module.exports={compare};
