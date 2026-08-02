# GA Lite

[English](./README.md) | [简体中文](./README.zh-CN.md) | 日本語

![GA Lite アナリティクスダッシュボード](./public/images/landing/hero.png)

このリポジトリは [GA Lite](https://galite.io/) のオープンソース版です。galite.io と同じ製品機能を提供し、Cloudflare Workers と D1 上で動作します。

- リポジトリ：[github.com/crevanta/galite](https://github.com/crevanta/galite)
- ライセンス：[AGPL-3.0-only](./LICENSE)

## 機能

- 複数の Google Analytics 4、Google Search Console、Bing Webmaster アカウントを接続。
- 1 つのダッシュボードで複数のサイトを管理。
- 概要、リアルタイム、トレンド、ディメンション、ファネルのレポートを表示。
- 必要に応じて公開プロフィールと埋め込み Widget を公開。
- HTTP API と MCP を通じてサイトデータを集約。

## 必要なもの

- [Cloudflare](https://dash.cloudflare.com/) アカウント。
- Node.js 20.19.6+（20.x）または 22.12+（22.x）と pnpm 9.15.9。`pnpm` がない場合は `npm install -g pnpm@9.15.9` でインストールできます。

## デプロイ

### 1. 依存関係をインストールして D1 を作成

```bash
pnpm install
pnpm exec wrangler login
pnpm exec wrangler d1 create open-galite
cp wrangler.jsonc.example wrangler.jsonc
```

コマンドから返された D1 の `database_id` を `wrangler.jsonc` に設定します。この時点では、ドメイン、管理者アカウント、Google OAuth の設定は不要です。

### 2. Worker をデプロイ

```bash
pnpm build
openssl rand -hex 32 | pnpm exec wrangler secret put APP_SECRET
pnpm db:migrate:remote
pnpm exec wrangler deploy
```

`APP_SECRET` はデプロイ時に必要な唯一の Secret です。デプロイ後、Wrangler が生成された `workers.dev` URL を表示します。

### 3. 管理者を初期化

デプロイ先の URL を開きます。初回画面で管理者のメールアドレスとパスワードを設定すると、自動的にログインします。

## オプション設定

### Google Analytics と Search Console

Google OAuth はアプリケーションの起動後に設定できます。以下の操作は、すべて同じ Google Cloud プロジェクトを選択した状態で行います。

1. [Google Cloud プロジェクト作成ページ](https://console.cloud.google.com/projectcreate)を開き、GA Lite 用のプロジェクトを作成して、コンソールでそのプロジェクトを選択します。
2. [API Library](https://console.cloud.google.com/apis/library)を開き、次の API を検索してそれぞれ有効にします。
   - **Google Analytics Admin API**（`analyticsadmin.googleapis.com`）
   - **Google Analytics Data API**（`analyticsdata.googleapis.com`）
   - **Google Search Console API**（`searchconsole.googleapis.com`）

   Google Cloud CLI にログイン済みの AI Agent は、同じ操作を次のコマンドで実行できます。

   ```bash
   gcloud services enable \
     analyticsadmin.googleapis.com \
     analyticsdata.googleapis.com \
     searchconsole.googleapis.com \
     --project YOUR_PROJECT_ID
   ```

3. [Google Auth Platform scopes](https://console.cloud.google.com/auth/scopes)を開きます。初回設定を求められた場合は、アプリ名を **GA Lite** にし、サポートメールとデベロッパー連絡先を入力します。個人の Gmail アカウントでは Audience に **External** を選択します。**Data Access** の **Add or remove scopes** を開き、以下のスコープをすべて検索して選択し、保存します。

   ```text
   https://www.googleapis.com/auth/webmasters
   https://www.googleapis.com/auth/webmasters.readonly
   https://www.googleapis.com/auth/analytics
   https://www.googleapis.com/auth/analytics.edit
   https://www.googleapis.com/auth/analytics.readonly
   https://www.googleapis.com/auth/userinfo.email
   https://www.googleapis.com/auth/userinfo.profile
   openid
   ```

4. デプロイ済みの GA Lite で **Settings → Google OAuth** を開き、表示された **Authorized JavaScript origin** と 2 つの **Authorized redirect URI** をコピーします。
5. [Google Auth Platform clients](https://console.cloud.google.com/auth/clients)を開き、**Create client** をクリックして **Web application** を選択します。
   - **Authorized JavaScript origins** に GA Lite の Origin を追加します。パスを含めず、Origin だけを入力してください。
   - **Authorized redirect URIs** に GA4 と GSC のコールバック URL を追加します。GA Lite の表示と完全に一致させてください。
6. Client を作成し、表示された **Google Client ID** と **Google Client Secret** をコピーして、**Settings → Google OAuth** に入力して保存します。
7. **Integrations → Add a new account** を開き、Google の認可を完了します。

Google Client が未設定の場合、**Add a new account** を押すと対応する Settings タブが自動的に開きます。

### Bing Webmaster

**Integrations → Add a new account** を開いて Bing を選択し、Bing Webmaster API Key を入力します。

### カスタムドメイン

生成された `workers.dev` URL は追加設定なしで利用できます。カスタムドメインを使う場合：

1. Cloudflare でドメインを Worker に割り当てます。
2. そのカスタムドメインから GA Lite を開き、**Settings → Custom domain** で HTTPS Origin を入力します。
3. Google OAuth を有効にしている場合は、Settings に表示される新しい値で Google Cloud の Authorized JavaScript origin と Authorized redirect URI を更新します。

カスタムドメイン欄を空にすると、GA Lite は現在のリクエスト Origin を自動的に使用します。

## API と MCP

すべてのエンドポイントはデプロイ先の Origin を使用します。

- API ドキュメント：`/api-docs`
- MCP エンドポイント：`/api/mcp`
- MCP OAuth メタデータ：`/.well-known/oauth-authorization-server`

## ローカル開発

`.dev.vars` を作成し、ローカル用の Secret を 1 つ設定します。

```dotenv
APP_SECRET=replace-with-at-least-32-random-characters
```

ローカル D1 を準備して Nuxt を起動します。

```bash
pnpm db:migrate:local
pnpm dev
```

ターミナルに表示されたローカル URL を開き、同じ管理者初期化フローを完了します。

## 既存デプロイの更新

新しいバージョンを取得した後に実行します。

```bash
pnpm install
pnpm db:migrate:remote
pnpm deploy
```

## ライセンス

GA Lite は [GNU Affero General Public License v3.0](./LICENSE) の下で公開されています。
