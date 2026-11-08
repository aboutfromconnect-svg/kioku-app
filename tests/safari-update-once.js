void (async function () {
  const allowedOrigin = 'https://SET-TEST-SITE.netlify.app';
  const key = '__kiokuTestUpdateOnce';
  if (allowedOrigin.includes('SET-TEST-SITE') || !/^https:\/\/[a-z0-9-]+\.netlify\.app$/.test(allowedOrigin) || location.origin !== allowedOrigin) {
    alert('停止：指定したNetlifyテストサイト以外では使えません。更新は要求していません。'); return;
  }
  if (!isSecureContext || !('serviceWorker' in navigator)) { alert('更新確認を利用できない環境です。'); return; }
  if (window[key]) { alert('この画面からは既に更新確認を要求しています。再実行せず、読み取り専用診断で状態を確認してください。'); return; }
  if (!confirm('事前確認：テスト用日記の最新JSONをFilesに保存し、ファイルの存在を確認しましたか？\nこのサイトの全タブ・PWAの入力中の日記・追記・場所編集も保存済みですか？\n両方済んでいる場合だけ「OK」。未確認ならキャンセルしてください。')) return;
  if (!confirm(allowedOrigin + '\nこのサイトのWorker更新確認を1回実行します。通信・キャッシュ作成・新Workerの有効化に進む場合があります。\nこのコードは登録解除・DBやキャッシュ削除・画面再読み込みを行いません。実行を承認しますか？')) return;
  const describe = worker => worker ? worker.state + ' / ' + worker.scriptURL : 'なし';
  let registration, observed, timer, stopped = false, attempted = false;
  const seen = [];
  const capture = () => { if (observed && seen[seen.length - 1] !== observed.state) seen.push(observed.state); };
  const found = () => { if (observed) observed.removeEventListener('statechange', capture); observed = registration.installing; if (observed) { observed.addEventListener('statechange', capture); capture(); } };
  const summary = () => [
    'active：' + describe(registration && registration.active),
    'waiting：' + describe(registration && registration.waiting),
    'installing：' + describe(registration && registration.installing),
    'ページ制御：' + describe(navigator.serviceWorker.controller),
    '観測した変化：' + (seen.join(' → ') || 'なし')
  ].join('\n');
  try {
    registration = await Promise.race([navigator.serviceWorker.getRegistration(location.href), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('lookup-timeout')), 5000); })]);
    clearTimeout(timer);
    const workers = [registration && registration.active, registration && registration.waiting, registration && registration.installing, navigator.serviceWorker.controller].filter(Boolean);
    if (!registration || registration.scope !== allowedOrigin + '/' || !registration.active || workers.some(w => w.scriptURL !== allowedOrigin + '/service-worker.js')) {
      alert('停止：登録スコープまたはWorkerが想定と異なります。更新は要求していません。\n' + summary()); return;
    }
    if (registration.installing || registration.waiting) { alert('既に準備中または待機中です。更新を重ねず、状態を報告してください。\n' + summary()); return; }
    if (!navigator.onLine) { alert('オフラインのため更新は要求していません。'); return; }
    if (window[key]) { alert('別の実行が更新を要求済みです。再実行しません。'); return; }
    window[key] = true;
    registration.addEventListener('updatefound', found);
    attempted = true;
    await Promise.race([
      (async () => {
        await registration.update();
        while (!stopped && (registration.installing || (registration.active && registration.active.state === 'activating'))) await new Promise(resolve => setTimeout(resolve, 250));
        capture();
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('update-timeout')), 30000); })
    ]);
    alert((seen.includes('redundant') ? '導入が完了せずWorkerが破棄されました。失敗または別更新との競合の可能性があります。' : '更新確認の応答がありました。新版の画面表示はまだ確認していません。') + '\n' + summary() + '\n自動で再読み込みはしません。この結果を報告してください。');
  } catch (error) {
    const message = !attempted ? '登録情報を取得できませんでした。更新は要求していません。' : error.message === 'update-timeout' ? '30秒で観測を終了しました。更新をキャンセルしたわけではなく、処理が続く可能性があります。' : '更新確認でエラーが発生しました（' + (error.name || '不明') + '）。';
    alert(message + '\n' + summary() + '\n再実行せず、読み取り専用診断の結果を報告してください。');
  } finally {
    stopped = true; clearTimeout(timer);
    if (registration) registration.removeEventListener('updatefound', found);
    if (observed) observed.removeEventListener('statechange', capture);
  }
}());
