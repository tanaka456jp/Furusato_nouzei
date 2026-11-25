"use strict";
/*
 * Strictly local perspective correction for a light rectangular page on
 * a distinctly dark background. This is a conditional image transform, NOT
 * document recognition, a confidence certificate or a source comparison.
 * Uncertain, cropped or non-contrasting photos are left unchanged.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 else root.FurusatoPerspective=api;
}(typeof window!=="undefined"?window:this,function(){
 "use strict";
 function grey(rgba,i){
  return (rgba[i]*299+rgba[i+1]*587+rgba[i+2]*114)/1000;
 }
 function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}
 function area(q){
  let sum=0;
  for(let k=0;k<4;k++){
   const p=q[k],n=q[(k+1)%4];
   sum+=p.x*n.y-n.x*p.y;
  }
  return Math.abs(sum)/2;
 }
 function findCorners(w,h,rgba){
  const unverified={status:"UNVERIFIED",corners:null,autoApproved:false};
  if(!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||
      w<72||h<72||w*h>150000||!rgba||rgba.length!==w*h*4)
   return unverified;
  // Require all four image-frame corners to be dark. White-on-white,
  // cropped pages or random bright scenes must NOT be auto-rectified.
  for(const [x,y] of [[0,0],[w-1,0],[w-1,h-1],[0,h-1]]){
   const i=(y*w+x)*4;
   if(rgba[i+3]<250||grey(rgba,i)>150)return unverified;
  }
  const mask=new Uint8Array(w*h),visited=new Uint8Array(w*h);
  let bright=0;
  for(let p=0;p<w*h;p++){
   const i=p*4;
   if(rgba[i+3]>250&&grey(rgba,i)>=205){
    mask[p]=1;bright++;
   }
  }
  if(bright<w*h*.13||bright>w*h*.85)return unverified;
  const queue=new Int32Array(w*h);
  let best=[],secondSize=0;
  for(let start=0;start<w*h;start++){
   if(!mask[start]||visited[start])continue;
   let front=0,end=1;
   queue[0]=start;visited[start]=1;
   while(front<end){
    const p=queue[front++],x=p%w,y=(p/w)|0;
    const neighbors=[x>0?p-1:-1,x<w-1?p+1:-1,
       y>0?p-w:-1,y<h-1?p+w:-1];
    for(const next of neighbors){
     if(next>=0&&mask[next]&&!visited[next]){
      visited[next]=1;queue[end++]=next;
     }
    }
   }
   if(end>best.length){secondSize=best.length;best=Array.from(queue.subarray(0,end));}
   else secondSize=Math.max(secondSize,end);
  }
  if(best.length<w*h*.12)return unverified;
  // Do not silently crop to one of several substantial bright regions.
  // A second document, or a page divided by deep shadow, needs a fresh
  // photo. This is geometric ambiguity, not recognition of two slips.
  if(secondSize>=w*h*.06&&secondSize>=best.length*.25)
   return {status:"AMBIGUOUS_PAGE",corners:null,autoApproved:false};
  let tl=null,tr=null,br=null,bl=null;
  let minS=Infinity,maxS=-Infinity,maxD=-Infinity,minD=Infinity;
  let minX=w,maxX=-1,minY=h,maxY=-1;
  for(const p of best){
   const x=p%w,y=(p/w)|0,s=x+y,d=x-y;
   minX=Math.min(minX,x);maxX=Math.max(maxX,x);
   minY=Math.min(minY,y);maxY=Math.max(maxY,y);
   if(s<minS){minS=s;tl={x,y};}
   if(s>maxS){maxS=s;br={x,y};}
   if(d>maxD){maxD=d;tr={x,y};}
   if(d<minD){minD=d;bl={x,y};}
  }
  const q=[tl,tr,br,bl];
  if(minX<w*.015||maxX>w*.985||minY<h*.015||maxY>h*.985||
     maxX-minX<w*.38||maxY-minY<h*.38||
     area(q)<w*h*.12||best.length/(area(q)||1)<.55||
     Math.min(dist(tl,tr),dist(bl,br))<w*.28||
     Math.min(dist(tl,bl),dist(tr,br))<h*.28)
   return unverified;
  const angle=Math.atan2(tr.y-tl.y,tr.x-tl.x);
  if(Math.abs(angle)>Math.PI/6)return unverified;
  return {status:"CORNERS_FOUND",corners:q,autoApproved:false};
 }
 // Exact square-to-quadrilateral projective mapping, not just a rotation.
 function homography(q){
  const [p0,p1,p2,p3]=q;
  const dx1=p1.x-p2.x,dy1=p1.y-p2.y;
  const dx2=p3.x-p2.x,dy2=p3.y-p2.y;
  const dx3=p0.x-p1.x+p2.x-p3.x;
  const dy3=p0.y-p1.y+p2.y-p3.y;
  const den=dx1*dy2-dx2*dy1;
  if(Math.abs(den)<1e-8)return null;
  const g=(dx3*dy2-dx2*dy3)/den;
  const h=(dx1*dy3-dx3*dy1)/den;
  const a=p1.x-p0.x+g*p1.x,b=p3.x-p0.x+h*p3.x;
  const d=p1.y-p0.y+g*p1.y,e=p3.y-p0.y+h*p3.y;
  return function(u,v){
   const z=g*u+h*v+1;
   if(!Number.isFinite(z)||z<=.01)return null;
   return {x:(a*u+b*v+p0.x)/z,y:(d*u+e*v+p0.y)/z};
  };
 }
 function tryRectify(input){
  const fallback={status:"UNVERIFIED",canvas:null,autoApproved:false};
  let sample=null,output=null;
  try{
   if(!input||!Number.isFinite(input.width)||!Number.isFinite(input.height)||
      input.width<750||input.height<400||
      input.width*input.height>10000000)return fallback;
   const factor=Math.min(1,288/Math.max(input.width,input.height));
   const sw=Math.max(72,Math.round(input.width*factor));
   const sh=Math.max(72,Math.round(input.height*factor));
   sample=document.createElement("canvas");
   sample.width=sw;sample.height=sh;
   const small=sample.getContext("2d",{willReadFrequently:true});
   if(!small)return fallback;
   small.drawImage(input,0,0,sw,sh);
   const guess=findCorners(sw,sh,small.getImageData(0,0,sw,sh).data);
   if(guess.status==="AMBIGUOUS_PAGE")return {status:"AMBIGUOUS_PAGE",canvas:null,autoApproved:false};
   if(guess.status!=="CORNERS_FOUND")return fallback;
   const sx=input.width/sw,sy=input.height/sh;
   const q=guess.corners.map(p=>({x:p.x*sx,y:p.y*sy}));
   const map=homography(q);
   if(!map)return fallback;
   const naturalW=Math.round(Math.max(dist(q[0],q[1]),dist(q[3],q[2])));
   const naturalH=Math.round(Math.max(dist(q[0],q[3]),dist(q[1],q[2])));
   const scale=Math.min(1,2200/Math.max(naturalW,naturalH),
                        Math.sqrt(3200000/(naturalW*naturalH)));
   const ow=Math.floor(naturalW*scale),oh=Math.floor(naturalH*scale);
   if(ow<750||oh<400)return fallback;
   const src=input.getContext("2d",{willReadFrequently:true})
                  .getImageData(0,0,input.width,input.height).data;
   output=document.createElement("canvas");
   output.width=ow;output.height=oh;
   const ctx=output.getContext("2d",{willReadFrequently:true});
   if(!ctx)return fallback;
   const pixels=ctx.createImageData(ow,oh),dest=pixels.data;
   for(let y=0;y<oh;y++)for(let x=0;x<ow;x++){
    const p=map((x+.5)/ow,(y+.5)/oh);
    const j=(y*ow+x)*4;
    if(!p||p.x<0||p.y<0||p.x>=input.width-1||p.y>=input.height-1){
     dest[j]=dest[j+1]=dest[j+2]=255;dest[j+3]=255;
     continue;
    }
    const ix=Math.floor(p.x),iy=Math.floor(p.y);
    const i=(iy*input.width+ix)*4;
    // Nearest-neighbor avoids accidentally mixing adjacent fine digits
    // across a high-contrast document grid or currency cell.
    dest[j]=src[i];dest[j+1]=src[i+1];dest[j+2]=src[i+2];dest[j+3]=255;
   }
   ctx.putImageData(pixels,0,0);
   return {status:"APPLIED",canvas:output,autoApproved:false};
  }catch(_){
   return fallback;
  }finally{
   if(sample){sample.width=0;sample.height=0;}
   // No pixel arrays or source information are retained in module state.
  }
 }
 // Small-angle deskew for light-background scans. Require multiple long
 // parallel ink rules and a clear peak; text alone is not proof of skew.
 function estimateSkew(w,h,rgba){
  const no={status:"UNVERIFIED",degrees:null,autoApproved:false};
  if(!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||w<160||h<100||w*h>270000||!rgba||rgba.length!==w*h*4)return no;
  const points=[];let light=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const i=(y*w+x)*4,g=grey(rgba,i);
   if(rgba[i+3]!==255)return no;
   if(g>205)light++;
   if(g<115&&x>=w*.04&&x<w*.96&&y>=h*.04&&y<h*.96)points.push([x,y]);
  }
  if(light<w*h*.65||points.length<w*h*.002||points.length>w*h*.22)return no;
  const scores=[];
  for(let step=-10;step<=10;step++){
   const degrees=step/2,slope=Math.tan(degrees*Math.PI/180);
   const counts=new Uint16Array(h+Math.ceil(w*.20)+4),bits=new Uint16Array(counts.length),offset=Math.ceil(w*.10)+2;
   for(const [x,y] of points){
    const b=Math.round(y-(x-w/2)*slope)+offset;
    counts[b]++;bits[b]|=1<<Math.min(11,Math.floor(x*12/w));
   }
   let score=0,lines=0,prior=-100,peak=0;
   for(let y=0;y<counts.length;y++){
    const coverage=bits[y].toString(2).replace(/0/g,"").length;
    if(counts[y]<w*.35||coverage<9)continue;
    if(y-prior>Math.max(4,Math.round(h*.012))){if(peak){score+=peak*peak;lines++;}peak=0;}
    peak=Math.max(peak,counts[y]);prior=y;
   }
   if(peak){score+=peak*peak;lines++;}
   scores.push({degrees,score,lines});
  }
  const zero=scores[10],ranked=scores.slice().sort((a,b)=>b.score-a.score),best=ranked[0];
  const rival=ranked.find(s=>Math.abs(s.degrees-best.degrees)>=1);
  if(best.lines<3||Math.abs(best.degrees)<1||Math.abs(best.degrees)>=5||
     best.score<zero.score*1.25||best.score<(rival?.score||0)*1.18)return no;
  return {status:"SKEW_FOUND",degrees:best.degrees,autoApproved:false};
 }
 function tryDeskew(input){
  const fallback={status:"UNVERIFIED",canvas:null,autoApproved:false};
  let sample=null,output=null,success=false;
  try{
   const w=input?.width,h=input?.height;
   if(!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||w<750||h<400||w*h>10000000)return fallback;
   const factor=Math.min(1,512/Math.max(w,h)),sw=Math.round(w*factor),sh=Math.round(h*factor);
   if(sw<160||sh<100)return fallback;
   sample=document.createElement("canvas");sample.width=sw;sample.height=sh;
   const ctx=sample.getContext("2d",{willReadFrequently:true});if(!ctx)return fallback;
   ctx.drawImage(input,0,0,sw,sh);
   const guess=estimateSkew(sw,sh,ctx.getImageData(0,0,sw,sh).data);
   if(guess.status!=="SKEW_FOUND")return fallback;
   const radians=-guess.degrees*Math.PI/180,cos=Math.abs(Math.cos(radians)),sin=Math.abs(Math.sin(radians));
   // Expand, never crop. Do not downsample a small original or exceed
   // the OCR allocation limit. White margins preserve all source pixels.
   const ow=Math.ceil(w*cos+h*sin)+2,oh=Math.ceil(w*sin+h*cos)+2;
   if(ow*oh>10000000)return fallback;
   output=document.createElement("canvas");output.width=ow;output.height=oh;
   const out=output.getContext("2d");if(!out)return fallback;
   out.fillStyle="#fff";out.fillRect(0,0,ow,oh);
   out.translate(ow/2,oh/2);out.rotate(radians);out.drawImage(input,-w/2,-h/2);
   success=true;return {status:"APPLIED",canvas:output,degrees:guess.degrees,autoApproved:false};
  }catch(_){return fallback;}
  finally{if(sample){sample.width=0;sample.height=0;}if(output&&!success){output.width=0;output.height=0;}}
 }
 // Negative evidence from the untouched source can never be erased by
 // deskew. Missing fields are not evidence of zero, either.
 function deskewConsistent(raw,candidate){
  if(!raw||!candidate||raw.yearConflict||raw.yearUnsupported||raw.documentTypeConflict||
     (raw.reasons||[]).some(x=>/^FIELD_(?:CONFLICT|DUPLICATE|INVALID)_/.test(x)))return false;
  if(raw.observedYear!==null&&raw.observedYear!==undefined&&raw.observedYear!==candidate.year)return false;
  return Object.entries(raw.observedCandidates||{}).every(([k,v])=>candidate.candidates?.[k]===v);
 }
 return {findCorners,homography,tryRectify,estimateSkew,tryDeskew,deskewConsistent};
}));