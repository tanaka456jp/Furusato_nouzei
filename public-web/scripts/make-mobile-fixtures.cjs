"use strict";
// Deterministic fictional negative fixtures. Never reads any source document.
const fs=require("node:fs"),path=require("node:path"),zlib=require("node:zlib"),assert=require("node:assert/strict");
const W=1100,H=800;
const B=s=>Buffer.from(s,"ascii");
const stream=(dict,bytes)=>Buffer.concat([B("<< "+dict+" /Length "+bytes.length+" >>\nstream\n"),bytes,B("\nendstream")]);
function pdf(objects){
 const parts=[Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n","latin1")],offsets=[0];
 let size=parts[0].length;
 for(let i=0;i<objects.length;i++){
  offsets.push(size);
  const block=Buffer.concat([B((i+1)+" 0 obj\n"),objects[i],B("\nendobj\n")]);
  parts.push(block);size+=block.length;
 }
 parts.push(B("xref\n0 "+offsets.length+"\n0000000000 65535 f \n"+offsets.slice(1).map(n=>String(n).padStart(10,"0")+" 00000 n \n").join("")+"trailer\n<< /Size "+offsets.length+" /Root 1 0 R >>\nstartxref\n"+size+"\n%%EOF\n"));
 const out=Buffer.concat(parts);
 for(let i=1;i<offsets.length;i++)assert.equal(out.subarray(offsets[i],offsets[i]+String(i).length+6).toString("ascii"),i+" 0 obj");
 assert.equal(out.subarray(size,size+4).toString(),"xref");
 return out;
}
function electronic(){
 return pdf([B("<< /Type /Catalog /Pages 2 0 R >>"),B("<< /Type /Pages /Count 1 /Kids [3 0 R] >>"),
 B("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>"),
 stream("",B("BT /F1 24 Tf 50 530 Td (SYNTHETIC QA - NOT A TAX SLIP) Tj /F1 16 Tf 0 -45 Td (No taxpayer data. Expected: HOLD.) Tj 0 -35 Td (2026 / 7000000 / 5200000 / 1670000 / 1000000) Tj ET")),
 B("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")]);
}
function pixels(blank=false){
 const p=Buffer.alloc(W*H*3,255);
 const set=(x,y,v)=>{const i=(y*W+x)*3;p[i]=p[i+1]=p[i+2]=v;};
 if(blank)return p;
 // Artificial lines and strokes: no Japanese tax document title or fields.
 for(let y=110;y<730;y++)for(let x=60;x<1040;x++)
  if((y%91<4&&x%37<26)||(x%131<4&&y%41<27))set(x,y,30);
 // Visible QA mark drawn from an original tiny bitmap, not a real form.
 const glyphs=[["01110","10001","10001","10001","10101","10010","01101"],["01110","10001","10001","11111","10001","10001","10001"]];
 for(let g=0;g<glyphs.length;g++)for(let y=0;y<7;y++)for(let x=0;x<5;x++)
  if(glyphs[g][y][x]==="1")for(let dy=0;dy<10;dy++)for(let dx=0;dx<10;dx++)set(60+g*70+x*10+dx,20+y*10+dy,25);
 return p;
}
function rasterPdf(pages,blank=false){
 assert.ok(Number.isInteger(pages)&&pages>=1&&pages<=20);
 const image=stream("/Type /XObject /Subtype /Image /Width "+W+" /Height "+H+" /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode",zlib.deflateSync(pixels(blank)));
 const ids=Array.from({length:pages},(_,i)=>5+i);
 return pdf([B("<< /Type /Catalog /Pages 2 0 R >>"),B("<< /Type /Pages /Count "+pages+" /Kids ["+ids.map(i=>i+" 0 R").join(" ")+"] >>"),
 image,stream("",B("q "+W+" 0 0 "+H+" 0 0 cm /Im0 Do Q")),
 ...ids.map(()=>B("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 "+W+" "+H+"] /Resources << /XObject << /Im0 3 0 R >> >> /Contents 4 0 R >>"))]);
}
function crc32(data){
 let c=0xffffffff;
 for(const b of data){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}
 return (c^0xffffffff)>>>0;
}
function chunk(type,data){
 const payload=Buffer.concat([B(type),data]),size=Buffer.alloc(4),crc=Buffer.alloc(4);
 size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(payload));return Buffer.concat([size,payload,crc]);
}
function png(){
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(W,0);ihdr.writeUInt32BE(H,4);ihdr[8]=8;ihdr[9]=2;
 const rgb=pixels(),rows=Buffer.alloc(H*(1+W*3));
 for(let y=0;y<H;y++)rgb.copy(rows,y*(1+W*3)+1,y*W*3,(y+1)*W*3);
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",zlib.deflateSync(rows)),chunk("IEND",Buffer.alloc(0))]);
}
function createFixtures(){
 return {"01-electronic-not-slip.pdf":electronic(),"02-scan-not-slip.pdf":rasterPdf(1),"03-photo-not-slip.png":png(),"04-batch-20-pages.pdf":rasterPdf(20),"05-blank.pdf":rasterPdf(1,true)};
}
if(require.main===module){
 const dest=path.resolve(__dirname,"../qa-fixtures");
 fs.mkdirSync(dest,{recursive:true});
 const files=createFixtures();
 for(const [name,bytes] of Object.entries(files)){
  assert.ok(bytes.length>100&&bytes.length<8*1024*1024);
  fs.writeFileSync(path.join(dest,name),bytes,{flag:"wx"});
 }
 const header=require("../src/ocr-image-header.js");
 assert.equal(header.inspect(new Uint8Array(files["03-photo-not-slip.png"].subarray(0,header.MAX_HEADER_BYTES)),"image/png",files["03-photo-not-slip.png"].length).status,"ACCEPT");
 console.log("MOBILE_SYNTHETIC_FIXTURES_5_PASS; all expected HOLD; no real slips");
}
module.exports={createFixtures};
