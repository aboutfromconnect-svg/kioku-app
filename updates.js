/* Worker activation never reloads a page. Reload is an explicit, clean-draft action. */
(() => {
  const RELEASE = '0.2-ui3';
  function start(isDirty) {
    const box=document.getElementById('updateNotice'),label=document.getElementById('updateStatus');
    const apply=document.getElementById('applyUpdate'),check=document.getElementById('checkUpdate');
    let registration, available=false, checking=false, lastCheck=0, noticeTimer;
    function hide(){clearTimeout(noticeTimer);box.hidden=true;label.textContent='';}
    function show(text){clearTimeout(noticeTimer);box.hidden=false;label.textContent=text;}
    function version(worker) {
      return new Promise(resolve=>{
        if(!worker){resolve(null);return;}
        const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();resolve(null)},3000);
        channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data?.release||null)};
        worker.postMessage({type:'KIOKU_VERSION'},[channel.port2]);
      });
    }
    async function inspect(){
      const release=await version(registration?.active || navigator.serviceWorker.controller);
      if(release && release!==RELEASE){available=true;apply.hidden=false;show('新しいバージョンがあります。入力中の記録を保存してから更新してください。');}
      else if(release===RELEASE){available=false;apply.hidden=true;hide();}
    }
    async function refresh(manual=false){
      if(checking || (!manual && Date.now()-lastCheck<60000))return;
      checking=true;lastCheck=Date.now();check.disabled=true;
      try{
        if(!navigator.onLine)throw new Error('Offline');
        if(!registration)registration=await navigator.serviceWorker.register('./service-worker.js',{updateViaCache:'none'});
        let timer;
        try { await Promise.race([registration.update(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Update timeout')),15000)})]); }
        finally { clearTimeout(timer); }
        await inspect();
        if(manual&&!available&&!registration.installing){show('最新版です');noticeTimer=setTimeout(()=>{if(!available)hide()},3000);}
      }catch(_){show('更新を確認できませんでした。現在の画面と記録は保持しています。接続を確認して再試行してください。');}
      finally{checking=false;check.disabled=false;}
    }
    check.onclick=()=>refresh(true);
    apply.onclick=async()=>{
      if(isDirty()){show('未保存の入力があります。日記・追記・場所の編集を保存してから「更新する」を押してください。');return;}
      const release=await version(registration?.active || navigator.serviceWorker.controller);
      if(!release || release===RELEASE){show('新版の準備を確認できませんでした。更新を確認して再試行してください。');return;}
      // Recheck after asynchronous messaging; the user may have typed in the meantime.
      if(isDirty()){show('未保存の入力があります。保存してから更新してください。');return;}
      location.reload();
    };
    if(!('serviceWorker' in navigator)||!isSecureContext){check.disabled=true;show('この環境ではアプリの更新確認を利用できません。HTTPSで開いてください。');return;}
    navigator.serviceWorker.addEventListener('controllerchange',inspect);
    window.addEventListener('pageshow',()=>refresh());
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refresh()});
    (async()=>{
      try{
        registration=await navigator.serviceWorker.register('./service-worker.js',{updateViaCache:'none'});
        registration.addEventListener('updatefound',()=>{
          const worker=registration.installing;if(!worker)return;
          show('新しいファイルを確認しています。入力はそのまま続けられます。');
          worker.addEventListener('statechange',()=>{
            if(worker.state==='activated')inspect();
            if(worker.state==='redundant')show('更新ファイルの確認に失敗しました。現在の画面と記録は保持しています。');
          });
        });
        await inspect();await refresh();
      }catch(_){show('更新機能を起動できませんでした。記録は保持しています。「更新を確認」で再試行できます。');}
    })();
  }
  globalThis.KiokuUpdates=Object.freeze({RELEASE,start});
})();
