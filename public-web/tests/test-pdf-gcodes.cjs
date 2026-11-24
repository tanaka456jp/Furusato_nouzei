"use strict";
/** Pure synthetic glyph tests: no real tax document, no names, no upload. */
const assert=require("node:assert/strict");
const g=require("../src/pdf-gcodes.js");
const parts=[];
function add(t,x,y,width=11){
 parts.push({str:t,transform:[1,0,0,1,x,y],width});
}
function code(s,x,y){for(let i=0;i<3;i++)add(s[i],x+i*2.75,y,5.5);}
function amount(s,x,y){for(let i=0;i<s.length;i++)add(s[i],x+i*5.5,y,11);}
code("L01",77,786);add("7",141,784,12);
code("G04",104,619);amount("7,000,000",178,617);
code("G05",231,628);amount("5,200,000",289,626);
code("G06",341,628);amount("1,670,000",398,626);
code("G26",138,529);amount("1,000,000",215,529);
const good=g.review(parts);
assert.equal(good.status,"REQUIRES_SOURCE_REVIEW");
assert.equal(good.eligibleForManualTransfer,true);
assert.equal(good.autoApproved,false);
assert.equal(good.year,2025);
assert.deepEqual(good.candidates,{
 salaryGross:7000000,salaryIncomeReference:5200000,
 deductionsReference:1670000,socialInsurance:1000000
});
assert.deepEqual(good.sourceIndicators,{});
// Synthetic positive G-code amounts must be retained as HOLD evidence.
const extra=[];
function extraCode(s,x,y){for(let i=0;i<3;i++)
 extra.push({str:s[i],transform:[1,0,0,1,x+i*2.75,y],width:5.5});}
function extraAmount(s,x,y){for(let i=0;i<s.length;i++)
 extra.push({str:s[i],transform:[1,0,0,1,x+i*5.5,y],width:11});}
for(const [code,x,y,raw] of [
 ["G27",320,400,"50,000"],["G28",470,400,"10,000"],
 ["G29",620,400,"200,000"],["G47",500,280,"5,000"],
 ["G74",100,400,"60,000"]]){
 extraCode(code,x,y);extraAmount(raw,x+65,y);
}
const withCredits=g.review([...parts,...extra]);
assert.equal(withCredits.eligibleForManualTransfer,true);
assert.deepEqual(withCredits.sourceIndicators,{
 hasLifeInsurance:true,hasEarthquakeInsurance:true,
 hasMortgage:true,hasIncomeAdjustment:true,hasDependents:true
});
// A single compact PDF.js number is also positive evidence, even when
// the four required amounts are independently represented per glyph.
const compactPositive=g.review([...parts,
 {str:"G29",transform:[1,0,0,1,620,370],width:17},
 {str:"350,000",transform:[1,0,0,1,690,370],width:45}
]);
assert.equal(compactPositive.sourceIndicators.hasMortgage,true);
const duplicateOptional=g.review([...parts,...extra,
 {str:"G29",transform:[1,0,0,1,620,400],width:10}]);
assert.equal(duplicateOptional.sourceIndicators.hasNonstandardConditions,true);
const badYear=g.review(parts.filter(p=>p!==parts.find(p=>p.str==="7"&&p.transform[4]===141)));
assert.equal(badYear.eligibleForManualTransfer,false);
assert.equal(badYear.year,null);
const wrong=g.review([...parts,{str:"G04",transform:[1,0,0,1,104,619],width:17}]);
assert.equal(wrong.eligibleForManualTransfer,false);
assert.ok(wrong.reasons.includes("CODE_G04_AMBIGUOUS"));
const withoutSocial=g.review(parts.filter(p=>!(p.transform[5]===529&&
 p.transform[4]>200&&p.transform[4]<300)));
