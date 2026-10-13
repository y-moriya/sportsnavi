# sportsnavi (阪神タイガース ニュース通知バッチ)

スポーツナビ（Yahoo! JAPAN）の阪神タイガースニュースを定期巡回し、ベクター重複判定（`echo-breaker`）を経て Discord に自動通知するバッチスクリプトです。

---

## 🌟 特徴

- **国内IPでの安定巡回**: 常時稼働マシン（Raspberry Pi、自宅サーバー、国内VPS等）の cron から直接実行することで、Yahoo! の地域制限（海外IPの403ブロック）を回避。
- **高精度な重複判定**: タイトル・キーワードの除外に加え、`echo-breaker`（ベクターDB類似度判定API）による類似記事の自動スキップ。
- **安全な多重起動防止**: ファイルロック（`data/process.lock`）により、前回のジョブ実行中（ベクター反映待ちなど）の重複実行を自動回避。
- **ローカル既読管理**: `data/history.json` に既読URLを自動記録（48時間以上前の古い履歴は自動クリーンアップ）。
- **Discord チャンク分割送信**: 2,000文字を超える長文記事も複数メッセージに自動分割して完全投稿。

---

## 📋 必要要件

- **Node.js**: v20.0.0 以上
- **パッケージマネージャー**: `pnpm` (推奨) または `npm`
- **ネットワーク**: 日本国内のIPアドレス（Yahoo! JAPAN へのアクセスが許可されている環境）

---

## 🚀 セットアップ手順（別マシンでの導入手順）

### 1. リポジトリのクローン

常時稼働マシンにログインし、リポジトリをクローンします。

```bash
git clone https://github.com/y-moriya/sportsnavi.git
cd sportsnavi
```

### 2. 依存パッケージのインストール

```bash
# pnpm を使用する場合
pnpm install

# npm を使用する場合
npm install
```

### 3. 環境変数ファイル（`.env`）の作成

`.env.example` をコピーして `.env` を作成し、通知先の Discord Webhook URL などを設定します。

```bash
cp .env.example .env
nano .env  # または vim .env
```

#### `.env` 設定項目

```ini
# Discord Webhook URL (必須)
WEBHOOK_URL="https://discord.com/api/webhooks/xxxx/yyyy"

# 類似記事判定 API (任意, デフォルトで echo-breaker が指定されています)
ECHO_BREAKER_URL="https://echo-breaker.euros21st.workers.dev/api/check-article"

# ベクターDB反映待ち時間 (ミリ秒, デフォルト: 90000 = 90秒)
NOTIFY_INTERVAL_MS=90000

# Axiom ログ送信 (任意, 設定した場合のみログを Axiom へ転送)
# AXIOM_TOKEN="xaat-..."
# AXIOM_DATASET="personal-apps"
```

### 4. ビルドと手動実行確認

TypeScript をビルドし、一度手動でスクリプトを実行して動作確認を行います。

```bash
# ビルド
pnpm run build

# 手動実行（本番モード）
pnpm run:prod
# または
node dist/index.js
```

ログが出力され、新着記事があれば Discord に通知されることを確認します。

---

## ⏰ Cron 定期実行の設定

15分おきに自動巡回するよう、マシンの `crontab` に登録します。

### 1. Node.js のフルパスを確認

cron 環境では環境変数 `PATH` が限定されるため、`node` コマンドの絶対パスを確認します。

```bash
which node
# 例: /usr/bin/node または /home/user/.local/share/mise/installs/node/...
```

### 2. crontab の編集

```bash
crontab -e
```

以下の設定行を末尾に追加します（パスはご自身の環境に合わせて置き換えてください）。

```cron
# 毎時 0分, 15分, 30分, 45分 に実行
*/15 * * * * cd /path/to/sportsnavi && /path/to/node dist/index.js >> /path/to/sportsnavi/cron.log 2>&1
```

#### 設定例（Raspberry Pi / Linux標準ユーザー `pi` の場合）:
```cron
*/15 * * * * cd /home/pi/sportsnavi && /usr/bin/node dist/index.js >> /home/pi/sportsnavi/cron.log 2>&1
```

> **Tip**: 前回のジョブがベクターDB反映待ち（90秒）等で実行中の場合でも、ファイルロックによって次回の二重起動は自動的に安全にスキップされます。

---

## 🛠️ コマンド一覧

| コマンド | 説明 |
| :--- | :--- |
| `pnpm start` | TypeScriptファイルを直接実行（開発・テスト用） |
| `pnpm run build` | TypeScript を `dist/` にコンパイル |
| `pnpm run:prod` | コンパイル済みの `dist/index.js` を実行（本番推奨） |
| `pnpm test` | 単体テストを実行（vitest） |
| `pnpm run typecheck` | TypeScript の型チェックを実行 |

---

## 📁 データファイルの構成

実行時に `data/` ディレクトリが自動作成されます（`.gitignore` 済み）。

- `data/history.json`: 既読記事の URL と通知タイムスタンプ（48時間保持）。
- `data/process.lock`: ジョブ実行中のロックファイル（ジョブ終了時に自動削除）。
