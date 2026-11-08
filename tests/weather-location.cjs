// Synthetic GPS only; all external requests intercepted. Production DB names blocked.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f));
const html=read('index.html').toString().replace('function openDB(){return KiokuData.openDatabase()}',"function openDB(){return KiokuData.openDatabase(indexedDB,'kioku-test-weather')}");
const server=http.createServer((req,res)=>{
  const p=new URL(req.url,'http://localhost').pathname;
  if(p==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html)}
  else if(['/data-safety.js','/environment.js','/updates.js'].includes(p)){res.setHeader('Content-Type','text/javascript');res.end(read(p.slice(1)))}
  else{res.writeHead(404);res.end()}
});
let browser,base,passed=0;
const weatherValues={weather_code:0,temperature_2m:18.5,apparent_temperature:17,relative_humidity_2m:56,surface_pressure:1001,wind_speed_10m:8,wind_direction_10m:90,precipitation:0.2,cloud_cover:22};
async function setup(options={}){
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}}),calls=[],errors=[];
  let release;const gate=new Promise(r=>release=r);
  await context.route('**/*',async route=>{
    const url=route.request().url();
    if(url.startsWith(base))return route.continue();
    if(url.startsWith('https://api.open-meteo.com/')){
      calls.push(url);if(options.deferredAPI)await gate;
      return route.fulfill({status:options.apiFailure?503:200,contentType:'application/json',body:JSON.stringify({current:{...weatherValues,time:Math.floor(Date.now()/1000),interval:900}})}).catch(()=>{});
    }
    return route.abort();
  });
  await context.addInitScript(options=>{
    const open=IDBFactory.prototype.open;
    IDBFactory.prototype.open=function(name,...args){if(!name.startsWith('kioku-test-'))throw new Error('PRODUCTION DB BLOCKED');return open.call(this,name,...args)};
    IDBFactory.prototype.deleteDatabase=()=>{throw new Error('DB deletion forbidden')};
    if(options.autoWeather||options.saveLocation)localStorage.setItem('kioku-environment-settings-v1',JSON.stringify({autoWeather:!!options.autoWeather,saveLocation:!!options.saveLocation}));
    window.__gpsCalls=0;window.__gpsCallbacks=[];
    const fake=()=>({coords:{latitude:10+12345/100000,longitude:20+67891/100000,accuracy:25},timestamp:Date.now()});
    navigator.geolocation.getCurrentPosition=(ok,fail)=>{
      window.__gpsCalls++;const invoke=()=>options.geoError?fail({code:options.geoError}):ok(fake());
      if(options.deferredGPS)window.__gpsCallbacks.push(invoke);else setTimeout(invoke,0);
    };
    navigator.geolocation.watchPosition=()=>{throw new Error('Tracking forbidden')};
  },options);
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.waitForFunction(()=>!document.querySelector('#saveEntry').disabled);
  const all=()=>page.evaluate(async()=>{const db=await KiokuData.openDatabase(indexedDB,'kioku-test-weather');const result=await KiokuData.readAll(db);db.close();return result});
  const save=async text=>{await page.locator('#entryText').fill(text);await page.locator('#saveEntry').click();await page.waitForFunction(()=>document.querySelector('#entryText').value==='')};
  const close=async()=>{release();assert.deepEqual(errors,[]);await context.close()};
  return {page,context,calls,all,save,release,close};
}
async function test(name,fn){await fn();passed++;console.log('PASS '+name)}
(async()=>{
  try{
    await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}/`;
    browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
    await test('Both settings default off, no GPS/API and ordinary saving works',async()=>{
      const t=await setup();assert.equal(await t.page.evaluate(()=>__gpsCalls),0);assert.equal(t.calls.length,0);
      await t.save('架空の通常日記');const [e]=await t.all();assert.equal(e.locations,null);assert.equal(e.weatherMeta,null);await t.close();
    });
    await test('Weather-only consent: nine fields and provenance; no exact coordinates stored/sent',async()=>{
      const t=await setup({autoWeather:true});await t.page.waitForFunction(()=>document.querySelector('#temperature').value==='18.5');
      const u=new URL(t.calls[0]);assert.equal(u.searchParams.get('latitude'),'10.12');assert.equal(u.searchParams.get('longitude'),'20.68');assert.equal(u.searchParams.get('current').split(',').length,9);
      await t.page.locator('[data-tab="history"]').click();await t.page.locator('[data-tab="record"]').click();assert.equal(await t.page.evaluate(()=>__gpsCalls),1);
      await t.save('架空の天気日記');const [e]=await t.all();assert.equal(e.locations,null);assert.equal(e.apparentTemperature,17);assert.equal(e.windDirection,90);assert.equal(e.precipitation,0.2);assert.equal(e.cloudCover,22);assert.equal(e.weatherMeta.provider,'Open-Meteo');assert(e.weatherMeta.observedAt.endsWith('Z'));assert(!JSON.stringify(e).includes('10.12345'));assert(!t.calls[0].includes('架空'));await t.close();
    });
    await test('Location-only consent: recording place distinct from event place; no API request',async()=>{
      const t=await setup({saveLocation:true});await t.page.waitForFunction(()=>document.querySelector('#draftRecordingLocation').textContent.includes('測位精度'));
      assert.equal(t.calls.length,0);await t.save('架空の位置日記');const[e]=await t.all();assert.equal(e.locations.recording.method,'automatic');assert.equal(e.locations.recording.accuracy,25);assert.equal(e.locations.event,null);await t.close();
    });
    await test('Combined consent shares one GPS promise; location and weather round-trip in V1/V2',async()=>{
      const t=await setup({autoWeather:true,saveLocation:true});await t.page.waitForFunction(()=>document.querySelector('#temperature').value==='18.5');assert.equal(await t.page.evaluate(()=>__gpsCalls),1);
      await t.save('架空の両方日記');
      await t.page.evaluate(async()=>{
        const db=await KiokuData.openDatabase(indexedDB,'kioku-test-weather'),entries=await KiokuData.readAll(db);
        for(const json of [await KiokuData.createBackup(entries),JSON.stringify({app:'kioku',version:1,entries})]){
          const p=await KiokuData.parseBackup(json);if(!KiokuData.equal(p.entries,entries))throw Error('Round trip mismatch');
          const target=await KiokuData.openDatabase(indexedDB,'kioku-test-restore-'+p.version);await KiokuData.restore(target,p.entries,KiokuData.planRestore([],p.entries));if(!KiokuData.equal(await KiokuData.readAll(target),entries))throw Error('DB mismatch');target.close();
        }db.close();
      });await t.close();
    });
    for(const code of [1,2,3])await test(`GPS rejection/failure ${code} never blocks diary save`,async()=>{
      const t=await setup({autoWeather:true,saveLocation:true,geoError:code});await t.page.waitForFunction(()=>document.querySelector('#environmentStatus').textContent.includes('保存'));
      await t.save('架空の失敗時日記');assert.equal((await t.all()).length,1);assert.equal(t.calls.length,0);await t.close();
    });
    await test('Weather API failure still saves diary and acquired recording location',async()=>{
      const t=await setup({autoWeather:true,saveLocation:true,apiFailure:true});await t.page.waitForFunction(()=>document.querySelector('#environmentStatus').textContent.includes('天気を取得できません'));
      await t.save('架空の通信失敗');assert((await t.all())[0].locations.recording);await t.close();
    });
    await test('Late GPS and API responses cannot contaminate another draft',async()=>{
      for(const option of ['deferredGPS','deferredAPI']){
        const t=await setup({autoWeather:true,saveLocation:true,[option]:true});
        if(option==='deferredAPI')await t.page.waitForFunction(()=>document.querySelector('#draftRecordingLocation').textContent.includes('測位精度'));
        await t.save('架空の先に保存');
        // Cancel next draft's automatic weather, leaving the old response to arrive.
        await t.page.locator('#moreDetails').evaluate(e=>e.open=true);await t.page.locator('#eventTime').fill('2000-01-01T12:00');
        if(option==='deferredGPS')await t.page.evaluate(()=>__gpsCallbacks[0]());else t.release();
        await t.page.waitForTimeout(100);
        assert.equal(await t.page.locator('#temperature').inputValue(),'');assert.equal((await t.all())[0].weatherMeta,null);
        if(option==='deferredGPS')assert.equal(await t.page.locator('#draftRecordingLocation').textContent(),'記録した場所：未記録');await t.close();
      }
    });
    await test('Manual weather edit wins over delayed automatic response; provenance reflects edit',async()=>{
      const t=await setup({autoWeather:true,deferredAPI:true});await t.page.locator('#moreDetails').evaluate(e=>e.open=true);await t.page.locator('#temperature').fill('23');t.release();
      await t.page.waitForFunction(()=>document.querySelector('#humidity').value==='56');assert.equal(await t.page.locator('#temperature').inputValue(),'23');
      await t.save('架空の手入力');assert.equal((await t.all())[0].weatherMeta.fieldSources.temperature,'manual');await t.close();
    });
    await test('Past date removes automatic weather; never assigns current GPS as event place',async()=>{
      const t=await setup({autoWeather:true,saveLocation:true});await t.page.waitForFunction(()=>document.querySelector('#temperature').value==='18.5');
      await t.page.locator('#moreDetails').evaluate(e=>e.open=true);await t.page.locator('#eventTime').fill('2000-01-01T12:00');assert.equal(await t.page.locator('#temperature').inputValue(),'');
      await t.save('架空の過去日記');const[e]=await t.all();assert.equal(e.weatherMeta,null);assert.equal(e.weather,null);assert.equal(e.locations.event,null);assert(e.locations.recording);await t.close();
    });
    await test('Disabling consent during acquisition ignores late results and excludes coordinates',async()=>{
      const t=await setup({autoWeather:true,saveLocation:true,deferredGPS:true});await t.page.locator('[data-tab="settings"]').click();await t.page.locator('#autoWeatherSetting').uncheck();await t.page.locator('#saveLocationSetting').uncheck();await t.page.evaluate(()=>__gpsCallbacks[0]());
      await t.page.locator('[data-tab="record"]').click();await t.save('架空の同意撤回');assert.equal((await t.all())[0].locations,null);assert.equal(t.calls.length,0);await t.close();
    });
    await test('Manual event location and saved location deletion preserve diary and annotations',async()=>{
      const t=await setup({saveLocation:true});await t.page.locator('#moreDetails').evaluate(e=>e.open=true);await t.page.locator('#locationTarget').evaluate(e=>e.closest('details').open=true);
      await t.page.locator('#locationEditor [data-location-field="latitude"]').fill('0');await t.page.locator('#locationEditor [data-location-field="longitude"]').fill('0');await t.page.locator('#locationEditor [data-location-field="name"]').fill('架空地点');await t.page.locator('#locationEditor [data-location-action="save"]').click();
      await t.save('架空の場所編集');assert.equal((await t.all())[0].locations.event.name,'架空地点');
      await t.page.locator('#recentList .record').click();await t.page.locator('#annotationText').fill('架空の追記');await t.page.locator('#saveAnnotation').click();await t.page.waitForFunction(()=>document.querySelector('#annotationList').textContent.includes('架空の追記'));
      await t.page.locator('#savedEnvironmentDetails').evaluate(e=>e.open=true);const details=t.page.locator('#entryEnvironment [data-location-target=event]');await details.evaluate(e=>e.open=true);await details.locator('[data-location-action="delete"]').click();
      await t.page.waitForFunction(()=>document.querySelector('#entryEnvironment [data-location-target=event] p').textContent.includes('未記録'));
      const[e]=await t.all();assert.equal(e.locations.event,null);assert.equal(e.text,'架空の場所編集');assert.equal(e.annotations[0].text,'架空の追記');await t.close();
    });
    await test('Legacy record stays byte-equivalent after opening with automatic settings enabled',async()=>{
      const t=await setup();await t.save('架空の旧記録');
      const before=await t.page.evaluate(async()=>{const db=await KiokuData.openDatabase(indexedDB,'kioku-test-weather');const[e]=await KiokuData.readAll(db);for(const k of ['locations','weatherMeta','apparentTemperature','windDirection','precipitation','cloudCover','eventTimeZone','eventTimeWasEdited'])delete e[k];await new Promise((r,j)=>{const tx=db.transaction('entries','readwrite');tx.objectStore('entries').put(e);tx.oncomplete=r;tx.onabort=j});db.close();localStorage.setItem('kioku-environment-settings-v1',JSON.stringify({autoWeather:true,saveLocation:true}));return e});
      await t.page.reload();await t.page.waitForFunction(()=>document.querySelector('#temperature').value==='18.5');assert.deepEqual((await t.all())[0],before);await t.page.locator('#recentList .record').click();assert(!(await t.page.locator('#entryEnvironment').innerText()).includes('未記録'));await t.close();
    });
    await test('User opt-in persists; revocation in another tab removes pending location',async()=>{
      const t=await setup();await t.page.locator('[data-tab="settings"]').click();await t.page.locator('#autoWeatherSetting').check();await t.page.locator('#saveLocationSetting').check();
      assert.equal(await t.page.evaluate(()=>__gpsCalls),0);await t.page.locator('[data-tab="record"]').click();await t.page.waitForFunction(()=>document.querySelector('#temperature').value==='18.5');
      await t.page.reload();await t.page.waitForFunction(()=>document.querySelector('#temperature').value==='18.5');
      const other=await t.context.newPage();await other.goto(base);await other.evaluate(()=>localStorage.setItem('kioku-environment-settings-v1',JSON.stringify({autoWeather:false,saveLocation:false})));
      await t.page.waitForFunction(()=>!document.querySelector('#saveLocationSetting').checked);await t.save('架空の別タブ同意撤回');assert.equal((await t.all())[0].locations,null);await t.close();
    });
    await test('Manual location acquisition is labelled manual without a second GPS call',async()=>{
      const t=await setup({saveLocation:true});await t.page.waitForFunction(()=>document.querySelector('#draftRecordingLocation').textContent.includes('測位精度'));await t.page.locator('#moreDetails').evaluate(e=>e.open=true);await t.page.locator('#locationTarget').evaluate(e=>e.closest('details').open=true);
      await t.page.locator('#getLocation').click();await t.page.waitForFunction(()=>document.querySelector('#draftRecordingLocation').textContent.includes('手動'));await t.save('架空の手動取得');assert.equal((await t.all())[0].locations.recording.method,'manual');await t.close();
    });
    await test('Invalid new location/weather metadata rejects V1 import without changing database',async()=>{
      const t=await setup({saveLocation:true});await t.page.waitForFunction(()=>document.querySelector('#draftRecordingLocation').textContent.includes('測位精度'));await t.save('架空の不正復元試験');
      const result=await t.page.evaluate(async()=>{
        const db=await KiokuData.openDatabase(indexedDB,'kioku-test-weather'),before=await KiokuData.readAll(db);let rejected=0;
        for(const change of [e=>e.locations.recording.latitude=999,e=>e.locations.recording.accuracy=-1,e=>e.weatherMeta={provider:'Open-Meteo'},e=>e.cloudCover='invalid']){
          const[e]=structuredClone(before);change(e);try{await KiokuData.parseBackup(JSON.stringify({app:'kioku',version:1,entries:[e]}))}catch(_){rejected++}
        }const unchanged=KiokuData.equal(before,await KiokuData.readAll(db));db.close();return {rejected,unchanged};
      });assert.deepEqual(result,{rejected:4,unchanged:true});await t.close();
    });
    await test('Additional weather field alone can be saved and mobile layout has no horizontal overflow',async()=>{
      const t=await setup();await t.page.locator('#moreDetails').evaluate(e=>e.open=true);await t.page.locator('#apparentTemperature').fill('12');await t.page.locator('#saveEntry').click();await t.page.waitForFunction(()=>document.querySelector('#apparentTemperature').value==='');assert.equal((await t.all())[0].apparentTemperature,12);
      assert(await t.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await t.close();
    });
    await test('Deleting pending recording location is not undone by late GPS',async()=>{
      const t=await setup({saveLocation:true,deferredGPS:true});await t.page.locator('#moreDetails').evaluate(e=>e.open=true);await t.page.locator('#locationTarget').evaluate(e=>e.closest('details').open=true);await t.page.locator('#locationTarget').selectOption('recording');
      await t.page.locator('#locationEditor [data-location-action="delete"]').click();await t.page.evaluate(()=>__gpsCallbacks[0]());await t.page.waitForTimeout(50);
      await t.save('架空の位置削除');assert.equal((await t.all())[0].locations.recording,null);await t.close();
    });
    await test('Weather retry reuses GPS and unfinished location editor cannot block text saving',async()=>{
      const t=await setup({autoWeather:true,saveLocation:true});await t.page.waitForFunction(()=>document.querySelector('#temperature').value==='18.5');await t.page.locator('#moreDetails').evaluate(e=>e.open=true);await t.page.locator('#getWeather').click();await t.page.waitForFunction(()=>document.querySelector('#environmentStatus').textContent.includes('取得しました'));
      assert.equal(await t.page.evaluate(()=>__gpsCalls),1);await t.page.locator('#locationTarget').evaluate(e=>e.closest('details').open=true);await t.page.locator('#locationEditor [data-location-field="latitude"]').fill('999');await t.save('架空の入力途中');assert.equal((await t.all())[0].locations.event,null);await t.close();
    });
    await test('Compact mobile summary and folded technical details preserve stored data',async()=>{
      const empty=await setup();assert.equal(await empty.page.locator('#environmentCompact').isVisible(),false);assert.equal(await empty.page.locator('#environmentCompact').evaluate(e=>e.getBoundingClientRect().height),0);await empty.close();
      const t=await setup({autoWeather:true,saveLocation:true});await t.page.waitForFunction(()=>document.querySelector('#temperature').value==='18.5');
      assert.match(await t.page.locator('#environmentSummary').innerText(),/位置あり.*晴れ 18.5℃/);assert(!/Open-Meteo|取得しました|測位精度/.test(await t.page.locator('#environmentCompact').innerText()));
      assert((await t.page.locator('#environmentCompact').boundingBox()).height<=40);
      if(process.env.KIOKU_UI_SHOTS)await t.page.locator('#view-record > .card').screenshot({path:path.join(root,'netlify-test-package/ui-record.png')});
      await t.page.locator('#editEnvironment').click();assert(await t.page.locator('#moreDetails').evaluate(e=>e.open));
      await t.save('架空の折りたたみ確認');const before=await t.all();await t.page.locator('#recentList .record').click();
      assert.equal(await t.page.locator('#savedEnvironmentDetails').evaluate(e=>e.open),false);
      if(process.env.KIOKU_UI_SHOTS)await t.page.locator('.modal').screenshot({path:path.join(root,'netlify-test-package/ui-detail.png')});
      assert(!/Open-Meteo|測位精度|出来事が起きた場所/.test(await t.page.locator('#modalContent').innerText()));
      assert(await t.page.locator('#modalContent').evaluate(e=>e.querySelector('.modal-text').compareDocumentPosition(e.querySelector('#entryEnvironment')) & Node.DOCUMENT_POSITION_FOLLOWING));
      await t.page.locator('#savedEnvironmentDetails > summary').click();assert.match(await t.page.locator('#savedEnvironmentDetails').innerText(),/体感温度.*17/s);assert.match(await t.page.locator('#savedEnvironmentDetails').innerText(),/Open-Meteo/);
      await t.page.locator('[data-location-target=recording] > summary').click();assert.match(await t.page.locator('#savedEnvironmentDetails').innerText(),/測位精度 約25m/);
      assert.deepEqual(await t.all(),before);assert(await t.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await t.close();
    });
    console.log(`PASS ${passed} weather/location groups; synthetic coordinates only, production DB and real network blocked`);
  }finally{if(browser)await browser.close();await new Promise(r=>server.close(r))}
})().catch(e=>{console.error(e);process.exitCode=1});
