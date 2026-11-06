/**
 * Privacy-first private-test OCR adapter.
 * Converts PDF/JPEG/PNG to a temporary Google Doc with Drive OCR, extracts
 * cautious candidates, then deletes the document. Never return source text.
 * All OCR output requires review; it never authorizes a tax-limit estimate.
 */
var FurusatoOcr = (function () {
  "use strict";
  var MAX_BYTES=2*1024*1024;
  var EXT={"application/pdf":"pdf","image/png":"png","image/jpeg":"jpg"};
  var RULES=[
    ["salary_gross",/(?:^|\n)\s*(?:支払金額|給与支払金額)\s*[:：]?\s*([0-9][0-9,]{3,11})\s*(?:円|$)/gm],
    ["social_insurance",/(?:^|\n)\s*社会保険料等の金額\s*[:：]?\s*([0-9][0-9,]{3,11})\s*(?:円|$)/gm],
    ["salary_reference",/(?:^|\n)\s*給与所得控除後の金額(?:（調整控除後）)?\s*[:：]?\s*([0-9][0-9,]{3,11})\s*(?:円|$)/gm],
    ["deductions_reference",/(?:^|\n)\s*所得控除の額の合計額\s*[:：]?\s*([0-9][0-9,]{3,11})\s*(?:円|$)/gm],
    ["basic_reference",/(?:^|\n)\s*基礎控除の額\s*[:：]?\s*([0-9][0-9,]{3,11})\s*(?:円|$)/gm]
  ];
  function reviewText(text) {
    var normalized=String(text||"").normalize("NFKC").replace(/\r\n?/g,"\n");
    var validDocument=/給与所得の源泉徴収票|給与所得.*源泉徴収票/.test(normalized);
    var years=[],m,pattern=/(?:令和\s*([78])|20(25|26))\s*年分/g;
    while ((m=pattern.exec(normalized))) {
      var n=m[1] ? 2018+Number(m[1]) : 2000+Number(m[2]);
      if(years.indexOf(n)<0)years.push(n);
    }
    var warnings=["OCR_REVIEW_REQUIRED"];
    if(!validDocument)warnings.push("DOCUMENT_NOT_CONFIRMED");
    if(years.length!==1)warnings.push("YEAR_UNCERTAIN");
    var candidates={};
    RULES.forEach(function(item){
      var found=[],v; item[1].lastIndex=0;
      while((v=item[1].exec(normalized))){
        var num=Number(v[1].replace(/,/g,""));
        if(Number.isSafeInteger(num)&&num<=1000000000000&&found.indexOf(num)<0)found.push(num);
      }
      if(found.length===1)candidates[item[0]]=found[0];
      if(found.length>1)warnings.push("MULTIPLE_"+item[0].toUpperCase());
    });
    if(!validDocument||years.length!==1)candidates={};
    return {schema:"furusato-ocr-review/v1",status:"REQUIRES_REVIEW",
      year:validDocument&&years.length===1?years[0]:null,candidates:candidates,warnings:warnings};
  }
  function isSignature(bytes,mime){
    function b(i){return (bytes[i]+256)%256;}
    if(mime==="application/pdf")return bytes.length>=5&&[37,80,68,70,45].every(function(n,i){return b(i)===n;});
    if(mime==="image/png")return bytes.length>=8&&[137,80,78,71,13,10,26,10].every(function(n,i){return b(i)===n;});
    if(mime==="image/jpeg")return bytes.length>=4&&b(0)===255&&b(1)===216&&b(2)===255;
    return false;
  }
  function read(req){
    if(!req||req.consent!==true)throw new Error("Google Driveへの一時転送に同意してください");
    if(!Object.prototype.hasOwnProperty.call(EXT,req.mimeType))
      throw new Error("PDF・JPEG・PNGのみ対応します");
    if(typeof req.base64!=="string"||!/^[A-Za-z0-9+/]+={0,2}$/.test(req.base64)||
       req.base64.length>Math.ceil(MAX_BYTES*4/3)+8)
      throw new Error("OCRデータ形式・サイズが不正です");
    var bytes=Utilities.base64Decode(req.base64);
    if(!bytes.length||bytes.length>MAX_BYTES||!isSignature(bytes,req.mimeType))
      throw new Error("ファイル形式が不正です");
    var blob=Utilities.newBlob(bytes,req.mimeType,"source."+EXT[req.mimeType]);
    var id=null,answer=null,failed=false,cleanupFailed=false;
    try {
      var doc=Drive.Files.create(
        {name:"Furusato_OCR_TEMP_"+Utilities.getUuid(),mimeType:"application/vnd.google-apps.document"},
        blob,{ocrLanguage:"ja",fields:"id,mimeType"});
      if(!doc||!doc.id)throw new Error("Document conversion did not return an id");
      id=doc.id;
      answer=reviewText(DocumentApp.openById(id).getBody().getText());
    } catch(e) { failed=true; }
    finally {
      if(id)try {Drive.Files.remove(id);}catch(e){cleanupFailed=true;}
    }
    if(cleanupFailed)throw new Error("OCR一時ファイルの削除が失敗しました。Google DriveでFurusato_OCR_TEMP_を検索し確認してください");
    if(failed)throw new Error("OCRが失敗しました。Googleの認可とDrive API設定を確認してください");
    return answer;
  }
  return {read:read,reviewText:reviewText};
}());
function extractWithholdingOcr(request){return FurusatoOcr.read(request);}
if(typeof module!=="undefined"&&module.exports)module.exports=FurusatoOcr;
