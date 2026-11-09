"use strict";
/** Pure synthetic PDF text-layer geometry; no real source documents. */
const assert=require("node:assert/strict");
const audit=require("../src/ocr-layout.js").audit;
const names=["支払金額","給与所得控除後の金額",
 "所得控除の額の合計額","社会保険料等の金額"];
const values=["7,000,000円","5,200,000円","1,670,000円","1,000,000円"];
const keys=["salaryGross","salaryIncomeReference","deductionsReference","socialInsurance"];
const expected={
 salaryGross:7000000,salaryIncomeReference:5200000,
 deductionsReference:1670000,socialInsurance:1000000
};
function item(str,x,y){return {str,transform:[1,0,0,1,x,y],width:90,height:10};}
const spans=[
 ...names.map((s,i)=>item(s,24+i*170,700)),
 ...values.map((s,i)=>item(s,24+i*170,680))
];
const matching=audit(spans,expected);
assert.equal(matching.status,"MATCH");
assert.equal(matching.autoApproved,false);
assert.deepEqual(matching.checkedFields,keys);
assert.deepEqual(matching.reasons,[]);
const conflict=spans.map(x=>({...x}));
conflict[4]=item("7,200,000円",24,680);
assert.equal(audit(conflict,expected).status,"CONFLICT");
assert.ok(audit(conflict,expected).reasons.includes("LAYOUT_VALUE_MISMATCH_salaryGross"));
const ambiguous=spans.concat([item("8,000,000円",70,676)]);
assert.equal(audit(ambiguous,expected).status,"CONFLICT");
assert.ok(audit(ambiguous,expected).reasons.includes("LAYOUT_AMBIGUOUS_AMOUNT_salaryGross"));
const duplicate=spans.concat([item("支払金額",24,700)]);
assert.equal(audit(duplicate,expected).status,"CONFLICT");
assert.ok(audit(duplicate,expected).reasons.includes("LAYOUT_DUPLICATE_LABEL_salaryGross"));
const partial=audit(spans.filter(x=>x.str!=="社会保険料等の金額"),expected);
assert.equal(partial.status,"PARTIAL");
assert.equal(partial.autoApproved,false);
assert.equal(audit(null,expected).status,"UNVERIFIED");
assert.equal(audit(spans,null).status,"UNVERIFIED");
assert.equal(audit([{str:"支払金額",transform:[1,0,0,1,"bad",700]}],expected).status,"PARTIAL");
const distant=spans.map(x=>({...x}));
distant[4]=item("7,200,000円",5000,100);
assert.notEqual(audit(distant,expected).status,"CONFLICT");
assert.equal(audit(spans,{...expected,salaryGross:7200000}).status,"CONFLICT");
const extract=require("../src/ocr-layout.js").extract;
const separateLabelAndValuePdf=spans.concat([
 item("給与所得の源泉徴収票",24,790),
 item("令和",24,750),item("8",62,750),item("年分",92,750)
]);
const review=extract(separateLabelAndValuePdf);
assert.equal(review.status,"REQUIRES_SOURCE_REVIEW");
assert.equal(review.positionStatus,"COMPLETE_CANDIDATES");
assert.equal(review.eligibleForManualTransfer,true);
assert.equal(review.autoApproved,false);
assert.equal(review.originalCompared,false);
assert.equal(review.year,2026);
assert.deepEqual(review.candidates,expected);
const duplicateAmount=extract(separateLabelAndValuePdf.concat([
 item("7,000,000円",28,679)
]));
assert.equal(duplicateAmount.eligibleForManualTransfer,false);
assert.equal(duplicateAmount.positionStatus,"CONFLICT");
assert.ok(duplicateAmount.reasons.includes("LAYOUT_AMBIGUOUS_AMOUNT_salaryGross"));
const duplicateYear=extract(separateLabelAndValuePdf.concat([
 item("令和8年分",600,750)
]));
assert.equal(duplicateYear.positionStatus,"CONFLICT");
assert.equal(duplicateYear.eligibleForManualTransfer,false);
const noTitle=extract(spans.concat([
 item("令和",24,750),item("8",62,750),item("年分",92,750)
]));
assert.equal(noTitle.eligibleForManualTransfer,false);
assert.equal(noTitle.positionStatus,"UNVERIFIED");
const missingSalary=extract(separateLabelAndValuePdf.filter(
 x=>x.str!=="7,000,000円"));
