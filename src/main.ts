import { Logger, logger } from "./logger";

export interface Env {
  SPORTSNAVI_KV: KVNamespace;
  ECHO_BREAKER?: Fetcher;
  WEBHOOK_URL?: string;
  AXIOM_DATASET?: string;
  AXIOM_TOKEN?: string;
  NOTIFY_INTERVAL_MS?: string;
}

export interface NewsItem {
  title: string;
  credit: string;
  url: string;
}

export type CheckArticleRequest = {
  media_name: string;
  url: string;
  title: string;
  content: string;
};

export type CheckArticleResponse = {
  is_duplicate: boolean;
  similarity_score: number;
  verification_result?: boolean;
  message: string;
  debug_info: {
    most_similar_article: {
      title: string;
      url: string;
      score: number;
    } | null;
  };
};

export const DUPLICATE_CHECK_URL =
  "https://echo-breaker.euros21st.workers.dev/api/check-article";

export const INCLUDE_TITLES = ["阪神"];
export const IGNORE_TITLES = [
  "虎になれ",
  "阪神大学",
  "虎のソナタ",
  "内匠宏幸",
  "掛布",
  "寺尾で候",
  "阪神戦",
  "ネット",
  "ネット驚愕",
  "阪神リーグ",
  "鬼筆",
  "金村義明",
  "亀山つとむ",
  "岡田彰布",
  "岡田顧問",
  "広岡達朗",
  "廣岡達朗",
  "佐藤義則",
];

export const IGNORE_CREDITS = [
  "日テレNEWS",
  "東スポWEB",
  "日刊ゲンダイDIGITAL",
  "文春オンライン",
  "夕刊フジ",
  "CoCoKARAnext",
  "note",
  "NEWSポストセブン",
  "日テレNEWS NNN",
  "西スポWEB OTTO！",
  "TBS NEWS DIG Powered by JNN",
  "AERA dot.",
  "デイリー新潮",
  "FRIDAY",
  "RONSPO",
  "中日スポーツ",
  "共同通信",
  "時事通信",
  "ベースボールチャンネル",
  "Yahoo!ニュース オリジナル THE PAGE",
  "テレ東スポーツ",
  "J-CASTニュース",
  "高校野球ドットコム",
  "Full-Count",
  "土井麻由実",
  "現代ビジネス",
  "THE ANSWER",
  "ベースボールキング",
  "AERA DIGITAL",
  "DAZN News",
  "Number Web",
  "スポーティングニュース日本版",
  "週刊女性PRIME",
  "THE DIGEST",
  "スポニチアネックス",
];

export const IGNORE_KEYWORDS = [
  "川藤",
  "中畑",
  "掛布",
  "SNS",
  "ＳＮＳ",
  "旧ツイッター",
  "藤田平",
  "柏原誠",
  "デーブ大久保",
  "畑野理之",
  "ネット",
  "佐藤義則",
  "ファンは「",
  "Xでは",
  "Ｘでは",
  "江本",
  "ファン",
  "高木豊",
];

export const MAX_NOTIFICATIONS_PER_RUN = 5;

export const DEFAULT_FETCH_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
  "Sec-CH-UA":
    '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  "Sec-CH-UA-Mobile": "?0",
  "Sec-CH-UA-Platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

/**
 * User-Agent 付与および一時的エラー（403/429/5xx）時のリトライを行う fetch ラッパー
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  maxRetries = 2,
  delayMs = 1500,
  log: Logger = logger,
): Promise<Response> {
  const headers = {
    ...DEFAULT_FETCH_HEADERS,
    ...(options.headers || {}),
  };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, { ...options, headers });
      if (response.ok) {
        return response;
      }
      if (
        attempt < maxRetries &&
        (response.status === 429 || response.status >= 500)
      ) {
        if (response.body) {
          await response.body.cancel();
        }
        log.warn(
          `Fetch returned status ${response.status}, retrying in ${delayMs}ms... (attempt ${attempt + 1}/${maxRetries})`,
          { url, status: response.status },
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      return response;
    } catch (err) {
      if (attempt < maxRetries) {
        log.warn(
          `Fetch threw error, retrying in ${delayMs}ms... (attempt ${attempt + 1}/${maxRetries})`,
          { url, error: String(err) },
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Failed to fetch ${url} after ${maxRetries} retries`);
}

interface RawNewsItem {
  title?: string;
  credit?: string;
  url?: string;
}

/**
 * HTMLRewriter を使用してスポーツナビのニュース一覧をストリーミングパース
 */
