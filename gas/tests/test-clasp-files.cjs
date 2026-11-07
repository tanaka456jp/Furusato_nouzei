"use strict";
// Exercise the installed, pinned clasp collector; no OAuth/API/remote writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'..');
 const {Files}=await import(require('node:url').pathToFileURL(path.join(root,'node_modules/@google/clasp/build/src/core/files.js')).href);
 const f=new Files({configFilePath:path.join(root,'.clasp.json'),project:{scriptId:'synthetic-readonly'},files:{contentDir:root,projectRootDir:root,fileExtensions:{SERVER_JS:['.js','.gs'],HTML:['.html'],JSON:['.json']},ignorePatterns:fs.readFileSync(path.join(root,'.claspignore'),'utf8').trim().split(/\r?\n/),skipSubdirectories:false}});
 const actual=await f.collectLocalFiles();
 assert.deepEqual(actual.map(x=>[x.remotePath,x.type]).sort(),[['Code','SERVER_JS'],['Engine','SERVER_JS'],['SourceOCR','SERVER_JS'],['Index','HTML'],['appsscript','JSON']].sort());
 console.log('PASS real clasp 3.3.0 collects exactly five approved source files without authentication');
})().catch(e=>{console.error(e);process.exitCode=1;});
