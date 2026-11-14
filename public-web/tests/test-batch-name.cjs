"use strict";
/** Fictional-only E03 recipient-name geometry/PII isolation tests. */
const assert=require("node:assert/strict");
const extractor=require("../src/batch-name.js");
function item(str,x,y,width=12){
 return {str,transform:[1,0,0,1,x,y],width};
}
const fixture=[
 item("E03",77,680,12),item("架空太郎",91,680,46),
 item("G02",77,662,12),item("123456789012",91,662,75),
 item("配偶者",80,340,34),item("架空花子",91,340,46),
 item("架空商事",380,680,50)
];
assert.equal(extractor.extract(fixture),"架空太郎");
// Actual Japanese PDF generators often split each E03 code glyph; the
// name can be on a baseline ~2px above the printed field-code baseline.
const split=[
 item("E",76.7,683.2,5.5),item("0",79.4,683.2,5.5),
 item("3",82.2,683.2,5.5),item("架空",89.3,681.1,22),
 item("二",111.3,681.1,11),item("郎",122.3,681.1,11),
 item("々",87.7,683.2,246.8), // bogus full-width font placeholder
 item("家族",89.3,350,22),item("会社",380,683.2,30)
];
assert.equal(extractor.extract(split),"架空二郎");
assert.equal(extractor.extract([...split,item("E03",76.7,683.2,11)]),null,
 "Ambiguous duplicated code must never guess a recipient");
assert.equal(extractor.extract([
 item("E03",77,680,12),item("架空",91,680,23),
 item("二郎",117,680,23)
]),"架空 二郎");
assert.equal(extractor.extract([...fixture,item("E03",77,679,12)]),null);
assert.equal(extractor.extract([item("氏名",78,680,12),
 item("架空太郎",95,680,40)]),null);
assert.equal(extractor.extract([item("E03",77,680,12),
 item("=HYPERLINK(1)",91,680,80)]),null);
assert.equal(extractor.extract([item("E03",77,680,12),
 item("123456789012",91,680,80)]),null);
assert.equal(extractor.extract([item("E03",77,680,12),
 item("本人",360,680,23)]),null);
assert.equal(extractor.normalize("　架空　四郎　"),"架空 四郎");
for(const value of ["-TEST","=cmd","\u0000name","A","12345"])
 assert.equal(extractor.normalize(value),null);
console.log("PUBLIC_WEB_E03_NAME_ONLY_LOCAL_SYNTHETIC_PASS");