export async function parseNewsListWithHTMLRewriter(
  response: Response,
): Promise<NewsItem[]> {
  const items: NewsItem[] = [];
  let currentItem: RawNewsItem | null = null;
  let capturingField: "title" | "credit" | null = null;

  const rewriter = new HTMLRewriter()
    .on(".cm-timeLine__item", {
      element(el) {
        currentItem = {};
        el.onEndTag(() => {
          if (currentItem?.title && currentItem?.credit && currentItem?.url) {
            items.push({
              title: currentItem.title.trim(),
              credit: currentItem.credit.trim(),
              url: currentItem.url.trim(),
            });
          }
          currentItem = null;
        });
      },
    })
    .on(".cm-timeLine__itemArticleLink", {
      element(el) {
        const href = el.getAttribute("href");
        if (currentItem && href) {
          currentItem.url = href;
        }
      },
    })
    .on(".cm-timeLine__itemTitle", {
      element(el) {
        capturingField = "title";
        if (currentItem) currentItem.title = "";
        el.onEndTag(() => {
          capturingField = null;
        });
      },
      text(text) {
        if (capturingField === "title" && currentItem) {
          currentItem.title = (currentItem.title || "") + text.text;
        }
      },
    })
    .on(".cm-timeLine__itemCredit", {
      element(el) {
        capturingField = "credit";
        if (currentItem) currentItem.credit = "";
        el.onEndTag(() => {
          capturingField = null;
        });
      },
      text(text) {
        if (capturingField === "credit" && currentItem) {
          currentItem.credit = (currentItem.credit || "") + text.text;
        }
      },
    });

  await rewriter.transform(response).arrayBuffer();
  return items;
}

/**
 * 後方互換性のための parseNewsItems
 */
export function parseNewsItems(newsItems: any): NewsItem[] {
  if (Array.isArray(newsItems)) {
    return newsItems;
  }
  const news: NewsItem[] = [];
  for (const newsItem of newsItems) {
    const title = newsItem.querySelector?.(".cm-timeLine__itemTitle")?.textContent;
    const credit = newsItem.querySelector?.(".cm-timeLine__itemCredit")?.textContent;
    const url = newsItem.querySelector?.("a.cm-timeLine__itemArticleLink")?.getAttribute?.("href");

    if (!title || !credit || !url) {
      throw new Error("Failed to find title, credit, or url");
    }

    news.push({
      title,
      credit,
      url,
    });
  }
  return news;
}

export function filterNewsByTitle(
  news: Array<NewsItem>,
  log: Logger = logger,
): Array<NewsItem> {
  const ignoredTitles: string[] = [];
  const filteredNews = news.filter((newsItem) => {
    const isIncluded = INCLUDE_TITLES.some((title) =>
      newsItem.title.includes(title),
    );
    const isIgnored = IGNORE_TITLES.some((title) =>
      newsItem.title.includes(title),
    );
    if (isIncluded && !isIgnored) {
      return true;
    } else if (isIgnored) {
      ignoredTitles.push(newsItem.title);
      return false;
    }
    return false;
  });

  if (ignoredTitles.length > 0) {
    log.info("Filtered out news items by title", { ignoredTitles });
  }

  return filteredNews;
}

export function filterNewsByCredit(news: Array<NewsItem>): Array<NewsItem> {
  return news.filter((newsItem) => !IGNORE_CREDITS.includes(newsItem.credit));
}

export function filterNews(
  newsItems: Array<NewsItem>,
  log: Logger = logger,
): Array<NewsItem> {
  const newsFilteredByTitle = filterNewsByTitle(newsItems, log);
  const newsFilteredByTitleAndCredit = filterNewsByCredit(newsFilteredByTitle);
  return newsFilteredByTitleAndCredit;
}

