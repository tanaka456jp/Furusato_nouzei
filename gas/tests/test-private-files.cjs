"use strict";
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..','..');
const files=cp.execFileSync('git',['ls-files','-z','--','gas'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
const forbidden=[];
const receipt=path.join(root,'gas/.private/furusato/receipt.json');
if(fs.existsSync(receipt)){
 const r=JSON.parse(fs.readFileSync(receipt,'utf8'));
 for(const k of ['scriptId','spreadsheetId','deploymentId','webAppUrl','protectedScriptId'])if(r[k])forbidden.push(r[k]);
}
for(const file of files){
 assert.ok(!/(^|\/)(\.private|node_modules|\.qa-python|dist)\//.test(file),'Private/generated tracked file: '+file);
 assert.ok(!/(^|\/)(\.clasp\.json|\.clasprc\.json|auth\.json|credentials\.json)$/.test(file),'Credential/config tracked: '+file);
 const text=fs.readFileSync(path.join(root,file),'utf8');
 for(const value of forbidden)assert.ok(!text.includes(value),'Private ID leaked in '+file);
 assert.ok(!/ya29\.[A-Za-z0-9_-]{20,}|AKfycb[A-Za-z0-9_-]{30,}/.test(text),'Potential token/deployment leaked in '+file);
}
console.log('PASS tracked GAS files contain no private configuration, credentials or known deployment IDs');