assert.equal(withoutSocial.eligibleForManualTransfer,false);
assert.equal(withoutSocial.candidates.salaryGross,7000000);
assert.equal(withoutSocial.candidates.socialInsurance,undefined);
assert.ok(withoutSocial.reasons.includes("CODE_G26_AMOUNT_UNVERIFIED"));
// Optional numeric fields do not alter eligibility or certify absence.
const opt=g.review([...parts,...extra,{str:"G46",transform:[1,0,0,1,100,250],width:17},{str:"580,000",transform:[1,0,0,1,165,250],width:40}]);
assert.deepEqual(opt.optionalCandidates,{mortgageSourceApplied:200000,sourceBasicYen:580000,sourceAdjustmentYen:5000});
assert.deepEqual(g.verifiedOptional(opt,opt),opt.optionalCandidates);
assert.deepEqual(g.verifiedOptional(opt,{...opt,year:2026}),{});
assert.deepEqual(g.verifiedOptional(opt,{...opt,candidates:{...opt.candidates,socialInsurance:1000001}}),{});
assert.deepEqual(g.verifiedOptional(opt,{...opt,eligibleForManualTransfer:false}),{});
assert.deepEqual(g.verifiedOptional(opt,{...opt,candidates:{}}),{});
assert.equal(duplicateOptional.optionalCandidates.mortgageSourceApplied,undefined);
const zero=g.review([...parts,{str:"G47",transform:[1,0,0,1,100,250],width:17},{str:"0",transform:[1,0,0,1,165,250],width:5}]);
assert.equal(zero.optionalCandidates.sourceAdjustmentYen,0);
assert.equal(zero.sourceIndicators.hasIncomeAdjustment,undefined);
const conflict=g.review([...parts,...extra,{str:"700,000",transform:[1,0,0,1,700,400],width:40}]);
assert.equal(conflict.optionalCandidates.mortgageSourceApplied,undefined);
assert.deepEqual(g.verifiedOptional({...opt,optionalCandidates:{mortgageSourceApplied:600001,sourceBasicYen:"580000",sourceAdjustmentYen:-1}},opt),{});
// Synthetic R7 adjacent slots, never real source amounts.
const r7Slots=[];
for(const [code,x,y,value] of [["G30",77,350,"123456"],["G31",176,350,"23456"],["G32",275,350,"34567"],["G33",374,350,"45678"],["G34",474,350,"56789"],["G36",132,310,"345678"],["G45",474,260,"12345"]]){
 r7Slots.push({str:code,transform:[1,0,0,1,x,y],width:15},{str:value,transform:[1,0,0,1,x+48,y],width:35});
}
const r7=g.review([...parts,...r7Slots]);
const wanted={sourceInsurance_generalNew:123456,sourceInsurance_generalOld:23456,sourceInsurance_medicalNew:34567,sourceInsurance_pensionNew:45678,sourceInsurance_pensionOld:56789,mortgageSourcePossible:345678,sourceInsurance_longTermOld:12345};
assert.deepEqual(r7.optionalCandidates,wanted);
assert.deepEqual(g.verifiedOptional(r7,r7),wanted);
for(const flag of ["hasLifeInsurance","hasMortgage","hasEarthquakeInsurance"])assert.equal(r7.sourceIndicators[flag],true);
assert.equal(r7.optionalCandidates.sourceInsurance_earthquake,undefined);
const newer=g.review([...parts.map(p=>p.str==="7"&&p.transform[4]===141?{...p,str:"8"}:p),...r7Slots]);
assert.equal(newer.year,2026);assert.deepEqual(newer.optionalCandidates,{});
assert.deepEqual(g.verifiedOptional({...r7,year:2026},{...r7,year:2026}),{});
const duplicateR7=g.review([...parts,...r7Slots,{str:"G30",transform:[1,0,0,1,77,350],width:15}]);
assert.equal(duplicateR7.optionalCandidates.sourceInsurance_generalNew,undefined);
// Synthetic date geometry; no personal dates or original PDF bytes.
const dateTokens=(era="令和",y="3",m="2",d="28")=>[
 ["居住開始年月日",265,438,65],["年",287,429.5,6],["月",309,429.5,6],["日",331,429.5,6],
 [era,256,415.5,24],[y,287,415.5,6],[m,309,415.5,6],[d,331,415.5,12]
].map(([str,x,y,width])=>({str,transform:[1,0,0,1,x,y],width}));
const dateResult=g.review([...parts,...dateTokens()]);
assert.equal(dateResult.optionalCandidates.mortgageMoveInYear,2021);
assert.equal(dateResult.sourceIndicators.hasMortgage,true);
assert.equal(g.verifiedOptional(dateResult,dateResult).mortgageMoveInYear,2021);
assert.equal(g.review([...parts,...dateTokens("平成","30","12","31")]).optionalCandidates.mortgageMoveInYear,2018);
for(const a of [dateTokens("令和","3","2","29"),dateTokens("令和","1","4","30"),dateTokens("平成","31","5","1"),dateTokens("令和","9","1","1")]){
 const result=g.review([...parts,...a]);assert.equal(result.optionalCandidates.mortgageMoveInYear,undefined);assert.equal(result.sourceIndicators.hasMortgage,true);
}
const secondDate=g.review([...parts,...dateTokens(),{str:"令和",transform:[1,0,0,1,256,399],width:24}]);
assert.equal(secondDate.sourceIndicators.hasNonstandardConditions,true);
assert.equal(secondDate.optionalCandidates.mortgageMoveInYear,undefined);
assert.equal(g.review([...parts,...dateTokens().filter(p=>p.str!=="月")]).optionalCandidates.mortgageMoveInYear,undefined);
assert.equal(g.verifiedOptional({...dateResult,optionalCandidates:{mortgageMoveInYear:2013}},dateResult).mortgageMoveInYear,undefined);
assert.equal(g.verifiedOptional({...dateResult,sourceIndicators:{hasMortgage:true,hasNonstandardConditions:true}},dateResult).mortgageMoveInYear,undefined);
// R7 narrow count columns: synthetic values, original printed geometry.
const counts=[];
for(const [code,x] of [["G13",187.22],["G16",269.78],["G18",324.7],["G72",379.98],["G20",435.25],["G14",214.5],["G24",545.45]])counts.push({str:code,transform:[1,0,0,1,x,571.68],width:12});
const countToken=(x,str)=>({str,transform:[1,0,0,1,x+16.05,570.71],width:6});
const family=g.review([...parts,...counts,countToken(187.22,"2"),countToken(435.25,"1")]);
assert.deepEqual(family.optionalCandidates,{familySpecificCount:2,familyUnder16Count:1});
assert.equal(family.sourceIndicators.hasDependents,true);
assert.deepEqual(g.verifiedOptional(family,family),family.optionalCandidates);
const missing=g.review([...parts,...counts.filter(c=>c.str!=="G16"),countToken(187.22,"2")]);
assert.equal(missing.optionalCandidates.familySpecificCount,undefined);
const foreign=g.review([...parts,...counts,countToken(545.45,"1")]);
assert.equal(foreign.sourceIndicators.hasNonstandardConditions,true);
const secondary=g.review([...parts,...counts,countToken(214.5,"1")]);
assert.equal(secondary.sourceIndicators.hasNonstandardConditions,true);
assert.equal(g.review([...parts,...counts,countToken(187.22,"99")]).optionalCandidates.familySpecificCount,undefined);
assert.equal(g.review([...parts,...counts,countToken(187.22,"0")]).optionalCandidates.familySpecificCount,undefined);
assert.equal(g.verifiedOptional({...family,year:2026},{...family,year:2026}).familySpecificCount,undefined);
// G43 is read only with matching heading and neighbouring slot.
const spouseSlots=[["G43",270.13,352.95,11],["G44",374.31,368.89,11],["配偶者の合計所得",298.59,384.88,44],["720000",337.72,352.33,36]].map(([str,x,y,width])=>({str,transform:[1,0,0,1,x,y],width}));
const spouseReview=g.review([...parts,...spouseSlots]);
assert.equal(spouseReview.optionalCandidates.sourceSpouseIncome,720000);
assert.equal(spouseReview.sourceIndicators.hasSpouse,true);
assert.equal(g.verifiedOptional(spouseReview,spouseReview).sourceSpouseIncome,720000);
assert.equal(g.review([...parts,...spouseSlots.filter(x=>x.str!=="G44")]).optionalCandidates.sourceSpouseIncome,undefined);
assert.equal(g.review([...parts,...spouseSlots,{...spouseSlots[3],str:"800000"}]).optionalCandidates.sourceSpouseIncome,undefined);
assert.equal(g.verifiedOptional({...spouseReview,year:2026},{...spouseReview,year:2026}).sourceSpouseIncome,undefined);
// Synthetic amounts at representative R7 compact-span coordinates.
const groupedFields=[
 ["L01",77,786,"7",141,784,6],
 ["G04",104.31,619.41,"6,123,000",178,617.5,55],
 ["G05",231.16,627.56,"4,456,000",288.6,626,55],
 ["G06",341.35,627.56,"1,234,000",397.65,626,55],
 ["G26",137.61,529.05,"876,000",223.6,529.25,36]
].flatMap(([code,x,y,value,vx,vy,w])=>[{str:code,transform:[1,0,0,1,x,y],width:12},{str:value,transform:[1,0,0,1,vx,vy],width:w}]);
const groupedResult=g.review(groupedFields);
assert.equal(groupedResult.eligibleForManualTransfer,true);
assert.deepEqual(groupedResult.candidates,{salaryGross:6123000,salaryIncomeReference:4456000,deductionsReference:1234000,socialInsurance:876000});
assert.equal(groupedResult.autoApproved,false);
const noSocial=g.review(groupedFields.slice(0,-1));
assert.equal(noSocial.eligibleForManualTransfer,false);assert.equal(noSocial.candidates.socialInsurance,undefined);
assert.equal(noSocial.candidates.salaryGross,6123000);
for(const extra of [{...groupedFields[3],str:"999,000"},{...groupedFields[3],str:"9",transform:[1,0,0,1,180,617.5],width:6}]){
 const conflict=g.review([...groupedFields,extra]);
 assert.equal(conflict.eligibleForManualTransfer,false);assert.equal(conflict.candidates.salaryGross,undefined);
}
const explicitZero=g.review([...groupedFields.slice(0,-1),{...groupedFields[9],str:"0"}]);
assert.equal(explicitZero.eligibleForManualTransfer,true);assert.equal(explicitZero.candidates.socialInsurance,0);
const overlap=g.review([...groupedFields,{str:"G07",transform:[1,0,0,1,220,619.41],width:12}]);
assert.equal(overlap.eligibleForManualTransfer,false);assert.equal(overlap.candidates.salaryGross,undefined);
console.log("PUBLIC_PDF_GCODES_EVERY_DIGIT_POSITION_SYNTHETIC_PASS");