export async function fetchNewsListPage(
  log: Logger = logger,
): Promise<NewsItem[]> {
  try {
    const newsListPage = await fetchWithRetry(
      "https://sports.yahoo.co.jp/list/news/npb?genre=npb&team=5",
      {},
      2,
      1500,
      log,
    );
    if (!newsListPage.ok) {
      if (newsListPage.body) {
        await newsListPage.body.cancel();
      }
      if (newsListPage.status === 403) {
        const bodySnippet = (await newsListPage.text().catch(() => "")).slice(
          0,
          300,
        );
        const cfRay = newsListPage.headers.get("cf-ray") || undefined;
        log.info(
          "News list fetch returned 403 (likely geo-restriction or redundant instance), skipping this instance.",
          { status: 403, cfRay, bodySnippet },
        );
        return [];
      }
      log.warn(
        `Failed to fetch news list (status: ${newsListPage.status}), skipping this run.`,
        { status: newsListPage.status },
      );
      return [];
    }
    return await parseNewsListWithHTMLRewriter(newsListPage);
  } catch (err) {
    log.warn(
      "Failed to fetch news list due to network/retry error, skipping this run.",
      { error: String(err) },
    );
    return [];
  }
}

export async function filterUnregisteredNewsItems(
  items: Array<NewsItem>,
  kv: KVNamespace,
): Promise<Array<NewsItem>> {
  if (items.length === 0) return [];
  const results = await Promise.all(
    items.map((item) => kv.get(`articles:${item.url}`)),
  );
  return items.filter((_, index) => results[index] === null);
}

export async function registerNewsItem(
  newsItem: NewsItem,
  kv: KVNamespace,
  log: Logger = logger,
  skipCheck = false,
): Promise<boolean> {
  const key = `articles:${newsItem.url}`;
  if (!skipCheck) {
    const res = await kv.get(key);
    if (res !== null) {
      log.info("News item already registered", { item: newsItem });
      return true;
    }
  }

  await kv.put(key, "true", { expirationTtl: 24 * 60 * 60 });
  log.info("Registering news item", { item: newsItem });
  return false;
}

export function normalizeNewlines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n");
}

export function filterPhotoLines(text: string): string {
  const lines = text.split("\n");
  const filteredLines = lines.filter((line) => !/^【[^】]+】/.test(line.trim()));
  return filteredLines.join("\n");
}

/**
 * HTMLRewriter を使用して記事タイトル、本文、次ページの有無をストリーミング抽出
 */
export async function extractArticleContentWithHTMLRewriter(
  response: Response,
  pageNumber = 1,
  articleBaseUrl = "",
): Promise<{ title: string; body: string; hasNextPage: boolean }> {
  let title = "";
  let body = "";
  let inHeader = false;
  let inParagraph = false;
  let currentParagraph = "";
  let hasNextPage = false;
  const pageRegex = /\d+\/\d+ページ/;

  // 記事IDを抽出して次ページリンクを自記事のものに限定する
  const articleIdMatch = articleBaseUrl.match(/articles\/([a-zA-Z0-9]+)/);
  const articleId = articleIdMatch ? articleIdMatch[1] : "";
  const nextPageNumber = pageNumber + 1;

  const rewriter = new HTMLRewriter()
    .on(
      "article#uamods > header > h1, article#uamods-article > div > header > h1, article header h1",
      {
        element(el) {
          inHeader = true;
          el.onEndTag(() => {
            inHeader = false;
          });
        },
        text(text) {
          if (inHeader) {
            title += text.text;
          }
        },
      },
    )
    .on(
      "article#uamods > div > div > p, article#uamods-article > div > section > div > p, article#uamods-article > div > section > div > *",
      {
        element(el) {
          inParagraph = true;
          currentParagraph = "";
          el.onEndTag(() => {
            inParagraph = false;
            const filteredText = filterPhotoLines(currentParagraph);
            if (!pageRegex.test(filteredText) && filteredText.trim().length > 0) {
              body += `${filteredText}\n`;
            }
          });
        },
        text(text) {
          if (inParagraph) {
            currentParagraph += text.text;
          }
        },
      },
    )
    .on(
      "article#uamods > div > div > p br, article#uamods-article > div > section > div > p br",
      {
        element() {
          if (inParagraph) {
            currentParagraph += "\n";
          }
        },
      },
    )
    .on("a[href*='page=']", {
      element(el) {
        const href = el.getAttribute("href");
        if (!href) return;

        // 次ページのリンクか判定
        const hasNextPageParam =
          href.includes(`?page=${nextPageNumber}`) ||
          href.includes(`&page=${nextPageNumber}`) ||
          href.includes(`page=${nextPageNumber}`);

        if (hasNextPageParam) {
          if (articleId) {
            if (href.includes(articleId)) {
              hasNextPage = true;
            }
          } else {
            hasNextPage = true;
          }
        }
      },
    });

  await rewriter.transform(response).arrayBuffer();
  return {
    title: title.trim(),
    body: normalizeNewlines(body).trim(),
    hasNextPage,
  };
}

