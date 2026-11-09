"use strict";
/**
 * Cheap camera scan triage. This does NOT estimate OCR correctness.
 * Read a downscaled pixel sample locally; never return/save raw pixels.
 * HOLD only for clearly unusable/empty/dark frames.
 */
(function(root,factory){
  var instance=factory();
  if(typeof module==="object"&&module.exports)module.exports=instance;
  else root.FurusatoImageQuality=instance;
}(typeof window!=="undefined"?window:this,function(){
  "use strict";
  var SAMPLE_SIDE=256;
  function analyzePixels(width,height,rgba){
    if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||
       width<=0||height<=0||!rgba||rgba.length!==width*height*4)
      return {status:"HOLD",reasons:["IMAGE_PIXELS_INVALID"]};
    var count=width*height, sum=0, minimum=255,maximum=0;
    var dark=0,veryLight=0,transparency=0, gradient=0,edges=0;
    var previous=new Uint8Array(width);
    for(var y=0;y<height;y++){
      var left=0;
      for(var x=0;x<width;x++){
        var i=(y*width+x)*4;
        var a=rgba[i+3];
        if(a!==255)transparency++;
        var grey=Math.max(0,Math.min(255,Math.round(
          (rgba[i]*299+rgba[i+1]*587+rgba[i+2]*114)/1000)));
        minimum=Math.min(minimum,grey);maximum=Math.max(maximum,grey);
        sum+=grey;if(grey<145)dark++;if(grey>235)veryLight++;
        if(x>0){gradient+=Math.abs(grey-left);edges++;}
        if(y>0){gradient+=Math.abs(grey-previous[x]);edges++;}
        left=grey;previous[x]=grey;
      }
    }
    var mean=sum/count;
    var spread=maximum-minimum;
    var lowInk=dark/count<0.0003;
    var reasons=[];
    if(transparency/count>0.01)reasons.push("IMAGE_ALPHA_UNSUPPORTED");
    if(mean<35)reasons.push("IMAGE_TOO_DARK");
    if(spread<35||lowInk)reasons.push("IMAGE_BLANK_OR_LOW_CONTRAST");
    var warnings=[];
    if(mean<100||mean>248)warnings.push("IMAGE_EXPOSURE_REVIEW");
    if(edges&&gradient/edges<2)warnings.push("IMAGE_SHARPNESS_REVIEW");
    return {
      status:reasons.length?"HOLD":"REVIEW",
      reasons:reasons,warnings:warnings,
      // Deliberately no image, text, source name, pixel histogram or amount.
      sourcePixelsPersisted:false,accuracyCertified:false
    };
  }
  function assessCanvas(canvas){
    if(!canvas||!Number.isSafeInteger(canvas.width)||
       !Number.isSafeInteger(canvas.height)||
       canvas.width<750||canvas.height<400||
       canvas.width*canvas.height>10000000)
      return {status:"HOLD",reasons:["IMAGE_DIMENSIONS_UNVERIFIED"]};
    var sample=document.createElement("canvas");
    sample.width=Math.max(1,Math.round(SAMPLE_SIDE*canvas.width/
      Math.max(canvas.width,canvas.height)));
    sample.height=Math.max(1,Math.round(SAMPLE_SIDE*canvas.height/
      Math.max(canvas.width,canvas.height)));
    try{
      var ctx=sample.getContext("2d",{willReadFrequently:true});
      if(!ctx)return {status:"HOLD",reasons:["IMAGE_SAMPLE_UNAVAILABLE"]};
      ctx.drawImage(canvas,0,0,sample.width,sample.height);
      var pixels=ctx.getImageData(0,0,sample.width,sample.height);
      return analyzePixels(sample.width,sample.height,pixels.data);
    }catch(_){
      return {status:"HOLD",reasons:["IMAGE_SAMPLE_UNAVAILABLE"]};
    }finally{
      sample.width=0;sample.height=0;
    }
  }
  return {analyzePixels:analyzePixels,assessCanvas:assessCanvas};
}));