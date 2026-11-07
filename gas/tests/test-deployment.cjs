"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const g=require('../deployment/private-gas.cjs');
let count=0;function test(name,fn){fn();count++;console.log('PASS '+name);}
const copy=x=>JSON.parse(JSON.stringify(x));
test('offline preflight checks full source policy',()=>assert.equal(g.preflight().kind,'LOCAL_STATIC'));
test('reject existing and dangling directory junctions before writes',()=>{
 const dir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'furusato-link-test-'));
 const target=path.join(dir,'target'),link=path.join(dir,'link');fs.mkdirSync(target);
 try{fs.symlinkSync(target,link,process.platform==='win32'?'junction':'dir');assert.throws(()=>g.rejectLinks([link]));fs.rmdirSync(target);assert.throws(()=>g.rejectLinks([link]));}
 finally{if(fs.existsSync(target))fs.rmdirSync(target);try{fs.unlinkSync(link);}catch(e){if(e.code!=='ENOENT')throw e;}fs.rmdirSync(dir);}
});
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../appsscript.json'),'utf8'));
for(const access of ['ANYONE','ANYONE_ANONYMOUS','DOMAIN',undefined])test('reject access '+access,()=>{
 const m=copy(manifest);m.webapp.access=access;assert.throws(()=>g.manifestCheck(m));
});
test('reject user accessing execution',()=>{const m=copy(manifest);m.webapp.executeAs='USER_ACCESSING';assert.throws(()=>g.manifestCheck(m));});
test('reject extra OAuth scopes',()=>{const m=copy(manifest);m.oauthScopes.push('https://www.googleapis.com/auth/drive');assert.throws(()=>g.manifestCheck(m));});
test('reject absent advanced Drive service',()=>{const m=copy(manifest);m.dependencies.enabledAdvancedServices=[];assert.throws(()=>g.manifestCheck(m));});
const receipt={schema:'furusato-private-install/v1',createdByInstaller:true,title:'Furusato_PRIVATE_SYNTHETIC_TEST',scriptId:'synthetic-script',spreadsheetId:'synthetic-sheet',protectedScriptId:'protected-script',owner:'synthetic-owner'};
// Apps Script REST Project uses "creator" (not creatorUser).
const project={scriptId:receipt.scriptId,parentId:receipt.spreadsheetId,title:receipt.title,creator:{email:'synthetic@example.invalid'}};
const user={emailAddress:'synthetic@example.invalid',permissionId:receipt.owner};
const cfg={scriptId:receipt.scriptId,rootDir:'.',parentId:receipt.spreadsheetId};
test('accept fully matching installer target',()=>g.identityCheck(receipt,project,user,cfg));
for(const [key,value] of [['createdByInstaller',false],['scriptId','protected-script'],['spreadsheetId','protected-script'],['owner','other-owner'],['title','HousingERP'],['schema','other']])test('reject changed receipt '+key,()=>{const r={...receipt,[key]:value};assert.throws(()=>g.identityCheck(r,project,user,cfg));});
for(const [key,value] of [['scriptId','other-script'],['parentId','other-sheet'],['title','other-title'],['creator',{email:'other@example.invalid'}]])test('reject changed remote '+key,()=>assert.throws(()=>g.identityCheck(receipt,{...project,[key]:value},user,cfg)));
for(const [key,value] of [['scriptId','protected-script'],['parentId','other-sheet'],['rootDir','../../HousingERP']])test('reject clasp '+key,()=>assert.throws(()=>g.identityCheck(receipt,project,user,{...cfg,[key]:value})));
const deployment={deploymentConfig:{scriptId:receipt.scriptId,versionNumber:3},entryPoints:[{entryPointType:'WEB_APP',webApp:{url:'https://script.google.com/macros/s/SYNTHETIC/exec',entryPointConfig:{access:'MYSELF',executeAs:'USER_DEPLOYING'}}}]};
test('actual deployment permission evidence required',()=>assert.ok(g.deploymentCheck(deployment,receipt.scriptId,3)));
for(const change of [d=>d.entryPoints[0].webApp.entryPointConfig.access='ANYONE_ANONYMOUS',d=>d.entryPoints[0].webApp.entryPointConfig.executeAs='USER_ACCESSING',d=>d.entryPoints=[],d=>d.deploymentConfig.versionNumber=2,d=>d.deploymentConfig.scriptId='protected-script',d=>d.entryPoints[0].webApp.url='https://evil.invalid/exec'])test('reject invalid actual deployment '+count,()=>{const d=copy(deployment);change(d);assert.throws(()=>g.deploymentCheck(d,receipt.scriptId,3));});
test('digest detects extra uploaded code',()=>assert.notEqual(g.digest(g.source()),g.digest([...g.source(),{name:'Unsafe',type:'SERVER_JS',source:'function unsafe(){}'}])));
test('digest normalizes only newline platform differences',()=>assert.equal(g.digest([{name:'a',type:'HTML',source:'a\r\nb'}]),g.digest([{name:'a',type:'HTML',source:'a\nb'}])));
(async()=>{
 const sheet={id:receipt.spreadsheetId,mimeType:'application/vnd.google-apps.spreadsheet',ownedByMe:true,capabilities:{canEdit:true},owners:[{permissionId:receipt.owner}],appProperties:{furusatoInstaller:'v1'},shared:false,trashed:false};
 await g.sheetCheck(async()=>sheet,receipt.spreadsheetId,receipt.owner);count++;
 for(const edit of [{shared:true},{trashed:true},{ownedByMe:false},{owners:[{permissionId:'other'}]},{appProperties:{}},{mimeType:'text/plain'},{capabilities:{canEdit:false}}]){await assert.rejects(()=>g.sheetCheck(async()=>({...sheet,...edit}),receipt.spreadsheetId,receipt.owner));count++;}
 console.log('DEPLOYMENT SAFETY RESULT '+count+' synthetic checks passed; real Google acceptance HOLD');
})().catch(e=>{console.error(e);process.exitCode=1;});