export async function getNewsArticle(
  url: string,
  _headerSelector?: string,
  _bodySelector?: string,
  log: Logger = logger,
): Promise<string> {
  const newsArticlePage = await fetchWithRetry(url, {}, 2, 1000, log);

  if (!newsArticlePage.ok) {
    if (newsArticlePage.body) {
      await newsArticlePage.body.cancel();
    }
    return "";
  }

  const pageMatch = url.match(/[?&]page=(\d+)/);
  const pageNumber = pageMatch ? parseInt(pageMatch[1], 10) : 1;

  const { title, body } = await extractArticleContentWithHTMLRewriter(
    newsArticlePage,
    pageNumber,
    url,
  );

  let content = title && url.endsWith("1") ? `${title} \n\n\n` : "";
  content += normalizeNewlines(body);
  log.info("Retrieved article page", { url, contentLength: content.length });
  return content;
}

export function getNewsArticleNormal(
  url: string,
  log: Logger = logger,
): Promise<string> {
  return getNewsArticle(
    url,
    "article#uamods > header > h1",
    "article#uamods > div > div > p",
    log,
  );
}

export function getNewsArticleExpert(
  url: string,
  log: Logger = logger,
): Promise<string> {
  return getNewsArticle(
    url,
    "article#uamods-article > div > header > h1",
    "article#uamods-article > div > section > div > *",
    log,
  );
}

export async function sendDiscordMessage(
  webhookUrl: string,
  content: string,
  newsItem: NewsItem,
  log: Logger = logger,
): Promise<void> {
  const discordResponse = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content,
      username: newsItem.credit,
      avatar_url:
        "https://s.yimg.jp/images/sportsnavi/common/apple-touch-icon.png",
    }),
  });
  if (!discordResponse.ok) {
    throw new Error(
      `Failed to send discord notification: ${discordResponse.statusText}`,
    );
  }
  log.info("Sent Discord message", {
    credit: newsItem.credit,
    title: newsItem.title,
    status: discordResponse.status,
  });
}

export function splitContentIntoChunks(
  content: string,
  maxChunkLength: number,
): string[] {
  const lines = content.split("\n");
  let currentChunk = "";
  const chunks: string[] = [];
  for (const line of lines) {
    if (currentChunk.length + line.length > maxChunkLength) {
      chunks.push(currentChunk);
      currentChunk = "";
    }
    currentChunk += `${line.trim()}\n`;
  }
  chunks.push(currentChunk);
  return chunks;
}

export function normalizeNewlinesInChunks(chunks: string[]): string[] {
  return chunks.map((chunk) => normalizeNewlines(chunk));
}

export function convertItemToDuplicateCheckRequest(
  item: NewsItem,
  content: string,
): CheckArticleRequest {
  return {
    media_name: item.credit,
    title: item.title,
    content: content,
    url: item.url,
  };
}

/**
 * 1記事の取得・検証・通知
 * - 1ページ目で早期キーワード除外
 * - 1ページ目で早期重複チェック (echo-breaker)
 * - 重複でない場合のみ次ページを取得
 */
