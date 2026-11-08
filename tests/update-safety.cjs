const waitUntil=require('./wait-until.cjs');
// Real Chromium Service Worker tests, using only ephemeral profiles and synthetic data.
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
// Pin the verified v0.1 baseline so later changes to main cannot change this test.
const LEGACY_REVISION = process.env.KIOKU_LEGACY_REVISION || '5fff049ee54f1a03be11a225d02e7c66fbffefea';
const read = file => fs.readFileSync(path.join(root,file));
const current = read('index.html').toString().replace('KiokuUpdates.start(', '(()=>{})(').replace('function openDB(){return KiokuData.openDatabase()}', "function openDB(){return KiokuData.openDatabase(indexedDB,'kioku-test-upgrade')}");
const legacy = execFileSync('git',['show',`${LEGACY_REVISION}:index.html`],{cwd:root,encoding:'utf8'}).replace("DB_NAME='kioku-personal-v1'", "DB_NAME='kioku-test-upgrade'").replace('function openDB(){return KiokuData.openDatabase()}',"function openDB(){return KiokuData.openDatabase(indexedDB,'kioku-test-upgrade')}");
const legacySW = execFileSync('git',['show',`${LEGACY_REVISION}:service-worker.js`],{cwd:root});
const legacyHasModule=legacy.includes('./data-safety.js');
const legacyData=legacyHasModule?execFileSync('git',['show',`${LEGACY_REVISION}:data-safety.js`],{cwd:root}):null;
const legacyCache=legacyHasModule?'kioku-static-0.1.1-safety2':'kioku-static-v1';
const release = '0.2-ui3', cacheName = 'kioku-static-' + release;
const basePath = process.env.KIOKU_TEST_BASE_PATH || '/';
assert(/^\/(?:[a-z0-9-]+\/)*$/.test(basePath));
let version = 'old', fault = null, groups = 0;
const pass = name => { groups++; console.log('PASS ' + name); };
const server = http.createServer((req,res) => {
  const url = new URL(req.url,'http://localhost');
  if (!url.pathname.startsWith(basePath)) { res.writeHead(404); res.end(); return; }
  url.pathname = '/' + url.pathname.slice(basePath.length);
  if(process.env.DEBUG_UPDATE)console.log('REQUEST',version,fault,url.pathname);
  res.setHeader('Cache-Control','no-store');
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(version === 'old' || fault === 'old-html' ? legacy : current);
  } else if (url.pathname === '/service-worker.js') {
    res.setHeader('Content-Type','text/javascript'); res.end(version === 'old' ? legacySW : read('service-worker.js'));
  } else if (url.pathname === '/updates.js') {res.setHeader('Content-Type','text/javascript');if(fault==='missing-updates'){res.writeHead(404);res.end('missing')}else res.end(read('updates.js'));
  } else if (url.pathname === '/environment.js') {
    if(fault==='missing-environment'){res.writeHead(404);res.end('missing');}
    else {res.setHeader('Content-Type','text/javascript');res.end(read('environment.js'));}
  } else if (url.pathname === '/data-safety.js') {
    if(legacyHasModule&&url.searchParams.get('v')==='0.1.1-safety2'){res.setHeader('Content-Type','text/javascript');res.end(legacyData);}
    else if (fault === 'missing-script') { res.writeHead(404); res.end('missing'); }
    else { res.setHeader('Content-Type','text/javascript'); res.end(fault === 'wrong-script' ? 'globalThis.KiokuData={RELEASE:"incompatible"};' : read('data-safety.js')); }
  } else if (['/manifest.webmanifest','/icons/icon-192.png','/icons/icon-512.png'].includes(url.pathname)) {
    res.setHeader('Content-Type',url.pathname.endsWith('.png')?'image/png':'application/manifest+json'); res.end(read(url.pathname.slice(1)));
  } else { res.writeHead(404); res.end(); }
});

