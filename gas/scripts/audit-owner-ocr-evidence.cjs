"use strict";
/**
 * Offline review of the owner's v0.1.17 acceptance JSON files.
 * No OAuth access, Google calls, authentication reuse, file mutation or raw
 * evidence output. This NEVER certifies the immutable deployment version.
 */
const fs = require("node:fs");
const path = require("node:path");
const {createHash} = require("node:crypto");
const root = path.resolve(__dirname, "..");
const evidenceDir = path.join(root, ".private", "furusato", "evidence");
const stageRoot = path.join(root, ".private", "furusato-v020-stage");
const stageEvidenceDir = path.join(stageRoot, "evidence");
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
    Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s;
}
function validateRecord(data, options = {}) {
  const errors = [];
  const fail = (name, condition) => { if (condition) errors.push(name); };
  if (!data || typeof data !== "object" || Array.isArray(data))
    return {device: "UNRECOGNIZED", status: "HOLD", reasons: ["INVALID_RECORD"]};
  const device = Object.hasOwn(devices, data.device) ? data.device : "UNRECOGNIZED";
  const expected = devices[device] || [];
  fail("UNSUPPORTED_DEVICE", !expected.length);
  fail("PROTOCOL_UNSUPPORTED", data.protocolRevision !== (options.stageV020 ? 2 : 1));
  if (options.stageV020) {
    fail("STAGE_VERSION_INVALID", data.candidateVersion !== "v0.1.20");
    fail("STAGE_RECEIPT_BINDING_INVALID", typeof data.stageReceiptFingerprint !== "string" ||
      !/^[a-f0-9]{64}$/.test(data.stageReceiptFingerprint) ||
      data.stageReceiptFingerprint !== options.receiptFingerprint);
    fail("STAGE_SOURCE_COMMIT_DIFFERS", data.sourceCommit !== options.sourceCommit);
  }
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
function summarizeRecords(records, rejected = 0, options = {}) {
  const byDevice = {};
  const chosen = {};
  const unorderable = new Set();
  const tiedLatest = new Set();
  for (const record of records) {
    const r = validateRecord(record, options);
    if (r.device === "UNRECOGNIZED") {
      rejected++;
      continue;
    }
    // Failed records with missing or invalid timestamps cannot be ordered
    // relative to an older PASS. Treat the entire device as HOLD rather
    // than silently preferring whichever record happens to be readable.
    if (!r.finishedAt) {
      unorderable.add(r.device);
      continue;
    }
    const previous = chosen[r.device];
    if (!previous || r.finishedAt > previous.finishedAt) {
      chosen[r.device] = r;
      tiedLatest.delete(r.device);
    } else if (r.finishedAt === previous.finishedAt) {
      // Distinct owner evidence files can have equal millisecond timestamps.
      // Never let read order decide a PASS/FAIL conflict.
      tiedLatest.add(r.device);
    }
  }
  for (const device of Object.keys(devices)) {
    const r = chosen[device];
    const uncertainty = [
      ...(unorderable.has(device) ? ["UNORDERABLE_EVIDENCE_TIME"] : []),
      ...(tiedLatest.has(device) ? ["DUPLICATE_LATEST_FINISHED_AT"] : [])
    ];
    byDevice[device === "WINDOWS_EDGE_OWNER_OBSERVED" ? "windows" : "iphone"] =
      uncertainty.length ? {status:"HOLD",reasons:uncertainty,formats:devices[device]} :
      r ? {status:r.status,reasons:r.reasons,formats:devices[device]} :
        {status:"HOLD",reasons:["EVIDENCE_NOT_FOUND"],formats:devices[device]};
  }
  const sourceAgreement = chosen.WINDOWS_EDGE_OWNER_OBSERVED?.sourceCommit &&
    chosen.IPHONE_SAFARI_OWNER_OBSERVED?.sourceCommit &&
    chosen.WINDOWS_EDGE_OWNER_OBSERVED.sourceCommit === chosen.IPHONE_SAFARI_OWNER_OBSERVED.sourceCommit;
  const bothPass = Object.values(byDevice).every(x => x.status === "OWNER_ATTESTED_STRUCTURE_PASS");
  return {
    schema: options.stageV020 ? "furusato-owner-ocr-audit/v2" : "furusato-owner-ocr-audit/v1",
    mode: "OFFLINE_READ_ONLY",
    recordsInspected: records.length,
    unsafeOrInvalidFiles: rejected,
    ...byDevice,
    sameRecordedSourceCommit: sourceAgreement ? "YES" : "UNVERIFIED",
    structuralStatus: bothPass && !rejected && sourceAgreement ?
      "OWNER_ATTESTED_STRUCTURE_PASS" : "HOLD",
    evidenceQuality: "OWNER_ANSWERS_AND_DRIVE_API_COUNTERS_ONLY",
    ...(options.stageV020 ? {
      candidateVersion: "v0.1.20",
      stageReceiptBinding: "LOCAL_RECEIPT_SHA256_AND_SOURCE_COMMIT",
      immutableDeploymentVersion: "REQUIRES_INDEPENDENT_REMOTE_GET"
    } : {immutableDeploymentVersion: "NOT_IN_OWNER_RECORD"}),
    independentOcrAccuracy: "NOT_VERIFIED",
    independentDeletionOutsideOauthScope: "NOT_VERIFIED",
    release: "HOLD"
  };
}
function loadRecords(directory = evidenceDir) {
  const folders = directory === stageEvidenceDir ?
    [path.join(root, ".private"), stageRoot, directory] :
    [path.join(root, ".private"), path.join(root, ".private", "furusato"), directory];
  for (const folder of folders) {
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
function readStageContext() {
  // Only locally attests that the owner's evidence belongs to the unchanged
  // v0.1.20 stage receipt. It never attests the current live Google deployment.
  const receiptPath = path.join(stageRoot, "receipt.json");
  for (const folder of [path.join(root, ".private"), stageRoot]) {
    const st = fs.lstatSync(folder);
    if (!st.isDirectory() || st.isSymbolicLink()) throw Error("UNSAFE_STAGE_DIRECTORY");
  }
  const st = fs.lstatSync(receiptPath);
  if (!st.isFile() || st.isSymbolicLink() || st.size < 3 || st.size > 1024 * 1024)
    throw Error("UNSAFE_STAGE_RECEIPT");
  const raw = fs.readFileSync(receiptPath);
  const receipt = JSON.parse(raw.toString("utf8"));
  if (!receipt || receipt.schema !== "furusato-v020-stage/v1" ||
      receipt.appVersion !== "v0.1.20" || receipt.release !== "HOLD" ||
      receipt.oldDeployment !== "UNMODIFIED_BY_STAGE" ||
      typeof receipt.sourceCommit !== "string" || !/^[a-f0-9]{40}$/.test(receipt.sourceCommit))
    throw Error("UNVERIFIED_STAGE_RECEIPT");
  return {
    stageV020: true,
    receiptFingerprint: createHash("sha256").update(raw).digest("hex"),
    sourceCommit: receipt.sourceCommit
  };
}
function main() {
  const stageV020 = process.argv.length === 3 && process.argv[2] === "--stage-v020";
  if (process.env.CI || (!stageV020 && process.argv.length !== 2))
    throw Error("LOCAL_OWNER_AUDIT_ONLY");
  const options = stageV020 ? readStageContext() : {};
  const {records,rejected} = loadRecords(stageV020 ? stageEvidenceDir : evidenceDir);
  const result = summarizeRecords(records,rejected,options);
  console.log(JSON.stringify(result));
  if (result.structuralStatus !== "OWNER_ATTESTED_STRUCTURE_PASS") process.exitCode = 2;
}
module.exports = {auditDrive,validateRecord,summarizeRecords,loadRecords};
if (require.main === module) {
  try { main(); }
  catch { console.error("OWNER_OCR_EVIDENCE_AUDIT_HOLD: PRIVATE_RECORDS_UNAVAILABLE_OR_UNSAFE"); process.exitCode = 2; }
}
