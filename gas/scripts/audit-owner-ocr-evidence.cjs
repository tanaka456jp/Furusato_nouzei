"use strict";
/**
 * Offline review of the owner's v0.1.17 acceptance JSON files.
 * No OAuth access, Google calls, authentication reuse, file mutation or raw
 * evidence output. This NEVER certifies the immutable deployment version.
 */
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const evidenceDir = path.join(root, ".private", "furusato", "evidence");
const devices = Object.freeze({
  WINDOWS_EDGE_OWNER_OBSERVED: ["PDF", "PNG", "JPEG"],
  IPHONE_SAFARI_OWNER_OBSERVED: ["JPEG"]
});
const scope = "FURUSATO_DEDICATED_OAUTH_SCOPE_ONLY_INCLUDING_TRASH";
const filePattern = /^owner-ocr-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i;

function auditDrive(row) {
  return !!row && row.status === "PASS" && row.protection === "PASS" &&
    row.temporaryOcrFiles === 0 && Number.isSafeInteger(row.pages) && row.pages > 0;
}
function validTimestamp(s) {
  return typeof s === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s) &&
    Number.isFinite(Date.parse(s));
}
function validateRecord(data) {
  const errors = [];
  const fail = (name, condition) => { if (condition) errors.push(name); };
  if (!data || typeof data !== "object" || Array.isArray(data))
    return {device: "UNRECOGNIZED", status: "HOLD", reasons: ["INVALID_RECORD"]};
  const device = Object.hasOwn(devices, data.device) ? data.device : "UNRECOGNIZED";
  const expected = devices[device] || [];
  fail("UNSUPPORTED_DEVICE", !expected.length);
  fail("PROTOCOL_UNSUPPORTED", data.protocolRevision !== 1);
  fail("RELEASE_NOT_HOLD", data.release !== "HOLD");
  fail("OWNER_STATUS_NOT_PASS", data.status !== "PASS");
  fail("SOURCE_COMMIT_INVALID", typeof data.sourceCommit !== "string" ||
    !/^[0-9a-f]{40}$/.test(data.sourceCommit));
  fail("DRIVE_SCOPE_NOT_RECORDED", data.driveCoverage !== scope);
  fail("TIME_UNVERIFIED", !validTimestamp(data.startedAt) ||
    !validTimestamp(data.finishedAt) || Date.parse(data.finishedAt) < Date.parse(data.startedAt));
  fail("BEFORE_DRIVE_AUDIT_INVALID", !auditDrive(data.before));
  fail("FORMAT_COVERAGE_INCOMPLETE", !Array.isArray(data.results) ||
    data.results.length !== expected.length);
  if (Array.isArray(data.results)) {
    for (let i = 0; i < expected.length; i++) {
      const row = data.results[i];
      fail("FORMAT_OR_ORDER_INVALID", !row || row.format !== expected[i]);
      fail("OWNER_ASSERTION_INCOMPLETE", !row ||
        row.consentReset !== "PASS" || row.candidates !== "PASS" || row.unreviewedHold !== "PASS");
      fail("AFTER_DRIVE_AUDIT_INVALID", !row || !auditDrive(row.after));
    }
  }
  return {
    device, status: errors.length ? "HOLD" : "OWNER_ATTESTED_STRUCTURE_PASS",
    reasons: [...new Set(errors)].sort(),
    // Source commits allow mismatch detection BETWEEN records, but do not
    // independently prove the historical deployed immutable GAS version.
    sourceCommit: errors.length ? null : data.sourceCommit,
    finishedAt: validTimestamp(data.finishedAt) ? data.finishedAt : null
  };
}
function summarizeRecords(records, rejected = 0) {
  const byDevice = {};
  const chosen = {};
  for (const record of records) {
    const r = validateRecord(record);
    if (r.device === "UNRECOGNIZED") rejected++;
    else if (!chosen[r.device] || (r.finishedAt || "") >= (chosen[r.device].finishedAt || ""))
      chosen[r.device] = r;
  }
  for (const device of Object.keys(devices)) {
    const r = chosen[device];
    byDevice[device === "WINDOWS_EDGE_OWNER_OBSERVED" ? "windows" : "iphone"] =
      r ? {status:r.status,reasons:r.reasons,formats:devices[device]} :
        {status:"HOLD",reasons:["EVIDENCE_NOT_FOUND"],formats:devices[device]};
  }
  const sourceAgreement = chosen.WINDOWS_EDGE_OWNER_OBSERVED?.sourceCommit &&
    chosen.IPHONE_SAFARI_OWNER_OBSERVED?.sourceCommit &&
    chosen.WINDOWS_EDGE_OWNER_OBSERVED.sourceCommit === chosen.IPHONE_SAFARI_OWNER_OBSERVED.sourceCommit;
  const bothPass = Object.values(byDevice).every(x => x.status === "OWNER_ATTESTED_STRUCTURE_PASS");
  return {
    schema: "furusato-owner-ocr-audit/v1",
    mode: "OFFLINE_READ_ONLY",
    recordsInspected: records.length,
    unsafeOrInvalidFiles: rejected,
    ...byDevice,
    sameRecordedSourceCommit: sourceAgreement ? "YES" : "UNVERIFIED",
    structuralStatus: bothPass && !rejected && sourceAgreement ?
      "OWNER_ATTESTED_STRUCTURE_PASS" : "HOLD",
    evidenceQuality: "OWNER_ANSWERS_AND_DRIVE_API_COUNTERS_ONLY",
    immutableDeploymentVersion: "NOT_IN_OWNER_RECORD",
    independentOcrAccuracy: "NOT_VERIFIED",
    independentDeletionOutsideOauthScope: "NOT_VERIFIED",
    release: "HOLD"
  };
}
function loadRecords(directory = evidenceDir) {
  for (const folder of [path.join(root, ".private"), path.join(root, ".private", "furusato"), directory]) {
    const st = fs.lstatSync(folder);
    if (!st.isDirectory() || st.isSymbolicLink()) throw Error("UNSAFE_PRIVATE_DIRECTORY");
  }
  const names = fs.readdirSync(directory);
  const records = [];
  let rejected = 0;
  for (const name of names) {
    if (!name.startsWith("owner-ocr-")) continue;
    if (!filePattern.test(name)) { rejected++; continue; }
    try {
      const file = path.join(directory, name);
      const st = fs.lstatSync(file);
      if (!st.isFile() || st.isSymbolicLink() || st.size < 2 || st.size > 1024 * 1024)
        throw Error("UNSAFE_PRIVATE_FILE");
      records.push(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch { rejected++; }
  }
  return {records, rejected};
}
function main() {
  if (process.argv.length !== 2 || process.env.CI)
    throw Error("LOCAL_OWNER_AUDIT_ONLY");
  const {records,rejected} = loadRecords();
  const result = summarizeRecords(records,rejected);
  console.log(JSON.stringify(result));
  if (result.structuralStatus !== "OWNER_ATTESTED_STRUCTURE_PASS") process.exitCode = 2;
}
module.exports = {auditDrive,validateRecord,summarizeRecords,loadRecords};
if (require.main === module) {
  try { main(); }
  catch { console.error("OWNER_OCR_EVIDENCE_AUDIT_HOLD: PRIVATE_RECORDS_UNAVAILABLE_OR_UNSAFE"); process.exitCode = 2; }
}
