"use strict";
// WEB-only research component, not included in dist or called by UI.
// Local Tax Act supplementary Art.3-3(2),(5); Yokohama FY2026 guidance:
// https://www.city.yokohama.lg.jp/kurashi/koseki-zei-hoken/zeikin/y-shizei/kojin-shiminzei-kenminzei/kojin-shiminzei-shosai/zeigakukoujoR8.html
// Inputs are separate post-credit levies BEFORE this relief, one-stop
// application-special credit and final rounding. Do not apply a fixed
// 60/40 or 80/20 split: use the actual residual levies. Exact rational
// results deliberately do not settle legal rounding or final assessment.
const STAGE="after-ordinary-credits-before-relief-and-one-stop";
const KEYS=["year","incomeYen","familyCount","cityAfterCredits100","prefectureAfterCredits100","stage"];
const hold=()=>({status:"HOLD",calculation:null,donationLimitYen:null,release:"HOLD"});
const valid=(n,max)=>Number.isSafeInteger(n)&&n>=0&&n<=max;
const gcd=(a,b)=>{while(b){const t=a%b;a=b;b=t;}return a;};
function fraction(n,d){
 const g=gcd(n,d);return {numerator:String(n/g),denominator:String(d/g)};
}
function calculate(input){
 if(!input||typeof input!=="object"||Array.isArray(input)||
    Object.keys(input).length!==KEYS.length||!KEYS.every(k=>Object.prototype.hasOwnProperty.call(input,k))||
    ![2025,2026].includes(input.year)||input.stage!==STAGE||
    !valid(input.incomeYen,18050000)||!valid(input.familyCount,31)||
    !valid(input.cityAfterCredits100,180500000)||!valid(input.prefectureAfterCredits100,180500000))return hold();
 const threshold=350000*(input.familyCount+1)+100000+(input.familyCount?320000:0);
 if(input.incomeYen<=threshold)return hold(); // distinct statutory non-taxable branch
 const gap=BigInt(input.incomeYen-threshold)*100n;
 const city=BigInt(input.cityAfterCredits100),pref=BigInt(input.prefectureAfterCredits100),total=city+pref;
 const remaining=total<gap?total:gap;
 const relief=total-remaining;
 const part=n=>total===0n?{reliefYen:fraction(0n,1n),remainingYen:fraction(0n,1n)}:{
  reliefYen:fraction(n*relief,total*100n),remainingYen:fraction(n*remaining,total*100n)};
 return {status:"COMPONENTS_ONLY",donationLimitYen:null,release:"HOLD",calculation:{
  year:input.year,residentYear:input.year+1,thresholdYen:threshold,stage:STAGE,
  excessIncomeYen:input.incomeYen-threshold,totalReliefYen:fraction(relief,100n),
  totalRemainingYen:fraction(remaining,100n),city:part(city),prefecture:part(pref),
  finalRoundingCertified:false,oneStopCreditApplied:false}};
}
// Research only: compare the two separately calculated post-credit states.
// Yokohama: application-special credit comes AFTER relief.
// Itabashi and Hayashima: final 100-yen truncation follows tax credits.
// Exact rational final floor is a candidate model, not certification of
// intermediate statutory rounding or upstream credit amounts.
function compare(input){
 const names=["year","incomeYen","familyCount","filing","before","after"];
 const pairKeys=["cityAfterCredits100","prefectureAfterCredits100","cityOneStop100","prefectureOneStop100"];
 if(!input||typeof input!=="object"||Array.isArray(input)||
    Object.keys(input).length!==names.length||!names.every(k=>Object.prototype.hasOwnProperty.call(input,k))||
    !["return","one-stop"].includes(input.filing))return hold();
 const read=(x,baseline)=>{
  if(!x||typeof x!=="object"||Array.isArray(x)||Object.keys(x).length!==pairKeys.length||
     !pairKeys.every(k=>Object.prototype.hasOwnProperty.call(x,k)&&valid(x[k],180500000))||
     ((baseline||input.filing==="return")&&(x.cityOneStop100!==0||x.prefectureOneStop100!==0)))return null;
  const result=calculate({year:input.year,incomeYen:input.incomeYen,familyCount:input.familyCount,
   cityAfterCredits100:x.cityAfterCredits100,prefectureAfterCredits100:x.prefectureAfterCredits100,stage:STAGE});
  if(result.status!=="COMPONENTS_ONLY")return null;
  const c=result.calculation;
  function bill(p,credit){
   const d=BigInt(p.remainingYen.denominator),n=BigInt(p.remainingYen.numerator)*100n-BigInt(credit)*d;
   return n<=0n?0:Number(n/(d*10000n)*100n);
  }
  const city=bill(c.city,x.cityOneStop100),prefecture=bill(c.prefecture,x.prefectureOneStop100);
  return {reliefYen:c.totalReliefYen,cityYen:city,prefectureYen:prefecture,totalYen:city+prefecture};
 };
 const before=read(input.before,true),after=read(input.after,false);
 if(!before||!after)return hold();
 return {status:"COMPONENTS_ONLY",release:"HOLD",donationLimitYen:null,calculation:{
  before,after,residentSavingYen:before.totalYen-after.totalYen,
  finalRoundingModel:"exact-rational-then-floor-each-100-research",
  intermediateRoundingCertified:false,upstreamCreditsCertified:false}};
}
// Research bridge: accept reviewed adjusted levy and computed housing
// amounts, derive ordinary and application-special credits separately,
// then compare both relief-adjusted states. No source-slip inputs or UI.
// Upstream housing calculation and its rounding remain separate gates.
function compareCredits(input){
 const keys=["year","incomeYen","familyCount","municipality","specialRatePercent","donationYen","housingBeforeYen","housingAfterYen","cityAdjusted100","prefectureAdjusted100","filing"];
 if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).length!==keys.length||
   !keys.every(k=>Object.prototype.hasOwnProperty.call(input,k))||
   ![2025,2026].includes(input.year)||!valid(input.incomeYen,18050000)||!valid(input.familyCount,31)||
   !["standard","designated"].includes(input.municipality)||![5,10,20,23,33].includes(input.specialRatePercent)||
   !valid(input.donationYen,Math.floor(input.incomeYen*3/10))||input.donationYen<2000||
   !valid(input.housingBeforeYen,136500)||!valid(input.housingAfterYen,136500)||
   !valid(input.cityAdjusted100,180500000)||!valid(input.prefectureAdjusted100,180500000)||
   !["return","one-stop"].includes(input.filing)||
   (input.filing==="one-stop"&&input.housingBeforeYen!==input.housingAfterYen))return hold();
 const ratio=BigInt(90000-input.specialRatePercent*1021),unit=500000n;
 const shares=input.municipality==="standard"?[3n,2n]:[4n,1n];
 const levies=[BigInt(input.cityAdjusted100),BigInt(input.prefectureAdjusted100)];
 const base=BigInt(input.donationYen-2000);
 const ceil=(n,d)=>(n+d-1n)/d,min=(a,b)=>a<b?a:b,max0=n=>n<0n?0n:n;
 const parts=shares.map((s,i)=>{
  const special=min(base*s*ratio,levies[i]*1000n);
  const ordinary=ceil(base*s*10000n+special,unit);
  const extra=input.filing==="one-stop"?ceil(special*(90000n-ratio),unit*ratio):0n;
  return {ordinaryDonationCreditYen:Number(ordinary),applicationSpecialCreditYen:Number(extra),
   before100:Number(max0(levies[i]-BigInt(input.housingBeforeYen)*s*20n)),
   after100:Number(max0(levies[i]-BigInt(input.housingAfterYen)*s*20n-ordinary*100n))};
 });
 const state=(after)=>({cityAfterCredits100:after?parts[0].after100:parts[0].before100,
  prefectureAfterCredits100:after?parts[1].after100:parts[1].before100,
  cityOneStop100:after?parts[0].applicationSpecialCreditYen*100:0,
  prefectureOneStop100:after?parts[1].applicationSpecialCreditYen*100:0});
 const out=compare({year:input.year,incomeYen:input.incomeYen,familyCount:input.familyCount,
  filing:input.filing,before:state(false),after:state(true)});
 if(out.status!=="COMPONENTS_ONLY")return out;
 return {...out,calculation:{...out.calculation,parts,upstreamHousingCertified:false}};
}
module.exports=Object.freeze({calculate,compare,compareCredits});
