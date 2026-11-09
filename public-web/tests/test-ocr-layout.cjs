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
console.log("PUBLIC_OCR_PDF_POSITION_NEGATIVE_AUDIT_SYNTHETIC_PASS; not accuracy proof");
