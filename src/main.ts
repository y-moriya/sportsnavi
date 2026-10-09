import { DOMParser } from "linkedom";
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

export function parseNewsItems(newsItems: Iterable<any>): NewsItem[] {
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
      newsItem.title.includes(title)
    );
    const isIgnored = IGNORE_TITLES.some((title) =>
      newsItem.title.includes(title)
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

export async function fetchNewsListPage(): Promise<any> {
  const newsListPage = await fetch(
    "https://sports.yahoo.co.jp/list/news/npb?genre=npb&team=5",
  );
  const newsListBody = await newsListPage.text();
  const newsListDoc = new DOMParser().parseFromString(
    newsListBody,
    "text/html",
  );
  const newsItems = newsListDoc?.querySelectorAll?.(".cm-timeLine__item");

  if (!newsItems) {
    throw new Error("Failed to find news items");
  }

  return newsItems;
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
): Promise<boolean> {
  const key = `articles:${newsItem.url}`;
  const res = await kv.get(key);
  if (res !== null) {
    log.info("News item already registered", { item: newsItem });
    return true;
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

export async function getNewsArticle(
  url: string,
  headerSelector: string,
  bodySelector: string,
  log: Logger = logger,
): Promise<string> {
  const newsArticlePage = await fetch(url);

  if (!newsArticlePage.ok) {
    if (newsArticlePage.body) {
      await newsArticlePage.body.cancel();
    }
    return "";
  }

  const newsArticleBody = await newsArticlePage.text();
  const newsArticleDoc = new DOMParser().parseFromString(
    newsArticleBody,
    "text/html",
  );
  if (!newsArticleDoc) {
    return "";
  }
  for (const br of newsArticleDoc.querySelectorAll("br")) {
    br.replaceWith(newsArticleDoc.createTextNode("\n"));
  }
  const newsHeader = newsArticleDoc.querySelector(headerSelector)?.textContent;
  const paragraphElements = newsArticleDoc.querySelectorAll(bodySelector);
  let newsBody = "";
  const pageRegex = /\d+\/\d+ページ/;
  for (const paragraph of paragraphElements ?? []) {
    const filteredText = filterPhotoLines(paragraph.textContent ?? "");
    if (pageRegex.test(filteredText)) {
      continue;
    }
    newsBody += `${filteredText}\n`;
  }
  let content = newsHeader && url.endsWith("1") ? `${newsHeader} \n\n\n` : "";
  content += normalizeNewlines(newsBody);
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

export async function notifyDiscordWithNewsItem(
  newsItem: NewsItem,
  env: Env,
  log: Logger = logger,
): Promise<void> {
  const webhookUrl = env.WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error("WEBHOOK_URL is not set");
  }

  const getNewsArticleFn = getNewsArticleNormal;
  if (newsItem.url.includes("expert")) {
    log.info("Ignored expert news item", { item: newsItem });
    return;
  }

  let newsContent = "";
  for (const i of [1, 2, 3, 4, 5]) {
    const content = await getNewsArticleFn(`${newsItem.url}?page=${i}`, log);
    if (content === "") {
      break;
    }
    newsContent += content;
  }
  newsContent += `\n<${newsItem.url}>`;

  if (IGNORE_KEYWORDS.some((keyword) => newsContent.includes(keyword))) {
    log.info("Ignored news item due to keywords", { item: newsItem });
    return;
  }

  const duplicateCheckRequestBody = convertItemToDuplicateCheckRequest(
    newsItem,
    newsContent,
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
    return;
  }

  const MAX_CONTENT_LENGTH = 2000;
  const contentChunks = splitContentIntoChunks(newsContent, MAX_CONTENT_LENGTH);
  const normalizedContentChunks = normalizeNewlinesInChunks(contentChunks);

  for (const chunk of normalizedContentChunks) {
    await sendDiscordMessage(webhookUrl, chunk, newsItem, log);
  }
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

  const intervalMs = env.NOTIFY_INTERVAL_MS
    ? parseInt(env.NOTIFY_INTERVAL_MS, 10)
    : 90 * 1000;

  for (const newsItem of news) {
    const isRegistered = await registerNewsItem(newsItem, env.SPORTSNAVI_KV, log);
    if (!isRegistered) {
      await notifyDiscordWithNewsItem(newsItem, env, log);
      if (intervalMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
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

export async function runCron(env: Env): Promise<void> {
  const log = createLoggerFromEnv(env);
  log.info("Start cron job");
  try {
    const newsItems = await fetchNewsListPage();
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
    await notifyDiscord(unregisteredNews, env, log);
    log.info("Cron job completed successfully");
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
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(runCron(env));
  },
};
