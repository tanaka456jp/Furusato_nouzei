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
  let best=[];
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
   if(end>best.length)best=Array.from(queue.subarray(0,end));
  }
  if(best.length<w*h*.12)return unverified;
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
 return {findCorners,homography,tryRectify};
}));