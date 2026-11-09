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
  var MAX_BYTES=8*1024*1024;
  var ACCEPTED={"image/jpeg":true,"image/png":true,"application/pdf":true};
  function show(message){
    report.replaceChildren();
    var line=document.createElement("p");
    line.textContent=message;
    report.appendChild(line);
    report.hidden=false;
  }
  function blocked(message){
    review=null;acceptCheck.checked=false;acceptButton.disabled=true;
    show(message);
  }
  function clearReview(){
    review=null;acceptCheck.checked=false;acceptButton.disabled=true;
    report.replaceChildren();report.hidden=true;
    delete form.dataset.ocrYear;
    delete form.dataset.ocrReviewPending;
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
    return content.items.map(function(item){
      return String(item.str||"")+(item.hasEOL?"\n":" ");
    }).join("");
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
    var original=image,enhanced=null,worker=null;
    try{
      enhanced=contrastVariant(image);
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
    var canvas=null,pdf=null;
    try{
      var result;
      if(file.type==="application/pdf"){
        pdf=await openPdf(file);
        var page=await pdf.getPage(1);
        var text=await digitalPdfText(page);
        var digital=window.FurusatoSlipReview.reviewDigitalPdf(text);
        if(digital.eligibleForManualTransfer)result=digital;
        else if((digital.reasons||[]).some(function(reason){return reason.startsWith("FIELD_CONFLICT_");})){
          result=digital;
        }else{
          canvas=await rasterizePdf(page);
          result=await twoPass(canvas);
        }
      }else{
        canvas=await imageToCanvas(file);
        result=await twoPass(canvas);
      }
      review=result;
      displayReview(result);
    }catch(error){
      blocked("OCRを完了できませんでした。入力原票は送信されません。個人情報の誤読を避けるため手入力に切り替えてください。");
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
      Number(form.elements.namedItem("year").value)!==review.year){
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