# Safari更新失敗の追加診断

対象：`https://serene-granita-4c0d0b.netlify.app/`。アプリ本体・配布設定の変更なし。

## 利用者の画面で確認できたこと

- 画面は `0.1.1-netlify-test1`。
- 更新確認ブックマークレットでTypeError。
- activeとcontrollerはactivated、waiting/installingなし。
- updatefoundによる変化は観測されなかった。

この結果だけでエラー原因や有効Workerの版を断定しません。新Workerが待機し続けている証拠ではありません。ブックマークレットはerror.nameだけを表示しており、詳細なエラー文はこの画像に含まれません。

## 外部からの読み取り確認

認証情報なしのHTTP GETで以下を確認しました。アプリは実行せず、IndexedDBは開いていません。

| URLのパス | 状態 | Content-Type | 内容 |
|---|---|---|---|
| `/` | 401 | text/html; charset=utf-8 | Login Redirect |
| `/service-worker.js` | 401 | text/html; charset=utf-8 | Login Redirect |

Worker URLの応答は `Server: Netlify`。HTMLは `app.netlify.com/edge-access` へのログイン案内で、JavaScriptのWorker本体ではありません。ログイン案内は実行せず、認証情報も入力していません。

**認証・アクセス制限による更新スクリプト取得失敗が有力な候補です。ただし、このHTTP試験は未ログインの環境であり、利用者の通常Safariが同じ401を受けたことを直接証明してはいません。** 私用ブラウザーとプライベートモードの認証状態の違いは候補であり、未確認です。

旧Workerのナビゲーション用キャッシュ処理と、ブラウザーのWorkerスクリプト更新取得は区別します。後者の失敗を、旧HTMLキャッシュだけの問題と判断しないでください。

## 次の確認（設定変更はまだしない）

Netlifyで対象プロジェクトの `Project configuration → General → Visitor access → Project visibility` を確認します。UIやプランによって `Password Protection` と表示されることがあります。

確認したい内容：Public / Private / Password、通常の配信URLにも適用されているか（Production and previewsか、Previewsのみか）、Team login protectionが設定されているか。パスワード・Cookie・トークンの共有は不要です。

- Private/ログイン保護なら、通常Safariでの認証状態と更新ファイルへの認証適用を調べます。旧Workerがナビゲーションを処理するため、新しいページへ移るだけではログイン案内が見えない場合があります。
- Publicに変更する案はサイトの閲覧範囲を広げるため、確認・承認前に実行しません。日記DBが自動公開される操作ではありませんが、配信ファイルの公開範囲は変わります。
- 認証を維持したままの復旧方法とテストサイトの公開設定を変える方法は、現設定を見てから選びます。
- Workerが取得できる条件が整う前にunregisterしても401は解消しません。登録解除・データ削除・PWA再インストール・更新確認の連続実行は行いません。

## 公開判断

**C. 修正が必要（配信条件／Safari更新経路の解決が必要）**。アプリ本体のバグと確定したという意味ではありません。原因対処後、同一URL・同一保存領域の通常SafariとPWAで、既存データ保持を再確認するまで正式公開を保留します。

参考：[Netlify Project visibility](https://docs.netlify.com/manage/security/secure-access-to-sites/project-visibility/)、[Service Worker更新仕様](https://w3c.github.io/ServiceWorker/#update-algorithm)。
