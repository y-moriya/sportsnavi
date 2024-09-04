import {
  DOMParser,
  type Element,
  type NodeList,
} from "https://deno.land/x/deno_dom@v0.1.45/deno-dom-wasm.ts";
import "https://deno.land/std@0.203.0/dotenv/load.ts";

interface NewsItem {
  title: string;
  credit: string;
  url: string;
}

const INCLUDE_TITLES = ["阪神"];
const IGNORE_TITLES = ["虎になれ", "阪神大学", "虎のソナタ", "内匠宏幸", "掛布"];
const IGNORE_CREDITS = [
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
  "ベースボールチャンネル"
];
const IGNORE_KEYWORDS = ["川藤", "中畑", "掛布"];

function parseNewsItems(newsItems: NodeList) {
  const news = [];
  for (const newsItem of newsItems) {
    const newsElement = newsItem as Element;
    const title = newsElement.querySelector(".cm-timeLine__itemTitle")
      ?.textContent;
    const credit = newsElement.querySelector(".cm-timeLine__itemCredit")
      ?.textContent;
    const url = newsElement.querySelector("a.cm-timeLine__itemArticleLink")
      ?.getAttribute("href");

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

function filterNewsByTitle(news: Array<NewsItem>) {
  return news.filter((newsItem) =>
    INCLUDE_TITLES.some((title) => newsItem.title.includes(title)) &&
    IGNORE_TITLES.every((title) => !newsItem.title.includes(title))
  );
}

function filterNewsByCredit(news: Array<NewsItem>) {
  return news.filter((newsItem) => !IGNORE_CREDITS.includes(newsItem.credit));
}

export function filterNews(newsItems: Array<NewsItem>) {
  const newsFilteredByTitle = filterNewsByTitle(newsItems);
  const newsFilteredByTitleAndCredit = filterNewsByCredit(newsFilteredByTitle);
  return newsFilteredByTitleAndCredit;
}

async function fetchNewsListPage() {
  const newsListPage = await fetch(
    "https://sports.yahoo.co.jp/list/news/npb?genre=npb&team=5",
  );
  const newsListBody = await newsListPage.text();
  const newsListDoc = new DOMParser().parseFromString(
    newsListBody,
    "text/html",
  );
  const newsItems = newsListDoc?.querySelectorAll(".cm-timeLine__item");

  if (!newsItems) {
    throw new Error("Failed to find news items");
  }

  return newsItems;
}

async function sendRequestToSupabase(
  url: string,
  method: string,
  body: object,
): Promise<Response> {
  return await fetch(
    url,
    {
      method: method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_KEY")}`,
      },
      body: JSON.stringify(body),
    },
  );
}

async function filterUnregisteredNewsItems(
  items: Array<NewsItem>,
): Promise<Array<NewsItem>> {
  const res = await sendRequestToSupabase(
    Deno.env.get("SUPABASE_MULTI_URL") as string,
    "POST",
    { uris: items.map((item) => item.url) },
  );
  const json: { uri: string; registered: boolean }[] = await res.json();
  console.log(json);
  return items.filter((item) =>
    !json.find((j) => j.uri === item.url)?.registered
  );
}

async function registerNewsItem(newsItem: NewsItem) {
  const res = await sendRequestToSupabase(
    Deno.env.get("SUPABASE_URL") as string,
    "POST",
    { uri: newsItem.url },
  );
  const json = await res.json();
  if (json.registered) {
    console.info(`Already registered: ${JSON.stringify(newsItem)}`);
    return true;
  }

  console.info(`Registering: ${JSON.stringify(newsItem)}`);
  return false;
}

export function normalizeNewlines(text: string): string {
  let normalizedLine = text.replace(/^－/ig, "\n\n－").replaceAll(
    "。",
    "。\n\n",
  ).replace(/」$/ig, "」\n\n");
  normalizedLine = text.replace(/\n{3,}/g, "<3br>");
  normalizedLine = normalizedLine.replace(/\<3br\>/g, "\n\n");

  return normalizedLine;
}

export async function getNewsArticle(
  url: string,
  headerSelector: string,
  bodySelector: string,
): Promise<string> {
  const newsArticlePage = await fetch(url);

  if (!newsArticlePage.ok) {
    return "";
  }

  const newsArticleBody = await newsArticlePage.text();
  const newsArticleDoc = new DOMParser().parseFromString(
    newsArticleBody,
    "text/html",
  );
  const newsHeader = newsArticleDoc?.querySelector(headerSelector)?.textContent;
  const paragraphElements = newsArticleDoc?.querySelectorAll(bodySelector);
  let newsBody = "";
  const pageRegex = /\d+\/\d+ページ/;
  for (const paragraph of paragraphElements ?? []) {
    if (pageRegex.test(paragraph.textContent ?? "")) {
      continue;
    }
    newsBody += `${paragraph.textContent}\n`;
  }
  let content = newsHeader && url.endsWith("1") ? `${newsHeader} \n\n\n` : "";
  content += normalizeNewlines(newsBody);
  console.info(content);
  return content;
}

export function getNewsArticleNormal(url: string): Promise<string> {
  return getNewsArticle(
    url,
    "article#uamods > header > h1",
    "article#uamods > div > div > p",
  );
}

export function getNewsArticleExpert(url: string): Promise<string> {
  return getNewsArticle(
    url,
    "article#uamods-article > div > header > h1",
    "article#uamods-article > div > section > div > *",
  );
}

async function sendDiscordMessage(
  webhookUrl: string,
  content: string,
  newsItem: NewsItem,
) {
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
  console.log({ content, discordResponse });
}

export function splitContentIntoChunks(
  content: string,
  maxChunkLength: number,
): string[] {
  const lines = content.split("\n");
  let currentChunk = "";
  const chunks = [];
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

async function notifyDiscordWithNewsItem(newsItem: NewsItem) {
  const webhookUrl = Deno.env.get("WEBHOOK_URL");
  if (!webhookUrl) {
    throw new Error("WEBHOOK_URL is not set");
  }

  let getNewsArticleFn = getNewsArticleNormal;
  if (newsItem.url.includes("expert")) {
    getNewsArticleFn = getNewsArticleExpert;
  }

  let newsContent = "";
  for (const i of [1, 2, 3, 4, 5]) {
    const content = await getNewsArticleFn(`${newsItem.url}?page=${i}`);
    if (content === "") {
      break;
    }
    newsContent += content;
  }
  newsContent += `\n<${newsItem.url}>`;

  // newsContentに無視する単語が含まれている場合は通知しない
  if (IGNORE_KEYWORDS.some((keyword) => newsContent.includes(keyword))) {
    console.info(`Ignored: ${JSON.stringify(newsItem)}`);
    return;
  }

  // Discord message content length limit is 2000 characters
  const MAX_CONTENT_LENGTH = 2000;
  const contentChunks = splitContentIntoChunks(newsContent, MAX_CONTENT_LENGTH);
  const normalizedContentChunks = normalizeNewlinesInChunks(contentChunks);

  for (const chunk of normalizedContentChunks) {
    await sendDiscordMessage(webhookUrl, chunk, newsItem);
  }
}

async function notifyDiscord(news: Array<NewsItem>) {
  for (const newsItem of news) {
    const isRegistered = await registerNewsItem(newsItem);
    if (!isRegistered) {
      await notifyDiscordWithNewsItem(newsItem);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

// メインの処理
Deno.cron("fetch newsItems and notify discord", "* * * * *", async () => {
  console.info("Start cron job");
  const newsItems = await fetchNewsListPage();
  const news = parseNewsItems(newsItems);
  const filteredNews = filterNews(news);
  const unregisteredNews = await filterUnregisteredNewsItems(filteredNews);
  await notifyDiscord(unregisteredNews);
});
