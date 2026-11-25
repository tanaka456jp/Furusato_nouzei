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
  var review=null, busy=false,batchBusy=false;
  var generation=0,reviewFile=null,reviewYear=null,reviewGeneration=-1;
  var manualRevision=0,reviewManualRevision=-1;
  // At most one OCR worker may be active while the scan button is locked.
  // Keep a stable shutdown Promise so changing a source can interrupt the
  // in-flight recognize() without double-terminating the same worker.
  var activeOcrSession=null,activePdfSession=null;
  // A PDF loading task owns its worker. Cancel in-flight raster work first,
  // then destroy the loading task exactly once; do not unlock another scan
  // until that same teardown Promise finishes.
  function stopPdfSession(session){
    if(!session.stopPromise){
      if(session.textReader&&!session.textReaderCancelled){
        session.textReaderCancelled=true;
        try{
          var stopText=session.textReader.cancel();
          if(stopText&&typeof stopText.catch==="function")stopText.catch(function(){});
        }catch(_){}
      }
      if(session.renderTask&&typeof session.renderTask.cancel==="function"){
        try{session.renderTask.cancel();}catch(_){
          // Continue worker teardown even if the render task already ended.
        }
      }
      session.stopPromise=Promise.resolve().then(function(){
        return session.task.destroy();
      });
      session.stopPromise.catch(function(){});
    }
    return session.stopPromise;
  }
  function cancelActivePdf(){
    if(activePdfSession)stopPdfSession(activePdfSession);
  }
  function stopOcrSession(session){
    if(!session.stopPromise){
      session.stopPromise=Promise.resolve().then(function(){
        return session.worker.terminate();
      });
      // Cancellation is fire-and-forget, but the normal scan's finally
      // still awaits this SAME Promise and can report a shutdown failure.
      session.stopPromise.catch(function(){});
    }
    return session.stopPromise;
  }
  function cancelActiveOcr(){
    if(activeOcrSession)stopOcrSession(activeOcrSession);
  }
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
  var ACCEPTED={"image/jpeg":true,"image/png":true,"image/webp":true,"application/pdf":true};
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
    var forecast=form.elements.namedItem("forecastReviewed");
    if(forecast)forecast.checked=false;
    var manualCheck=form.elements.namedItem("correctedSourceReviewed");
    if(manualCheck)manualCheck.checked=false;
    delete form.dataset.ocrManualReviewRequired;
    // A new file (including a cancelled selection), reset or tax-year change
    // must not leave the four values copied from an older source slip.
    // Never erase unrelated manual inputs when OCR has not been transferred.
    var oldTransferred=transferredSource;
    var hadTransferredSource=!!oldTransferred||!!form.dataset.ocrYear;
    transferredSource=null;
    generation++;
    cancelActiveOcr();
    cancelActivePdf();
    review=null;reviewFile=null;reviewYear=null;reviewGeneration=-1;
    reviewManualRevision=-1;
    acceptCheck.checked=false;acceptCheck.disabled=true;
    acceptButton.disabled=true;
    report.replaceChildren();report.hidden=true;
    delete form.dataset.ocrYear;
    delete form.dataset.ocrOriginalGross;
    delete form.dataset.ocrOriginalIncome;
    form.dispatchEvent(new Event("family-source-reset"));
    delete form.dataset.ocrOriginalSocial;
    delete form.dataset.ocrOriginalDeductions;
    delete form.dataset.ocrSourceIndicators;
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
      cancelActiveOcr();
      cancelActivePdf();
      review=null;reviewFile=null;reviewYear=null;reviewGeneration=-1;
      reviewManualRevision=-1;
      acceptCheck.checked=false;acceptCheck.disabled=true;
      acceptButton.disabled=true;
      form.dataset.ocrReviewPending="true";
      clearEstimate();
      show("金額の手入力が変更されたため、以前のOCR候補を無効にしました。新しい原票で再読取するか、入力をクリアして手入力してください。");
    }else if(form.dataset.ocrYear){
      // Preserve the ORIGINAL source year as local evidence. The amount
      // review is invalid until the operator explicitly re-attests the
      // corrected figures. Removing the year would turn a prior-year slip
      // into an apparently pure manual input and allow the wrong tax law.
      form.dataset.ocrReviewPending="true";
      form.dataset.ocrManualReviewRequired="true";
      var manualCheck=form.elements.namedItem("correctedSourceReviewed");
      if(manualCheck)manualCheck.checked=false;
      clearEstimate();
      show("OCR転記後に金額が変更されました。原票年分は保持しています。修正した見込額を再照合し、再確認欄をチェックしてください。");
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
  // File pickers can dispatch cancel without change when dismissed or
  // when the same file is reselected. Previous candidates are invalid.
  fileInput.addEventListener("cancel",function(){
    var hasSource=!!transferredSource||!!form.dataset.ocrYear||
      form.dataset.ocrReviewPending==="true"||review!==null||
      !!(fileInput.files&&fileInput.files.length);
    if(!hasSource)return; // pure manual entry stays unaffected
    clearReview();
    form.dataset.ocrReviewPending="true";
    show("原票のファイル選択が中止されました。以前の候補は無効です。原票を再読取するか、入力をクリアして手入力してください。");
  });
  form.addEventListener("reset",function(){clearReview();fileInput.value="";});
  var taxYear=form.elements.namedItem("year");
  taxYear.addEventListener("change",function(){
    // The attestation flag was removed on manual edit, but the older OCR
    // source still exists in memory until clearReview() disposes of it.
    // A year change must not silently turn that situation into manual mode.
    var hadTransferredSource=!!form.dataset.ocrYear||!!transferredSource;
    // No file is present after an aborted picker. Preserve an existing OCR
    // review HOLD even if the original slip was never transferred.
    var wasPending=form.dataset.ocrReviewPending==="true";
    clearReview();
    if(hadTransferredSource||wasPending||
       (fileInput.files&&fileInput.files.length)){
      form.dataset.ocrReviewPending="true";
      show("所得年が変更されました。以前の原票からの読取結果は使えません。新規入力または原票の再確認が必要です。");
    }
  });
  function safeCanvas(source,width,height){
    var factor=Math.min(1,2600/Math.max(width,height));
    var w=Math.max(1,Math.floor(width*factor));
    var h=Math.max(1,Math.floor(height*factor));
    if(w<750||h<400||w*h>10000000)throw Error("IMAGE_RESOLUTION_UNSUPPORTED");
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
      new Uint8Array(headerBytes),file.type,file.size);
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
  async function openPdf(file,isStale,maxPages){
    var pageLimit=maxPages===undefined?1:maxPages;
    if(!Number.isSafeInteger(pageLimit)||pageLimit<1||pageLimit>20)
      throw Error("PDF_PAGE_LIMIT_INVALID");
    var pdfjs=await import("./vendor/pdf.mjs");
    if(isStale())throw Error("OCR_SOURCE_CANCELLED");
    pdfjs.GlobalWorkerOptions.workerSrc="./vendor/pdf.worker.mjs";
    // File.arrayBuffer() itself cannot be interrupted in all browsers.
    // Avoid starting PDF.js after the bytes have arrived if the user has
    // since replaced/cancelled the file or changed the income year.
    var bytes=new Uint8Array(await file.arrayBuffer());
    if(isStale())throw Error("OCR_SOURCE_CANCELLED");
    var task=pdfjs.getDocument({data:bytes,disableAutoFetch:true,disableStream:true,
      isEvalSupported:false,useSystemFonts:false,stopAtErrors:true,
      maxImageSize:MAX_PDF_IMAGE_PIXELS});
    var session={task:task,renderTask:null,stopPromise:null,
      textReader:null,textReaderCancelled:false};
    activePdfSession=session;
    try{
      var document=await task.promise;
      if(isStale())throw Error("OCR_SOURCE_CANCELLED");
      if(document.numPages<1||document.numPages>pageLimit)
        throw Error("PDF_PAGE_COUNT_UNSUPPORTED");
      return {document:document,session:session};
    }catch(error){
      // A cancelled load must release its PDF.js worker even when no
      // document proxy was produced. Preserve the initial failure.
      try{await stopPdfSession(session);}catch(_){}
      if(activePdfSession===session)activePdfSession=null;
      throw error;
    }
  }
  async function digitalPdfText(page,session,isStale){
    if(!window.FurusatoPdfLayout||
       typeof window.FurusatoPdfLayout.boundedTextLayer!=="function")
      throw Error("PDF_TEXT_LAYER_GUARD_MISSING");
    // getTextContent() eagerly collects every PDF text item before our
    // existing boundedTextLayer() can check the 4,000-item/120k-char cap.
    // Stream in chunks and reject excessive text BEFORE allocating a full
    // text-layer array. Keep the same strict final geometry audit.
    if(!page||typeof page.streamTextContent!=="function")
      throw Error("PDF_TEXT_STREAM_UNAVAILABLE");
    var stream=page.streamTextContent();
    if(!stream||typeof stream.getReader!=="function")
      throw Error("PDF_TEXT_STREAM_UNAVAILABLE");
    var reader=stream.getReader(),items=[],chars=0,finished=false;
    session.textReader=reader;
    session.textReaderCancelled=false;
    try{
      while(true){
        if(isStale())throw Error("OCR_SOURCE_CANCELLED");
        var part=await reader.read();
        if(isStale())throw Error("OCR_SOURCE_CANCELLED");
        if(part.done){finished=true;break;}
        if(!part.value||!Array.isArray(part.value.items))
          throw Error("PDF_TEXT_CHUNK_INVALID");
        if(items.length+part.value.items.length>4000)
          throw Error("PDF_TEXT_ITEM_COUNT_INVALID");
        for(const item of part.value.items){
          if(!item||typeof item!=="object")
            throw Error("PDF_TEXT_ITEM_INVALID");
          if(typeof item.str!=="string"){
            if(item.str!==undefined)throw Error("PDF_TEXT_ITEM_INVALID");
            continue; // PDF.js may emit marked-content controls.
          }
          if(item.str.length>240||!Array.isArray(item.transform)||
             item.transform.length!==6||item.transform.some(function(v){
               return typeof v!=="number"||!Number.isFinite(v);
             }))throw Error("PDF_TEXT_ITEM_MALFORMED");
          chars+=item.str.length+1;
          if(chars>120000)throw Error("PDF_TEXT_TOTAL_LIMIT");
        }
        items.push(...part.value.items);
      }
      var checked=window.FurusatoPdfLayout.boundedTextLayer(items);
      if(checked.status!=="OK"&&checked.status!=="EMPTY")
        throw Error("PDF_TEXT_LAYER_HOLD");
      return {text:checked.text,items:checked.items,
        emptyTextLayer:checked.status==="EMPTY"};
    }finally{
      if(!finished&&!session.textReaderCancelled){
        session.textReaderCancelled=true;
        try{await reader.cancel();}catch(_){}
      }
      if(session.textReader===reader)session.textReader=null;
      try{reader.releaseLock();}catch(_){}
    }
  }
  async function rasterizePdf(page,session){
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
      var renderTask=page.render({canvas:canvas,canvasContext:ctx,viewport:view});
      session.renderTask=renderTask;
      try{
        if(session.stopPromise){
          if(typeof renderTask.cancel==="function")renderTask.cancel();
          throw Error("OCR_SOURCE_CANCELLED");
        }
        await renderTask.promise;
      }finally{
        if(session.renderTask===renderTask)session.renderTask=null;
      }
      return canvas;
    }catch(error){
      canvas.width=0;canvas.height=0;
      throw error;
    }
  }
  async function twoPass(image,isStale,allowGridRecovery=false){
    function ensureCurrent(){
      // A stale OCR result is never used. Stop expensive follow-up passes
      // as soon as the current recognition returns control to JavaScript.
      if(typeof isStale==="function"&&isStale())
        throw Error("OCR_SOURCE_CANCELLED");
    }
    if(typeof window.Tesseract==="undefined"||
      typeof window.Tesseract.createWorker!=="function")
      throw Error("端末内OCRエンジンを読み込めません。");
    var original=image,enhanced=null,rectified=null,worker=null,session=null;
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
      session={worker:worker,stopPromise:null};
      activeOcrSession=session;
      ensureCurrent();
      var a=await worker.recognize(original,{}, {text:true,blocks:true});
      ensureCurrent();
      // Request enhanced geometry only if the first read has a strictly
      // bounded, complete table plan. No added OCR pass for unrelated pages.
      var regions=window.FurusatoOcrRegions;
      var firstPlan=regions?.planSeparate?.(a?.data?.blocks,original.width,original.height,
        window.FurusatoSlipReview.reviewText(a?.data?.text));
      var b=firstPlan?.status==="READY"
        ?await worker.recognize(enhanced,{}, {text:true,blocks:true})
        :await worker.recognize(enhanced);
      ensureCurrent();
      // Whole-page OCR confidence includes irrelevant names/addresses.
      // Compare the required tax fields and tax year only, with no
      // identity-field recognition scoring or automatic approval.
      var compared=window.FurusatoSlipReview.compareAttempts(
        a?.data?.text,b?.data?.text);
      // Recover separate label/value rows only with matching complete
      // table geometry and amounts from both passes, then crop rereads.
      // Explicit year/field conflicts never qualify for this route.
      if(!compared.eligibleForManualTransfer&&firstPlan?.status==="READY"){
        const second=regions.planSeparate(b?.data?.blocks,enhanced.width,enhanced.height,
          window.FurusatoSlipReview.reviewText(b?.data?.text));
        const agreed=regions.agreeSeparate(firstPlan,second);
        if(agreed.status!=="READY")return compared;
        const values=[];
        for(const region of agreed.rectangles){
          ensureCurrent();
          const crop=document.createElement("canvas");
          try{
            crop.width=region.width*3;crop.height=region.height*3;
            const ctx=crop.getContext("2d");
            if(!ctx)throw Error("FIELD_REGION_CANVAS_UNAVAILABLE");
            ctx.fillStyle="#fff";ctx.fillRect(0,0,crop.width,crop.height);
            ctx.drawImage(original,region.left,region.top,region.width,region.height,0,0,crop.width,crop.height);
            const rec=await worker.recognize(crop);
            ensureCurrent();
            values.push({key:region.key,text:rec?.data?.text,confidence:rec?.data?.confidence});
          }finally{crop.width=0;crop.height=0;}
        }
        const checked=regions.assessSeparate(values,agreed);
        return checked.eligibleForManualTransfer===true?checked:compared;
      }
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
      // Geometry is diagnostic unless all exact heading/label/amount
      // evidence agrees. No recovery over a partial digital text layer.
      if(!compared.eligibleForManualTransfer&&regions?.planGridCanvas){
        const grid=regions.planGridCanvas(original);
        if(grid.layoutLocated===true){
          compared.gridLayoutLocated=true;
          // Last, bounded crop stage. The worker is terminated in
          // finally; these parameters cannot affect later whole-page reads.
          if(grid.rectangles?.length===4&&typeof worker.setParameters==="function"&&regions.assessGridDigits&&regions.gridReadVariant&&regions.gridCropSize){
            const digitReads=[];
            try{
              ensureCurrent();
              await worker.setParameters({tessedit_pageseg_mode:"7",tessedit_char_whitelist:"0123456789,"});
              for(const pass of [0,1]){
                const values=[];
                for(const region of grid.rectangles){
                  ensureCurrent();
                  const variant=regions.gridReadVariant(region.key,pass);
                  if(!variant)throw Error("FIELD_REGION_VARIANT_UNAVAILABLE");
                  const source=variant.source==="original"?original:enhanced;
                  const crop=document.createElement("canvas");
                  try{
                    const size=regions.gridCropSize(region,grid.gridSpan,"digit",variant.scale);
                    if(!size)throw Error("GRID_CROP_SIZE_UNVERIFIED");
                    const {border,width,height}=size;
                    crop.width=width+border*2;crop.height=height+border*2;
                    const ctx=crop.getContext("2d");
                    if(!ctx)throw Error("FIELD_REGION_CANVAS_UNAVAILABLE");
                    ctx.fillStyle="#fff";ctx.fillRect(0,0,crop.width,crop.height);
                    ctx.drawImage(source,region.left,region.top,region.width,region.height,border,border,width,height);
                    const rec=await worker.recognize(crop);
                    ensureCurrent();
                    values.push({key:region.key,text:rec?.data?.text});
                  }finally{crop.width=0;crop.height=0;}
                }
                digitReads.push(values);
              }
              const check=regions.assessGridDigits(digitReads[0],digitReads[1]);
              if(check.status==="DIAGNOSTIC_ONLY")compared.gridDigitsMatched=check.matchedFields;
            }catch(_){ensureCurrent();/* preserve HOLD even on diagnostic failure */}
            if(grid.headerRectangles?.length===3&&regions.assessGridHeader){
              try{
                ensureCurrent();
                // RAW_LINE for the title; SINGLE_LINE for both year
                // samplings and subsequent field labels. Fixed settings.
                await worker.setParameters({tessedit_pageseg_mode:"13",tessedit_char_whitelist:""});
                const reads=[];
                for(const region of grid.headerRectangles){
                  ensureCurrent();
                  if(region.key==="year")await worker.setParameters({tessedit_pageseg_mode:"7",tessedit_char_whitelist:""});
                  ensureCurrent();
                  const crop=document.createElement("canvas");
                  try{
                    const size=regions.gridCropSize(region,grid.gridSpan,"header",region.scale);
                    if(!size)throw Error("GRID_CROP_SIZE_UNVERIFIED");
                    const {border,width,height}=size;
                    crop.width=width+border*2;crop.height=height+border*2;
                    const ctx=crop.getContext("2d");
                    if(!ctx)throw Error("HEADER_REGION_CANVAS_UNAVAILABLE");
                    ctx.fillStyle="#fff";ctx.fillRect(0,0,crop.width,crop.height);
                    ctx.drawImage(original,region.left,region.top,region.width,region.height,border,border,width,height);
                    const rec=await worker.recognize(crop);
                    ensureCurrent();
                    reads.push({key:region.key,text:rec?.data?.text});
                  }finally{crop.width=0;crop.height=0;}
                }
                const fullPageReviews=[
                  window.FurusatoSlipReview.reviewText(a?.data?.text,true),
                  window.FurusatoSlipReview.reviewText(b?.data?.text,true)];
                const header=regions.assessGridHeader(reads,fullPageReviews);
                compared.gridHeaderStatus=header.status;
                if(allowGridRecovery&&header.status==="MATCH"&&[3,4].includes(compared.gridDigitsMatched)&&
                   grid.labelRectangles?.length===4&&regions.assessGridRecovery){
                  const labels=[];
                  for(const region of grid.labelRectangles){
                    ensureCurrent();
                    const crop=document.createElement("canvas");
                    try{
                      const size=regions.gridCropSize(region,grid.gridSpan,"label",region.scale);
                      if(!size)throw Error("GRID_CROP_SIZE_UNVERIFIED");
                      const {border,width,height}=size;
                      crop.width=width+border*2;crop.height=height+border*2;
                      const ctx=crop.getContext("2d");
                      if(!ctx)throw Error("LABEL_REGION_CANVAS_UNAVAILABLE");
                      ctx.fillStyle="#fff";ctx.fillRect(0,0,crop.width,crop.height);
                      ctx.drawImage(original,region.left,region.top,region.width,region.height,border,border,width,height);
                      const rec=await worker.recognize(crop);
                      ensureCurrent();
                      labels.push({key:region.key,text:rec?.data?.text});
                    }finally{crop.width=0;crop.height=0;}
                  }
                  const recovery=regions.assessGridRecovery(grid,reads,labels,digitReads[0],digitReads[1],fullPageReviews);
                  if(recovery.eligibleForManualTransfer===true||window.FurusatoPdfGCodes?.canConfirmSocialZero(recovery))return recovery;
                  compared.reasons=[...(compared.reasons||[]),...recovery.reasons];
                }
              }catch(_){ensureCurrent();/* diagnostic only */}
            }
          }
        }
      }
      return compared;
    }finally{
      // Termination can itself reject, e.g. a worker process crash. Never
      // skip release of large intermediate canvases in that case.
      try{
        if(session){
          if(activeOcrSession===session)activeOcrSession=null;
          await stopOcrSession(session);
        }
      }finally{
        if(enhanced){enhanced.width=0;enhanced.height=0;}
        if(rectified){rectified.width=0;rectified.height=0;}
      }
    }
  }
  // Shared PDF page reader for the legacy single-slip screen and
  // page-by-page batch screening. Never assumes consecutive pages are the
  // same taxpayer; each page is isolated and must be reviewed independently.
  async function analyzePdfPage(page,pdfSession,isStale,includeRecipient){
    var canvas=null,result;
    function ensureCurrent(){
      if(isStale())throw Error("OCR_SOURCE_CANCELLED");
    }
    try{
          var extracted=await digitalPdfText(page,pdfSession,isStale);
          ensureCurrent();
          if(extracted.emptyTextLayer){
            // No PDF text operators: scanned image-only single-page PDF.
            // This is the only fallback for EMPTY, not for malformed layers.
            canvas=await rasterizePdf(page,pdfSession);
            ensureCurrent();
            result=await twoPass(canvas,isStale,true);
          }else{
          var digital=window.FurusatoSlipReview.reviewDigitalPdf(extracted.text);
          if(typeof window.FurusatoPdfLayout!=="object"||
             typeof window.FurusatoPdfLayout.audit!=="function"||
             typeof window.FurusatoPdfLayout.extract!=="function")
            throw Error("PDF_POSITION_AUDIT_MISSING");
          var positioned=window.FurusatoPdfLayout.extract(extracted.items);
          var coded=window.FurusatoPdfGCodes &&
            typeof window.FurusatoPdfGCodes.review==="function"
            ?window.FurusatoPdfGCodes.review(extracted.items):null;
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
          const codedTaxFields=coded&&[2025,2026].includes(coded.year)&&
            !digital.yearConflict&&!digital.yearUnsupported&&!digital.documentTypeConflict&&
            (positioned.year===null||positioned.year===coded.year)&&
            !(digital.reasons||[]).some(r=>/^FIELD_(?:CONFLICT|DUPLICATE)_/.test(r))&&
            (positioned.reasons||[]).every(r=>
              /^LAYOUT_AMBIGUOUS_AMOUNT_/.test(r))&&
            Object.entries(coded.candidates||{}).every(([key,val])=>
              digital.candidates?.[key]===undefined||
              digital.candidates[key]===val);
          if(codedTaxFields){
            // A rigorously anchored L01+G-code slip can be parsed even when
            // PDF.js emits each yen digit separately and label-based parsing
            // (correctly) flags those groups as ambiguous. The G-code
            // numbers stay review-only. Missing social insurance stays HOLD.
            result=coded;
          }else if(positioned.positionStatus==="CONFLICT"||
             hardTextFailure||digital.yearConflict===true||digital.yearUnsupported===true||digital.documentTypeConflict===true||
             conflictingYears||crossCheck.status==="CONFLICT"){
            result={
              schema:"furusato-slip-pdf-cross-check/v1",
              status:"REQUIRES_SOURCE_REVIEW",year:null,candidates:{},
              reasons:positioned.positionStatus==="CONFLICT"
                ?positioned.reasons:digital.yearConflict===true
                  ?["PDF_EXPLICIT_YEAR_CONFLICT"]:digital.yearUnsupported===true
                    ?["PDF_EXPLICIT_YEAR_UNSUPPORTED"]:digital.documentTypeConflict===true
                    ?["PDF_DOCUMENT_TYPE_CONFLICT"]:crossCheck.status==="CONFLICT"
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
            canvas=await rasterizePdf(page,pdfSession);
            ensureCurrent();
            result=await twoPass(canvas,isStale);
          }
          }
      // Propagate source-detected deductions through every PDF extraction
      // route, including layout and OCR fallbacks; manual correction must
      // not silently erase a positive finding.
      if(coded&&coded.sourceIndicators&&Object.keys(coded.sourceIndicators).length)
        result.sourceIndicators=Object.assign({},coded.sourceIndicators);
      // Only copy optional numeric candidates when the independently read
      // source year and all four required amounts match the selected route.
      if(window.FurusatoPdfGCodes?.verifiedOptional){
        const optional=window.FurusatoPdfGCodes.verifiedOptional(coded,result);
        result.optionalCandidates=optional;
        result.r8VerifiedLayout=coded?.r8VerifiedLayout===true&&result.year===2026&&Object.keys(optional).some(k=>["sourceInsurance_generalNew","sourceInsurance_generalOld","sourceInsurance_medicalNew","mortgageSourcePossible","mortgageMoveInYear","familySpecialRelativeCount"].includes(k));
      }
      if(includeRecipient&&extracted&&!extracted.emptyTextLayer&&
         window.FurusatoBatchName&&
         typeof window.FurusatoBatchName.extract==="function"){
        const recipient=window.FurusatoBatchName.extract(extracted.items);
        if(recipient)result.recipientName=recipient;
      }
      return result;
    }finally{
      if(canvas){canvas.width=0;canvas.height=0;}
      if(page&&typeof page.cleanup==="function"){
        try{page.cleanup();}catch(_){}
      }
    }
  }
  // The batch UI only receives vetted year/four-value candidates, never
  // OCR text, page raster, PDF bytes, identity/address or employer fields.
  window.FurusatoBatchPdf=Object.freeze({
    maxBytes:MAX_BYTES,
    maxPages:20,
    async open(file,isStale){return openPdf(file,isStale,20);},
    async readPage(pdf,session,pageNo,isStale){
      if(isStale())throw Error("OCR_SOURCE_CANCELLED");
      var page=await pdf.getPage(pageNo);
      if(isStale())throw Error("OCR_SOURCE_CANCELLED");
      return analyzePdfPage(page,session,isStale,true);
    },
    async close(session){
      if(!session)return;
      try{await stopPdfSession(session);}finally{
        if(activePdfSession===session)activePdfSession=null;
      }
    },
    cancel(){cancelActiveOcr();cancelActivePdf();},
    isSingleBusy(){return busy;},
    beginBatch(){
      if(busy||batchBusy)return false;
      batchBusy=true;runButton.disabled=true;return true;
    },
    endBatch(){
      batchBusy=false;runButton.disabled=busy;
    }
  });
  function isAllowedReferenceYear(referenceYear){
    var selected=Number(taxYear.value);
    return [2025,2026].includes(referenceYear)&&
      [2025,2026].includes(selected)&&
      (referenceYear===selected||referenceYear===selected-1);
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
      if(r.gridLayoutLocated===true){
        const note=document.createElement("p");
        note.textContent="一部の罫線配置は一致しましたが、年分・項目名・金額の確認ができないため転記しません。原票を見て手入力するか、電子PDFを指定してください。";
        report.appendChild(note);
        if(Number.isInteger(r.gridDigitsMatched)&&r.gridDigitsMatched>=0&&r.gridDigitsMatched<=4){
          const count=document.createElement("p");
          count.textContent="金額欄の数字再読取：4欄中"+r.gridDigitsMatched+"欄で2回の認識結果が一致（原票との一致や精度は未確認・転記不可）。";
          report.appendChild(count);
        }
        if(["MATCH","CONFLICT","UNVERIFIED"].includes(r.gridHeaderStatus)){
          const heading=document.createElement("p");
          heading.textContent=r.gridHeaderStatus==="MATCH"?
            "表題・所得年の部分読取：一致（原票照合前・転記不可）。":
            r.gridHeaderStatus==="CONFLICT"?"表題・所得年の部分読取：年分の不一致または対応外年分（転記不可）。":
            "表題・所得年の部分読取：確認できませんでした（転記不可）。";
          report.appendChild(heading);
        }
      }
      if(window.FurusatoPdfGCodes?.canConfirmSocialZero(r)&&isAllowedReferenceYear(r.year)){
        const partial=document.createElement("ul");
        for(const field of window.FurusatoSlipReview.FIELDS){
          const li=document.createElement("li");
          li.textContent=field.label+"："+(field.key==="socialInsurance"?"未取得（0円未確定）":r.candidates[field.key].toLocaleString("ja-JP")+"円");
          partial.appendChild(li);
        }
        report.appendChild(partial);
        const year=document.createElement("p");year.textContent="所得年："+r.year+"年（原票照合前）";report.appendChild(year);
        const note=document.createElement("p");note.textContent="社会保険料等の欄のみ未取得です。原票を見て本当に空欄（控除対象額なし）であることを確認した場合だけ、次のボタンを押してください。金額が記載されている場合は使用しないでください。";report.appendChild(note);
        const button=document.createElement("button");button.type="button";button.className="secondary";button.id="slipConfirmSocialZero";button.textContent="原票が空欄であることを確認し、0円を設定";
        button.addEventListener("click",function(){
          if(busy||review!==r||reviewGeneration!==generation||reviewManualRevision!==manualRevision||reviewFile!==(fileInput.files&&fileInput.files[0])||reviewYear!==Number(taxYear.value)||!isAllowedReferenceYear(r.year))return;
          const completed=window.FurusatoPdfGCodes.confirmSocialZero(r);if(!completed)return;
          review=completed;displayReview(completed);
        });report.appendChild(button);
      }
      return;
    }
    if(r.schema==="furusato-slip-grid-review/v1"){
      const note=document.createElement("p");
      note.textContent="画像の部分読取による候補です。追加控除・扶養等は未読取です。原票の年分・4項目・その他の控除を必ず確認してください。";
      report.appendChild(note);
    }
    var ul=document.createElement("ul");
    r._acceptedCandidate=false;
    window.FurusatoSlipReview.FIELDS.forEach(function(field){
      var li=document.createElement("li");
      li.textContent=field.label+"："+r.candidates[field.key].toLocaleString("ja-JP")+"円";
      ul.appendChild(li);
    });
    const countLabels={"familySpecificCount":"特定扶養親族","familyElderlyCount":"老人扶養親族","familyOtherCount":"その他の控除対象扶養親族","familySpecialRelativeCount":"特定親族","familyUnder16Count":"16歳未満の扶養親族"};
    const optionalLabels={...countLabels,sourceSpouseIncome:"配偶者の合計所得（G43）",mortgageMoveInYear:"居住開始年（西暦）",mortgageSourceApplied:"住宅借入金等特別控除額（G29）",sourceBasicYen:"基礎控除額（G46）",sourceAdjustmentYen:"所得金額調整控除額（G47）",mortgageSourcePossible:"住宅借入金等特別控除可能額（G36）",sourceInsurance_generalNew:"新生命保険料（G30）",sourceInsurance_generalOld:"旧生命保険料（G31）",sourceInsurance_medicalNew:"介護医療保険料（G32）",sourceInsurance_pensionNew:"新個人年金保険料（G33）",sourceInsurance_pensionOld:"旧個人年金保険料（G34）",sourceInsurance_longTermOld:"旧長期損害保険料（G45）"};
    for(const [key,label] of Object.entries(optionalLabels)){
      const n=r.optionalCandidates?.[key];
      if(Number.isSafeInteger(n)&&n>=0){
        const li=document.createElement("li");li.textContent=label+"："+(Object.prototype.hasOwnProperty.call(countLabels,key)?String(n)+"人":key==="mortgageMoveInYear"?String(n)+"年":n.toLocaleString("ja-JP")+"円")+"（原票照合候補）";ul.appendChild(li);
      }
    }
    report.appendChild(ul);
    if(r.socialZeroManuallyConfirmed===true){const note=document.createElement("p");note.textContent="社会保険料等：原票空欄を手動確認して0円設定（自動読取ではありません）。";report.appendChild(note);}
    var y=document.createElement("p");
    y.textContent="所得年："+r.year+"年（申告年分と一致することを確認）";
    report.appendChild(y);
    if(!isAllowedReferenceYear(r.year)){
      var mismatch=document.createElement("p");
      mismatch.textContent="参照源泉票は、選択した試算対象年と同じ年か前年に限ります。";
      report.appendChild(mismatch);
      return;
    }
    if(r.year!==Number(taxYear.value)){
      var note=document.createElement("p");
      note.textContent=r.year+"年分は"+taxYear.value+"年の参考資料です。転記後に当年の見込額へ修正し、別途確認チェックを行ってください。";
      report.appendChild(note);
    }
    acceptCheck.disabled=false;
    acceptButton.disabled=false;
  }
  runButton.addEventListener("click",async function(){
    if(busy||batchBusy)return;
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
      blocked("JPEG・PNG・単純な静止WebP・1ページPDF（8MB以下）を1件だけ指定してください。HEIC・拡張WebPは未対応です。");
      return;
    }
    busy=true;runButton.disabled=true;acceptButton.disabled=true;
    var requestedGeneration=generation,requestedYear=Number(taxYear.value);
    var requestedManualRevision=manualRevision;
    var canvas=null,pdf=null,pdfSession=null,stage="SOURCE_PREPARE";
    function isStale(){
      return generation!==requestedGeneration||
        manualRevision!==requestedManualRevision||
        (fileInput.files&&fileInput.files[0])!==file||
        Number(taxYear.value)!==requestedYear;
    }
    function ensureCurrent(){
      if(isStale())throw Error("OCR_SOURCE_CANCELLED");
    }
    try{
      var result;
      if(file.type==="application/pdf"){
        stage="PDF_OPEN";var opened=await openPdf(file,isStale);
        pdf=opened.document;pdfSession=opened.session;
        ensureCurrent();
        stage="PDF_PAGE";var page=await pdf.getPage(1);
        ensureCurrent();
        stage="PDF_PAGE_READ";
        result=await analyzePdfPage(page,pdfSession,isStale);
      }else{
        stage="IMAGE_DECODE";canvas=await imageToCanvas(file);
        ensureCurrent();
        stage="IMAGE_OCR";result=await twoPass(canvas,isStale,true);
      }
      // A source swap, form reset or year change during async OCR invalidates
      // the old attempt, even if the two text recognitions both succeeded.
      if(isStale())return;
      review=result;reviewFile=file;reviewYear=requestedYear;
      reviewGeneration=requestedGeneration;
      reviewManualRevision=requestedManualRevision;
      displayReview(result);
    }catch(error){
      if(!isStale()){
        if(error?.message==="IMAGE_RESOLUTION_UNSUPPORTED")
          blocked("OCRを完了できませんでした。画像の解像度が不足しています。画像処理後の横幅750・高さ400ピクセル以上が必要です。拡大コピーではなく鮮明な原本を再撮影するか、電子PDF・手入力をご利用ください。入力原票は送信されません。");
        else blocked("OCRを完了できませんでした（処理区分："+stage+"）。入力原票は送信されません。画質・ページ構成を確認し、必要なら撮影し直すか手入力してください。");
      }
    }finally{
      // Keep the scan button unavailable until ALL cleanup completes.
      // Re-enabling before PDF.js worker termination permits overlapping
      // decode/worker heaps on repeated clicks, especially on mobile.
      try{
        if(canvas){canvas.width=0;canvas.height=0;}
        if(pdfSession){
          try{await stopPdfSession(pdfSession);}catch(_){
            // A crashed PDF worker must not trap the UI in a busy state.
          }
          if(activePdfSession===pdfSession)activePdfSession=null;
        }
      }finally{
        busy=false;runButton.disabled=false;
      }
    }
  });
  acceptCheck.addEventListener("change",function(){
    if(acceptCheck.disabled||!review?.eligibleForManualTransfer||
       reviewGeneration!==generation||
       reviewManualRevision!==manualRevision||
       reviewYear!==Number(taxYear.value)||
       !isAllowedReferenceYear(review.year))acceptCheck.checked=false;
  });
  acceptButton.addEventListener("click",function(){
    if(!review?.eligibleForManualTransfer||acceptCheck.disabled||
      !acceptCheck.checked||
      reviewGeneration!==generation||
      reviewManualRevision!==manualRevision||
      reviewFile!==(fileInput.files&&fileInput.files[0])||
      reviewYear!==Number(taxYear.value)||
      !isAllowedReferenceYear(review.year)){
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
    var forecast=form.elements.namedItem("forecastReviewed");
    if(forecast)forecast.checked=false;
    form.dataset.ocrYear=String(review.year);
    // The three arithmetic source values remain solely in this browser's
    // DOM, never in logs/network or the exported result. They are stable
    // audit evidence after the user changes forecast figures.
    form.dispatchEvent(new Event("family-source-reset"));
    // Prefill reviewed candidates only. Do not infer missing values as zero
    // or check a review checkbox; original and target conditions still need confirmation.
    const high=review.candidates.salaryGross>8500000;
    for(const [key,name,max,active] of [
      ["sourceSpouseIncome","sourceSpouseIncome",1330000,review.year===2025&&review.sourceIndicators?.hasSpouse===true&&review.optionalCandidates?.sourceSpouseIncome>0],
      ["mortgageSourceApplied","mortgageSourceApplied",600000,review.sourceIndicators?.hasMortgage===true],
      ["sourceBasicYen","sourceAdjustment_basic",1040000,high],
      ["sourceAdjustmentYen","sourceAdjustment_amount",150000,high],
      ["mortgageSourcePossible","mortgageSourcePossible",600000,(review.year===2025||(review.year===2026&&review.r8VerifiedLayout===true))&&review.sourceIndicators?.hasMortgage===true],
      ["mortgageMoveInYear","mortgageMoveInYear",review.year,(review.year===2025||(review.year===2026&&review.r8VerifiedLayout===true))&&review.sourceIndicators?.hasMortgage===true&&!review.sourceIndicators?.hasNonstandardConditions&&review.optionalCandidates?.mortgageMoveInYear>=2014],
      ...["generalNew","generalOld","medicalNew","pensionNew","pensionOld","longTermOld"].map(k=>["sourceInsurance_"+k,"sourceInsurance_"+k,100000000,(review.year===2025||(review.year===2026&&review.r8VerifiedLayout===true&&["generalNew","generalOld","medicalNew"].includes(k)))&&review.sourceIndicators?.[k==="longTermOld"?"hasEarthquakeInsurance":"hasLifeInsurance"]===true])]){
      const n=review.optionalCandidates?.[key],field=form.elements.namedItem(name);
      if(active&&field&&Number.isSafeInteger(n)&&n>=0&&n<=max)field.value=String(n);
    }
    if(review.year===2025&&review.sourceIndicators?.hasSpouse===true&&Number.isSafeInteger(review.optionalCandidates?.sourceSpouseIncome)&&review.optionalCandidates.sourceSpouseIncome>0&&review.optionalCandidates.sourceSpouseIncome<=1330000)form.dataset.ocrSpouseIncome=String(review.optionalCandidates.sourceSpouseIncome);
    const familyCountHints=Object.fromEntries(["familySpecificCount","familyElderlyCount","familyOtherCount","familySpecialRelativeCount","familyUnder16Count"].filter(k=>(review.year===2025||(review.year===2026&&review.r8VerifiedLayout===true&&k==="familySpecialRelativeCount"))&&review.sourceIndicators?.hasDependents===true&&Number.isSafeInteger(review.optionalCandidates?.[k])&&review.optionalCandidates[k]>0&&review.optionalCandidates[k]<=30).map(k=>[k,review.optionalCandidates[k]]));
    if(Object.keys(familyCountHints).length)form.dataset.ocrFamilyCountHints=JSON.stringify(familyCountHints);
    form.dataset.ocrOriginalGross=String(review.candidates.salaryGross);
    form.dataset.ocrOriginalIncome=String(review.candidates.salaryIncomeReference);
    form.dataset.ocrOriginalSocial=String(review.candidates.socialInsurance);
    form.dataset.ocrOriginalDeductions=String(review.candidates.deductionsReference);
    form.dataset.ocrSourceIndicators=
      Object.keys(review.sourceIndicators||{}).join(",");
    form.dataset.ocrReviewPending="false";
    delete form.dataset.ocrManualReviewRequired;
    form.dispatchEvent(new Event("ocr-source-transferred"));
    var manualCheck=form.elements.namedItem("correctedSourceReviewed");
    if(manualCheck)manualCheck.checked=false;
    review=null;acceptCheck.checked=false;acceptCheck.disabled=true;
    acceptButton.disabled=true;
    fileInput.value="";
    show("原票確認済みの数値候補を転記しました。控除・扶養などの確認項目を入力してから試算してください。");
  });
}());