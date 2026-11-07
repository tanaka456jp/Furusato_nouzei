"use strict";
// Entirely synthetic, offline. Never accesses a real global clasp credential.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const g=require('../deployment/private-gas.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'furusato-config-drift-'));
const protectedRoot=path.join(temp,'HousingERP');
const auth=path.join(temp,'.clasprc.json');
const files=['.clasp.json','appsscript.json','project.json'].map(x=>path.join(protectedRoot,x)).concat(auth);
const status=(report,name)=>report.checks.find(x=>x.name===name)?.state;
function snapshot(){
  return Object.fromEntries(files.map(p=>[path.resolve(p),fs.existsSync(p)?hash(fs.readFileSync(p)):null]));
}
function receipt(s){return {schema:'furusato-private-install/v1',createdByInstaller:true,protectedSnapshot:s};}
function diagnose(r){return g.configDriftReport(r,protectedRoot,auth);}
let count=0;
try {
  fs.mkdirSync(protectedRoot);
  files.forEach((p,i)=>fs.writeFileSync(p,'SYNTHETIC_SECRET_'+i));
  const old=snapshot();
  const before=files.map(p=>fs.readFileSync(p));
  const initial=diagnose(receipt(old));
  assert.equal(initial.status,'MATCH');
  assert.equal(initial.release,'HOLD');
  assert.deepEqual(initial.checks.map(x=>x.state),['UNCHANGED','UNCHANGED','UNCHANGED','UNCHANGED']);
  files.forEach((p,i)=>assert.deepEqual(fs.readFileSync(p),before[i]));
  count++;

  fs.writeFileSync(auth,'ROTATED_SYNTHETIC_OAUTH_TOKEN');
  const rotated=diagnose(receipt(old));
  assert.equal(rotated.status,'HOLD');
  assert.equal(status(rotated,'global-clasp-auth'),'CHANGED');
  assert.equal(rotated.checks.filter(x=>x.state!=='UNCHANGED').length,1);
  assert.ok(!JSON.stringify(rotated).includes('ROTATED_SYNTHETIC'));
  assert.ok(!JSON.stringify(rotated).includes(temp));
  assert.ok(!JSON.stringify(rotated).includes(old[path.resolve(auth)]));
  assert.ok(/unverified/.test(rotated.guidance));
  count++;

  fs.writeFileSync(files[0],'ALTERED_SYNTHETIC_HOUSING_SCRIPT_ID');
  const both=diagnose(receipt(old));
  assert.equal(both.status,'HOLD');
  assert.equal(status(both,'housing-clasp'),'CHANGED');
  assert.equal(status(both,'global-clasp-auth'),'CHANGED');
  count++;

  fs.unlinkSync(files[1]);
  assert.equal(status(diagnose(receipt(old)),'housing-appsscript'),'MISSING');
  count++;

  const missingBase=snapshot();
  fs.writeFileSync(files[1],'NEW_SYNTHETIC_MANIFEST');
  assert.equal(status(diagnose(receipt(missingBase)),'housing-appsscript'),'APPEARED');
  count++;

  const corrupt={...old,[path.join(temp,'unknown-sensitive-file')]:hash('secret')};
  assert.throws(()=>diagnose(receipt(corrupt)),/Protected snapshot/);
  assert.throws(()=>diagnose(receipt({...old,[path.resolve(files[0])]:'bad'})),/Protected snapshot/);
  assert.throws(()=>diagnose({schema:'other',protectedSnapshot:old}),/receipt/);
  count++;

  if(process.platform!=='win32') {
    fs.unlinkSync(files[2]);
    fs.symlinkSync(files[0],files[2]);
    const link=diagnose(receipt(old));
    assert.equal(status(link,'housing-project'),'BLOCKED_LINK');
    assert.equal(link.status,'HOLD');
    count++;
  }
  console.log('CONFIG_DRIFT_READONLY_PASS '+count+' synthetic checks; release HOLD');
} finally {
  fs.rmSync(temp,{recursive:true,force:true});
}
