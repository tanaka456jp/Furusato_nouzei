"use strict";
/**
 * Withholding slip, conservative extraction only. Pure and offline.
 * A text match is NOT an accuracy certificate and NEVER approves a tax result.
 * Concepts reused from HousingERP's page/field guards and TaxTheoryAudioApp's
 * multi-attempt region quality checks; no user/private materials are copied.
 */
(function (root, factory) {
  var moduleValue = factory();
  if (typeof module === "object" && module.exports) module.exports = moduleValue;
  else root.FurusatoSlipReview = moduleValue;
}(typeof window !== "undefined" ? window : this, function () {
  "use strict";
  var FIELDS = Object.freeze([
    Object.freeze({key:"salaryGross", label:"支払金額",
      expression:/^(?:給与)?支払金額\s*[:：]?\s*(.+)$/}),
    Object.freeze({key:"salaryIncomeReference", label:"給与所得控除後の金額",
      expression:/^給与所得控除後の金額(?:\s*\(調整控除後\))?\s*[:：]?\s*(.+)$/}),
    Object.freeze({key:"deductionsReference", label:"所得控除の額の合計額",
      expression:/^所得控除の額の合計額\s*[:：]?\s*(.+)$/}),
    Object.freeze({key:"socialInsurance", label:"社会保険料等の金額",
      expression:/^社会保険料等の金額\s*[:：]?\s*(.+)$/})
  ]);
  var AMOUNT=/^(?:0|[1-9][0-9]{0,11}|[1-9][0-9]{0,2}(?:,[0-9]{3}){1,3})\s*(?:円)?$/;
  function normalize(input) {
    return String(input == null ? "" : input)
      .normalize("NFKC").replace(/\r\n?/g,"\n")
      .replace(/[\u200b-\u200d\ufeff]/g,"")
      .replace(/[ \t]+/g," ").trim();
  }
  function parseYen(text) {
    if (!AMOUNT.test(text)) return null;
    var n=Number(text.replace(/[,\s円]/g,""));
    return Number.isSafeInteger(n)&&n>=0&&n<=1000000000000?n:null;
  }
  function reviewText(raw) {
    var text=normalize(raw);
    var lines=text.split("\n").map(function(x){return x.trim();}).filter(Boolean);
    var yearCandidates=[];
    var header=/給与所得(?:の)?源泉徴収票/.test(text);
    var years=/(?:令和\s*([78])\s*年分|20(25|26)\s*年分)/g,m;
    while ((m=years.exec(text))) {
      var y=m[1]?2018+Number(m[1]):2000+Number(m[2]);
      if (yearCandidates.indexOf(y)<0)yearCandidates.push(y);
    }
    var reasons=[];
    if(!header)reasons.push("DOCUMENT_TITLE_UNVERIFIED");
    if(yearCandidates.length!==1)reasons.push("DOCUMENT_YEAR_UNVERIFIED");
    var candidates={},duplicates=[];
    FIELDS.forEach(function(field){
      var values=[];
      lines.forEach(function(line){
        var found=field.expression.exec(line);
        if(!found)return;
        var amount=parseYen(found[1].trim());
        if(amount===null){
          reasons.push("FIELD_INVALID_"+field.key);
          return;
        }
        values.push(amount);
      });
      var different=Array.from(new Set(values));
      // Repeating a label, even with the SAME number, may indicate mixed
      // pages or a duplicated section. Never silently pick one occurrence.
      if(values.length>1){
        duplicates.push(field.key);
        reasons.push("FIELD_DUPLICATE_"+field.key);
      }else if(values.length===1)candidates[field.key]=values[0];
      if(!values.length)reasons.push("FIELD_MISSING_"+field.key);
    });
    duplicates.forEach(function(key){
      delete candidates[key];reasons.push("FIELD_CONFLICT_"+key);
    });
    if(!header||yearCandidates.length!==1)candidates={};
    return {
      schema:"furusato-slip-field-review/v1",
      status:"REQUIRES_SOURCE_REVIEW",
      year:header&&yearCandidates.length===1?yearCandidates[0]:null,
      candidates:candidates,
      reasons:Array.from(new Set(reasons)),
      fullyExtracted:reasons.length===0&&FIELDS.every(function(f){return Number.isSafeInteger(candidates[f.key]);}),
      sourceTextPersisted:false,autoApproved:false
    };
  }
  function compareAttempts(left,right,confidenceLeft,confidenceRight) {
    var a=reviewText(left),b=reviewText(right);
    var reasons=[];
    if(a.year===null||b.year===null||a.year!==b.year)
      reasons.push("YEAR_DISAGREEMENT");
    if(!a.fullyExtracted||!b.fullyExtracted)
      reasons.push("INCOMPLETE_OCR");
    if(!Number.isFinite(confidenceLeft)||!Number.isFinite(confidenceRight)||
       confidenceLeft<75||confidenceRight<75)
      reasons.push("OCR_CONFIDENCE_NOT_ENOUGH");
    var candidates={};
    FIELDS.forEach(function(f){
      if(!Number.isSafeInteger(a.candidates[f.key])||
         !Number.isSafeInteger(b.candidates[f.key])||
         a.candidates[f.key]!==b.candidates[f.key]){
        reasons.push("FIELD_DISAGREEMENT_"+f.key);
      }else{
        candidates[f.key]=a.candidates[f.key];
      }
    });
    // No source text is returned. Even a perfect agreement requires a
    // visual original-document comparison and a fresh exclusions check.
    return {
      schema:"furusato-slip-two-pass-review/v1",
      status:"REQUIRES_SOURCE_REVIEW",
      year:reasons.length===0?a.year:null,
      candidates:reasons.length===0?candidates:{},
      reasons:Array.from(new Set(reasons)),
      eligibleForManualTransfer:reasons.length===0,
      autoApproved:false,originalCompared:false
    };
  }
  function reviewDigitalPdf(text) {
    var r=reviewText(text);
    return {
      schema:"furusato-slip-digital-pdf-review/v1",
      status:"REQUIRES_SOURCE_REVIEW",
      year:r.fullyExtracted?r.year:null,
      candidates:r.fullyExtracted?r.candidates:{},
      reasons:r.reasons,
      eligibleForManualTransfer:r.fullyExtracted,
      originalCompared:false,autoApproved:false
    };
  }
  return {FIELDS:FIELDS,normalize:normalize,parseYen:parseYen,
    reviewText:reviewText,compareAttempts:compareAttempts,reviewDigitalPdf:reviewDigitalPdf};
}));