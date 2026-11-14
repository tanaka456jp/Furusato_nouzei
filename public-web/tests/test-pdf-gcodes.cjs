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
console.log("PUBLIC_PDF_GCODES_EVERY_DIGIT_POSITION_SYNTHETIC_PASS");
