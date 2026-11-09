"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const source=fs.readFileSync(path.join(__dirname,"..","SourceOCR.gs"),"utf8");
let creates=[],deletes=[],sample="給与所得の源泉徴収票\n令和8年分\n支払金額 5,000,000円\n社会保険料等の金額 1,000,000円\n氏名 テスト人物";
const ctx={module:{exports:{}},
 Utilities:{base64Decode:s=>Array.from(Buffer.from(s,"base64")).map(n=>n>127?n-256:n),
            newBlob:(bytes,mime,name)=>({bytes,mime,name}),getUuid:()=> "test"},
 Drive:{Files:{create:(meta,blob,opt)=>{creates.push({meta,blob,opt});return {id:"temp-1"};},
              remove:id=>deletes.push(id)}},
 DocumentApp:{openById:()=>({getBody:()=>({getText:()=>sample})})}};
vm.runInNewContext(source,ctx);
const api=ctx.module.exports;
// Observed with a real synthetic PDF converted by Google Drive: lines merge.
const joined=api.reviewText('令和8年分 給与所得の源泉徴収票 支払金額 7,000,000 円\n社会保険料等の金額 1,000,000 円 給与所得控除後の金額 5,200,000 円');
assert.equal(joined.candidates.salary_gross,7000000);
assert.equal(joined.candidates.social_insurance,1000000);
assert.equal(joined.candidates.salary_reference,5200000);
assert.equal(joined.status,'REQUIRES_REVIEW');
const duplicate=api.reviewText('令和8年分 給与所得の源泉徴収票 支払金額 7,000,000 円 支払金額 8,000,000 円');
assert.ok(duplicate.warnings.includes('MULTIPLE_SALARY_GROSS'));
assert.equal(duplicate.candidates.salary_gross,undefined);
const substring=api.reviewText('令和8年分 給与所得の源泉徴収票 誤支払金額 7,000,000 円');
assert.equal(substring.candidates.salary_gross,undefined);
const pdf=Buffer.from("%PDF-1.7\nsynthetic").toString("base64");
assert.throws(()=>api.read({mimeType:"application/pdf",base64:pdf}),/同意/);
assert.throws(()=>api.read({mimeType:"image/png",base64:pdf,consent:true}),/形式/);
assert.equal(creates.length,0);
const result=api.read({mimeType:"application/pdf",base64:pdf,consent:true});
assert.equal(result.status,"REQUIRES_REVIEW");
assert.equal(result.year,2026);
assert.equal(result.candidates.salary_gross,5000000);
assert.equal(result.candidates.social_insurance,1000000);
assert.equal(creates[0].opt.ocrLanguage,"ja");
assert.equal(creates[0].meta.mimeType,"application/vnd.google-apps.document");
assert.equal(deletes.length,1);
assert.ok(!JSON.stringify(result).includes("テスト人物"));
assert.ok(!("donationLimitYen" in result));
sample="給与所得の源泉徴収票\n令和7年分\n令和8年分\n支払金額 5,000,000円";
const conflicting=api.read({mimeType:"application/pdf",base64:pdf,consent:true});
assert.equal(conflicting.year,null);
assert.equal(Object.keys(conflicting.candidates).length,0);
ctx.DocumentApp.openById=()=>{throw new Error("test private content");};
assert.throws(()=>api.read({mimeType:"application/pdf",base64:pdf,consent:true}),/OCRが失敗/);
assert.equal(deletes.length,3,"Must delete even if OCR extraction failed");
ctx.Drive.Files.remove=()=>{throw new Error("access lost");};
assert.throws(()=>api.read({mimeType:"application/pdf",base64:pdf,consent:true}),/削除が失敗/);
console.log("PASS: consent, magic-byte checks, privacy, OCR always HOLD, cleanup");
