"use strict";
// Remote writes only target resources created by this installer. Never adopt IDs.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const crypto=require('node:crypto'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),privateDir=path.join(root,'.private','furusato');
const policy=require('./policy.json');
const authFile=path.join(privateDir,'auth.json'),receiptFile=path.join(privateDir,'receipt.json');
const work=path.join(privateDir,'project');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function ensure(ok,message){if(!ok)throw new Error(message);}
function json(file){return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}
function save(file,value){fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{mode:0o600});}
function rejectLinks(paths){
  for(const p of paths)try{ensure(!fs.lstatSync(p).isSymbolicLink(),'Symlink/junction deployment path blocked');}catch(e){if(e.code!=='ENOENT')throw e;}
}
function safeDirectories(){
  rejectLinks([root,path.join(root,'.private'),privateDir,work,authFile,receiptFile,
    ...['.clasp.json','.claspignore',...policy.sourceFiles].map(f=>path.join(work,f)),
    ...['creation-journal.json','api-evidence.json','install.lock'].map(f=>path.join(privateDir,f)),
    ...policy.sourceFiles.map(f=>path.join(root,f))]);
}
function source(){return policy.sourceFiles.map(name=>({name:name.replace(/\.(gs|html|json)$/,''),
  type:name.endsWith('.gs')?'SERVER_JS':name.endsWith('.html')?'HTML':'JSON',source:fs.readFileSync(path.join(root,name),'utf8')}));}
function digest(files){return hash(JSON.stringify(files.map(f=>[f.name,f.type,f.source.replace(/\r\n/g,'\n')]).sort((a,b)=>a[0].localeCompare(b[0]))));}
function manifestCheck(m){
  ensure(m.webapp?.access==='MYSELF'&&m.webapp?.executeAs==='USER_DEPLOYING','Private manifest required');
  ensure(JSON.stringify(m.oauthScopes)===JSON.stringify(['spreadsheets.currentonly','drive.file','documents'].map(s=>'https://www.googleapis.com/auth/'+s)),'Unexpected application scopes');
  ensure(m.dependencies?.enabledAdvancedServices?.length===1&&m.dependencies.enabledAdvancedServices[0].serviceId==='drive'&&m.dependencies.enabledAdvancedServices[0].version==='v3'&&m.dependencies.enabledAdvancedServices[0].userSymbol==='Drive','Drive v3 required');
}
function preflight(){
  safeDirectories();manifestCheck(json(path.join(root,'appsscript.json')));
  ensure(JSON.stringify(fs.readFileSync(path.join(root,'.claspignore'),'utf8').trim().split(/\r?\n/))===JSON.stringify(['**/**','!Code.gs','!Engine.gs','!Index.html','!appsscript.json','!SourceOCR.gs']),'Upload allowlist mismatch');
  ensure(policy.release==='HOLD','Release must remain HOLD');source();
  return {status:'PASS',kind:'LOCAL_STATIC',release:'HOLD'};
}
function claspEntry(){
  const candidates=[path.join(root,'node_modules','@google','clasp'),path.join(process.env.APPDATA||'', 'npm','node_modules','@google','clasp')];
  for(const p of candidates)if(fs.existsSync(path.join(p,'package.json'))){const pkg=json(path.join(p,'package.json'));ensure(pkg.version===policy.claspVersion,'Install pinned clasp '+policy.claspVersion);return path.join(p,pkg.bin.clasp);}
  throw new Error('Install pinned tools: npm ci --prefix gas');
}
function clasp(args,cwd=work,interactive=false){
  const env={...process.env};for(const k of Object.keys(env))if(/^clasp_/i.test(k)||k==='GOOGLE_APPLICATION_CREDENTIALS')delete env[k];
  const r=cp.spawnSync(process.execPath,[claspEntry(),'--auth',authFile,...args],{cwd,env,encoding:'utf8',stdio:interactive?'inherit':'pipe',timeout:interactive?600000:120000});
  ensure(r.status===0,'clasp operation failed: '+args[0]+' (details withheld to protect IDs/tokens)');return r.stdout;
}
function snapshot(protectedRoot){
  ensure(protectedRoot&&fs.existsSync(path.join(protectedRoot,'.clasp.json')),'HousingERP .clasp.json required for denylist; provide --protected-root');
  ensure(path.resolve(protectedRoot)!==root&&!path.resolve(protectedRoot).startsWith(privateDir),'Invalid protected root');
  const files=[path.join(protectedRoot,'.clasp.json'),path.join(protectedRoot,'appsscript.json'),path.join(protectedRoot,'project.json'),path.join(os.homedir(),'.clasprc.json')];
  return Object.fromEntries(files.map(p=>[path.resolve(p),fs.existsSync(p)?hash(fs.readFileSync(p)):null]));
}
function unchanged(s){for(const [p,h] of Object.entries(s))ensure((fs.existsSync(p)?hash(fs.readFileSync(p)):null)===h,'Protected configuration changed; STOP');}

