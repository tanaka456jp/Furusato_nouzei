"use strict";
/**
 * Independent synthetic boundary regression against published NTA tables.
 * Does not replace a qualified review of the full furusato deduction law.
 * References: NTA No.1199 and No.1410, as of November 2026.
 * No user document, user amounts, network or source tax values are read.
 */
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const source=fs.readFileSync(path.resolve(__dirname,"..","..","gas","Engine.gs"),"utf8");
const context={module:{exports:{}}};
vm.runInNewContext(source,context,{timeout:3000,filename:"Engine.gs"});
const engine=context.FurusatoEngine;
assert.ok(engine&&typeof engine.salaryIncome==="function");
assert.ok(typeof engine.statutoryRows==="function");
const rows=Array.from(engine.statutoryRows());
const expected={
 2025:[
  [1320000,950000],[3360000,880000],[4890000,680000],
  [6550000,630000],[23500000,580000],[24000000,480000],
  [24500000,320000],[25000000,160000],["上限なし",0]
 ],
 2026:[
  [1320000,1040000],[3360000,1040000],[4890000,1040000],
  [6550000,670000],[23500000,620000],[24000000,480000],
  [24500000,320000],[25000000,160000],["上限なし",0]
 ]
};
for(const year of [2025,2026]){
 const data=rows.filter(r=>r[0]===year);
 assert.equal(data.length,9);
 for(let i=0;i<data.length;i++){
  assert.equal(data[i][1],expected[year][i][0],
    year+" statutory total-income boundary "+i);
  assert.equal(data[i][2],expected[year][i][1],
    year+" statutory basic deduction "+i);
  assert.equal(data[i][3],i<6?430000:i===6?290000:i===7?150000:0,
    year+" resident-tax basic deduction "+i);
 }
}
// NTA No.1410 major boundaries; the special stepped 2026 short bands
// still require separate independent PDF Q&A review before certification.
for(const [year,gross,expectedIncome] of [
 [2025,1900000,1250000],
 [2025,6600000,4840000],
 [2026,1900000,1160000],
 [2026,2200000,1460000],
 [2026,6600000,4840000],
 [2026,8500000,6550000],
 [2026,8500001,6550001]
]){
 assert.equal(engine.salaryIncome(gross,year),expectedIncome,
  year+" salary gross "+gross);
}
assert.equal(engine.salaryIncome(7000000,2024),null);
console.log("PUBLIC_2025_2026_NTA_BASIC_AND_SALARY_BOUNDARY_SYNTHETIC_PASS; tax release HOLD");
