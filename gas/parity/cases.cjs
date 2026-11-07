"use strict";
// Synthetic inputs only. Preserve disagreement boundaries.
const amounts2025=[1899999,1900000,1900001,2200000,2500000,3299999,3300000,
 3599999,3600000,4899999,4900000,5000000,5812500,6599999,6600000,7000000,8000000,8500000];
const amounts2026=[2190999,2191000,2192999,2193000,2195999,2196000,
 2199999,2200000,2200001,2500000,3299999,3300000,3599999,3600000,
 4899999,4900000,5000000,5812500,6599999,6600000,7000000,8000000,8500000];
function casesFor(year,amounts){
 return amounts.map(gross=>({id:"Y"+year+"_G"+gross,year,salaryGross:gross,
  socialInsurance:gross>=3000000?1000000:100000,filing:"one-stop"}));
}
const cases=[...casesFor(2025,amounts2025),...casesFor(2026,amounts2026)];
if(require.main===module)process.stdout.write(JSON.stringify(cases));
module.exports=cases;
