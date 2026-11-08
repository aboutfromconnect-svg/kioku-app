const waitUntil=require('./wait-until.cjs');
// HTTPS navigation-only migration. Test-only certificate, profiles and IndexedDB.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),https=require('node:https');
const {execFileSync}=require('node:child_process'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),revision='7919e73e8af7331851f05eea5d90e10fae66190a';
const names=['index.html','data-safety.js','environment.js','updates.js','service-worker.js','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png'];
const old={},current={};
for(const n of names){current[n]=fs.readFileSync(path.join(root,n));if(!['environment.js','updates.js'].includes(n))old[n]=execFileSync('git',['show',revision+':'+n],{cwd:root,maxBuffer:8e6});}
for(const map of [old,current])map['index.html']=map['index.html'].toString().replace('function openDB(){return KiokuData.openDatabase()}',"function openDB(){return KiokuData.openDatabase(indexedDB,'kioku-test-bootstrap')}");
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kioku-test-tls-')),key=path.join(dir,'key.pem'),cert=path.join(dir,'cert.pem');
let browser,server,files=old,prefix='/';
(async()=>{try{
 const openssl=process.env.OPENSSL_PATH||(process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl');
 execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
 server=https.createServer({key:fs.readFileSync(key),cert:fs.readFileSync(cert)},(req,res)=>{
  const u=new URL(req.url,'https://localhost');const n=u.pathname.startsWith(prefix)?u.pathname.slice(prefix.length)||'index.html':'';
  if(process.env.DEBUG_BOOTSTRAP)console.log('SERVE',files===old?'old':'new',n);const body=files[n];res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',n.endsWith('.js')?'text/javascript':n.endsWith('.html')?'text/html; charset=utf-8':'application/octet-stream');
  if(!body){res.writeHead(404);res.end();}else res.end(body);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH,args:['--ignore-certificate-errors','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
 for(prefix of ['/','/kioku-app/']){
  files=old;const ctx=await browser.newContext({ignoreHTTPSErrors:true});
  await ctx.addInitScript(()=>{const open=IDBFactory.prototype.open;IDBFactory.prototype.open=function(n,...a){if(n!=='kioku-test-bootstrap')throw Error('Production DB blocked');return open.call(this,n,...a)};IDBFactory.prototype.deleteDatabase=()=>{throw Error('DB deletion forbidden')};});
  const url=`https://127.0.0.1:${server.address().port}${prefix}`,page=await ctx.newPage();page.on('console',m=>{if(m.type()==='error')console.log('BROWSER',m.text())});page.on('pageerror',e=>console.log('PAGE',e.message));await page.goto(url);await page.waitForFunction(()=>navigator.serviceWorker.controller);
  await page.locator('#entryText').fill('HTTPS更新の架空日記');await page.locator('[data-mood="安心"]').click();await page.locator('#saveEntry').click();await page.waitForFunction(()=>document.querySelector('#entryText').value==='');
  const snapshot=()=>page.evaluate(async()=>{const db=await KiokuData.openDatabase(indexedDB,'kioku-test-bootstrap');const all=await KiokuData.readAll(db);db.close();return all});const before=await snapshot();
  const other=await ctx.newPage();await other.goto(url);await other.waitForFunction(()=>!document.querySelector('#saveEntry').disabled);await other.locator('#entryText').fill('別画面の未保存入力');
  files=current;await page.reload();
  // Never call register(), update(), skipWaiting() or unregister() from the test.
  await waitUntil(page,()=>new Promise(resolve=>{
    const worker=navigator.serviceWorker.controller;if(!worker){resolve(false);return;}
    const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();resolve(false)},1000);
    channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data?.release==='0.2-ui3')};
    worker.postMessage({type:'KIOKU_VERSION'},[channel.port2]);
  }));
  assert.equal(await other.locator('#entryText').inputValue(),'別画面の未保存入力');
  const response=await page.reload();if(process.env.DEBUG_BOOTSTRAP)console.log('NAV',response.fromServiceWorker(),(await response.text()).match(/kioku-release[^>]+/)[0]);await page.waitForFunction(()=>globalThis.KiokuData?.RELEASE==='0.2-ui3',null,{timeout:5000}).catch(async e=>{console.log(await page.evaluate(()=>({release:globalThis.KiokuData?.RELEASE,error:document.querySelector('#startupError')?.textContent,meta:document.querySelector('meta[name=kioku-release]')?.content})));throw e});assert.deepEqual(await snapshot(),before);
  console.log('PASS HTTPS legacy navigation-only update, draft and IndexedDB preservation: '+prefix);await ctx.close();
 }
}finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));for(const f of [key,cert])if(fs.existsSync(f))fs.unlinkSync(f);fs.rmdirSync(dir);}})().catch(e=>{console.error(e);process.exitCode=1});
