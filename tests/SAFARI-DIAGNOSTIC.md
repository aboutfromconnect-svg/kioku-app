# 通常Safariの読み取り専用診断

対象：`https://serene-granita-4c0d0b.netlify.app/` のみ。

完成品はローカルの `netlify-test-package/diagnostics/kioku-safari-diagnostic.txt`（1行のブックマークレット）です。同じフォルダーの `.js` は読みやすい確認用。Netlifyへアップロードする必要はありません。アプリ本体・配布パッケージは変更していません。

## iPhoneへの登録

ブックマークレットは、ブックマークのURL欄へ小さな診断プログラムを保存して使うものです。

1. Windowsで上記 `.txt` を開き、内容をすべてコピーします。自分のiPhoneで開けるメモなどに貼り付け、iPhoneでも全文をコピーできるようにします。コード以外の見出しや引用符は含めません。
2. iPhoneの**通常Safari**で対象テストサイトを開きます。プライベートモードやホーム画面PWAではなく、旧版表示が残る通常Safariを使います。
3. Safariの共有メニューから「ブックマークを追加」を選び、名前を「kioku 診断」にして保存します。iOS版により共有は「…」内にあります。
4. Safariのブックマーク一覧を開き、今作った「kioku 診断」を長押しして「編集」を選びます。「編集」ボタンから対象を選ぶ形式の場合もあります。
5. アドレス（URL）欄の内容を全部消し、コピーした**1行全体**を貼り付けて保存します。先頭が `javascript:` であることを確認してください。検索欄への貼り付けではありません。
6. 対象テストサイトが表示された状態でブックマーク一覧を開き、「kioku 診断」をタップします。日本語の診断結果が出ます。「OK」で閉じます。自動で結果を送信・保存する機能はありません。

反応しない場合は、URL欄の先頭、全文が欠けていないこと、通常Safariであることを確認してください。iOSの制約・ページのセキュリティ設定で実行できない場合もあります。何も表示されないことは「Workerなし」を意味しません。設定を無理に緩めず、iOS版と症状を報告してください。

ブックマークの登録・編集は [AppleのSafari手順](https://support.apple.com/ja-jp/guide/iphone/iph42ab2f3a7/ios) も参照できます。Appleの説明は一般的なブックマーク操作で、ブックマークレットの実機動作保証ではありません。

## 結果の読み方

| 表示 | 意味 |
|---|---|
| 画面の版 | 開いているHTMLの識別子。Workerの版とは限らない |
| URL | 現在のページのURL |
| 登録スコープ | Workerが担当するURL範囲。現在URLに対応する登録だけを表示 |
| ページの制御 | 今のページがWorkerに制御されているか |
| 制御中Worker | ページを制御しているWorkerの状態・スクリプトURL |
| active | 有効なWorker。activatedは有効化済み |
| waiting | 導入済みだが待機中のWorker。installedと表示されることがある |
| installing | ファイル取得・導入中のWorker |

登録がなくても制御中Workerが残る場合があるので、両方を表示します。スクリプトURLは旧版・新版とも `service-worker.js` であるため、URLだけからWorkerの版を断定できません。この診断はWorkerへのメッセージ送信も行わず、版の推定や修復をしません。

結果の各行を次の相談に転記してください。URLに個人的なクエリーやフラグメントが含まれる場合は伏せて構いません。日記本文・写真・GPS座標は診断では読み取りません。

## 読み取り専用の範囲と試験

実行するWorker APIは `getRegistration(現在URL)` だけです。active/waiting/installing、controller、scope、scriptURL、stateとHTMLの版表示を読みます。IndexedDB・Cache Storage・localStorage・設定には触れません。update、register、unregister、postMessage、fetch、再読み込みは呼びません。5秒以内に情報を得られなければ取得失敗と表示します。

`tests/diagnostic-bookmarklet.cjs` の模擬環境で4グループ成功：対象以外・未設定の拒否、状態表示、登録なし、API取得失敗。保存領域・ネットワーク・変更用APIへのアクセスは試験中に禁止しました。ブックマークレットの構文と本体8ファイルの検査値不変も確認しています。iPhone実機での実行は未実施です。アプリ自身が並行して更新することまで診断コードが停止するものではありません。

## 第二段階の候補（今回は実行も修復コード提供もしていません）

どの操作も先に、すべての関連画面の未保存入力・追記を保存し、JSONをFilesへ保存して存在・日時・サイズを確認します。そのうえで、対象URLと操作を限定した**利用者の明示的な承認**を得ます。今回の診断依頼は修復実行の承認とは扱いません。

1. **まず update() の検討**：waiting/installingなしで旧画面が続くなら、対象登録に対する `registration.update()` で更新確認を明示的に開始する候補があります。ファイル取得・キャッシュ更新・新Workerの自動有効化に進み得るため読み取り専用ではありません。成功応答だけでは新版表示の成功にならず、再診断でactive/waiting/installingを確認します。現時点では、このiPhoneで解決するかは未確認です。[MDN update](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/update)
2. **waitingあり**：まず新Workerの配布内容と他のタブ・PWAを確認します。現在の修正版は導入成功後に自分でskipWaitingしますが、旧版には外部からの有効化メッセージ受信処理がありません。任意のSKIP_WAITINGメッセージを送っても有効化できません。ページ側からwaiting.skipWaiting()を直接呼ぶこともできません。保存後に同じスコープの全タブ・PWAを閉じるか別サイトへ移動して再度開く案を、承認後に試します。データ削除は不要ですが未保存入力は閉じると失われます。[MDN skipWaiting](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/skipWaiting)
3. **登録解除は最終候補**：update失敗の原因、ファイル不整合、空き容量、実行中の別画面を確認しても解決しない場合だけ検討します。unregisterはWorker登録の解除であり、IndexedDBやCache Storageの削除とは別です。ただし開いている旧ページは直ちに制御を失うとは限らず、再読み込みや起動時の旧コードが再登録する競合もあります。先に未保存入力を保存し、診断画面以外の対象タブ・PWAを閉じ、承認された対象スコープだけを解除、その後旧ページを再読み込みせず別サイトへ移動してから新しく開く、という手順を個別に検討します。解除後の起動がオフラインで成功する保証はありません。成功値だけで解除継続を断定せず再診断します。[MDN unregister](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/unregister)

いずれもIndexedDB削除、caches.delete、Safariのサイトデータ消去、PWA再インストールを組み合わせません。診断結果を確認してから、最小限の次の操作を具体化します。通常Safariの結果からPWAの保存領域・Worker状態が同一だとは断定しません。
