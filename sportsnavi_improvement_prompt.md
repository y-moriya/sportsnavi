# Cloudflare Workers `sportsnavi` 最適化・改善プロンプト

## 目的
リポジトリ `y-moriya/sportsnavi`（Cloudflare Workers上で稼働する阪神タイガースニュース取得・Discord通知ワーカー）のCPU時間超過（`exceededResources`）エラーを解消し、動作速度、バンドルサイズ、信頼性を抜本的に改善してください。

---

## 現状の課題とメトリクス
直近15日間のCloudflareメトリクスにおいて、`sportsnavi` は総実行数305回中、**37回（約12%）で `exceededResources` エラー** が発生しています。
Cloudflare Workers Freeプランでは1リクエストあたりのCPU時間が **10ミリ秒** に制限されています。現状の実装がこの10msのCPU制限を超過していることが根本原因です。

### 主なボトルネック
1. **重厚なHTMLパーサーによるCPU時間枯渇**:
   - `deno_dom`（WASM/JS実装のDOMParser）を使用しており、バンドルサイズが約600KBに肥大化しています。
   - Yahoo! スポナビのHTML全体を `new DOMParser().parseFromString()` でパースするため、1回のパースだけで10ms近くのCPU時間を消費します。
   - 記事本文の取得でページネーション（`?page=1..5`）を巡回するたびにフルDOMパースを繰り返すため、確実にCPUリミットを超過します。
2. **Worker内での90秒スリープ（`setTimeout`）**:
   - `notifyDiscord` 内で通知ごとに `await new Promise((resolve) => setTimeout(resolve, 90 * 1000))` を実行しています。
   - 複数記事がある場合、Workerの生存時間制限に引っかかり、タイムアウトやサブリクエストの強制切断を招きます。
3. **無駄な連続HTTPサブリクエスト**:
   - 記事ごとに盲目的に `page=1` から `page=5` まで逐次fetchを行っており、通信遅延とWorker拘束時間が長大化しています。
   - 類似記事判定（`echo-breaker` 呼び出し）の前に全ページの取得を行っているため、重複記事に対しても無駄なページ取得が発生しています。
4. **二重のKV読み書き**:
   - `filterUnregisteredNewsItems` でKVを引いた後、`notifyDiscord` 内の `registerNewsItem` で再度KVのgetを行っています。

---

## 改善要件

### 1. `HTMLRewriter` への置き換え（最優先・必須）
`deno_dom` の使用を完全に廃止し、Cloudflare Workers組み込みの **`HTMLRewriter`**（Rust/C++ネイティブ実装、CPU消費ほぼゼロ、ストリーミング処理）に置き換えてください。
- バンドルサイズを 600KB から 30KB 以下へ削減してください。
- DOMパース処理のCPU時間を数ミリ秒から 0.1ms 未満へ短縮してください。

#### 実装例: ニュース一覧のパース (`HTMLRewriter`)
```typescript
interface RawNewsItem {
  title?: string;
  credit?: string;
  url?: string;
}

export async function parseNewsListWithHTMLRewriter(response: Response): Promise<NewsItem[]> {
  const items: NewsItem[] = [];
  let currentItem: RawNewsItem | null = null;
  let capturingField: "title" | "credit" | null = null;

  const rewriter = new HTMLRewriter()
    .on(".cm-timeLine__item", {
      element() {
        if (currentItem?.title && currentItem?.credit && currentItem?.url) {
          items.push(currentItem as NewsItem);
        }
        currentItem = {};
      }
    })
    .on(".cm-timeLine__itemArticleLink", {
      element(el) {
        const href = el.getAttribute("href");
        if (currentItem && href) {
          currentItem.url = href;
        }
      }
    })
    .on(".cm-timeLine__itemTitle", {
      element() {
        capturingField = "title";
        if (currentItem) currentItem.title = "";
      },
      text(text) {
        if (capturingField === "title" && currentItem) {
          currentItem.title = (currentItem.title || "") + text.text;
        }
      }
    })
    .on(".cm-timeLine__itemCredit", {
      element() {
        capturingField = "credit";
        if (currentItem) currentItem.credit = "";
      },
      text(text) {
        if (capturingField === "credit" && currentItem) {
          currentItem.credit = (currentItem.credit || "") + text.text;
        }
      }
    });

  await rewriter.transform(response).arrayBuffer();

  if (currentItem?.title && currentItem?.credit && currentItem?.url) {
    items.push(currentItem as NewsItem);
  }

  return items;
}
```

#### 実装例: 記事本文の抽出 (`HTMLRewriter`)
```typescript
export async function extractArticleContentWithHTMLRewriter(response: Response): Promise<{ title: string; body: string; hasNextPage: boolean }> {
  let title = "";
  let body = "";
  let inHeader = false;
  let inParagraph = false;
  let hasNextPage = false;

  const rewriter = new HTMLRewriter()
    .on("article#uamods > header > h1", {
      element() { inHeader = true; },
      text(text) {
        if (inHeader) title += text.text;
      }
    })
    .on("article#uamods > div > div > p", {
      element() { inParagraph = true; },
      text(text) {
        if (inParagraph) body += text.text;
      }
    })
    .on("article#uamods > div > div > p br", {
      element() {
        if (inParagraph) body += "\n";
      }
    })
    .on("a[href*='?page=']", {
      element(el) {
        // 次ページリンクの有無を検知
        const text = el.getAttribute("href");
        if (text) hasNextPage = true;
      }
    });

  await rewriter.transform(response).arrayBuffer();
  return { title: title.trim(), body: body.trim(), hasNextPage };
}
```

### 2. スリープ処理（`setTimeout`）の撤廃または極小化
- 90秒待機はCloudflare Workersでは非推奨です。
- Discord Webhookのレート制限は通常「同一Webhookに対して5リクエスト/2秒」です。
- 待機時間を `500ms` 〜 `1000ms` 程度にするか、もしくは同時通知数を1回のCronあたり最大3〜5件に絞る（残りは次回Cronで処理する）設計に変更してください。

### 3. サブリクエストの最適化と早期脱落
- ページネーション取得時に、1ページ目のHTML内に「次ページへのリンク」が存在しない場合は、2ページ目以降のfetchを行わないでください。
- 1ページ目のタイトルと本文を取得した時点で、まず `IGNORE_KEYWORDS` のチェックと `echo-breaker`（重複記事チェック）を実施してください。重複と判定された場合は、2ページ目以降の取得をスキップして即座に終了してください。

### 4. KVアクセスの整理
- `filterUnregisteredNewsItems` で未登録と判定されたら、通知処理の直前に即 `kv.put`（キー登録）を行い、重複実行や無駄な多重getを防いでください。

---

## 期待される成果
1. **CPU時間**: 10msの制限に対し、1回の実行あたり1ms未満に収まること。
2. **エラー率**: `exceededResources` の発生件数がゼロになること。
3. **バンドルサイズ**: `deno_dom` の完全削除により、ビルド後サイズが大幅に削減されること。
4. **テスト**: 既存の `main.test.ts` および `logger.test.ts` が正常に通過すること。
