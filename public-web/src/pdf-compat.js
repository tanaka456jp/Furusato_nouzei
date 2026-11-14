"use strict";
/*
 * Local compatibility shim for PDF.js 6.3.289 on older browsers such as
 * Chromium 141. The PDF engine uses ES2026 Map upsert methods during render.
 * This file installs no network, storage, logging or PDF parsing behavior.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 else{
  api.install(root.Map);
  api.installReadableStream(root.ReadableStream);
  root.FurusatoPdfCompatibility=api;
 }
}(typeof window!=="undefined"?window:globalThis,function(){
 "use strict";
 function install(MapConstructor){
  if(typeof MapConstructor!=="function"||!MapConstructor.prototype||
     typeof MapConstructor.prototype.has!=="function"||
     typeof MapConstructor.prototype.get!=="function"||
     typeof MapConstructor.prototype.set!=="function")
   throw Error("PDF_COMPAT_MAP_UNAVAILABLE");
  const p=MapConstructor.prototype;
  if(typeof p.getOrInsert!=="function"){
   Object.defineProperty(p,"getOrInsert",{
    configurable:true,writable:true,enumerable:false,
    value:function(key,defaultValue){
     // Preserve existing values including undefined, false and null.
     if(this.has(key))return this.get(key);
     this.set(key,defaultValue);
     return defaultValue;
    }
   });
  }
  if(typeof p.getOrInsertComputed!=="function"){
   Object.defineProperty(p,"getOrInsertComputed",{
    configurable:true,writable:true,enumerable:false,
    value:function(key,callback){
     if(typeof callback!=="function")
      throw new TypeError("getOrInsertComputed requires a callback");
     if(this.has(key))return this.get(key);
     const value=callback(key);
     // A synchronous callback may have already added the key.
     if(this.has(key))return this.get(key);
     this.set(key,value);
     return value;
    }
   });
  }
  return p;
 }
 // Safari/WebKit 26 lacks ReadableStream async iteration. PDF.js 6
 // uses 'for await' for text-layer streams. Add only the missing method,
 // using native getReader(), without network/storage or PDF content access.
 function installReadableStream(StreamConstructor){
  if(typeof StreamConstructor!=="function"||!StreamConstructor.prototype)
   return false; // JSDOM and older non-PDF browsers can omit Streams.
  const p=StreamConstructor.prototype;
  if(typeof p[Symbol.asyncIterator]==="function")return false;
  if(typeof p.getReader!=="function")
   throw Error("PDF_COMPAT_STREAM_READER_UNAVAILABLE");
  Object.defineProperty(p,Symbol.asyncIterator,{
   configurable:true,writable:true,enumerable:false,
   value:async function* (){
    const reader=this.getReader();
    let finished=false;
    try{
     for(;;){
      const next=await reader.read();
      if(next.done){finished=true;return;}
      yield next.value;
     }
    }finally{
     try{
      // Break/throw from 'for await' must cancel the stream to release
      // PDF.js internal buffers. A fully consumed stream is not cancelled.
      if(!finished)await reader.cancel();
     }finally{
      reader.releaseLock();
     }
    }
   }
  });
  return true;
 }
 return Object.freeze({install,installReadableStream});
}));