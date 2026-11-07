"use strict";
/**
 * Build an explicitly-labelled, completely self-contained offline browser
 * acceptance preview from the SAME Engine.gs and Index.html as the GAS app.
 * Browser data never leaves the local file. This is not a GAS deployment.
 */
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const engine=fs.readFileSync(path.join(root,"Engine.gs"),"utf8");
const html=fs.readFileSync(path.join(root,"Index.html"),"utf8");
if(!html.includes("<script>")||!html.includes("GAS検証版"))throw new Error("HTML template changed");
if(/<\/script/i.test(engine))throw new Error("Unsafe script boundary in engine source");
const adapter=String.raw`
(function(){
 "use strict";
 var delegate = {
   onSuccess:null,onFailure:null,
   withSuccessHandler:function(fn){this.onSuccess=fn;return this;},
   withFailureHandler:function(fn){this.onFailure=fn;return this;},
   runFurusatoSimulation:function(data){
     var self=this;
     Promise.resolve().then(function(){
       try { self.onSuccess(FurusatoEngine.calculate(data)); }
       catch(err){ if(self.onFailure) self.onFailure(err); }
     });
   }
 };
 window.google={script:{run:delegate}};
}());
`;
const bootstrap="<script>\n"+engine+"\n"+adapter+"\n</script>\n";
const banner=String.raw`
<div id="localPreview" style="background:#fff3cc;color:#663d08;text-align:center;padding:10px 14px;font-size:13px;font-weight:650">
ローカル検証プレビュー（Google未接続・実運用禁止）／入力はファイル内でのみ処理され、保存・送信されません
</div>
`;
const output=html.replace("</header>","</header>\n"+banner)
 .replace("<script>",bootstrap+"<script>")
 .replace("GAS検証版 v0.1.9","ローカル動作プレビュー v0.1.9");
if(output===html||output.indexOf("window.google={script:{run:delegate}}")<0)throw new Error("Bundle step failed");
const dest=path.join(root,"dist","Furusato_GAS_LocalPreview.html");
fs.mkdirSync(path.dirname(dest),{recursive:true});
fs.writeFileSync(dest,output,"utf8");
console.log("LOCAL_PREVIEW_BUILT "+path.basename(dest)+" bytes="+fs.statSync(dest).size);
