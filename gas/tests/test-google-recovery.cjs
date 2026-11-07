"use strict";

const assert = require("node:assert/strict");
const {googleApi, refreshToken} = require("../deployment/private-gas.cjs");

const url = "https://www.googleapis.com/drive/v3/about";
const marker = "synthetic-secret-must-not-escape";
const credentials = {client_id:"test-client", client_secret:marker, refresh_token:"synthetic-refresh"};
const goodToken = {status:200, ok:true, json:async () => ({access_token:"synthetic-access"})};
const success = {status:200, ok:true, json:async () => ({ready:true})};

function queued(...responses) {
  let calls = 0;
  return {
    calls: () => calls,
    transport: async () => {
      const entry = responses[calls++];
      assert.ok(entry, "unexpected retry");
      if (entry instanceof Error) throw entry;
      return entry;
    }
  };
}

function failure(status, details) {
  return {status, ok:false, json:async () => ({error:{status:marker, message:marker, details}})};
}

async function safeReject(operation, code) {
  await assert.rejects(operation, error => {
    assert.match(error.message, new RegExp("^" + code + ":"));
    assert.ok(!error.message.includes(marker));
    return true;
  });
}

async function main() {
  const bad = queued(failure(400));
  await safeReject(() => refreshToken(credentials, bad.transport), "SAFE-GOOGLE-AUTH-REJECTED");
  assert.equal(bad.calls(), 1);
  const invalid = queued();
  await safeReject(() => refreshToken({client_secret:marker}, invalid.transport), "SAFE-GOOGLE-AUTH-CONFIG");
  assert.equal(invalid.calls(), 0);
  const renewal = queued(failure(503), goodToken);
  assert.equal(await refreshToken(credentials, renewal.transport), "synthetic-access");
  assert.equal(renewal.calls(), 2);
  const invalidResponse = queued({status:200,ok:true,json:async () => ({unknown:marker})});
  await safeReject(() => refreshToken(credentials, invalidResponse.transport), "SAFE-GOOGLE-AUTH-RESPONSE");

  for (const [response, code] of [
    [failure(401), "SAFE-GOOGLE-AUTH-EXPIRED"],
    [failure(403), "SAFE-GOOGLE-PERMISSION"],
    [failure(403, [{reason:"SERVICE_DISABLED"}]), "SAFE-GOOGLE-SERVICE-DISABLED"],
    [failure(404), "SAFE-GOOGLE-API"],
    [{status:200,ok:true,json:async () => {throw new Error(marker);}}, "SAFE-GOOGLE-API-RESPONSE"]
  ]) {
    const sequence = queued(response, success);
    const api = googleApi("synthetic-access", sequence.transport);
    await safeReject(() => api(url), code);
    assert.equal(sequence.calls(), 1);
    assert.deepEqual(await api(url), {ready:true});
  }

  const timeout = new DOMException(marker, "TimeoutError");
  for (const outage of [timeout, failure(429), new TypeError(marker)]) {
    const sequence = queued(outage, success);
    assert.deepEqual(await googleApi("synthetic-access", sequence.transport)(url), {ready:true});
    assert.equal(sequence.calls(), 2);
  }

  const offline = queued(timeout, timeout, success);
  const retryRead = googleApi("synthetic-access", offline.transport);
  await safeReject(() => retryRead(url), "SAFE-GOOGLE-TIMEOUT");
  assert.equal(offline.calls(), 2);
  assert.deepEqual(await retryRead(url), {ready:true});

  const write = queued(failure(503));
  await safeReject(() => googleApi("synthetic-access", write.transport)(url, "POST", {synthetic:true}), "SAFE-GOOGLE-TEMPORARY");
  assert.equal(write.calls(), 1);
  console.log("GOOGLE_RECOVERY_PASS 14 isolated scenarios; no account, Drive, or deployment mutations");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
