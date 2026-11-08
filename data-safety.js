/* kioku 0.2: no database is opened until openDatabase is explicitly called. */
(function (root) {
  'use strict';
  const DB_NAME = 'kioku-personal-v1', DB_VERSION = 1, STORE = 'entries';
  const FORMAT_VERSION = 2, MAX_BYTES = 120 * 1024 * 1024;
  const fail = message => { throw new Error(message); };
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  function canonical(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (object(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
    fail('JSONに保存できない値があります');
  }
  const equal = (a, b) => canonical(a) === canonical(b);
  function validateEntries(entries) {
    if (!Array.isArray(entries)) fail('記録一覧が不正です');
    const ids = new Set();
    for (const e of entries) {
      if (!object(e) || typeof e.id !== 'string' || !e.id.trim()) fail('記録IDが不正です');
      if (ids.has(e.id)) fail('バックアップ内に重複IDがあります');
      ids.add(e.id);
      if (e.schemaVersion !== 1) fail('未対応の記録形式です');
      if (!['episode', 'daily'].includes(e.type)) fail('記録の種類が不正です');
      for (const key of ['createdAt', 'eventAt']) {
        if (typeof e[key] !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(e[key]) || !Number.isFinite(Date.parse(e[key]))) fail('記録日時が不正です');
      }
      for (const key of ['text', 'situation', 'reason']) if (typeof e[key] !== 'string') fail('本文・状況・理由が不正です');
      if (!Array.isArray(e.moods) || e.moods.some(m => typeof m !== 'string')) fail('感情データが不正です');
      if (e.weather !== null && typeof e.weather !== 'string') fail('天気データが不正です');
      for (const key of ['temperature', 'pressure', 'humidity', 'wind', 'sleep', 'condition', 'fatigue']) {
        if (e[key] !== null && (typeof e[key] !== 'number' || !Number.isFinite(e[key]))) fail('数値データが不正です');
      }
      // Do not truncate legacy records. Validate every photo and annotation instead.
      if (!Array.isArray(e.photos) || e.photos.some(p => typeof p !== 'string' || !/^data:image\/(jpeg|png|webp);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(p) || p.endsWith(','))) fail('写真データが不正です');
      if (!Array.isArray(e.annotations) || e.annotations.some(a => !object(a) || typeof a.text !== 'string' || typeof a.at !== 'string' || !Number.isFinite(Date.parse(a.at)))) fail('追記データが不正です');
      for (const key of ['apparentTemperature','windDirection','precipitation','cloudCover']) if (e[key] != null && (typeof e[key] !== 'number' || !Number.isFinite(e[key]))) fail('追加の気象データが不正です');
      if (e.locations != null) {
        if (!object(e.locations)) fail('位置情報が不正です');
        for (const key of ['recording','event']) {
          const p=e.locations[key]; if (p == null) continue;
          if (!object(p) || !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude) || Math.abs(p.latitude)>90 || Math.abs(p.longitude)>180 || (p.accuracy !== null && (!Number.isFinite(p.accuracy) || p.accuracy<0)) || !['automatic','manual'].includes(p.method) || !['geolocation','manual'].includes(p.provider) || typeof p.name!=='string' || (p.measuredAt!==null && (typeof p.measuredAt!=='string' || !Number.isFinite(Date.parse(p.measuredAt))))) fail('位置情報の値が不正です');
        }
      }
      if (e.weatherMeta != null) {
        const m=e.weatherMeta;
        if (!object(m) || typeof m.provider!=='string' || !object(m.fieldSources) || !object(m.units) || !['automatic','manual'].includes(m.acquisition) || ['fetchedAt','observedAt'].some(key=>typeof m[key]!=='string'||!Number.isFinite(Date.parse(m[key])))) fail('気象データの出典が不正です');
      }
      canonical(e); // Includes unknown fields; never rebuild or discard them.
    }
    return entries;
  }
  async function digest(entries) {
    const bytes = new TextEncoder().encode(canonical(entries));
    const hash = await root.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
  }
  async function validatePhotos(entries) {
    const photos = new Set(entries.flatMap(e => e.photos));
    for (const photo of photos) {
      await new Promise((resolve, reject) => {
        const image = new Image();
        const finish = error => {
          clearTimeout(timer); image.onload = image.onerror = null;
          image.src = '';
          error ? reject(error) : resolve();
        };
        const timer = setTimeout(() => finish(new Error('写真の検証が時間内に完了しませんでした')), 15000);
        image.onload = () => finish(image.naturalWidth && image.naturalHeight ? null : new Error('写真のサイズが不正です'));
        image.onerror = () => finish(new Error('読み込めない写真が含まれています'));
        image.src = photo;
      });
    }
  }
  async function createBackup(entries) {
    const snapshot = JSON.parse(canonical(validateEntries(entries)));
    const payload = { app: 'kioku', version: FORMAT_VERSION, exportedAt: new Date().toISOString(), entryCount: snapshot.length, entries: snapshot, integrity: { algorithm: 'SHA-256', entriesHash: await digest(snapshot) } };
    const json = JSON.stringify(payload, null, 2);
    if (new TextEncoder().encode(json).length > MAX_BYTES) fail('バックアップが復元可能な上限（120MiB）を超えています。記録は変更していません');
    await parseBackup(json);
    return json;
  }
  async function parseBackup(json) {
    if (new TextEncoder().encode(json).length > MAX_BYTES) fail('バックアップは120MiBまでです');
    const p = JSON.parse(json);
    if (!object(p) || p.app !== 'kioku') fail('kiokuのバックアップではありません');
    if (p.version !== 1 && p.version !== FORMAT_VERSION) fail('未対応のバックアップ形式です。対応するアプリで開いてください');
    validateEntries(p.entries);
    if (p.version === FORMAT_VERSION) {
      if (p.entryCount !== p.entries.length) fail('記録件数が一致しません');
      if (!object(p.integrity) || p.integrity.algorithm !== 'SHA-256' || p.integrity.entriesHash !== await digest(p.entries)) fail('バックアップの内容が検査値と一致しません');
    }
    await validatePhotos(p.entries);
    return p;
  }
  function openDatabase(factory = root.indexedDB, name = DB_NAME) {
    return new Promise((resolve, reject) => {
      if (!factory) return reject(new Error('IndexedDB非対応'));
      const req = factory.open(name, DB_VERSION);
      let blocked = false;
      req.onupgradeneeded = event => {
        // Future migrations must be additive and gated by oldVersion.
        if (event.oldVersion < 1 && !req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onblocked = () => { blocked = true; reject(new Error('別のタブを閉じてから再度開いてください')); };
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        if (blocked) { db.close(); return; }
        db.onversionchange = () => db.close();
        resolve(db);
      };
    });
  }
  function readAll(db) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      tx.oncomplete = () => resolve(req.result);
      tx.onabort = () => reject(tx.error || new Error('読み込みが中断されました'));
      tx.onerror = () => reject(tx.error);
    });
  }
  function planRestore(existing, incoming) {
    const byId = new Map(existing.map(e => [e.id, e]));
    const added = [], identical = [], conflicts = [], relevant = [];
    for (const e of incoming) {
      if (!byId.has(e.id)) { added.push(e.id); relevant.push(null); }
      else {
        const current = byId.get(e.id);
        (equal(current, e) ? identical : conflicts).push(e.id);
        relevant.push(current);
      }
    }
    return { added, identical, conflicts, signature: canonical(relevant) };
  }
  function appendAnnotation(db, id, annotation) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite'), st = tx.objectStore(STORE);
      let reason;
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(reason || tx.error || new Error('追記を保存できませんでした'));
      tx.onerror = () => { reason = reason || tx.error; };
      st.get(id).onsuccess = event => {
        try {
          const current = event.target.result;
          if (!current) fail('記録が見つかりません。再読み込みしてください');
          const updated = { ...current, annotations: [...current.annotations, annotation] };
          validateEntries([updated]);
          st.put(updated);
        } catch (error) { reason = error; tx.abort(); }
      };
    });
  }
  function restore(db, incoming, approvedPlan) {
    validateEntries(incoming);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite'), st = tx.objectStore(STORE);
      let reason, result;
      const abort = error => { reason = error; tx.abort(); };
      tx.onabort = () => reject(reason || tx.error || new Error('復元を中断しました。追加分は取り消されました'));
      tx.onerror = () => { reason = reason || tx.error; };
      tx.oncomplete = () => resolve(result);
      st.getAll().onsuccess = event => {
        try {
          const before = event.target.result, plan = planRestore(before, incoming);
          if (!equal(plan, approvedPlan)) fail('確認後に記録が変更されました。もう一度復元を実行してください');
          const addIds = new Set(plan.added);
          for (const e of incoming) if (addIds.has(e.id)) st.add(e);
          // Read back inside the SAME transaction; a mismatch aborts all additions.
          st.getAll().onsuccess = verification => {
            try {
              const after = verification.target.result, byId = new Map(after.map(e => [e.id, e]));
              const expected = before.concat(incoming.filter(e => addIds.has(e.id)));
              if (after.length !== expected.length || expected.some(e => !byId.has(e.id) || !equal(e, byId.get(e.id)))) fail('復元後の整合性確認に失敗しました');
              result = plan;
            } catch (error) { abort(error); }
          };
        } catch (error) { abort(error); }
      };
    });
  }
  function updateLocation(db, id, target, location) {
    if (!['recording','event'].includes(target)) return Promise.reject(new Error('位置の種類が不正です'));
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,'readwrite'),st=tx.objectStore(STORE);let reason;
      tx.oncomplete=()=>resolve();tx.onabort=()=>reject(reason||tx.error||new Error('場所の更新を中断しました'));
      st.get(id).onsuccess=event=>{
        try {
          const e=event.target.result;if(!e)fail('記録が見つかりません');
          const updated={...e,locations:{...(e.locations||{}),[target]:location}};
          validateEntries([updated]);st.put(updated);
        }catch(error){reason=error;tx.abort()}
      };
    });
  }
  root.KiokuData = Object.freeze({ RELEASE: '0.2-ui3', DB_NAME, DB_VERSION, STORE, MAX_BYTES, canonical, equal, validateEntries, createBackup, parseBackup, openDatabase, readAll, planRestore, restore, appendAnnotation, updateLocation });
})(globalThis);
