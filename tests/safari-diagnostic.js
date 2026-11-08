void (async function () {
  const allowedOrigin = 'https://SET-TEST-SITE.netlify.app';
  if (allowedOrigin.includes('SET-TEST-SITE') || !/^https:\/\/[a-z0-9-]+\.netlify\.app$/.test(allowedOrigin) || location.origin !== allowedOrigin) {
    alert('診断を停止しました。指定したNetlifyテストサイトだけで使えます。変更はしていません。');
    return;
  }
  if (!('serviceWorker' in navigator) || !isSecureContext) {
    alert('この画面ではService Workerの状態を取得できません。変更はしていません。');
    return;
  }
  let timer;
  try {
    const registration = await Promise.race([
      navigator.serviceWorker.getRegistration(location.href),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 5000); })
    ]);
    const worker = value => value ? value.state + ' / ' + value.scriptURL : 'なし';
    const controller = navigator.serviceWorker.controller;
    const release = document.querySelector('meta[name="kioku-release"]');
    alert([
      'kioku 読み取り専用診断（変更なし）',
      '画面の版：' + (release ? release.content : '不明'),
      'URL：' + location.href,
      '登録スコープ：' + (registration ? registration.scope : '該当登録なし'),
      'ページの制御：' + (controller ? 'あり' : 'なし'),
      '制御中Worker：' + worker(controller),
      'active（有効）：' + worker(registration && registration.active),
      'waiting（待機）：' + worker(registration && registration.waiting),
      'installing（準備中）：' + worker(registration && registration.installing),
      'この表示は現在の状態です。更新・有効化・登録解除は行っていません。'
    ].join('\n'));
  } catch (_) {
    alert('診断情報を取得できませんでした（取得拒否または5秒経過）。変更はしていません。');
  } finally {
    clearTimeout(timer);
  }
}());