export async function notifyDiscordWithNewsItem(
  newsItem: NewsItem,
  env: Env,
  log: Logger = logger,
): Promise<boolean> {
  const webhookUrl = env.WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error("WEBHOOK_URL is not set");
  }

  if (newsItem.url.includes("expert")) {
    log.info("Ignored expert news item", { item: newsItem });
    return false;
  }

  // 1. 1ページ目を取得
  const page1Url = newsItem.url.includes("?page=")
    ? newsItem.url
    : `${newsItem.url}?page=1`;

  const page1Res = await fetchWithRetry(page1Url, {}, 2, 1000, log);
  if (!page1Res.ok) {
    if (page1Res.body) await page1Res.body.cancel();
    return false;
  }

  const {
    title: page1Title,
    body: page1Body,
    hasNextPage,
  } = await extractArticleContentWithHTMLRewriter(page1Res, 1, newsItem.url);

  let page1Content = page1Title ? `${page1Title} \n\n\n` : "";
  page1Content += normalizeNewlines(page1Body);

  const page1FullText = `${page1Content}\n<${newsItem.url}>`;

  // 2. 1ページ目で早期キーワードチェック
  if (IGNORE_KEYWORDS.some((keyword) => page1FullText.includes(keyword))) {
    log.info("Ignored news item due to keywords", { item: newsItem });
    return false;
  }

  // 3. 1ページ目で早期重複記事チェック (echo-breaker)
  const duplicateCheckRequestBody = convertItemToDuplicateCheckRequest(
    newsItem,
    page1FullText,
  );

  const fetcher = env.ECHO_BREAKER
    ? env.ECHO_BREAKER.fetch.bind(env.ECHO_BREAKER)
    : globalThis.fetch;

  const res = await fetcher(DUPLICATE_CHECK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(duplicateCheckRequestBody),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(
      `Duplicate check API returned status ${res.status}: ${errorText}`,
    );
  }

  const checkArticleResponse = (await res.json()) as CheckArticleResponse;
  log.info("Duplicate check completed", {
    item: newsItem,
    isDuplicate: checkArticleResponse.is_duplicate,
    score: checkArticleResponse.similarity_score,
  });

  if (checkArticleResponse.is_duplicate) {
    log.info("Skipped duplicate news item", {
      item: newsItem,
      debugInfo: checkArticleResponse.debug_info,
    });
    return false;
  }

  // 4. 重複でなく、次ページが存在する場合のみ 2〜5 ページ目を取得
  let fullNewsContent = page1Content;
  if (hasNextPage) {
    let currentHasNext = true;
    for (let page = 2; page <= 5 && currentHasNext; page++) {
      const pageRes = await fetchWithRetry(
        `${newsItem.url}?page=${page}`,
        {},
        2,
        1000,
        log,
      );
      if (!pageRes.ok) {
        if (pageRes.body) await pageRes.body.cancel();
        break;
      }
      const parsed = await extractArticleContentWithHTMLRewriter(
        pageRes,
        page,
        newsItem.url,
      );
      if (!parsed.body) {
        break;
      }
      fullNewsContent += `\n\n${normalizeNewlines(parsed.body)}`;
      currentHasNext = parsed.hasNextPage;
    }
  }

  fullNewsContent = `${normalizeNewlines(fullNewsContent)}\n<${newsItem.url}>`;

  // 2ページ目以降も含めた全文で念のためキーワードチェック
  if (IGNORE_KEYWORDS.some((keyword) => fullNewsContent.includes(keyword))) {
    log.info("Ignored news item due to keywords in full content", {
      item: newsItem,
    });
    return false;
  }

  // 5. Discord へ送信
  const MAX_CONTENT_LENGTH = 2000;
  const contentChunks = splitContentIntoChunks(
    fullNewsContent,
    MAX_CONTENT_LENGTH,
  );
  const normalizedContentChunks = normalizeNewlinesInChunks(contentChunks);

  for (const chunk of normalizedContentChunks) {
    await sendDiscordMessage(webhookUrl, chunk, newsItem, log);
  }

  return true;
}

