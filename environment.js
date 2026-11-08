/* Opt-in, one-shot acquisition. No database access, tracking or diary transmission. */
(() => {
  'use strict';
  const RELEASE = '0.2-ui3';
  const fields = {
    weather: ['weather_code', '天気', ''], temperature: ['temperature_2m', '気温', '℃'],
    apparentTemperature: ['apparent_temperature', '体感温度', '℃'], humidity: ['relative_humidity_2m', '湿度', '%'],
    pressure: ['surface_pressure', '地表気圧', 'hPa'], wind: ['wind_speed_10m', '風速', 'km/h'],
    windDirection: ['wind_direction_10m', '風向', '°'], precipitation: ['precipitation', '降水量', 'mm'], cloudCover: ['cloud_cover', '雲量', '%']
  };
  const extraFields = ['apparentTemperature', 'windDirection', 'precipitation', 'cloudCover'];
  const copy = value => JSON.parse(JSON.stringify(value));
  const name = code => code === 0 || code === 1 ? '晴れ' : code === 2 || code === 3 ? 'くもり' : [45,48].includes(code) ? '霧' : [51,53,55,56,57,61,63,65,66,67,80,81,82].includes(code) ? '雨' : [71,73,75,77,85,86].includes(code) ? '雪' : [95,96,99].includes(code) ? '雷雨' : 'その他';
  const settingsKey = 'kioku-environment-settings-v1';
  function readSettings() {
    try { const s = JSON.parse(localStorage.getItem(settingsKey)); return { autoWeather: s?.autoWeather === true, saveLocation: s?.saveLocation === true }; }
    catch (_) { return { autoWeather: false, saveLocation: false }; }
  }
  function makeLocationForm(container, initial, onSave, onDelete) {
    const form = document.createElement('div'); form.className = 'detail-grid';
    const inputs = {};
    for (const [key, label, type] of [['latitude','緯度（-90〜90）','number'],['longitude','経度（-180〜180）','number'],['name','場所の名前（任意）','text']]) {
      const wrap = document.createElement('label'); wrap.className = 'field'; wrap.textContent = label;
      const input = document.createElement('input'); input.type = type; input.dataset.locationField = key;
      // This optional editor has its own validation; unfinished coordinates must not block diary submission.
      input.setAttribute('form','detached-location-editor');
      input.value = initial?.[key] ?? ''; if (type === 'number') { input.step = 'any'; input.min = key === 'latitude' ? '-90' : '-180'; input.max = key === 'latitude' ? '90' : '180'; } else input.maxLength = 200;
      wrap.append(input); form.append(wrap); inputs[key] = input;
    }
    const status = document.createElement('p'); status.className = 'small'; status.setAttribute('role','status');
    const save = document.createElement('button'); save.type = 'button'; save.className = 'outline-btn'; save.textContent = '場所を反映'; save.dataset.locationAction = 'save';
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button error'; remove.textContent = 'この場所を削除'; remove.dataset.locationAction = 'delete';
    save.onclick = async () => {
      const latitude = Number(inputs.latitude.value), longitude = Number(inputs.longitude.value);
      if (!inputs.latitude.value.trim() || !inputs.longitude.value.trim() || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude)>90 || Math.abs(longitude)>180) { status.textContent = '緯度・経度を範囲内で入力してください'; return; }
      save.disabled = true;
      try {
        const unchanged = initial && latitude === initial.latitude && longitude === initial.longitude;
        const location = unchanged ? { ...initial, name: inputs.name.value.trim() } : { latitude, longitude, accuracy: null, measuredAt: null, method: 'manual', provider: 'manual', name: inputs.name.value.trim() };
        location.updatedAt = new Date().toISOString(); await onSave(location); status.textContent = '場所を反映しました';
      } catch (_) { status.textContent = '場所を保存できませんでした'; } finally { save.disabled = false; }
    };
    remove.onclick = async () => { remove.disabled = true; try { await onDelete(); inputs.latitude.value = inputs.longitude.value = inputs.name.value = ''; status.textContent = '場所を削除しました'; } catch (_) { status.textContent = '削除できませんでした'; } finally { remove.disabled = false; } };
    form.append(save,remove); container.append(form,status);
  }
  function describeLocation(location) {
    if (!location) return '未記録';
    return `${location.name ? location.name + ' / ' : ''}${location.latitude}, ${location.longitude}${location.accuracy != null ? `（測位精度 約${location.accuracy}m）` : ''} / ${location.method === 'automatic' ? '自動' : '手動'}${location.measuredAt ? ' / 測位 '+location.measuredAt : ''}`;
  }
  function compactWeather(weather, temperature) {
    const icon = {晴れ:'☀️',くもり:'☁️',雨:'🌧️',雪:'❄️',霧:'🌫️',雷雨:'⛈️'}[weather] || '🌤️';
    return weather || (temperature !== '' && temperature != null) ? `${icon} ${weather || ''}${temperature !== '' && temperature != null ? ' '+temperature+'℃' : ''}`.trim() : '';
  }
  function mount() {
    const $ = id => document.getElementById(id);
    let settings = readSettings(), draft, sequence = 0;
    function status() {
      const place = draft.locations.event || draft.locations.recording;
      const progress = draft.weatherPending || draft.locationStatus === '現在地を取得中';
      const failed = /できません|許可がありません/.test(draft.weatherStatus+' '+draft.locationStatus);
      const summary = [place ? '📍 '+(place.name || '位置あり') : '', compactWeather($('weather').value,$('temperature').value), progress ? '取得中…' : failed ? '取得できません（詳細）' : ''].filter(Boolean).join('　');
      $('environmentSummary').textContent = summary;
      $('environmentCompact').hidden = !summary;
      $('environmentStatus').textContent = `${draft.weatherStatus}。${draft.locationStatus}。`;
      $('weatherInfo').textContent = draft.weatherStatus + '。手入力した項目は保持します。';
      $('draftRecordingLocation').textContent = '記録した場所：' + describeLocation(draft.locations.recording);
      $('draftEventLocation').textContent = '出来事の場所：' + describeLocation(draft.locations.event);
      $('getLocation').disabled = !settings.saveLocation;
      $('useCurrentForEvent').disabled = !settings.saveLocation || !draft.locations.recording;
      $('locationEditor').querySelectorAll('button,input,select').forEach(e => e.disabled = !settings.saveLocation);
    }
    function current(d) { return draft === d; }
    function clearAutomaticWeather() {
      for (const key of draft.autoFields) if (!draft.dirty.has(key)) $(key).value = '';
      draft.autoFields.clear(); draft.weatherMeta = null;
    }
    function reset() {
      draft?.abort?.abort();
      draft = { id: ++sequence, geo: null, locations: { recording: null, event: null }, dirty: new Set(), autoFields: new Set(), eventEdited: false, weatherAttempted: false, weatherPending: false, weatherGeneration: 0, locationGeneration: 0, locationStatus: '位置は未取得', weatherStatus: '自動取得は設定で有効にできます', weatherMeta: null };
      for (const key of extraFields) $(key).value = '';
      $('locationEditor').replaceChildren(); $('locationTarget').value = 'event'; renderDraftEditor(); status(); open();
    }
    function position(d) {
      // A single promise (including failures) per draft, shared by weather and location.
      if (!d.geo) d.geo = new Promise((resolve,reject) => {
        if (!navigator.geolocation) { reject(new Error('位置情報非対応')); return; }
        navigator.geolocation.getCurrentPosition(pos => {
          const c = pos.coords;
          if (![c.latitude,c.longitude,c.accuracy,pos.timestamp].every(Number.isFinite) || Math.abs(c.latitude)>90 || Math.abs(c.longitude)>180 || c.accuracy<0) { reject(new Error('測位結果が不正')); return; }
          resolve({latitude:c.latitude,longitude:c.longitude,accuracy:c.accuracy,measuredAt:new Date(pos.timestamp).toISOString(),provider:'geolocation'});
        }, reject, { enableHighAccuracy: false, timeout: 14000, maximumAge: 0 });
      });
      return d.geo;
    }
    async function location(method = 'manual') {
      if (!settings.saveLocation) return;
      const d = draft, generation = ++d.locationGeneration;
      d.locationStatus = '現在地を取得中'; status();
      try {
        const pos = await position(d);
        if (!current(d) || generation !== d.locationGeneration || !settings.saveLocation) return;
        d.locations.recording = {...pos,method,name:''}; d.locationStatus = '記録した場所を取得しました';
      } catch (error) {
        if (!current(d) || generation !== d.locationGeneration) return;
        d.locationStatus = error?.code === 1 ? '位置の許可がありません（本文は保存できます）' : '現在地を取得できません（本文は保存できます）';
      }
      if (current(d)) status();
    }
    async function weather(manual = false) {
      const d = draft;
      if (d.eventEdited) { d.weatherStatus = '日時指定の記録には現在の天気を入力しません'; status(); return; }
      if (d.weatherPending || (!manual && (!settings.autoWeather || d.weatherAttempted))) return;
      d.weatherAttempted = true; d.weatherPending = true;
      const generation = ++d.weatherGeneration;
      d.weatherStatus = '現在地・天気を取得中'; status();
      try {
        const pos = await position(d);
        if (!current(d) || generation !== d.weatherGeneration || d.eventEdited) return;
        const params = new URLSearchParams({ latitude: pos.latitude.toFixed(2), longitude: pos.longitude.toFixed(2), current: Object.values(fields).map(f=>f[0]).join(','), timezone:'GMT', timeformat:'unixtime', temperature_unit:'celsius', wind_speed_unit:'kmh', precipitation_unit:'mm' });
        const controller = new AbortController(); d.abort = controller;
        const timeout = setTimeout(()=>controller.abort(),12000);
        let payload;
        try { const response = await fetch('https://api.open-meteo.com/v1/forecast?'+params,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'}); if (!response.ok) throw new Error('API失敗'); payload = await response.json(); } finally { clearTimeout(timeout); }
        if (!current(d) || generation !== d.weatherGeneration || d.eventEdited) return;
        const c = payload.current;
        if (!c || !Number.isFinite(c.time) || !Number.isFinite(new Date(c.time*1000).getTime())) throw new Error('気象日時が不正');
        const values = {}, origins = {};
        for (const [key,[api]] of Object.entries(fields)) {
          if (!Number.isFinite(c[api])) throw new Error('気象値が不足');
          values[key] = key === 'weather' ? name(c[api]) : c[api];
          const input = $(key);
          if (key !== 'weather' && ((input.min !== '' && values[key] < Number(input.min)) || (input.max !== '' && values[key] > Number(input.max)))) throw new Error('気象値が範囲外');
        }
        for (const key of Object.keys(fields)) {
          if (!d.dirty.has(key)) { $(key).value = values[key]; d.autoFields.add(key); origins[key] = 'open-meteo'; } else origins[key] = 'manual';
        }
        // No coordinates or raw API payload are persisted, even when location saving is on.
        d.weatherMeta = { provider:'Open-Meteo', fetchedAt:new Date().toISOString(), observedAt:new Date(c.time*1000).toISOString(), acquisition:manual?'manual':'automatic', fieldSources:origins, units:Object.fromEntries(Object.entries(fields).map(([key,f])=>[key,f[2]])), precipitationIntervalSeconds:Number.isFinite(c.interval)?c.interval:null };
        d.weatherStatus = '現在の天気を取得しました（Open-Meteo）';
      } catch (error) {
        if (!current(d) || generation !== d.weatherGeneration) return;
        d.weatherStatus = error?.code === 1 ? '位置の許可がありません。天気は手入力できます' : '天気を取得できません。手入力・本文の保存は可能です';
      } finally {
        if (current(d) && generation === d.weatherGeneration) { d.weatherPending = false; status(); }
      }
    }
    function open() {
      if (!draft || !$('view-record').classList.contains('active')) return;
      if (settings.saveLocation && !draft.locationStarted) { draft.locationStarted = true; location('automatic'); }
      if (settings.autoWeather) weather();
    }
    function renderDraftEditor() {
      const target = $('locationTarget').value, d = draft, container = $('locationEditor'); container.replaceChildren();
      makeLocationForm(container,d.locations[target],value => {
        if (!settings.saveLocation || !current(d)) return;
        if (target === 'recording') d.locationGeneration++;
        d.locations[target] = value; d.locationStatus = '場所を手動変更しました'; status();
      }, () => {
        if (target === 'recording') d.locationGeneration++;
        d.locations[target] = null; d.locationStatus = '場所を削除しました'; status();
      });
    }
    for (const key of Object.keys(fields)) $(key).addEventListener('input',()=>{
      draft.dirty.add(key); draft.autoFields.delete(key);
      if (draft.weatherMeta) draft.weatherMeta.fieldSources[key] = 'manual'; status();
    });
    $('eventTime').addEventListener('input',()=>{
      draft.eventEdited = true; draft.weatherGeneration++; draft.weatherPending = false; draft.abort?.abort(); clearAutomaticWeather();
      draft.weatherStatus = '日時指定の記録には現在の天気を入力しません'; status();
    });
    function applySettings(next, persist = true) {
      const previous = settings; settings = next;
      $('autoWeatherSetting').checked = settings.autoWeather; $('saveLocationSetting').checked = settings.saveLocation;
      if (persist) {
        try { localStorage.setItem(settingsKey,JSON.stringify(settings)); $('privacySettingStatus').textContent = '設定を保存しました'; } catch (_) { $('privacySettingStatus').textContent = '設定は今回の起動中のみ有効です'; }
      } else $('privacySettingStatus').textContent = '別の画面で変更した設定を反映しました';
      if (previous.autoWeather && !settings.autoWeather) { draft.weatherGeneration++; draft.weatherPending = false; draft.abort?.abort(); draft.weatherStatus = '自動取得オフ'; }
      if (previous.saveLocation && !settings.saveLocation) { draft.locationGeneration++; draft.locations = {recording:null,event:null}; draft.locationStarted = false; draft.locationStatus = '位置保存オフ（入力中の位置を除去）'; renderDraftEditor(); }
      status(); open();
    }
    for (const [id,key] of [['autoWeatherSetting','autoWeather'],['saveLocationSetting','saveLocation']]) {
      $(id).checked = settings[key];
      $(id).addEventListener('change',()=>applySettings({...settings,[key]:$(id).checked}));
    }
    window.addEventListener('storage', event => {
      if (event.key !== settingsKey && event.key !== null) return;
      applySettings(readSettings(),false);
    });
    $('getWeather').onclick = () => {
      if (!settings.autoWeather && !confirm('現在地を一度取得し、小数点以下2桁に丸めた座標をOpen-Meteoへ送ります。本文・写真・感情は送りません。取得しますか？')) return;
      weather(true);
    };
    $('getLocation').onclick = () => location('manual');
    $('locationTarget').onchange = () => { renderDraftEditor(); status(); };
    $('useCurrentForEvent').onclick = () => {
      if (!settings.saveLocation || !draft.locations.recording) return;
      draft.locations.event = {...draft.locations.recording,method:'manual',assignedAt:new Date().toISOString()}; renderDraftEditor(); status();
    };
    function snapshot() {
      const extras = Object.fromEntries(extraFields.map(key=>[key,$(key).value.trim()===''?null:Number($(key).value)]));
      return { ...extras, weatherMeta: draft.weatherMeta ? copy(draft.weatherMeta) : null, locations: settings.saveLocation ? copy(draft.locations) : null, eventTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, eventTimeWasEdited: draft.eventEdited };
    }
    return { reset, open, snapshot, eventEdited:()=>draft.eventEdited };
  }
  function detail(entry, container, update) {
    const place=entry.locations?.event || entry.locations?.recording;
    const line=document.createElement('p');line.className='environment-line';line.textContent=[compactWeather(entry.weather,entry.temperature),place?'📍 '+(place.name || '場所あり'):''].filter(Boolean).join('　');
    if(line.textContent)container.append(line);
    const fold=document.createElement('details');fold.className='environment-details';fold.id='savedEnvironmentDetails';
    const title=document.createElement('summary');title.textContent='天気・場所の詳細';fold.append(title);container.append(fold);container=fold;
    for (const key of Object.keys(fields)) if (entry[key] != null && entry[key] !== '') { const p = document.createElement('p'); p.className='info-line'; p.textContent=fields[key][1]+'：'+entry[key]+' '+fields[key][2]; container.append(p); }
    if (entry.weatherMeta) { const p=document.createElement('p'); p.className='small'; p.textContent=`気象取得元：${entry.weatherMeta.provider} / 取得：${entry.weatherMeta.fetchedAt} / 対象：${entry.weatherMeta.observedAt}（手修正した項目は手入力）`;container.append(p); }
    for (const [target,label] of [['recording','日記を記録した場所'],['event','出来事が起きた場所']]) {
      const wrap=document.createElement('details'),summary=document.createElement('summary');wrap.dataset.locationTarget=target;summary.textContent=label;wrap.append(summary);
      const description=document.createElement('p');description.className='small';description.textContent=describeLocation(entry.locations?.[target]);wrap.append(description);
      const note=document.createElement('p');note.className='small';note.textContent='既存記録の場所を手動変更・削除できます。座標は端末とバックアップに保存されます。外部送信はしません。';wrap.append(note);
      makeLocationForm(wrap,entry.locations?.[target],location=>update(target,location),()=>update(target,null));container.append(wrap);
    }
  }
  globalThis.KiokuEnvironment = Object.freeze({ RELEASE, mount, detail });
})();