/**
 * Diagnose a previously captured install snapshot without credentials, network,
 * Google API calls, writes, secret values, hashes or local absolute paths.
 * A changed global clasp file may be ordinary token rotation, but the original
 * snapshot only has a hash: the cause cannot be inferred or auto-approved.
 */
function configDriftReport(receipt,protectedRoot,globalAuthPath=path.join(os.homedir(),'.clasprc.json')){
  ensure(receipt?.schema===policy.schema&&receipt.createdByInstaller===true,
    'Missing/invalid private install receipt; manual review required');
  ensure(protectedRoot&&path.resolve(protectedRoot)!==root&&
    !path.resolve(protectedRoot).startsWith(privateDir+path.sep),
    'Invalid protected root');
  const items=[
    ['housing-clasp',path.join(protectedRoot,'.clasp.json')],
    ['housing-appsscript',path.join(protectedRoot,'appsscript.json')],
    ['housing-project',path.join(protectedRoot,'project.json')],
    ['global-clasp-auth',globalAuthPath]
  ].map(([name,p])=>({name,file:path.resolve(p)}));
  const recorded=receipt.protectedSnapshot;
  ensure(recorded&&typeof recorded==='object'&&!Array.isArray(recorded)&&
    Object.keys(recorded).length===items.length&&
    items.every(item=>Object.hasOwn(recorded,item.file)&&
      (recorded[item.file]===null||/^[a-f0-9]{64}$/.test(recorded[item.file]))),
    'Protected snapshot does not match expected files; manual review required');
  const checks=items.map(({name,file})=>{
    let state,actual=null;
    try{
      const stat=fs.lstatSync(file);
      if(stat.isSymbolicLink())state='BLOCKED_LINK';
      else if(!stat.isFile())state='NOT_REGULAR_FILE';
      else actual=hash(fs.readFileSync(file));
    }catch(e){
      if(e.code!=='ENOENT')state='UNREADABLE';
    }
    if(!state)state=recorded[file]===actual?'UNCHANGED':
      actual===null?'MISSING':recorded[file]===null?'APPEARED':'CHANGED';
    return {name,state};
  });
  const match=checks.every(c=>c.state==='UNCHANGED');
  return {
    kind:'LOCAL_READONLY_CONFIG_DRIFT',status:match?'MATCH':'HOLD',release:'HOLD',
    checks,
    guidance:match?
      'Only the 4 local protected files match the recorded snapshot. Formal release remains HOLD.':
      'Change cause is unverified. Do not overwrite the snapshot, refresh its hashes, push, or deploy until the owner reviews the changed file(s).'
  };
}