export async function notifyDiscord(
  news: Array<NewsItem>,
  env: Env,
  log: Logger = logger,
): Promise<void> {
  const webhookUrl = env.WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error("WEBHOOK_URL is not set");
  }

  // ベクター処理がデータベースに反映されるまでの待機時間（デフォルト90秒）
  const intervalMs = env.NOTIFY_INTERVAL_MS
    ? parseInt(env.NOTIFY_INTERVAL_MS, 10)
    : 90 * 1000;

  for (let i = 0; i < news.length; i++) {
    const newsItem = news[i];
    // 未登録判定済みのため、二重 get をスキップして即 put (skipCheck = true)
    await registerNewsItem(newsItem, env.SPORTSNAVI_KV, log, true);
    const notified = await notifyDiscordWithNewsItem(newsItem, env, log);
    // 実際に新規通知が行われ、かつ後続の記事がある場合のみベクターDB反映待ちを行う
    if (notified && i < news.length - 1 && intervalMs > 0) {
      log.info("Waiting for vector DB propagation before checking next article", {
        intervalMs,
      });
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}

export function createLoggerFromEnv(env: Env): Logger {
  return new Logger({
    appName: "sportsnavi",
    dataset: env.AXIOM_DATASET,
    token: env.AXIOM_TOKEN,
  });
}

export async function getCloudflareTrace(): Promise<{
  colo: string;
  loc: string;
}> {
  try {
    const res = await fetch("https://cloudflare.com/cdn-cgi/trace");
    if (!res.ok) return { colo: "UNKNOWN", loc: "UNKNOWN" };
    const text = await res.text();
    const colo = text.match(/colo=([A-Z]+)/)?.[1] ?? "UNKNOWN";
    const loc = text.match(/loc=([A-Z]+)/)?.[1] ?? "UNKNOWN";
    return { colo, loc };
  } catch {
    return { colo: "UNKNOWN", loc: "UNKNOWN" };
  }
}

export async function runCron(
  env: Env,
  scheduledTime?: number,
): Promise<void> {
  const log = createLoggerFromEnv(env);
  const bucket = scheduledTime
    ? Math.floor(scheduledTime / (15 * 60 * 1000))
    : Math.floor(Date.now() / (15 * 60 * 1000));
  const lockKey = `cron:done:${bucket}`;

  try {
    const alreadyDone = await env.SPORTSNAVI_KV.get(lockKey);
    if (alreadyDone !== null) {
      log.info(
        "Cron job already executed successfully for this interval, skipping",
        { bucket, scheduledTime },
      );
      return;
    }

    const trace = await getCloudflareTrace();
    log.info("Start cron job", {
      scheduledTime,
      bucket,
      colo: trace.colo,
      loc: trace.loc,
    });

    const newsItems = await fetchNewsListPage(log);
    if (newsItems.length === 0) {
      log.info("No news items retrieved, finishing cron run", { bucket });
      return;
    }

    const news = parseNewsItems(newsItems);
    const filteredNews = filterNews(news, log);
    const unregisteredNews = await filterUnregisteredNewsItems(
      filteredNews,
      env.SPORTSNAVI_KV,
    );
    log.info("News items prepared for notification", {
      rawCount: news.length,
      filteredCount: filteredNews.length,
      unregisteredCount: unregisteredNews.length,
    });

    // 1回のCronあたりの通知数を最大件数に絞る（残りは次回Cronで処理）
    const targetNews = unregisteredNews.slice(0, MAX_NOTIFICATIONS_PER_RUN);
    await notifyDiscord(targetNews, env, log);

    await env.SPORTSNAVI_KV.put(lockKey, "true", { expirationTtl: 30 * 60 });
    log.info("Cron job completed successfully", { bucket });
  } catch (err) {
    log.error("Cron job failed", err);
  } finally {
    await log.flush();
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const log = createLoggerFromEnv(env);
    log.info("Health check ping received", { path: url.pathname });
    return new Response(
      "SportsNavi News Fetcher is running. Cron schedule: */15 * * * *",
      {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      },
    );
  },

  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(runCron(env, event.scheduledTime));
  },
};
