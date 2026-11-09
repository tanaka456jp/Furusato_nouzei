"use strict";
/**
 * Client-only, fail-closed OCR review. NO user file ever enters a request.
 * npm-built runtime assets (Tesseract/PDF.js/ja models) are SELF-HOSTED.
 * Image OCR uses 2 correlated attempts (original vs contrast-enhanced);
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
  var manualRevision=0,reviewManualRevision=-1;
  // Keep original OCR provenance even after a manual edit invalidates
  // dataset.ocrYear. Otherwise switching documents can retain stale amounts.
  var transferredSource=null;
  // Confirmation is meaningful only AFTER the actual candidates are shown.
  acceptCheck.disabled=true;
  acceptCheck.checked=false;
  var MAX_BYTES=8*1024*1024;
  // PDF.js 6.x defaults maxImageSize to -1 (unlimited). A small PDF can
  // contain an enormous compressed raster; never decode it without a cap.
  var MAX_PDF_IMAGE_PIXELS=16*1024*1024;
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
    reviewManualRevision=-1;
    acceptCheck.checked=false;acceptCheck.disabled=true;
    acceptButton.disabled=true;
    show(message);
  }
  function clearReview(){
    clearEstimate();
    // A confirmation of deductions on the previous slip cannot be reused
    // for a newly selected source or a different income year.
    var confirmation=form.elements.namedItem("acknowledgedExclusions");
    if(confirmation)confirmation.checked=false;
    // A new file (including a cancelled selection), reset or tax-year change
    // must not leave the four values copied from an older source slip.
    // Never erase unrelated manual inputs when OCR has not been transferred.
    var oldTransferred=transferredSource;
    var hadTransferredSource=!!oldTransferred||!!form.dataset.ocrYear;
    transferredSource=null;
    generation++;
    review=null;reviewFile=null;reviewYear=null;reviewGeneration=-1;
    reviewManualRevision=-1;
    acceptCheck.checked=false;acceptCheck.disabled=true;
    acceptButton.disabled=true;
    report.replaceChildren();report.hidden=true;
    delete form.dataset.ocrYear;
    delete form.dataset.ocrReviewPending;
    if(hadTransferredSource){
      // Remove the *unchanged* OCR fields from the old source, preserving
      // anything deliberately edited by the user (including reference fields).
      ["salaryGross","salaryIncomeReference",
       "deductionsReference","socialInsurance"].forEach(function(name){
        var input=form.elements.namedItem(name);
        if(input&&(!oldTransferred||(!oldTransferred.edited[name]&&
           input.value===oldTransferred.values[name])))input.value="";
      });
    }
    // When no OCR transfer happened, these optional verification fields
    // are manual input and must not be silently cleared on a file change.
  }
  // User edits take priority over an OCR candidate, including edits made
  // while the async worker is running and after the candidate is displayed.
  // Programmatic transfers set .value without dispatching an input event.
  function amountWasEdited(event){
    var target=event.target;
    if(!target||!["salaryGross","salaryIncomeReference",
       "deductionsReference","socialInsurance"].includes(target.name))return;
    manualRevision++;
    if(transferredSource&&Object.prototype.hasOwnProperty.call(
       transferredSource.values,target.name))
      transferredSource.edited[target.name]=true;
    if(busy||review!==null){
      generation++;
      review=null;reviewFile=null;reviewYear=null;reviewGeneration=-1;
      reviewManualRevision=-1;
      acceptCheck.checked=false;acceptCheck.disabled=true;
      acceptButton.disabled=true;
      form.dataset.ocrReviewPending="true";
      clearEstimate();
      show("金額の手入力が変更されたため、以前のOCR候補を無効にしました。新しい原票で再読取するか、入力をクリアして手入力してください。");
    }else if(form.dataset.ocrYear){
      // A source/year attestation from a prior OCR transfer can no longer
      // authenticate manually modified amounts.
      delete form.dataset.ocrYear;
      form.dataset.ocrReviewPending="true";
      clearEstimate();
      show("OCR転記後の金額が変更されました。原票照合済みの状態を解除しました。再読取するか、入力をクリアして手入力してください。");
    }
  }
  form.addEventListener("input",amountWasEdited);
  form.addEventListener("change",amountWasEdited);

  fileInput.addEventListener("change",function(){
    // File picker cancellation must NOT convert an unverified OCR session
    // into a normal manual calculation. In particular, a previously
    // transferred slip may no longer have dataset.ocrYear after an edit.
    var wasPending=form.dataset.ocrReviewPending==="true";
    var hadTransferredSource=!!transferredSource||!!form.dataset.ocrYear;
    clearReview();
    if(fileInput.files&&fileInput.files.length){
      form.dataset.ocrReviewPending="true";
      show("原票の読取前です。読取結果を確認するか「入力をクリア」で解除してください。");
    }else if(wasPending||hadTransferredSource){
      form.dataset.ocrReviewPending="true";
      show("原票選択が取り消されました。未確認の読取結果は使えません。入力をクリアして手入力するか、原票を再選択してください。");
    }
  });
  form.addEventListener("reset",function(){clearReview();fileInput.value="";});
  var taxYear=form.elements.namedItem("year");
  taxYear.addEventListener("change",function(){
    // The attestation flag was removed on manual edit, but the older OCR
    // source still exists in memory until clearReview() disposes of it.
    // A year change must not silently turn that situation into manual mode.
    var hadTransferredSource=!!form.dataset.ocrYear||!!transferredSource;
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
    try{
      var context=canvas.getContext("2d",{willReadFrequently:true});
      if(!context)throw Error("画像処理に対応していません。");
      context.fillStyle="#fff";context.fillRect(0,0,w,h);
      context.drawImage(source,0,0,w,h);
      return canvas;
    }catch(error){
      canvas.width=0;canvas.height=0;
      throw error;
    }
  }
  function contrastVariant(original){
    var alternate=document.createElement("canvas");
    alternate.width=original.width;alternate.height=original.height;
    try{
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
    }catch(error){
      alternate.width=0;alternate.height=0;
      throw error;
    }
  }
  async function imageToCanvas(file){
    // Inspect only bounded header bytes BEFORE decoding compressed pixels.
    if(!window.FurusatoImageHeader||
       typeof window.FurusatoImageHeader.inspect!=="function"||
       !file||typeof file.slice!=="function")
      throw Error("IMAGE_HEADER_PREFLIGHT_UNAVAILABLE");
    var headerBytes=await file.slice(0,
      window.FurusatoImageHeader.MAX_HEADER_BYTES).arrayBuffer();
    var imageInfo=window.FurusatoImageHeader.inspect(
      new Uint8Array(headerBytes),file.type);
    if(imageInfo.status!=="ACCEPT")throw Error("IMAGE_HEADER_PREFLIGHT_HOLD");
    var image;
    if(typeof createImageBitmap==="function"){
      // Some Safari versions expose createImageBitmap but reject particular
      // JPEG decodes/options. A failed decode must not block the safe native
      // image-element path (which still undergoes the same quality gates).
      try{image=await createImageBitmap(file,{imageOrientation:"from-image"});}
      catch(_){image=null;}
      if(image){
        try{
          if(window.FurusatoImageHeader.verifyDecodedSize(
              imageInfo,image.width,image.height).status!=="ACCEPT")
            throw Error("IMAGE_HEADER_DECODED_DIMENSION_HOLD");
          return safeCanvas(image,image.width,image.height);
        }finally{if(typeof image.close==="function")image.close();}
      }
    }
    var url=URL.createObjectURL(file);
    try{
      image=await new Promise(function(resolve,reject){
        var img=new Image();
        img.onload=function(){resolve(img);};
        img.onerror=function(){reject(Error("画像を表示できません。"));};
        img.src=url;
      });
      if(window.FurusatoImageHeader.verifyDecodedSize(
          imageInfo,image.naturalWidth,image.naturalHeight).status!=="ACCEPT")
        throw Error("IMAGE_HEADER_DECODED_DIMENSION_HOLD");
      return safeCanvas(image,image.naturalWidth,image.naturalHeight);
    }finally{URL.revokeObjectURL(url);}
  }
  async function openPdf(file){
    var pdfjs=await import("./vendor/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc="./vendor/pdf.worker.mjs";
    var bytes=new Uint8Array(await file.arrayBuffer());
    var task=pdfjs.getDocument({data:bytes,disableAutoFetch:true,disableStream:true,
      isEvalSupported:false,useSystemFonts:false,stopAtErrors:true,
      maxImageSize:MAX_PDF_IMAGE_PIXELS});
    try{
      var document=await task.promise;
      if(document.numPages!==1)
        throw Error("PDFは1ページのみ対応しています。");
      return {document:document,task:task};
    }catch(error){
      // PDF.js 6 owns its worker through the loading task. The document
      // proxy is not guaranteed to expose .destroy().
      if(typeof task.destroy==="function")
        await task.destroy().catch(function(){});
      throw error;
    }
  }
  async function digitalPdfText(page){
    var content=await page.getTextContent();
    if(!window.FurusatoPdfLayout||
       typeof window.FurusatoPdfLayout.boundedTextLayer!=="function")
      throw Error("PDF_TEXT_LAYER_GUARD_MISSING");
    var checked=window.FurusatoPdfLayout.boundedTextLayer(content.items);
    if(checked.status!=="OK"&&checked.status!=="EMPTY")
      throw Error("PDF_TEXT_LAYER_HOLD");
    return {text:checked.text,items:checked.items,
      emptyTextLayer:checked.status==="EMPTY"};
  }
  async function rasterizePdf(page){
    var viewport=page.getViewport({scale:1});
    var scale=Math.min(3,2600/Math.max(viewport.width,viewport.height));
    if(scale<=0||!Number.isFinite(scale)||viewport.width*scale<750||
       viewport.height*scale<400)throw Error("PDFの解像度が不足しています。");
    var view=page.getViewport({scale:scale});
    var canvas=document.createElement("canvas");
    canvas.width=Math.ceil(view.width);canvas.height=Math.ceil(view.height);
    try{
      var ctx=canvas.getContext("2d");
      if(!ctx)throw Error("PDF画像化に対応していません。");
      // PDF.js 6.x may require an explicit canvas in addition to its context.
      await page.render({canvas:canvas,canvasContext:ctx,viewport:view}).promise;
      return canvas;
    }catch(error){
      canvas.width=0;canvas.height=0;
      throw error;
    }
  }
  async function twoPass(image,isStale){
    function ensureCurrent(){
      // A stale OCR result is never used. Stop expensive follow-up passes
      // as soon as the current recognition returns control to JavaScript.
      if(typeof isStale==="function"&&isStale())
        throw Error("OCR_SOURCE_CANCELLED");
    }
    if(typeof window.Tesseract==="undefined"||
      typeof window.Tesseract.createWorker!=="function")
      throw Error("端末内OCRエンジンを読み込めません。");
    var original=image,enhanced=null,rectified=null,worker=null;
    try{
      ensureCurrent();
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
      ensureCurrent();
      var paths={
        workerPath:new URL("./vendor/tesseract/worker.min.js",location.href).href,
        corePath:new URL("./vendor/tesseract/core",location.href).href,
        langPath:new URL("./vendor/tesseract/lang",location.href).href,
        workerBlobURL:false,cacheMethod:"none"
      };
      worker=await window.Tesseract.createWorker("jpn",window.Tesseract.OEM.LSTM_ONLY,paths);
      ensureCurrent();
      var a=await worker.recognize(original,{}, {text:true,blocks:true});
      ensureCurrent();
      var b=await worker.recognize(enhanced);
      ensureCurrent();
      var compared=window.FurusatoSlipReview.compareAttempts(
        a?.data?.text,b?.data?.text,a?.data?.confidence,b?.data?.confidence);
      // Do not use regional reads to invent fields or override global HOLD.
      // If the original OCR returns exact positions for all four labels,
      // re-read the four crops at 2x size and VETO disagreement.
      if(compared.eligibleForManualTransfer&&
         window.FurusatoOcrRegions&&
         typeof window.FurusatoOcrRegions.plan==="function"&&
         typeof window.FurusatoOcrRegions.assessRechecks==="function"){
        var plan=window.FurusatoOcrRegions.plan(
          a?.data?.blocks,original.width,original.height,compared.candidates);
        if(plan.status==="CONFLICT")return {
          schema:"furusato-slip-region-review/v1",status:"REQUIRES_SOURCE_REVIEW",
          year:null,candidates:{},reasons:plan.reasons,
          eligibleForManualTransfer:false,autoApproved:false,originalCompared:false
        };
        if(plan.status==="READY"){
          var values=[];
          for(const region of plan.rectangles){
            ensureCurrent();
            var crop=document.createElement("canvas");
            try{
              crop.width=region.width*2;crop.height=region.height*2;
              var ctx=crop.getContext("2d");
              if(!ctx)throw Error("FIELD_REGION_CANVAS_UNAVAILABLE");
              ctx.fillStyle="#fff";ctx.fillRect(0,0,crop.width,crop.height);
              ctx.drawImage(original,
                region.left,region.top,region.width,region.height,
                0,0,crop.width,crop.height);
              var rec=await worker.recognize(crop);
              ensureCurrent();
              values.push({key:region.key,text:rec?.data?.text,
                confidence:rec?.data?.confidence});
            }finally{crop.width=0;crop.height=0;}
          }
          var checked=window.FurusatoOcrRegions.assessRechecks(
            values,compared.candidates);
          if(checked.status!=="CORROBORATED")return {
            schema:"furusato-slip-region-review/v1",status:"REQUIRES_SOURCE_REVIEW",
            year:null,candidates:{},reasons:checked.reasons,
            eligibleForManualTransfer:false,autoApproved:false,originalCompared:false
          };
        }
      }
      return compared;
    }finally{
      // Termination can itself reject, e.g. a worker process crash. Never
      // skip release of large intermediate canvases in that case.
      try{
        if(worker)await worker.terminate();
      }finally{
        if(enhanced){enhanced.width=0;enhanced.height=0;}
        if(rectified){rectified.width=0;rectified.height=0;}
      }
    }
  }
  function displayReview(r){
    // A pre-checked consent made during the asynchronous scan is invalid.
    acceptCheck.checked=false;
    acceptCheck.disabled=true;
    acceptButton.disabled=true;
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
    acceptCheck.disabled=false;
    acceptButton.disabled=false;
  }
  runButton.addEventListener("click",async function(){
    if(busy)return;
    // A reread supersedes all prior source attestations. A missing/invalid
    // file must not leave the old OCR values, which could otherwise be
    // calculated after the user re-checks the exclusions confirmation.
    // Do not force purely manual users into OCR HOLD for an empty click.
    var hadSource=!!transferredSource||!!form.dataset.ocrYear||
      form.dataset.ocrReviewPending==="true"||review!==null;
    if(hadSource){
      clearReview();
      form.dataset.ocrReviewPending="true";
    }
    // The deductions attestation must be renewed even on a failed scan.
    var confirmation=form.elements.namedItem("acknowledgedExclusions");
    if(confirmation)confirmation.checked=false;
    blocked("読み取り中です。画像や金額はサーバーへ送信しません。");
    var file=fileInput.files&&fileInput.files.length===1?fileInput.files[0]:null;
    if(!file||!ACCEPTED[file.type]||file.size<=0||file.size>MAX_BYTES){
      blocked("JPEG・PNG・1ページPDF（8MB以下）を1件だけ指定してください。HEICは未対応です。");
      return;
    }
    busy=true;runButton.disabled=true;acceptButton.disabled=true;
    var requestedGeneration=generation,requestedYear=Number(taxYear.value);
    var requestedManualRevision=manualRevision;
    var canvas=null,pdf=null,pdfTask=null,stage="SOURCE_PREPARE";
    function isStale(){
      return generation!==requestedGeneration||
        manualRevision!==requestedManualRevision||
        (fileInput.files&&fileInput.files[0])!==file||
        Number(taxYear.value)!==requestedYear;
    }
    try{
      var result;
      if(file.type==="application/pdf"){
        stage="PDF_OPEN";var opened=await openPdf(file);
        pdf=opened.document;pdfTask=opened.task;
        stage="PDF_PAGE";var page=await pdf.getPage(1);
        stage="PDF_TEXT";var extracted=await digitalPdfText(page);
        if(extracted.emptyTextLayer){
          // No PDF text operators: scanned image-only single-page PDF.
          // This is the only fallback for EMPTY, not for malformed layers.
          stage="PDF_RASTER";canvas=await rasterizePdf(page);
          stage="PDF_OCR";result=await twoPass(canvas,isStale);
        }else{
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
        // Distinct complete extraction routes must agree on ALL four yen
        // values, not just the year. A position audit may return PARTIAL;
        // that must not mask a conflicting complete positioned candidate.
        if(typeof window.FurusatoPdfLayout.crossCheckExtracted!=="function")
          throw Error("PDF_CROSS_SOURCE_AUDIT_MISSING");
        var crossCheck=window.FurusatoPdfLayout.crossCheckExtracted(
          digital,positioned);
        if(positioned.positionStatus==="CONFLICT"||
           hardTextFailure||digital.yearConflict===true||
           conflictingYears||crossCheck.status==="CONFLICT"){
          result={
            schema:"furusato-slip-pdf-cross-check/v1",
            status:"REQUIRES_SOURCE_REVIEW",year:null,candidates:{},
            reasons:positioned.positionStatus==="CONFLICT"
              ?positioned.reasons:digital.yearConflict===true
                ?["PDF_EXPLICIT_YEAR_CONFLICT"]:crossCheck.status==="CONFLICT"
                  ?crossCheck.reasons:["PDF_TEXT_OR_YEAR_CONFLICT"],
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
          stage="PDF_RASTER";canvas=await rasterizePdf(page);
          stage="PDF_OCR";result=await twoPass(canvas,isStale);
        }
        }
      }else{
        stage="IMAGE_DECODE";canvas=await imageToCanvas(file);
        stage="IMAGE_OCR";result=await twoPass(canvas,isStale);
      }
      // A source swap, form reset or year change during async OCR invalidates
      // the old attempt, even if the two text recognitions both succeeded.
      if(isStale())return;
      review=result;reviewFile=file;reviewYear=requestedYear;
      reviewGeneration=requestedGeneration;
      reviewManualRevision=requestedManualRevision;
      displayReview(result);
    }catch(error){
      if(generation===requestedGeneration)
        blocked("OCRを完了できませんでした（処理区分："+stage+"）。入力原票は送信されません。画質・ページ構成を確認し、必要なら撮影し直すか手入力してください。");
    }finally{
      busy=false;runButton.disabled=false;
      if(canvas){canvas.width=0;canvas.height=0;}
      if(pdfTask&&typeof pdfTask.destroy==="function")
        await pdfTask.destroy().catch(function(){});
    }
  });
  acceptCheck.addEventListener("change",function(){
    if(acceptCheck.disabled||!review?.eligibleForManualTransfer||
       reviewGeneration!==generation||
       reviewManualRevision!==manualRevision||
       reviewYear!==Number(taxYear.value)||
       review.year!==Number(taxYear.value))acceptCheck.checked=false;
  });
  acceptButton.addEventListener("click",function(){
    if(!review?.eligibleForManualTransfer||acceptCheck.disabled||
      !acceptCheck.checked||
      reviewGeneration!==generation||
      reviewManualRevision!==manualRevision||
      reviewFile!==(fileInput.files&&fileInput.files[0])||
      reviewYear!==Number(taxYear.value)||
      Number(taxYear.value)!==review.year){
      show("原票の4金額・年分と控除状況を確認してから反映してください。");return;
    }
    var previousValues={};
    window.FurusatoSlipReview.FIELDS.forEach(function(field){
      var input=form.elements.namedItem(field.key);
      if(input){
        input.value=String(review.candidates[field.key]);
        previousValues[field.key]=input.value;
      }
    });
    transferredSource={values:previousValues,edited:{}};
    // The four OCR yen fields are not a declaration that spouse, dependent,
    // mortgage and other deduction exclusions have been rechecked.
    var confirmation=form.elements.namedItem("acknowledgedExclusions");
    if(confirmation)confirmation.checked=false;
    form.dataset.ocrYear=String(review.year);
    form.dataset.ocrReviewPending="false";
    review=null;acceptCheck.checked=false;acceptCheck.disabled=true;
    acceptButton.disabled=true;
    fileInput.value="";
    show("原票確認済みの数値候補を転記しました。控除・扶養などの確認項目を入力してから試算してください。");
  });
}());