async function accessToken(){
  ensure(fs.existsSync(authFile),'AUTH_REQUIRED: run setup-private-gas.ps1 -Login; authorize Furusato separately');
  const a=json(authFile),t=a.tokens?.default;ensure(t?.refresh_token&&t.client_id&&t.client_secret,'Isolated clasp credentials are incomplete');
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:t.client_id,client_secret:t.client_secret,refresh_token:t.refresh_token,grant_type:'refresh_token'}),signal:AbortSignal.timeout(30000)});
  ensure(r.ok,'AUTH_REQUIRED: isolated Google token refresh failed');return (await r.json()).access_token;
}
async function client(){
  const token=await accessToken();
  return async function api(url,method='GET',body){
    ensure(/^https:\/\/(script|www)\.googleapis\.com\//.test(url),'Unexpected API host');
    const response=await fetch(url,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
    if(!response.ok){let code='UNKNOWN';try{code=(await response.json()).error?.status||code;}catch{}throw new Error('Google API '+response.status+' '+code+'; no automatic API/security setting changes');}
    return response.status===204?{}:response.json();
  };
}
const scriptUrl=id=>'https://script.googleapis.com/v1/projects/'+encodeURIComponent(id);
const driveUrl=id=>'https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id);
async function sheetCheck(api,id,owner){
  const s=await api(driveUrl(id)+'?fields=id,name,mimeType,ownedByMe,owners(permissionId),trashed,shared,capabilities(canEdit),appProperties');
  ensure(s.id===id&&!s.trashed&&s.mimeType==='application/vnd.google-apps.spreadsheet'&&s.ownedByMe&&s.capabilities?.canEdit&&!s.shared&&s.owners?.length===1&&s.owners[0].permissionId===owner,'Sheet must be private, editable and owned by authenticated user');
  ensure(s.appProperties?.furusatoInstaller==='v1','Only installer-created synthetic sheet allowed');return s;
}
async function verify(api,r,protectedRoot){
  ensure(r.schema===policy.schema&&r.createdByInstaller===true,'No installer receipt; existing project adoption prohibited');
  ensure(r.scriptId&&r.spreadsheetId&&r.scriptId!==r.spreadsheetId,'Invalid receipt IDs');
  const denied=json(path.join(protectedRoot,'.clasp.json')).scriptId;
  ensure(denied&&r.protectedScriptId===denied&&r.scriptId!==denied&&r.spreadsheetId!==denied,'Protected ID collision or denylist changed');
  const protectedProject=await api(scriptUrl(denied));ensure(protectedProject.scriptId===denied,'Protected project lookup failed');
  ensure(protectedProject.parentId&&r.spreadsheetId!==protectedProject.parentId&&r.scriptId!==protectedProject.parentId,'Protected spreadsheet collision');
  const user=(await api('https://www.googleapis.com/drive/v3/about?fields=user(permissionId,emailAddress)')).user;
  ensure(user.permissionId===r.owner,'Google account changed');await sheetCheck(api,r.spreadsheetId,user.permissionId);
  const p=await api(scriptUrl(r.scriptId));
  const cfg=json(path.join(work,'.clasp.json'));identityCheck(r,p,user,cfg);
  unchanged(r.protectedSnapshot);return p;
}
function identityCheck(r,p,user,cfg){
  ensure(r.createdByInstaller===true&&r.schema===policy.schema&&r.title?.startsWith(policy.projectPrefix),'Existing project adoption prohibited');
  ensure(r.scriptId&&r.spreadsheetId&&r.scriptId!==r.protectedScriptId&&r.spreadsheetId!==r.protectedScriptId,'Protected ID collision');
  ensure(p.scriptId===r.scriptId&&p.parentId===r.spreadsheetId&&p.title===r.title&&p.creator?.email===user.emailAddress&&user.permissionId===r.owner,'Script ID, parent, title, owner or creator mismatch');
  ensure(cfg.scriptId===r.scriptId&&(!cfg.rootDir||cfg.rootDir==='.')&&(!cfg.parentId||cfg.parentId===r.spreadsheetId),'Local clasp target mismatch');
}
function deploymentCheck(d,id,version){
  ensure(d.deploymentConfig?.scriptId===id&&d.deploymentConfig?.versionNumber===version,'Deployment target/version mismatch');
  ensure(d.entryPoints?.length===1&&d.entryPoints[0].entryPointType==='WEB_APP','Expected exactly one web app');
  const w=d.entryPoints[0].webApp;
  ensure(w?.entryPointConfig?.access==='MYSELF'&&w.entryPointConfig.executeAs==='USER_DEPLOYING','Live deployment is NOT private');
  ensure(/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(w.url),'Unexpected web app URL');return w.url;
}
async function install({protectedRoot,deploy=false}){
  preflight();const before=snapshot(protectedRoot);const api=await client();fs.mkdirSync(work,{recursive:true});let r;
  const deniedId=json(path.join(protectedRoot,'.clasp.json')).scriptId;
  const lock=path.join(privateDir,'install.lock');const lockFd=fs.openSync(lock,'wx',0o600);
  const protectedRemote=async()=>({content:digest((await api(scriptUrl(deniedId)+'/content')).files),deployments:hash(JSON.stringify(await api(scriptUrl(deniedId)+'/deployments')))});
  let remoteBefore;
  try{
    remoteBefore=await protectedRemote();
    if(fs.existsSync(receiptFile))r=json(receiptFile);
    else{
      ensure(!fs.existsSync(path.join(work,'.clasp.json')),'Unrecorded clasp project; refusing to overwrite/adopt');
      ensure(!fs.existsSync(path.join(privateDir,'creation-journal.json')),'Incomplete creation; inspect private journal before retry');
      const denied=json(path.join(protectedRoot,'.clasp.json')).scriptId;
      const pp=await api(scriptUrl(denied));ensure(pp.scriptId===denied&&pp.parentId,'Cannot resolve protected script and spreadsheet');
      const user=(await api('https://www.googleapis.com/drive/v3/about?fields=user(permissionId,emailAddress)')).user;
      const title=policy.projectPrefix+crypto.randomUUID();
      const sheet=await api('https://www.googleapis.com/drive/v3/files?fields=id','POST',{name:title,mimeType:'application/vnd.google-apps.spreadsheet',appProperties:{furusatoInstaller:'v1'}});
      save(path.join(privateDir,'creation-journal.json'),{spreadsheetId:sheet.id,title,status:'SHEET_CREATED_NO_SCRIPT'});
      ensure(sheet.id!==pp.parentId&&sheet.id!==denied,'Protected sheet collision');await sheetCheck(api,sheet.id,user.permissionId);
      // clasp 3.3 --type sheets creates a DIFFERENT container and ignores parentId.
      // standalone + parentId uses projects.create with our already checked sheet.
      clasp(['create-script','--type','standalone','--title',title,'--parentId',sheet.id]);const cfg=json(path.join(work,'.clasp.json'));
      r={schema:policy.schema,createdByInstaller:true,createdAt:new Date().toISOString(),scriptId:cfg.scriptId,spreadsheetId:sheet.id,title,owner:user.permissionId,protectedScriptId:denied,protectedSnapshot:before,release:'HOLD'};save(receiptFile,r);
    }
    await verify(api,r,protectedRoot);const remote=await api(scriptUrl(r.scriptId)+'/content');
    if(r.uploadDigest)ensure(digest(remote.files)===r.uploadDigest,'Remote source drift; manual review required before push');
    else ensure(remote.files.every(f=>f.name==='appsscript'||(f.name==='Code'&&/^\s*function myFunction\(\)\s*\{\s*\}\s*$/.test(f.source))),'New project contains unexpected code; refusing push');
    safeDirectories();for(const f of policy.sourceFiles)fs.copyFileSync(path.join(root,f),path.join(work,f));fs.copyFileSync(path.join(root,'.claspignore'),path.join(work,'.claspignore'));
    await verify(api,r,protectedRoot);clasp(['push','--force']);const uploaded=await api(scriptUrl(r.scriptId)+'/content');
    ensure(digest(uploaded.files)===digest(source()),'Uploaded source digest mismatch');manifestCheck(JSON.parse(uploaded.files.find(f=>f.name==='appsscript').source));
    r.uploadDigest=digest(uploaded.files);save(receiptFile,r);
    if(deploy){
      await verify(api,r,protectedRoot);const version=await api(scriptUrl(r.scriptId)+'/versions','POST',{description:'Furusato synthetic acceptance; release HOLD'});
      const frozen=await api(scriptUrl(r.scriptId)+'/content?versionNumber='+version.versionNumber);
      ensure(digest(frozen.files)===r.uploadDigest,'Immutable version digest mismatch');manifestCheck(JSON.parse(frozen.files.find(f=>f.name==='appsscript').source));
      clasp(['create-deployment','--versionNumber',String(version.versionNumber),'--description','Furusato PRIVATE synthetic; HOLD']);
      const list=await api(scriptUrl(r.scriptId)+'/deployments');const matches=(list.deployments||[]).filter(d=>d.deploymentConfig?.versionNumber===version.versionNumber);
      ensure(matches.length===1,'Deployment not uniquely found');const actual=await api(scriptUrl(r.scriptId)+'/deployments/'+encodeURIComponent(matches[0].deploymentId));
      r.webAppUrl=deploymentCheck(actual,r.scriptId,version.versionNumber);r.deploymentId=actual.deploymentId;r.versionNumber=version.versionNumber;r.privateVerifiedAt=new Date().toISOString();save(receiptFile,r);
    }
    ensure(JSON.stringify(await protectedRemote())===JSON.stringify(remoteBefore),'Protected Google source/deployments changed during installation; STOP');
    const evidence={...preflight(),kind:'REAL_GOOGLE_API',sourceDigest:r.uploadDigest,sourceCommit:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),privateDeployment:deploy?'PASS':'HOLD',webUi:'HOLD',ocr:'HOLD',print:'HOLD',protectedConfiguration:'UNCHANGED',protectedGoogleSourceAndDeployments:'UNCHANGED',timestamp:new Date().toISOString()};
    save(path.join(privateDir,'api-evidence.json'),evidence);return evidence;
  }finally{fs.closeSync(lockFd);fs.unlinkSync(lock);unchanged(before);}
}
async function main(){
  const args=process.argv.slice(2);const mode=args.shift()||'preflight';const ix=args.indexOf('--protected-root');
  const protectedRoot=ix>=0?path.resolve(args[ix+1]):path.resolve(root,'..','..','HousingERP');
  if(mode==='preflight')console.log(JSON.stringify(preflight()));
  else if(mode==='reuse-auth'){
    // Explicit opt-in only. Copy credentials; never pass global auth to clasp.
    preflight();ensure(!fs.existsSync(authFile),'Isolated authentication already exists');
    const globalAuth=path.join(os.homedir(),'.clasprc.json');const original=fs.readFileSync(globalAuth);
    ensure(json(globalAuth).tokens?.default?.refresh_token,'Existing clasp authorization unavailable');
    fs.mkdirSync(privateDir,{recursive:true});fs.writeFileSync(authFile,original,{flag:'wx',mode:0o600});
    ensure(hash(fs.readFileSync(globalAuth))===hash(original),'Global auth changed');
    await client();console.log('EXISTING_AUTH_REUSED_IN_ISOLATION: global authentication unchanged');
  }
  else if(mode==='login'){preflight();fs.mkdirSync(privateDir,{recursive:true});clasp(['login'],privateDir,true);}
  else if(mode==='install')console.log(JSON.stringify(await install({protectedRoot,deploy:args.includes('--deploy')})));
  else if(mode==='diagnose'){
    safeDirectories();
    const report=configDriftReport(json(receiptFile),protectedRoot);
    console.log(JSON.stringify(report));
    if(report.status!=='MATCH')process.exitCode=2;
  }
  else if(mode==='verify'){
    preflight();const api=await client(),r=json(receiptFile);await verify(api,r,protectedRoot);
    const actualDeployment=await api(scriptUrl(r.scriptId)+'/deployments/'+encodeURIComponent(r.deploymentId));
    ensure(actualDeployment.deploymentId===r.deploymentId&&deploymentCheck(actualDeployment,r.scriptId,r.versionNumber)===r.webAppUrl,'Receipt deployment URL/ID differs from Google');
    const frozen=await api(scriptUrl(r.scriptId)+'/content?versionNumber='+r.versionNumber);
    ensure(digest(frozen.files)===r.uploadDigest&&r.uploadDigest===digest(source()),'Deployed source differs from local acceptance candidate');
    manifestCheck(JSON.parse(frozen.files.find(f=>f.name==='appsscript').source));console.log('REAL_GOOGLE_PRIVATE_DEPLOYMENT_PASS');
  }
  else throw new Error('Unknown command');
}
module.exports={preflight,manifestCheck,source,digest,verify,identityCheck,sheetCheck,deploymentCheck,install,snapshot,unchanged,configDriftReport,rejectLinks,accessToken};
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
