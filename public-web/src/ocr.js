"use strict";
/**
 * Client-only, fail-closed OCR review. NO user file ever enters a request.
 * npm-built runtime assets (Tesseract/PDF.js/ja models) are SELF-HOSTED.
 * Image OCR is 2 independent attempts (original vs contrast-enhanced);
 * agreement is a candidate, NEVER tax assessment or source verification.
 */
(function(){
  var form=document.getElementById("calculator");
  var fileInput=document.getElementById("slipFile");
  var runButton=document.getElementById("slipScan");
  var acceptButton=document.getElementById("slipTransfer");
  var acceptCheck=document.getElementById("slipConfirm");
  var report=document.getElementById("slipReview");
  if(!form||!fileInput||!runButton||!acceptButton||!acceptCheck||!report)return;
  var review=null, busy=false;
  var generation=0,reviewFile=null,reviewYear=null,reviewGeneration=-1;
  var MAX_BYTES=8*1024*1024;
  var ACCEPTED={"image/jpeg":true,"image/png":true,"application/pdf":true};
  function show(message){
    report.replaceChildren();
    var line=document.createElement("p");
    line.textContent=message;
    report.appendChild(line);
    report.hidden=false;
  }
  function clearEstimate(){
    var output=document.getElementById("result");
    if(!output)return;
    output.replaceChildren();output.hidden=true;output.className="result";
  }
  function blocked(message){
    clearEstimate();
    review=null;reviewFile=null;reviewYear=null;reviewGeneration=-1;
    acceptCheck.checked=false;acceptButton.disabled=true;
    show(message);
  }
  function clearReview(){
    clearEstimate();
    // A new file (including a cancelled selection), reset or tax-year change
    // must not leave the four values copied from an older source slip.
    // Never erase unrelated manual inputs when OCR has not been transferred.
    var hadTransferredSource=!!form.dataset.ocrYear;
    generation++;
    review=null;reviewFile=null;reviewYear=null;reviewGeneration=-1;
    acceptCheck.checked=false;acceptButton.disabled=true;
    report.replaceChildren();report.hidden=true;
    delete form.dataset.ocrYear;
    delete form.dataset.ocrReviewPending;
    if(hadTransferredSource){
      ["salaryGross","socialInsurance"].forEach(function(name){
        var input=form.elements.namedItem(name);
        if(input)input.value="";
      });
    }
    if(form.elements.namedItem("salaryIncomeReference"))
      form.elements.namedItem("salaryIncomeReference").value="";
    if(form.elements.namedItem("deductionsReference"))
      form.elements.namedItem("deductionsReference").value="";
  }
  fileInput.addEventListener("change",function(){
    clearReview();
    if(fileInput.files&&fileInput.files.length){
      form.dataset.ocrReviewPending="true";
      show("原票の読取前です。読取結果を確認するか「入力をクリア」で解除してください。");
    }
  });
  form.addEventListener("reset",function(){clearReview();fileInput.value="";});
  var taxYear=form.elements.namedItem("year");
  taxYear.addEventListener("change",function(){
    var hadTransferredSource=!!form.dataset.ocrYear;
    clearReview();
    if(hadTransferredSource||(fileInput.files&&fileInput.files.length)){
      form.dataset.ocrReviewPending="true";
      show("所得年が変更されました。以前の原票からの読取結果は使えません。新規入力または原票の再確認が必要です。");
    }
  });
  function safeCanvas(source,width,height){
    var factor=Math.min(1,2600/Math.max(width,height));
    var w=Math.max(1,Math.floor(width*factor));
    var h=Math.max(1,Math.floor(height*factor));
    if(w<750||h<400||w*h>10000000)throw Error("解像度が不適切です。より鮮明な画像で再試行してください。");
    var canvas=document.createElement("canvas");
    canvas.width=w;canvas.height=h;
    var context=canvas.getContext("2d",{willReadFrequently:true});
    if(!context)throw Error("画像処理に対応していません。");
    context.fillStyle="#fff";context.fillRect(0,0,w,h);
    context.drawImage(source,0,0,w,h);
    return canvas;
  }
  function contrastVariant(original){
    var alternate=document.createElement("canvas");
    alternate.width=original.width;alternate.height=original.height;
    var context=alternate.getContext("2d",{willReadFrequently:true});
    if(!context)throw Error("画像補正に対応していません。");
    context.drawImage(original,0,0);
    var pixels=context.getImageData(0,0,alternate.width,alternate.height);
    var data=pixels.data;
    for(var i=0;i<data.length;i+=4){
      var grey=.299*data[i]+.587*data[i+1]+.114*data[i+2];
      var adjusted=Math.max(0,Math.min(255,Math.round((grey-128)*1.35+139)));
      data[i]=data[i+1]=data[i+2]=adjusted;
    }
    context.putImageData(pixels,0,0);
    return alternate;
  }
  async function imageToCanvas(file){
    var image;
    if(typeof createImageBitmap==="function"){
      image=await createImageBitmap(file,{imageOrientation:"from-image"});
      try{return safeCanvas(image,image.width,image.height);}
      finally{if(typeof image.close==="function")image.close();}
    }
    var url=URL.createObjectURL(file);
    try{
      image=await new Promise(function(resolve,reject){
        var img=new Image();
        img.onload=function(){resolve(img);};
        img.onerror=function(){reject(Error("画像を表示できません。"));};
        img.src=url;
      });
      return safeCanvas(image,image.naturalWidth,image.naturalHeight);
    }finally{URL.revokeObjectURL(url);}
  }
  async function openPdf(file){
    var pdfjs=await import("./vendor/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc="./vendor/pdf.worker.mjs";
    var bytes=new Uint8Array(await file.arrayBuffer());
    var task=pdfjs.getDocument({data:bytes,disableAutoFetch:true,disableStream:true,
      isEvalSupported:false,useSystemFonts:false,stopAtErrors:true});
    var pdf=await task.promise;
    if(pdf.numPages!==1){await pdf.destroy();throw Error("PDFは1ページのみ対応しています。");}
    return pdf;
  }
  async function digitalPdfText(page){
    var content=await page.getTextContent();
    return {text:content.items.map(function(item){
      return String(item.str||"")+(item.hasEOL?"\n":" ");
    }).join(""),items:content.items};
  }
  async function rasterizePdf(page){
    var viewport=page.getViewport({scale:1});
    var scale=Math.min(3,2600/Math.max(viewport.width,viewport.height));
    if(scale<=0||!Number.isFinite(scale)||viewport.width*scale<750||
       viewport.height*scale<400)throw Error("PDFの解像度が不足しています。");
    var view=page.getViewport({scale:scale});
    var canvas=document.createElement("canvas");
    canvas.width=Math.ceil(view.width);canvas.height=Math.ceil(view.height);
    var ctx=canvas.getContext("2d");
    if(!ctx)throw Error("PDF画像化に対応していません。");
    await page.render({canvasContext:ctx,viewport:view}).promise;
    return canvas;
  }
  async function twoPass(image){
    if(typeof window.Tesseract==="undefined"||
      typeof window.Tesseract.createWorker!=="function")
      throw Error("端末内OCRエンジンを読み込めません。");
    var original=image,enhanced=null,rectified=null,worker=null;
    try{
      if(typeof window.FurusatoImageQuality!=="object"||
         typeof window.FurusatoImageQuality.assessCanvas!=="function")
        throw Error("IMAGE_QUALITY_MODULE_MISSING");
      var quality=window.FurusatoImageQuality.assessCanvas(original);
      if(quality.status!=="REVIEW")throw Error("IMAGE_QUALITY_HOLD");
      // Only high-confidence page corners trigger perspective correction.
      // An unverified silhouette retains the existing source image.
      if(window.FurusatoPerspective&&
         typeof window.FurusatoPerspective.tryRectify==="function"){
        var correction=window.FurusatoPerspective.tryRectify(image);
        if(correction.status==="APPLIED"){
          rectified=correction.canvas;
          if(window.FurusatoImageQuality.assessCanvas(rectified).status!=="REVIEW")
            throw Error("RECTIFIED_IMAGE_QUALITY_HOLD");
          original=rectified;
        }
      }
      enhanced=contrastVariant(original);
      var paths={
        workerPath:new URL("./vendor/tesseract/worker.min.js",location.href).href,
        corePath:new URL("./vendor/tesseract/core",location.href).href,
        langPath:new URL("./vendor/tesseract/lang",location.href).href,
        workerBlobURL:false,cacheMethod:"none"
      };
      worker=await window.Tesseract.createWorker("jpn",window.Tesseract.OEM.LSTM_ONLY,paths);
      var a=await worker.recognize(original);
      var b=await worker.recognize(enhanced);
      return window.FurusatoSlipReview.compareAttempts(
        a?.data?.text,b?.data?.text,a?.data?.confidence,b?.data?.confidence);
    }finally{
      if(worker)await worker.terminate();
      if(enhanced){enhanced.width=0;enhanced.height=0;}
      if(rectified){rectified.width=0;rectified.height=0;}
    }
  }
  function displayReview(r){
    report.replaceChildren();
    report.hidden=false;
    var title=document.createElement("p");
    title.textContent=r.eligibleForManualTransfer
      ?"項目候補を抽出しました。原票で数値・年分・追加控除を必ず照合してください。"
      :"読み取りを保留しました。手入力してください。";
    report.appendChild(title);
    if(!r.eligibleForManualTransfer){
      var errors=document.createElement("p");
      errors.textContent="停止理由："+(r.reasons||[]).join(" / ");
      report.appendChild(errors);
      return;
    }
    var ul=document.createElement("ul");
    r._acceptedCandidate=false;
    window.FurusatoSlipReview.FIELDS.forEach(function(field){
      var li=document.createElement("li");
      li.textContent=field.label+"："+r.candidates[field.key].toLocaleString("ja-JP")+"円";
      ul.appendChild(li);
    });
    report.appendChild(ul);
    var y=document.createElement("p");
    y.textContent="所得年："+r.year+"年（申告年分と一致することを確認）";
    report.appendChild(y);
    if(Number(form.elements.namedItem("year").value)!==r.year){
      var mismatch=document.createElement("p");
      mismatch.textContent="選択した所得年と原票の年が一致しません。反映せず、年分を確認してください。";
      report.appendChild(mismatch);
      return;
    }
    acceptButton.disabled=false;
  }
  runButton.addEventListener("click",async function(){
    if(busy)return;
    blocked("読み取り中です。画像や金額はサーバーへ送信しません。");
    var file=fileInput.files&&fileInput.files.length===1?fileInput.files[0]:null;
    if(!file||!ACCEPTED[file.type]||file.size<=0||file.size>MAX_BYTES){
      blocked("JPEG・PNG・1ページPDF（8MB以下）を1件だけ指定してください。HEICは未対応です。");
      return;
    }
    busy=true;runButton.disabled=true;acceptButton.disabled=true;
    var requestedGeneration=generation,requestedYear=Number(taxYear.value);
    var canvas=null,pdf=null;
    try{
      var result;
      if(file.type==="application/pdf"){
        pdf=await openPdf(file);
        var page=await pdf.getPage(1);
        var extracted=await digitalPdfText(page);
        var digital=window.FurusatoSlipReview.reviewDigitalPdf(extracted.text);
        if(typeof window.FurusatoPdfLayout!=="object"||
           typeof window.FurusatoPdfLayout.audit!=="function"||
           typeof window.FurusatoPdfLayout.extract!=="function")
          throw Error("PDF_POSITION_AUDIT_MISSING");
        var positioned=window.FurusatoPdfLayout.extract(extracted.items);
        // A PDF text layer can concatenate several separate table cells into
        // one text line: FIELD_INVALID alone is not decisive if all four
        // independent positioned cell anchors were uniquely verified.
        // A real duplicate/conflict always blocks even that layout fallback.
        var hardTextFailure=(digital.reasons||[]).some(function(reason){
          return reason.startsWith("FIELD_CONFLICT_")||
                 reason.startsWith("FIELD_DUPLICATE_")||
                 (reason.startsWith("FIELD_INVALID_")&&
                  !positioned.eligibleForManualTransfer);
        });
        var conflictingYears=positioned.year!==null&&digital.year!==null&&
          positioned.year!==digital.year;
        if(positioned.positionStatus==="CONFLICT"||
           hardTextFailure||conflictingYears){
          result={
            schema:"furusato-slip-pdf-cross-check/v1",
            status:"REQUIRES_SOURCE_REVIEW",year:null,candidates:{},
            reasons:positioned.positionStatus==="CONFLICT"
              ?positioned.reasons:["PDF_TEXT_OR_YEAR_CONFLICT"],
            eligibleForManualTransfer:false,originalCompared:false,
            autoApproved:false
          };
        }else if(digital.eligibleForManualTransfer){
          var positions=window.FurusatoPdfLayout.audit(
            extracted.items,digital.candidates);
          result=positions.status==="CONFLICT"?{
            schema:digital.schema,status:"REQUIRES_SOURCE_REVIEW",
            year:null,candidates:{},reasons:positions.reasons,
            eligibleForManualTransfer:false,originalCompared:false,
            autoApproved:false
          }:digital;
        }else if(positioned.eligibleForManualTransfer){
          // Only a fully unique title/year/four-fields geometry result can
          // supply missing digital text candidates. It still needs original
          // verification and full tax-engine checks before any estimate.
          result=positioned;
        }else{
          canvas=await rasterizePdf(page);
          result=await twoPass(canvas);
        }
      }else{
        canvas=await imageToCanvas(file);
        result=await twoPass(canvas);
      }
      // A source swap, form reset or year change during async OCR invalidates
      // the old attempt, even if the two text recognitions both succeeded.
      if(generation!==requestedGeneration||
         (fileInput.files&&fileInput.files[0])!==file||
         Number(taxYear.value)!==requestedYear)return;
      review=result;reviewFile=file;reviewYear=requestedYear;
      reviewGeneration=requestedGeneration;
      displayReview(result);
    }catch(error){
      if(generation===requestedGeneration)
        blocked("OCRを完了できませんでした。入力原票は送信されません。画質・ページ構成を確認し、必要なら撮影し直すか手入力してください。");
    }finally{
      busy=false;runButton.disabled=false;
      if(canvas){canvas.width=0;canvas.height=0;}
      if(pdf)await pdf.destroy().catch(function(){});
    }
  });
  acceptCheck.addEventListener("change",function(){
    if(!review?.eligibleForManualTransfer)acceptCheck.checked=false;
  });
  acceptButton.addEventListener("click",function(){
    if(!review?.eligibleForManualTransfer||!acceptCheck.checked||
      reviewGeneration!==generation||
      reviewFile!==(fileInput.files&&fileInput.files[0])||
      reviewYear!==Number(taxYear.value)||
      Number(taxYear.value)!==review.year){
      show("原票の4金額・年分と控除状況を確認してから反映してください。");return;
    }
    window.FurusatoSlipReview.FIELDS.forEach(function(field){
      var input=form.elements.namedItem(field.key);
      if(input)input.value=String(review.candidates[field.key]);
    });
    form.dataset.ocrYear=String(review.year);
    form.dataset.ocrReviewPending="false";
    review=null;acceptCheck.checked=false;acceptButton.disabled=true;
    fileInput.value="";
    show("原票確認済みの数値候補を転記しました。控除・扶養などの確認項目を入力してから試算してください。");
  });
}());