(async () => {
  let browser;
  try {
    const hash = 'sha256-' + createHash('sha256').update(read('data-safety.js')).digest('base64');
    assert(current.includes(`integrity="${hash}"`));
    assert(read('service-worker.js').toString().includes(`const INTEGRITY = '${hash}'`));
    assert(read('service-worker.js').toString().includes('await self.skipWaiting()'));
    pass('HTML and worker integrity hashes match actual script bytes; verified activation without forced navigation');
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base = `http://127.0.0.1:${server.address().port}${basePath}`;
    browser = await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),args:['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
    async function context() {
      const ctx = await browser.newContext({acceptDownloads:true,serviceWorkers:'allow'});
      // Do not intercept worker requests: exercise the browser's real fetch lifecycle.
      // Host resolution is restricted to loopback by the launch arguments above.
      await ctx.addInitScript(() => {
        window.__dbAudit = [];
        const open=IDBFactory.prototype.open,remove=IDBFactory.prototype.deleteDatabase;
        IDBFactory.prototype.open=function(name,...args){
          window.__dbAudit.push({op:'open',name});
          if(!name.startsWith('kioku-test-'))throw new Error('PRODUCTION DB BLOCKED');
          return open.call(this,name,...args);
        };
        IDBFactory.prototype.deleteDatabase=function(name,...args){
          window.__dbAudit.push({op:'deleteDatabase',name});
          throw new Error('Database deletion forbidden in update tests');
        };
        for(const method of ['clear','delete','put','add']) {
          const original=IDBObjectStore.prototype[method];
          IDBObjectStore.prototype[method]=function(...args){window.__dbAudit.push({op:method});return original.apply(this,args);};
        }
      });
      return ctx;
    }
    const snapshot = page => page.evaluate(() => new Promise((resolve,reject)=>{
      const req=indexedDB.open('kioku-test-upgrade',1);
      req.onsuccess=()=>{const db=req.result,tx=db.transaction('entries'),read=tx.objectStore('entries').getAll();tx.oncomplete=()=>{db.close();resolve(read.result)};tx.onabort=()=>reject(tx.error)};
      req.onerror=()=>reject(req.error);
    }));
    async function seedOld(ctx) {
      version='old';fault=null;
      const page=await ctx.newPage();await page.goto(base);
      await page.waitForFunction(()=>!document.querySelector('#saveEntry').disabled);
      const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=2;c.getContext('2d').fillRect(0,0,2,2);return c.toDataURL('image/png').split(',')[1]});
      await page.locator('#entryText').fill('更新試験だけの架空日記');
      await page.locator('[data-mood="安心"]').click();
      await page.locator('#photoInput').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
      await page.waitForFunction(()=>document.querySelector('#photosStatus').textContent.includes('1/3'));
      await page.locator('#saveEntry').click();
      await page.locator('#recentList .record').click();
      await page.locator('#annotationText').fill('旧版で追加した架空の追記');await page.locator('#saveAnnotation').click();
      await page.waitForFunction(()=>document.querySelector('#annotationList').textContent.includes('旧版で追加'));
      await page.evaluate(()=>new Promise((resolve,reject)=>{
        const req=indexedDB.open('kioku-test-upgrade',1);req.onsuccess=()=>{
          const db=req.result,tx=db.transaction('entries','readwrite'),st=tx.objectStore('entries');
          st.getAll().onsuccess=e=>{const entry=e.target.result[0];entry.future={nested:['架空',null,123]};entry.annotations[0].future={keep:true};st.put(entry)};
          tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>reject(tx.error);
        };
      }));
      return page;
    }
    // Actual old application writes the data. The new application must not rewrite it.
    const migration=await context();let page=await seedOld(migration);const before=await snapshot(page);
    version='new';await page.reload();await page.waitForFunction(()=>!document.querySelector('#saveEntry').disabled);
    assert.deepEqual(await snapshot(page),before);
    assert(!(await page.evaluate(()=>__dbAudit)).some(e=>['clear','delete','deleteDatabase','put','add'].includes(e.op)));
    pass('Actual legacy UI to v0.2 upgrade preserves all data with zero writes');
    // V2 complete export/restore into a separate database, including the unknown fields.
    const roundtrip=await page.evaluate(async()=>{
      const src=await KiokuData.openDatabase(indexedDB,'kioku-test-upgrade'),entries=await KiokuData.readAll(src);
      const payload=await KiokuData.parseBackup(await KiokuData.createBackup(entries));
      const dst=await KiokuData.openDatabase(indexedDB,'kioku-test-roundtrip');
      await KiokuData.restore(dst,payload.entries,KiokuData.planRestore([],payload.entries));
      const restored=await KiokuData.readAll(dst);src.close();dst.close();return restored;
    });assert.deepEqual(roundtrip,before);pass('V2 restores legacy diary, photo, moods, annotation and nested unknown fields exactly');
    for(const failure of ['missing-script','wrong-script','missing-environment']) {
      fault=failure;await page.reload();await page.locator('#startupError').waitFor();
      assert.match(await page.locator('#startupError').innerText(),/削除や初期化は不要/);
      assert.equal(await page.locator('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled)').count(),0);
      assert.deepEqual(await page.evaluate(()=>__dbAudit),[]);
      assert.deepEqual(await snapshot(page),before);
      pass(`${failure}: startup error, all operations disabled, no DB opened, records preserved`);
    }
    fault=null;await page.reload();await page.waitForFunction(()=>!document.querySelector('#saveEntry').disabled);
    assert.deepEqual(await snapshot(page),before);pass('Reload after dependency recovery preserves all records');
    await page.locator('[data-tab="settings"]').click();
    const downloadPromise=page.waitForEvent('download');await page.locator('#exportData').click();const download=await downloadPromise;await download.cancel();
    await page.waitForFunction(()=>document.querySelector('#backupStatus').textContent.includes('保存完了は未確認'));
    assert(!/バックアップ成功|保存が完了/.test(await page.locator('#backupStatus').innerText()));
    assert.equal(await page.evaluate(()=>localStorage.getItem('kioku-last-backup')),null);
    pass('Cancelled/unconfirmed download never reports backup save success');await migration.close();

    // Real worker lifecycle: failed installs preserve old active worker.
    // Failed installs must leave the old active worker intact.
    for(const failure of ['missing-script','wrong-script','missing-environment','missing-updates','old-html']) {
      const failureContext=await context();page=await seedOld(failureContext);const original=await snapshot(page);
      await page.evaluate(async()=>{await navigator.serviceWorker.register('./service-worker.js');await navigator.serviceWorker.ready});
      await page.waitForFunction(()=>navigator.serviceWorker.controller);
      version='new';fault=failure;
      const state=await page.evaluate(async()=>{
        const r=await navigator.serviceWorker.getRegistration();
        const settled=new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>reject(new Error('Worker install did not settle: '+JSON.stringify({installing:r.installing?.state,waiting:r.waiting?.state,active:r.active?.state}))),20000);
          r.addEventListener('updatefound',()=>{
            const worker=r.installing;
            const check=()=>{if(['redundant','installed'].includes(worker.state)){clearTimeout(timer);resolve(worker.state)}};
            worker.addEventListener('statechange',check);check();
          },{once:true});
        });
        await r.update();return settled;
      });assert.equal(state,'redundant');assert.deepEqual(await snapshot(page),original);
      assert(await page.evaluate(name=>caches.has(name),legacyCache));
      pass(`Worker rejects ${failure} release and preserves old worker and diary`);
      await failureContext.close();
    }
    const swctx=await context();page=await seedOld(swctx);const original=await snapshot(page);
    await page.evaluate(async()=>{await navigator.serviceWorker.register('./service-worker.js');await navigator.serviceWorker.ready});
    await page.waitForFunction(()=>navigator.serviceWorker.controller);
    const other=await swctx.newPage();await other.goto(base);await other.waitForFunction(()=>navigator.serviceWorker.controller);
    await other.waitForFunction(()=>!document.querySelector('#saveEntry').disabled);
    await other.locator('#entryText').fill('未保存の架空入力');
    version='new';fault=null;
    await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update()});
    await waitUntil(page,async()=>{const r=await navigator.serviceWorker.getRegistration();return r.active?.scriptURL && !r.installing && !r.waiting && caches.has('kioku-static-0.2-ui3')});
    assert(await page.evaluate(name=>caches.has(name),legacyCache));
    assert.deepEqual(await snapshot(other),original);
    pass('Verified worker activates with two legacy windows open; IndexedDB and old cache retained');
    assert.equal(await other.locator('#entryText').inputValue(),'未保存の架空入力');
    await page.reload();await page.waitForFunction(()=>globalThis.KiokuData?.RELEASE==='0.2-ui3');
    assert.equal(await other.locator('#entryText').inputValue(),'未保存の架空入力');
    pass('Reload switches one window to new release without reloading another draft');
    assert.deepEqual(await snapshot(page),original);
    pass('Manual reload preserves legacy records without closing all windows');
    // Server now intentionally serves an incompatible release. Cached shell must remain coherent.
    fault='old-html';await page.reload();await page.waitForFunction(()=>globalThis.KiokuData?.RELEASE==='0.2-ui3');
    assert.deepEqual(await snapshot(page),original);pass('Active worker never swaps cached HTML for unrelated network HTML');
    fault=null;await swctx.setOffline(true);await page.reload();await page.waitForFunction(()=>!document.querySelector('#saveEntry').disabled);
    assert.deepEqual(await snapshot(page),original);pass('Complete new shell and existing diary work offline');
    await page.evaluate(async cacheName=>{const c=await caches.open(cacheName);await c.delete('./data-safety.js?v=0.2-ui3')},cacheName);
    await page.reload();await page.locator('#startupError').waitFor();assert.deepEqual(await page.evaluate(()=>__dbAudit),[]);
    assert.deepEqual(await snapshot(page),original);pass('Missing cached script fails closed offline without opening or modifying DB');
    await swctx.close();
    console.log(`PASS ${groups} update-safety groups; ephemeral browser, synthetic data, production DB blocked`);
  } finally {
    if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));
  }
})().catch(e=>{console.error(e);process.exitCode=1});
