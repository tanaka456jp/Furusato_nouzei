"use strict";
/**
 * 41-case independent numerical comparison: PR #5 Excel COM vs pinned GAS PR #2.
 * This is NOT a formal release or a tax-law certification.
 */
const fs = require("node:fs");
const path = require("node:path");
const PINNED_GAS_SHA = "17147b0b3ba06fb8f23b1fa9b459c7d7b8030ab2";
const ORIGINAL_SOURCE = "EXCEL_COM_V4_18_3_REVIEW";
const SCHEMA = "furusato-excel-gas-v4183/v1";
function reject(message) { throw new Error("EXCEL_GAS_41_INVALID: " + message); }
function safeInt(value) { return Number.isSafeInteger(value) && value >= 0 && value <= 1e12; }
function compare(observation, cases, gasEngine, opts = {}) {
  if (!observation || observation.schema !== SCHEMA ||
      observation.source !== (opts.allowMock ? "MOCK" : ORIGINAL_SOURCE) ||
      observation.gasCommitSha !== PINNED_GAS_SHA ||
      !/^[0-9a-f]{64}$/.test(observation.workbookSha256 || "") ||
      !/^[0-9a-f]{64}$/.test(observation.gasEngineSha256 || "") ||
      observation.macrosDisabled !== true || observation.readOnly !== true ||
      observation.dynamicABA !== true || observation.officialExcelSource !== false)
    reject("untrusted source, revision, hash or Excel isolation");
  if (!Array.isArray(cases) || cases.length !== 41 ||
      !Array.isArray(observation.results) || observation.results.length !== 41)
    reject("exactly 41 cases must be represented");
  if (!gasEngine || typeof gasEngine.calculate !== "function") reject("missing GAS engine");
  const byId = new Map(cases.map(v => [v.id, v]));
  if (byId.size !== 41) reject("duplicate test IDs");
  const observedIds = new Set(), differences = [];
  let matched = 0, pending = 0, done = 0, normal2025 = 0, normal2026 = 0;
  const salaryValues = new Set();
  const nta2026 = new Map([
    ["Y2026_G2192999", 1451000],
    ["Y2026_G2195999", 1453000],
    ["Y2026_G2199999", 1456000]
  ]);
  for (const row of observation.results) {
    if (!row || !byId.has(row.id) || observedIds.has(row.id)) reject("missing, unknown or repeated case");
    observedIds.add(row.id);
    const input = byId.get(row.id);
    for (const key of ["id", "year", "salaryGross", "socialInsurance", "filing"])
      if (row[key] !== input[key]) reject("Excel input changed: " + row.id + "/" + key);
    if (row.status !== "NORMAL" || row.statusText !== "正常") reject("Excel HOLD or invalid status: " + row.id);
    if (row.calcState === 2) pending++;
    else if (row.calcState === 0) done++;
    else reject("Excel calculation is still running or state is untrusted: " + row.id);
    for (const key of ["donationLimitYen", "salaryIncomeYen", "residentIncomeLevyYen"])
      if (!safeInt(row[key])) reject("invalid Excel numeric output: " + row.id + "/" + key);
    if (nta2026.has(row.id) && row.salaryIncomeYen !== nta2026.get(row.id))
      reject("Excel violates 2026 NTA special salary band: " + row.id);
    salaryValues.add(row.salaryIncomeYen);
    if (input.year === 2025) normal2025++; else if (input.year === 2026) normal2026++;
    const gas = gasEngine.calculate({
      year: input.year, incomeType: "salary", filing: input.filing,
      salaryGross: input.salaryGross, socialInsurance: input.socialInsurance,
      salaryIncomeReference: "", deductionsReference: "", acknowledgedExclusions: true
    });
    const fields = [];
    if (!gas || gas.status !== "ESTIMATE" || !gas.calculation) fields.push("status");
    else {
      if (gas.donationLimitYen !== row.donationLimitYen) fields.push("donationLimitYen");
      if (gas.calculation.salaryIncomeYen !== row.salaryIncomeYen) fields.push("salaryIncomeYen");
      if (gas.calculation.residentIncomeLevyYen !== row.residentIncomeLevyYen) fields.push("residentIncomeLevyYen");
    }
    if (fields.length) differences.push({
      id: row.id, fields, year: input.year, salaryGross: input.salaryGross,
      excel: {donationLimitYen: row.donationLimitYen, salaryIncomeYen: row.salaryIncomeYen,
        residentIncomeLevyYen: row.residentIncomeLevyYen},
      gas: gas && gas.calculation ? {donationLimitYen: gas.donationLimitYen,
        salaryIncomeYen: gas.calculation.salaryIncomeYen,
        residentIncomeLevyYen: gas.calculation.residentIncomeLevyYen} : null
    });
    else matched++;
  }
  const anchor = observation.results.find(r => r.id === "Y2026_G7000000");
  if (!anchor || anchor.donationLimitYen !== 109000) reject("2026 7m anchor must be 109000");
  if (normal2025 < 5 || normal2026 < 5 || salaryValues.size < 8)
    reject("insufficient independent responsive Excel cases");
  const allNumericMatch = matched === 41 && differences.length === 0;
  return {
    schema: "furusato-excel-gas-41-comparison/v1",
    excelRevision: "v4.18.3-review", gasCommitSha: PINNED_GAS_SHA,
    workbookSha256: observation.workbookSha256, gasEngineSha256: observation.gasEngineSha256,
    actualExcelCOM: !opts.allowMock, checked: 41, matched, mismatchCount: differences.length,
    excelCalculationDoneCount: done, excelCalculationPendingCount: pending,
    observedSalary2026SpecialBands: 3, allNumericMatch, differences,
    numericVerdict: allNumericMatch ? "MATCH_41_OF_41" : "MISMATCH",
    // Even all 41 match, remaining tax situations and printing are unverified.
    releaseVerdict: "HOLD", allTaxLawCoverage: false, physicalPrintTested: false
  };
}
function run(argv) {
  if (argv.length !== 2) reject("usage: node compare_excel_gas_v4183.cjs <evidence.json> <gas-checkout>");
  const doc = JSON.parse(fs.readFileSync(path.resolve(argv[0]), "utf8").replace(/^\uFEFF/, ""));
  const reference = path.resolve(argv[1]);
  const cases = require(path.join(reference, "gas", "parity", "cases.cjs"));
  const engine = require(path.join(reference, "gas", "Engine.gs"));
  const result = compare(doc, cases, engine);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (!result.allNumericMatch) process.exitCode = 2;
}
if (require.main === module) {
  try {run(process.argv.slice(2));}
  catch(error) {console.error(error.message); process.exitCode = 2;}
}
module.exports = {compare, PINNED_GAS_SHA, SCHEMA, ORIGINAL_SOURCE};
