"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const context = {module: {exports: {}}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../Engine.gs"), "utf8"), context);
const engine = context.module.exports;
const cases = require("../../taxdata/separate-tax-cases-v1.json");
const spec = require("../../taxdata/separate-tax-v1.json");
const exact = require("../../taxdata/separate-tax-exact-v1.json");
const local = require("../../taxdata/separate-tax-local-v1.json");
const copy = value => JSON.parse(JSON.stringify(value));

assert.equal(exact.length, cases.length);
for (const {id, input, expected, exact:localEdge} of [...cases,...local]) {
  const result = engine.calculate(input);
  assert.equal(result.status, "ESTIMATE", id);
  const {nationalBefore: n, residentBefore: r, atInput: d} = result.calculation;
  assert.deepEqual(copy(n.allocation.rows.map(row => row.kind)), spec.buckets.map(row => row[0]), id);
  const actual = {
    nationalApplied: n.allocation.rows.map(row => row.applied),
    residentApplied: r.allocation.rows.map(row => row.applied),
    nationalTaxable: n.allocation.rows.map(row => row.taxable),
    residentTaxable: r.allocation.rows.map(row => row.taxable),
    nationalUnused: n.allocation.unused, residentUnused: r.allocation.unused,
    nationalBefore: n.annual, residentBefore: r.levy.reduce((s, y) => s + Math.floor(y / 100000) * 100, 0),
    ratio: r.ratio, nationalAfter: d.nationalAfter.annual, residentAfter: d.residentAfter[0] + d.residentAfter[1],
    netCost: d.netCost, limit: result.donationLimitYen
  };
  if (localEdge) {
    actual.residentBeforeParts = r.levy.map(y => Math.floor(y / 100000) * 100);
    actual.residentAfterParts = d.residentAfter;
  }
  assert.deepEqual(copy(actual), expected, id);
  const edge = localEdge || exact.find(row => row.id === id);
  assert.equal(result.maximumDonationYen, edge.maximum, id);
  assert.equal(result.roundedMaximumYen, edge.rounded, id);
  assert.equal(engine.calculate({...input,donation:edge.maximum}).calculation.atInput.netCost, edge.costAtMaximum, id);
  assert.equal(engine.calculate({...input,donation:edge.maximum+1}).calculation.atInput.netCost, edge.costNext, id);
}
const input = cases[0].input;
for (const [change, code] of [
  [{filing: "one-stop"}, "SAFE-TAX-012"],
  [{conditions: "unreviewed"}, "SAFE-TAX-013"],
  [{hasMortgage: true}, "SAFE-TAX-013"],
  [{noFileStock: 2000000}, "SAFE-TAX-013"],
  [{listedStock: 0}, "SAFE-TAX-014"],
  [{listedDividend: 100000}, "SAFE-TAX-014"],
  [{municipality: "other"}, "SAFE-TAX-019"],
  [{residentDeductions: 0}, "SAFE-TAX-015"],
  [{nationalDeductions: -1}, "SAFE-TAX-011"],
  [{year: 2027}, "SAFE-TAX-011"],
  [{donation: 10.5}, "SAFE-TAX-011"]
]) {
  const blocked = engine.calculate({...input, ...change});
  assert.equal(blocked.status, "HOLD");
  assert.equal(blocked.donationLimitYen, null);
  assert.equal(blocked.calculation, null);
  assert.equal(blocked.stop.code, code);
  assert.ok(blocked.stop.action && blocked.stop.resume && blocked.stop.storage);
}
assert.equal(engine.calculate(input).status, "ESTIMATE");
console.log(`SEPARATE_TAX_PASS ${cases.length} original + ${local.length} new statutory cases, each with an exact boundary, and 11 HOLD/recovery cases`);
