// Real local worker lifecycle; synthetic data only. No production DB is permitted.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
function release(next){
  const files={};for(const name of ['index.html','service-worker.js','updates.js','data-safety.js','environment.js','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png'])files[name]=fs.readFileSync(path.join(root,name));
  for(const name of Object.keys(files).filter(n=>!n.endsWith('.png')))files[name]=files[name].toString().replaceAll('0.2-ui3',next).replaceAll('kioku-personal-v1','kioku-test-update-flow');
  for(const [name,key]of [['data-safety.js','INTEGRITY'],['environment.js','ENVIRONMENT_INTEGRITY'],['updates.js','UPDATES_INTEGRITY']]){
    const hash='sha256-'+createHash('sha256').update(files[name]).digest('base64');
    files['index.html']=files['index.html'].replace(new RegExp(`(src="\\./${name}[^\"]*" integrity=")[^\"]+"`),'$1'+hash+'"');
    files['service-worker.js']=files['service-worker.js'].replace(new RegExp(`const ${key} = '[^']+'`),`const ${key} = '${hash}'`);
  }return files;
}
const first=release('0.2-ui3'),next=release('0.2-update-test-next');let files=first,broken=false;
const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';const body=files[name];res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.html')?'text/html; charset=utf-8':'application/octet-stream');if(!body||(broken&&name==='updates.js')){res.writeHead(404);res.end();}else res.end(body);});
(async()=>{let browser;try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/`;
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH,args:['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
 const ctx=await browser.newContext();await ctx.addInitScript(()=>{const open=IDBFactory.prototype.open;IDBFactory.prototype.open=function(name,...args){if(name!=='kioku-test-update-flow')throw Error('Production DB blocked');return open.call(this,name,...args)};IDBFactory.prototype.deleteDatabase=()=>{throw Error('Deletion forbidden')};});
 const page=await ctx.newPage();await page.goto(url);await page.waitForFunction(()=>navigator.serviceWorker.controller);
 await page.waitForFunction(()=>document.querySelector('#updateNotice').hidden&&!document.querySelector('#checkUpdate').disabled);
 console.log('PASS normal current-version startup has no notification');
 await page.locator('[data-tab="settings"]').click();await page.locator('#checkUpdate').click();await page.waitForFunction(()=>document.querySelector('#updateStatus').textContent==='最新版です');
 await page.waitForFunction(()=>document.querySelector('#updateNotice').hidden);console.log('PASS manual latest-version notice disappears automatically');
 await page.locator('[data-tab="record"]').click();await page.locator('#entryText').fill('架空の未保存日記');
 files=next;broken=true;await page.locator('[data-tab="settings"]').click();await page.locator('#checkUpdate').click();
 await page.waitForFunction(()=>document.querySelector('#updateStatus').textContent.includes('更新ファイルの確認に失敗'));
 assert.equal(await page.locator('#entryText').inputValue(),'架空の未保存日記');assert.equal(await page.evaluate(()=>KiokuData.RELEASE),'0.2-ui3');console.log('PASS incomplete release rejected with draft and old application retained');
 broken=false;await page.locator('#checkUpdate').click();await page.locator('#applyUpdate').waitFor();
 assert.match(await page.locator('#updateStatus').innerText(),/新しいバージョン/);
 await page.locator('#applyUpdate').click();assert.match(await page.locator('#updateStatus').innerText(),/未保存/);assert.equal(await page.locator('#entryText').inputValue(),'架空の未保存日記');console.log('PASS update detection and explicit reload blocked for unsaved draft');
 await page.evaluate(()=>document.querySelector('#entryForm').requestSubmit());await page.waitForFunction(()=>document.querySelector('#entryText').value==='');
 await page.locator('#applyUpdate').click();await page.waitForFunction(()=>globalThis.KiokuData?.RELEASE==='0.2-update-test-next');
 assert.match(await page.locator('#recentList').innerText(),/架空の未保存日記/);console.log('PASS user update after save loads complete new release and retains IndexedDB');
 await ctx.setOffline(true);await page.locator('[data-tab="settings"]').click();await page.locator('#checkUpdate').click();await page.waitForFunction(()=>document.querySelector('#updateStatus').textContent.includes('更新を確認できません'));assert.match(await page.locator('#recentList').innerText(),/架空の未保存日記/);console.log('PASS offline update error retains existing data');
 await ctx.close();
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1});
