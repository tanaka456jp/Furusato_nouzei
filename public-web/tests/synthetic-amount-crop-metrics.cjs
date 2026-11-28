"use strict";
// Research-only: summarize the fixed 4x4 factorial experiment. Never
// select per-field winners, repair punctuation, or emit transfer candidates.
const assert=require("node:assert/strict");
const KEYS=["salaryGross","salaryIncomeReference","deductionsReference","socialInsurance"];
function summarizeAmountCrop(observations,expected){
  assert.ok(Array.isArray(observations)&&observations.length===16);
  assert.ok(expected&&KEYS.every(k=>Number.isSafeInteger(Number(expected[k]))&&Number(expected[k])>=0));
  const variants=[];
  for(const mode of ["7","13"])for(const scale of [1,2]){
    const rows=observations.filter(x=>x&&x.mode===mode&&x.scale===scale);
    assert.equal(rows.length,4,"Unexpected sample count for fixed variant");
    const metrics={mode,scale,exact:0,fields:4,malformed:0,lowConfidence:0,wrongHighConfidence:0,elapsedMs:0,byField:{}};
    for(const key of KEYS){
      const matches=rows.filter(x=>x.key===key);
      assert.equal(matches.length,1,"Missing or duplicate crop: "+key);
      const x=matches[0];
      assert.ok(x.strictAmount===null||(Number.isSafeInteger(x.strictAmount)&&x.strictAmount>=0));
      assert.ok(x.confidence===null||(Number.isFinite(x.confidence)&&x.confidence>=0&&x.confidence<=100));
      assert.ok(Number.isFinite(x.elapsedMs)&&x.elapsedMs>=0);
      let status;
      if(x.strictAmount===null){metrics.malformed++;status="MALFORMED";}
      else if(x.confidence===null||x.confidence<75){metrics.lowConfidence++;status="LOW_CONFIDENCE";}
      else if(x.strictAmount!==Number(expected[key])){metrics.wrongHighConfidence++;status="WRONG_HIGH_CONFIDENCE";}
      else{metrics.exact++;status="EXACT";}
      metrics.elapsedMs+=x.elapsedMs;
      metrics.byField[key]={status,confidence:x.confidence,elapsedMs:x.elapsedMs};
    }
    variants.push(metrics);
  }
  return variants;
}
module.exports={summarizeAmountCrop};
