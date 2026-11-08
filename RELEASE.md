# kioku v0.1.1 公開前確認とGitHub Desktop手順

## 実機の確認記録

利用者から、iPhone実機で旧版からの更新後も日記・写真・感情・追記が保持され、正常動作したとの報告を受領しました。また、旧形式Ver.1と新形式Ver.2のバックアップ復元の両方で、写真・感情・追記まで確認済みとの回答を受領しています。

これは利用者による確認結果です。機種・iOSバージョン、Safariとホーム画面PWAそれぞれの内訳は記録されていません。以前のSAFETY-REPORTにある「実機未実施」はその自動検証時点の記録です。

## 本番ファイルの確認

- DB名：`kioku-personal-v1`、DBバージョン：`1`、ストア：`entries` を維持。
- DBの削除・ストアの削除・既存データの一括変換はありません。ストア作成は初回だけです。
- 復元は未登録IDを追加し、同じIDの既存データは上書きしません。
- 利用者の確認付き単件削除／全削除は既存機能として残っています。更新時には呼びません。
- 本番HTML・JS・Service Worker・マニフェストに `kioku-test-iphone` などのテスト識別子はありません。
- Service Workerは全ファイルとJSの検査値を確認してから導入し、旧画面が閉じるまで切り替えを待ちます。HTML・JS・Workerの識別子と検査値は一致しています。
- 本番アプリのJSは今回の公開準備では変更していません。除外設定、公開チェック、サブパスでのテスト、手順書を追加しています。

## コミットと配信の対象

コミット対象：`index.html`、`data-safety.js`、`service-worker.js`、`README.md`、`.gitattributes`、`.gitignore`、`_config.yml`、`RELEASE.md`、`tests/`。

既存の `manifest.webmanifest` と `icons/` はそのまま保持します。

- `netlify-test-package/` はローカル保存のまま、`.gitignore`でGit追加対象から除外しました。強制追加しないでください。
- `tests/` は再現可能な検証のためGitに残しますが、`_config.yml`でGitHub Pages配信から除外します。READMEとこの手順書も配信から除外します。
- `kioku-backup-*.json` はGit追加対象から除外。ほかの名前の個人ファイルもコミットしないでください。
- 本番サイトに必要なアセットは `index.html`、`data-safety.js`、`service-worker.js`、`manifest.webmanifest`、2つのアイコンだけです。

**この除外設定はGitHub Pagesの標準Jekyllビルド（Deploy from a branch / main / root）を前提とします。** GitHub Actionsでフォルダをそのまま配布する設定や`.nojekyll`を利用する場合、`_config.yml`の除外だけでは不十分です。独自配信に切り替える場合は上記アセットだけを配布してください。今回、GitHub上の設定は取得・変更していません。

## GitHub Desktop：コミットと作業ブランチのプッシュ

以下は利用者が確認後に実行する手順です。エージェントはコミット・プッシュ・マージを実行していません。

1. GitHub Desktopでリポジトリ `kioku-app` を選択。
2. **Current Branch** が `codex/kioku-v0.1.1-data-safety` であることを確認。未コミットのままmainへ切り替えないでください。
3. **Changes**で上記コミット対象だけが含まれることを確認。`netlify-test-package/`や個人バックアップが表示されないことを確認。
4. 新規ファイルの `data-safety.js`、`.gitattributes`、`.gitignore`、`_config.yml`、`tests/` もチェックされていることを確認。
5. Summaryに `Release kioku v0.1.1: protect diary data and backups` と入力し、**Commit to codex/kioku-v0.1.1-data-safety** を押す。
6. GitHubのSettings → Pagesで、公開元が作業ブランチではなくmainであることを確認する。独自Actionsが全ブランチを自動公開する設定になっていないことも確認する。
7. 作業ブランチを **Publish branch**（初回）または **Push origin** で送信。これは作業ブランチの共有であり、mainの更新ではありません。ただし実際の公開トリガーは手順6で確認した設定に依存します。

## 公開を決めた後：mainへのマージとプッシュ

1. 自分の普段使う本番アプリから最新バックアップを保存し、保存先で存在を確認する。バックアップをGitHubへ追加しない。
2. Desktopの **Fetch origin** を押す。作業ブランチのコミットが完了し、Changesが空であることを確認。
3. **Current Branch → main** に切り替え、**Pull origin** が出ていれば実行する。mainに別の変更が入っていた場合は、今回の確認結果だけで進めず差分を再確認する。
4. **Branch → Merge into current branch…** を開き、`codex/kioku-v0.1.1-data-safety` を選択しmainへマージする。競合が出た場合、内容を確認せず一括採用しない。
5. マージ結果の本番DB名、テスト用パッケージ不在、必要ファイル一式を確認する。
6. **ここが公開の最終判断点です。** mainの **Push origin** を押すと、Pagesがmainを公開元としている場合は本番更新が始まります。
7. GitHubの **Actions** でPagesのビルド・配信完了を確認する。テスト用パッケージがコミットに含まれていないこと、標準Jekyllビルドならtestsが配信対象から除外されることを確認する。

保護されたmainで直接プッシュできない場合は、作業ブランチからmainへのPull Requestを作成し、確認後にGitHub上でマージしてください。PRのマージでもmain更新により公開が始まります。

## 公開後の注意

- 既存の本番URL・ドメイン・DB名を変えない。Netlifyのコピーを本番へコピーしない。
- HTML・JS・Workerを同じコミットで公開し、JSの改行や内容を後から個別変更しない。検査値の不一致は安全停止につながります。
- 古い画面が残る場合は対象サイトのタブとPWAを閉じて開き直す。日記を含むサイトデータやPWAの削除で対処しない。
- 記録数・写真・感情・追記と、新形式のバックアップ書き出しを確認する。
- 形式2のバックアップを旧v0.1に復元しない。旧版へ単純に戻しても新Workerのキャッシュが即時消えるわけではないため、不具合時はDBを消さず原因を調べる。
- 容量不足やアプリキャッシュ破損の自動復旧は引き続き制約があります。安全停止してもDBは削除しません。

## 自動テストの再実行

今回の再実行結果：基本機能21グループ、更新試験16グループ（ルート）＋16グループ（`/kioku-app/`）、Netlify用パッケージ11グループ、計64グループが成功しました。加えて `tests/release-check.cjs` の公開前検査と `git diff --check` が成功しています。本番のIndexedDBは開いていません。

Node.jsとPlaywrightを使い、必要なら `NODE_PATH` と `CHROME_PATH` を設定します。

```text
node tests/release-check.cjs
node tests/run.cjs
node tests/update-safety.cjs
```

PowerShellで `$env:KIOKU_TEST_BASE_PATH='/kioku-app/'` を設定して `tests/update-safety.cjs` を実行するとGitHub Pages相当のサブパスも検証できます。Netlifyのローカルパッケージが残っていれば `node netlify-test-package/verify.cjs` も実行できます。

公開除外チェックは設定の静的検査で、GitHub Pagesの実ビルドではありません。実際の配信成功は公開後のActionsで確認します。

公式資料：[Desktopでのコミット](https://docs.github.com/en/desktop/making-changes-in-a-branch/committing-and-reviewing-changes-to-your-project-in-github-desktop)、[ブランチの同期・マージ](https://docs.github.com/en/desktop/working-with-your-remote-repository-on-github-or-github-enterprise/syncing-your-branch-in-github-desktop)、[PagesのJekyll設定](https://docs.github.com/en/pages/setting-up-a-github-pages-site-with-jekyll/about-github-pages-and-jekyll)。
