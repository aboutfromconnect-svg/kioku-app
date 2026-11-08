// Run: NODE_PATH=<directory containing playwright> node tests/run.cjs
// Only a fresh browser profile, loopback server and kioku-test-* databases are used.
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert(source.includes('function openDB(){return KiokuData.openDatabase()}'));
const testApp = source.replace('function openDB(){return KiokuData.openDatabase()}', "function openDB(){return KiokuData.openDatabase(indexedDB,'kioku-test-ui')}");
const server = http.createServer((req, res) => {
  if (new URL(req.url, 'http://localhost').pathname === '/updates.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(root, 'updates.js'))); }
  else if (new URL(req.url, 'http://localhost').pathname === '/environment.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(root, 'environment.js'))); }
  else if (new URL(req.url, 'http://localhost').pathname === '/data-safety.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(root, 'data-safety.js'))); }
  else if (req.url === '/app') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(testApp); }
  else if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><script src="/data-safety.js"></script>'); }
  else { res.writeHead(404); res.end(); }
});
(async () => {
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: 'block' });
    await context.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
    await context.addInitScript(() => {
      const open = IDBFactory.prototype.open, remove = IDBFactory.prototype.deleteDatabase;
      IDBFactory.prototype.open = function(name, ...args) {
        if (!name.startsWith('kioku-test-')) throw new Error('PRODUCTION DATABASE ACCESS BLOCKED');
        return open.call(this, name, ...args);
      };
      IDBFactory.prototype.deleteDatabase = function(name, ...args) {
        if (!name.startsWith('kioku-test-')) throw new Error('PRODUCTION DATABASE ACCESS BLOCKED');
        return remove.call(this, name, ...args);
      };
    });
    const page = await context.newPage();
    await page.goto(base);
    const results = await page.evaluate(async () => {
      const D = KiokuData, results = [];
      const assert = (condition, message = 'assertion failed') => { if (!condition) throw new Error(message); };
      const rejects = async fn => { let rejected = false; try { await fn(); } catch (_) { rejected = true; } assert(rejected, 'Expected rejection'); };
      const test = async (name, fn) => { try { await fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, error: e.stack }); } };
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2;
      canvas.getContext('2d').fillRect(0, 0, 2, 2);
      const fixture = id => ({ id, schemaVersion: 1, type: 'episode', createdAt: '2026-01-01T01:00:00.000Z', eventAt: '2026-01-01T00:00:00.000Z', text: '架空の日記\nテスト専用 <>&', situation: '架空の公園', reason: '', moods: ['楽しい','安心'], weather: null, temperature: null, pressure: null, humidity: null, wind: null, sleep: 7, condition: 3, fatigue: 2, photos: ['image/jpeg','image/png','image/webp'].map(type => canvas.toDataURL(type)), annotations: [{ at: '2026-01-02T00:00:00.000Z', text: '架空の追記' }] });
      const legacy = entries => JSON.stringify({ app: 'kioku', version: 1, exportedAt: '2026-01-03T00:00:00.000Z', entries });
      const db = await D.openDatabase(indexedDB, 'kioku-test-data');
      const restore = async entries => D.restore(db, entries, D.planRestore(await D.readAll(db), entries));
      await test('Production DB guard and unchanged constants', async () => {
        assert(D.DB_NAME === 'kioku-personal-v1' && D.DB_VERSION === 1);
        await rejects(() => D.openDatabase());
        assert(db.version === 1);
      });
      const first = fixture('legacy-1');
      await test('V1 restore: all fields, photos, moods and annotations match', async () => {
        const parsed = await D.parseBackup(legacy([first])); await restore(parsed.entries);
        assert(D.equal(await D.readAll(db), [first]));
      });
      const future = fixture('future-fields');
      future.futureField = { nested: ['架空', null, { enabled: true }] };
      future.annotations[0].futureField = { value: 123 };
      await test('V2 round trip preserves unknown fields at every level', async () => {
        const json = await D.createBackup([future]), parsed = await D.parseBackup(json);
        assert(parsed.version === 2 && parsed.entryCount === 1 && D.equal(parsed.entries, [future]));
        await restore(parsed.entries);
        assert(D.equal((await D.readAll(db)).find(e => e.id === future.id), future));
      });
      await test('V1 unknown fields are preserved', async () => assert(D.equal((await D.parseBackup(legacy([future]))).entries, [future])));
      await test('Empty V2 backup is valid', async () => assert((await D.parseBackup(await D.createBackup([]))).entryCount === 0));
      const safe = D.canonical(await D.readAll(db));
      await test('New backup version and record schema stop safely', async () => {
        const p = JSON.parse(legacy([first])); p.version = 99;
        await rejects(() => D.parseBackup(JSON.stringify(p)));
        p.version = 1; p.entries[0].schemaVersion = 2;
        await rejects(() => D.parseBackup(JSON.stringify(p)));
      });
      await test('V2 detects tampering in ID, body, photos, moods and annotations', async () => {
        const json = await D.createBackup([first]);
        for (const mutate of [e => e.id += '-changed', e => e.text += 'changed', e => e.photos.reverse(), e => e.moods.reverse(), e => e.annotations[0].text += 'changed']) {
          const p = JSON.parse(json); mutate(p.entries[0]); await rejects(() => D.parseBackup(JSON.stringify(p)));
        }
        const p = JSON.parse(json); p.entryCount++; await rejects(() => D.parseBackup(JSON.stringify(p)));
      });
      await test('Invalid JSON, envelope, duplicate IDs and invalid known fields rejected', async () => {
        for (const text of ['{', 'null', '{}', legacy([first,first])]) await rejects(() => D.parseBackup(text));
        for (const mutate of [e => e.id = '', e => e.text = 123, e => e.eventAt = 'bad', e => e.moods = [3], e => e.annotations[0].at = 'bad', e => e.photos = ['https://example.invalid/photo.jpg'], e => e.photos = ['data:image/png;base64,AAAA'], e => e.sleep = '7']) {
          const e = structuredClone(first); mutate(e); await rejects(() => D.parseBackup(legacy([e])));
        }
        assert(D.canonical(await D.readAll(db)) === safe);
      });
      await test('Identical IDs skip; conflicting IDs retain existing content', async () => {
        const conflict = { ...first, text: '異なる架空の本文' };
        const plan = D.planRestore(await D.readAll(db), [conflict, future]);
        assert(plan.conflicts[0] === first.id && plan.identical[0] === future.id);
        await D.restore(db, [conflict, future], plan);
        assert(D.canonical(await D.readAll(db)) === safe);
      });
      await test('Change after confirmation aborts with no partial additions', async () => {
        const incoming = [fixture('race'), fixture('not-added')];
        const plan = D.planRestore(await D.readAll(db), incoming);
        await restore([fixture('race')]);
        const before = D.canonical(await D.readAll(db));
        await rejects(() => D.restore(db, incoming, plan));
        assert(D.canonical(await D.readAll(db)) === before);
      });
      await test('Synchronous write failure rolls back earlier queued writes', async () => {
        const before = D.canonical(await D.readAll(db)), original = IDBObjectStore.prototype.add;
        let count = 0;
        IDBObjectStore.prototype.add = function(...args) { if (++count === 2) throw new DOMException('simulated quota failure', 'QuotaExceededError'); return original.apply(this,args); };
        try { await rejects(() => restore([fixture('rollback-1'),fixture('rollback-2')])); } finally { IDBObjectStore.prototype.add = original; }
        assert(D.canonical(await D.readAll(db)) === before);
      });
      await test('Asynchronous constraint failure rolls back the entire transaction', async () => {
        const before = D.canonical(await D.readAll(db)), original = IDBObjectStore.prototype.add;
        IDBObjectStore.prototype.add = function(...args) { const request = original.apply(this,args); original.apply(this,args); return request; };
        try { await rejects(() => restore([fixture('async-rollback')])); } finally { IDBObjectStore.prototype.add = original; }
        assert(D.canonical(await D.readAll(db)) === before);
      });
      await test('Read-back mismatch aborts every addition', async () => {
        const before = D.canonical(await D.readAll(db)), original = IDBObjectStore.prototype.add;
        IDBObjectStore.prototype.add = function(e) { return original.call(this,{...e,text:'simulated corruption'}); };
        try { await rejects(() => restore([fixture('corrupt')])); } finally { IDBObjectStore.prototype.add = original; }
        assert(D.canonical(await D.readAll(db)) === before);
      });
      await test('Concurrent annotations preserve both additions and unknown fields', async () => {
        const a = { at: '2026-02-01T00:00:00.000Z', text: '架空の追記A' };
        const b = { at: '2026-02-02T00:00:00.000Z', text: '架空の追記B' };
        await Promise.all([D.appendAnnotation(db,future.id,a),D.appendAnnotation(db,future.id,b)]);
        const actual = (await D.readAll(db)).find(e => e.id === future.id);
        assert(D.equal(actual,{...future,annotations:[...future.annotations,a,b]}));
      });
      await test('Annotation never recreates a missing record; invalid annotation aborts', async () => {
        const before = D.canonical(await D.readAll(db));
        await rejects(() => D.appendAnnotation(db,'nonexistent',{at:new Date().toISOString(),text:'test'}));
        await rejects(() => D.appendAnnotation(db,first.id,{at:'invalid',text:'test'}));
        assert(D.canonical(await D.readAll(db)) === before);
      });
      await test('Reopening version 1 preserves all records', async () => {
        const before = await D.readAll(db); db.close();
        const reopened = await D.openDatabase(indexedDB,'kioku-test-data');
        assert(D.equal(await D.readAll(reopened),before)); reopened.close();
      });
      return { results, fixture: first, legacy: legacy([first]) };
    });
    for (const r of results.results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.error ? '\n' + r.error : ''}`);
    assert(results.results.every(r => r.ok), 'Data tests failed');
    const errors = []; page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); });
    await page.goto(base + '/app');
    await page.locator('#saveEntry').waitFor();
    await page.waitForFunction(() => !document.querySelector('#saveEntry').disabled);
    await page.locator('#entryText').fill('UIテスト専用の架空日記');
    await page.locator('[data-mood="楽しい"]').click();
    await page.locator('#saveEntry').click();
    await page.locator('#recentList').getByText('UIテスト専用の架空日記').waitFor();
    await page.locator('[data-tab="settings"]').click();
    const downloadEvent = page.waitForEvent('download');
    await page.locator('#exportData').click();
    const download = await downloadEvent;
    const stream = await download.createReadStream();
    const chunks = []; for await (const chunk of stream) chunks.push(chunk);
    const exported = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(exported.version, 2); assert.equal(exported.entryCount, 1);
    assert.match(await page.locator('#backupStatus').innerText(), /保存完了は未確認/);
    console.log('PASS UI save, V2 download and truthful backup status');
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#importFile').setInputFiles({ name:'synthetic-v1.json', mimeType:'application/json', buffer:Buffer.from(results.legacy) });
    await page.waitForFunction(() => !document.querySelector('#importData').disabled);
    assert.equal(await page.evaluate(async () => { const db=await KiokuData.openDatabase(indexedDB,'kioku-test-ui'); const all=await KiokuData.readAll(db); db.close(); return all.length; }), 2);
    console.log('PASS UI legacy import');
    const uiSnapshot = () => page.evaluate(async () => { const db=await KiokuData.openDatabase(indexedDB,'kioku-test-ui'); const all=await KiokuData.readAll(db); db.close(); return KiokuData.canonical(all); });
    const before = await uiSnapshot();
    let conflictShown = false;
    const conflicting = JSON.parse(results.legacy); conflicting.entries[0].text = '変更された架空の本文';
    page.once('dialog', async dialog => { conflictShown = /内容の相違：1件/.test(dialog.message()); await dialog.accept(); });
    await page.locator('#importFile').setInputFiles({ name:'conflict.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(conflicting)) });
    await page.waitForFunction(() => !document.querySelector('#importData').disabled);
    assert(conflictShown); assert.equal(await uiSnapshot(),before);
    console.log('PASS UI conflict warning preserves existing diary');
    const cancelled = JSON.parse(results.legacy); cancelled.entries[0].id = 'cancelled';
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('#importFile').setInputFiles({ name:'cancel.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(cancelled)) });
    await page.waitForFunction(() => !document.querySelector('#importData').disabled);
    assert.equal(await uiSnapshot(),before);
    console.log('PASS UI cancel leaves all records untouched');
    let stopped = false;
    cancelled.version = 99;
    page.once('dialog', async dialog => { stopped = /未対応/.test(dialog.message()); await dialog.accept(); });
    await page.locator('#importFile').setInputFiles({ name:'future.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(cancelled)) });
    await page.waitForFunction(() => !document.querySelector('#importData').disabled);
    assert(stopped); assert.equal(await uiSnapshot(),before);
    console.log('PASS UI unsupported format stops without writing');
    assert.deepEqual(errors, []);
    console.log(`PASS ${results.results.length + 5} test groups; production DB blocked, external network blocked`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