assert.equal(missingSalary.positionStatus,"UNVERIFIED");
assert.equal(missingSalary.eligibleForManualTransfer,false);
const heldAmbiguousField=extract(separateLabelAndValuePdf.concat([
 item("支払金額",24,700)
]));
assert.equal(heldAmbiguousField.positionStatus,"CONFLICT");
const adjusted=separateLabelAndValuePdf.map(x=>x.str==="給与所得控除後の金額"?
 item("給与所得控除後の金額（調整控除後）",x.transform[4],x.transform[5]):x);
assert.equal(extract(adjusted).eligibleForManualTransfer,true);

// Two complete extraction methods must agree exactly. An ordinary negative
// position audit can be PARTIAL if the field coordinates fall just outside
// its narrow band, so direct cross-checking is a distinct safety boundary.
const crossCheck=require("../src/ocr-layout.js").crossCheckExtracted;
const digital={eligibleForManualTransfer:true,year:2026,candidates:{...expected}};
const positioned={eligibleForManualTransfer:true,year:2026,candidates:{...expected}};
assert.equal(crossCheck(digital,positioned).status,"MATCH");
assert.equal(crossCheck(digital,positioned).autoApproved,false);
for(const key of keys){
 const changed={...positioned,candidates:{...expected,[key]:expected[key]+1}};
 const disagreement=crossCheck(digital,changed);
 assert.equal(disagreement.status,"CONFLICT");
 assert.ok(disagreement.reasons.includes(
   "PDF_TEXT_COORDINATE_AMOUNT_MISMATCH_"+key));
 assert.equal(disagreement.autoApproved,false);
}
const wrongYear=crossCheck(digital,{...positioned,year:2025});
assert.equal(wrongYear.status,"CONFLICT");
assert.ok(wrongYear.reasons.includes("PDF_TEXT_COORDINATE_YEAR_MISMATCH"));
assert.equal(crossCheck(digital,{...positioned,
 candidates:{...expected,socialInsurance:undefined}}).status,"CONFLICT");
assert.equal(crossCheck({...digital,eligibleForManualTransfer:false},positioned).status,"NOT_COMPARABLE");
assert.equal(crossCheck(digital,{...positioned,eligibleForManualTransfer:false}).status,"NOT_COMPARABLE");
// Contract: actual digital PDF orchestration must use the result as HOLD.
const fs=require("node:fs"),path=require("node:path");
const runtime=fs.readFileSync(path.join(__dirname,"..","src","ocr.js"),"utf8");
assert.match(runtime,/FurusatoPdfLayout\.crossCheckExtracted\(/);
assert.match(runtime,/crossCheck\.status==="CONFLICT"/);


// A compressed PDF may produce a huge or malformed text layer even if the
// uploaded file is under 8 MB. Refuse to construct a candidate in that case.
const bounded=require("../src/ocr-layout.js").boundedTextLayer;
const layer=bounded(separateLabelAndValuePdf);
assert.equal(layer.status,"OK");
assert.equal(layer.items.length,separateLabelAndValuePdf.length);
assert.equal(layer.sourcePersisted,false);
assert.equal(layer.text.includes("支払金額"),true);
const badItem=separateLabelAndValuePdf.map(x=>({...x}));
badItem[0]={...badItem[0],str:"X".repeat(241)};
assert.equal(bounded(badItem).status,"HOLD");
assert.equal(bounded(badItem).text,"");
assert.equal(bounded(badItem).items.length,0);
const badTransform=separateLabelAndValuePdf.map(x=>({...x}));
badTransform[0]={...badTransform[0],transform:[1,0,0,1,NaN,700]};
assert.equal(bounded(badTransform).status,"HOLD");
assert.equal(bounded(Array.from({length:4001},()=>item("abc",1,2))).status,"HOLD");
assert.equal(bounded(Array.from({length:600},()=>item("X".repeat(220),1,2))).status,"HOLD");
assert.equal(bounded([]).status,"HOLD");
assert.equal(bounded([null]).status,"HOLD");
assert.equal(bounded([item("OK",1,2),{type:"beginMarkedContent"}]).status,"OK");

assert.match(runtime,/FurusatoPdfLayout\.boundedTextLayer\(content\.items\)/);
console.log("PUBLIC_OCR_PDF_POSITION_NEGATIVE_AND_SOURCE_CANDIDATE_AUDIT_SYNTHETIC_PASS; not accuracy proof");
