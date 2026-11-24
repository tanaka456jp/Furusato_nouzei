"use strict";
/* JPEG/PNG/simple WebP bounded metadata preflight. No source images are persisted. */
(function(root,factory){
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 else root.FurusatoImageHeader=api;
}(typeof window!=="undefined"?window:this,function(){
 "use strict";
 // Source image decode happens before downscaling. A compressed 48MP
 // image can allocate ~200MB for RGBA, risking mobile tab eviction.
 // Allow typical 12/24MP photos; require larger sources to be resized.
 const MAX_HEADER_BYTES=192*1024,MAX_PIXELS=25000000,MAX_EDGE=16000;
 function hold(reason){return {status:"HOLD",width:null,height:null,reasons:[reason]};}
 function checkDimensions(w,h){
  if(!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||w<1||h<1||
     w>MAX_EDGE||h>MAX_EDGE||w*h>MAX_PIXELS)
   return hold("IMAGE_DECODED_DIMENSIONS_UNSAFE");
  return {status:"ACCEPT",width:w,height:h,reasons:[]};
 }
 // Deliberately support only a simple RIFF with exactly one VP8 or
 // VP8L image chunk. Extended VP8X, animation, alpha/EXIF metadata
 // chunks and trailing bytes are not accepted by this initial route.
 function inspectWebP(data,fileSize){
  const tag=(at,s)=>[...s].every((c,i)=>data[at+i]===c.charCodeAt(0));
  const u32=at=>data[at]+data[at+1]*256+data[at+2]*65536+data[at+3]*16777216;
  if(data.length<25||!tag(0,"RIFF")||!tag(8,"WEBP")||
     !Number.isSafeInteger(fileSize)||fileSize<25||fileSize>8*1024*1024||
     data.length!==Math.min(fileSize,MAX_HEADER_BYTES)||u32(4)+8!==fileSize)
   return hold("WEBP_RIFF_INVALID");
  const n=u32(16);
  if(n<5||20+n+(n%2)!==fileSize)return hold("WEBP_SINGLE_CHUNK_REQUIRED");
  if(tag(12,"VP8 ")){
   if(n<10||data.length<30||(data[20]&1)!==0||
      ![157,1,42].every((v,i)=>data[23+i]===v))
    return hold("WEBP_VP8_FRAME_INVALID");
   return checkDimensions((data[26]+data[27]*256)&16383,(data[28]+data[29]*256)&16383);
  }
  if(tag(12,"VP8L")){
   if(data[20]!==47||(data[24]>>5)!==0)return hold("WEBP_VP8L_FRAME_INVALID");
   const bits=u32(21);
   return checkDimensions((bits&16383)+1,((bits>>>14)&16383)+1);
  }
  return hold("WEBP_EXTENDED_OR_ANIMATED_UNSUPPORTED");
 }
 function inspect(data,mime,fileSize){
  if(!(data instanceof Uint8Array)||data.length===0||
     data.length>MAX_HEADER_BYTES)return hold("IMAGE_HEADER_UNAVAILABLE");
  if(mime==="image/webp")return inspectWebP(data,fileSize);
  if(mime==="image/png"){
   const sig=[137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82];
   if(data.length<24||sig.some((x,i)=>data[i]!==x))
    return hold("PNG_IHDR_INVALID");
   const u32=n=>data[n]*16777216+data[n+1]*65536+
     data[n+2]*256+data[n+3];
   return checkDimensions(u32(16),u32(20));
  }
  if(mime==="image/jpeg"){
   if(data.length<6||data[0]!==255||data[1]!==216)
    return hold("JPEG_SIGNATURE_INVALID");
   let pos=2,count=0,result=null;
   while(pos<data.length){
    if(data[pos]!==255)return hold("JPEG_MARKER_INVALID");
    while(pos<data.length&&data[pos]===255)pos++;
    if(pos>=data.length)return hold("JPEG_MARKER_TRUNCATED");
    const marker=data[pos++];
    if(marker===0xD9||marker===0xDA)break;
    if(marker===0x01||(marker>=0xD0&&marker<=0xD8))continue;
    if(pos+2>data.length)return hold("JPEG_SEGMENT_TRUNCATED");
    const length=data[pos]*256+data[pos+1];
    if(length<2||pos+length>data.length)
     return hold("JPEG_SEGMENT_TRUNCATED");
    if(marker>=0xC0&&marker<=0xCF&&
       ![0xC4,0xC8,0xCC].includes(marker)){
     if(length<7)return hold("JPEG_FRAME_INVALID");
     count++;
     result=checkDimensions(data[pos+5]*256+data[pos+6],
       data[pos+3]*256+data[pos+4]);
    }
    pos+=length;
   }
   return count===1?result:hold("JPEG_FRAME_NOT_UNIQUE");
  }
  return hold("IMAGE_MEDIA_TYPE_NOT_SUPPORTED");
 }
 // Ensure browser decoded bitmap dimensions match the compressed header.
 // EXIF quarter-turn may swap the two dimensions, but may not alter area.
 function verifyDecodedSize(preflight,width,height){
  if(!preflight||preflight.status!=="ACCEPT")
   return hold("IMAGE_PREFLIGHT_MISSING");
  const decoded=checkDimensions(width,height);
  if(decoded.status!=="ACCEPT")return decoded;
  if(!((width===preflight.width&&height===preflight.height)||
       (width===preflight.height&&height===preflight.width)))
   return hold("IMAGE_DECODED_HEADER_DIMENSION_MISMATCH");
  return decoded;
 }
 return Object.freeze({inspect,verifyDecodedSize,MAX_HEADER_BYTES,MAX_PIXELS,MAX_EDGE});
}));