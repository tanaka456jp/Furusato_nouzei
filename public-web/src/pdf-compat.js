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
 return Object.freeze({install});
}));