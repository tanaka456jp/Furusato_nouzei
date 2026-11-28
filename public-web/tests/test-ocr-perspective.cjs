"use strict";
/* Synthetic pixel geometry ONLY; NOT a field-recognition accuracy test. */
const assert=require("node:assert/strict");
const model=require("../src/ocr-perspective.js");
const w=288,h=224,pixels=new Uint8ClampedArray(w*h*4);
for(let y=0;y<h;y++)for(let x=0;x<w;x++){
 const i=(y*w+x)*4;
 const inside=y>=25&&y<=202&&x>=42+(y-25)*.12&&
                                   x<=248-(y-25)*.17;
 const c=inside?246:22;
 pixels[i]=pixels[i+1]=pixels[i+2]=c;pixels[i+3]=255;
}
const q=model.findCorners(w,h,pixels);
assert.equal(q.status,"CORNERS_FOUND");
assert.equal(q.corners.length,4);
assert.equal(q.autoApproved,false);
assert.ok(Math.abs(q.corners[0].x-42)<10);
assert.ok(Math.abs(q.corners[0].y-25)<10);
const project=model.homography(q.corners);
assert.ok(project);
for(let i=0;i<4;i++){
 const corner=project(i===1||i===2?1:0,i>=2?1:0);
 assert.ok(Math.hypot(corner.x-q.corners[i].x,
                      corner.y-q.corners[i].y)<.01);
}
const white=pixels.slice();
for(let i=0;i<white.length;i+=4)white[i]=white[i+1]=white[i+2]=255;
assert.equal(model.findCorners(w,h,white).status,"UNVERIFIED");
assert.equal(model.findCorners(1,1,[]).status,"UNVERIFIED");
const clipped=pixels.slice();
for(let i=0;i<clipped.length;i+=4)
 if(i/(w*4)<3)clipped[i]=clipped[i+1]=clipped[i+2]=255;
assert.equal(model.findCorners(w,h,clipped).status,"UNVERIFIED");
// Two sizeable disconnected bright regions on a dark background must
// not be silently reduced to the largest rectangle.
function regions(rects){
 const a=new Uint8ClampedArray(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=(y*w+x)*4,v=rects.some(([l,t,r,b])=>x>=l&&x<=r&&y>=t&&y<=b)?246:22;
  a[i]=a[i+1]=a[i+2]=v;a[i+3]=255;
 }
 return a;
}
const multiple=regions([[15,20,145,203],[165,40,265,188]]);
const ambiguous=model.findCorners(w,h,multiple);
assert.equal(ambiguous.status,"AMBIGUOUS_PAGE");
assert.equal(ambiguous.corners,null);assert.equal(ambiguous.autoApproved,false);
const incidental=regions([[15,20,145,203],[165,40,180,55]]);
assert.equal(model.findCorners(w,h,incidental).status,"CORNERS_FOUND");
const beforeDocument=global.document;
global.document={createElement:()=>({width:0,height:0,getContext:()=>({drawImage(){},getImageData(){return {data:multiple};}})})};
try{
 const rectified=model.tryRectify({width:1152,height:896});
 assert.equal(rectified.status,"AMBIGUOUS_PAGE");assert.equal(rectified.canvas,null);
 assert.equal(rectified.autoApproved,false);
}finally{if(beforeDocument===undefined)delete global.document;else global.document=beforeDocument;}
// Long parallel synthetic rules, rotated without relying on OCR text.
function ruled(degrees,rows=[50,90,130,170,210]){
 const w=400,h=280,a=new Uint8ClampedArray(w*h*4);a.fill(255);
 for(let y=0;y<h;y++)for(let x=20;x<w-20;x++)
  if(rows.some(r=>Math.abs(y-r-(x-w/2)*Math.tan(degrees*Math.PI/180))<.85)){
   const i=(y*w+x)*4;a[i]=a[i+1]=a[i+2]=25;
  }
 return a;
}
for(const degrees of [-4,-3,-2,2,3,4]){
 const out=model.estimateSkew(400,280,ruled(degrees));
 assert.equal(out.status,"SKEW_FOUND");assert.ok(Math.abs(out.degrees-degrees)<=.5);
 assert.equal(out.autoApproved,false);
}
// Non-half-degree slopes: coarse quantization can lose a long printed
// rule after rotation. Test the refined angle without altering OCR gates.
for(const degrees of [-3.7,-3.2,-2.7,-2.2,2.2,2.7,3.2,3.7]){
 const out=model.estimateSkew(400,280,ruled(degrees));
 assert.equal(out.status,"SKEW_FOUND");
 assert.ok(Math.abs(out.degrees-degrees)<=.10001);
 assert.equal(out.autoApproved,false);
}
for(const data of [ruled(0),ruled(3,[80]),ruled(3,[]),ruled(3,[80,140])])
 assert.equal(model.estimateSkew(400,280,data).status,"UNVERIFIED");
const candidate={year:2026,candidates:{salaryGross:7000000,socialInsurance:1000000}};
const raw={observedYear:2026,observedCandidates:{salaryGross:7000000},reasons:[]};
assert.equal(model.deskewConsistent(raw,candidate),true);
assert.equal(model.deskewConsistent({...raw,observedYear:2025},candidate),false);
assert.equal(model.deskewConsistent({...raw,observedCandidates:{salaryGross:7100000}},candidate),false);
assert.equal(model.deskewConsistent({...raw,reasons:["FIELD_DUPLICATE_salaryGross"]},candidate),false);
assert.equal(model.deskewConsistent({...raw,observedCandidates:{socialInsurance:0}},{year:2026,candidates:{salaryGross:7000000}}),false);
console.log("PUBLIC_OCR_FOUR_CORNER_PERSPECTIVE_SYNTHETIC_PASS; no OCR accuracy claim");
