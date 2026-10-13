import * as cheerio from "cheerio";
import {
  DEFAULT_FETCH_HEADERS,
  INCLUDE_TITLES,
  IGNORE_TITLES,
  IGNORE_CREDITS,
  IGNORE_KEYWORDS,
} from "./config.js";
import { Logger } from "./logger.js";

export interface NewsItem {
  title: string;
  credit: string;
  url: string;
}

export const YAHOO_SPORTS_NAVI_URL =
  "https://sports.yahoo.co.jp/list/news/npb?genre=npb&team=5";

export function normalizeNewlines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n");
}

export function filterPhotoLines(text: string): string {
  const lines = text.split("\n");
  const filteredLines = lines.filter((line) => !/^【[^】]+】/.test(line.trim()));
  return filteredLines.join("\n");
}

export function filterNewsByTitle(
  news: NewsItem[],
  log?: Logger,
): NewsItem[] {
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
    }
    if (isIgnored) {
      ignoredTitles.push(newsItem.title);
    }
    return false;
  });

  if (ignoredTitles.length > 0 && log) {
    log.info("Filtered out news items by title", { ignoredTitles });
  }

  return filteredNews;
}

export function filterNewsByCredit(news: NewsItem[]): NewsItem[] {
  return news.filter((newsItem) => !IGNORE_CREDITS.includes(newsItem.credit));
}

export function filterNews(newsItems: NewsItem[], log?: Logger): NewsItem[] {
  const newsFilteredByTitle = filterNewsByTitle(newsItems, log);
  return filterNewsByCredit(newsFilteredByTitle);
}

/**
 * スポーツナビのニュース一覧HTMLをパース
 */
export function parseNewsListHtml(html: string): NewsItem[] {
  const $ = cheerio.load(html);
  const items: NewsItem[] = [];

  $(".cm-timeLine__item").each((_, el) => {
    const title = $(el).find(".cm-timeLine__itemTitle").text().trim();
    const credit = $(el).find(".cm-timeLine__itemCredit").text().trim();
    const url = $(el).find("a.cm-timeLine__itemArticleLink").attr("href")?.trim();

    if (title && credit && url) {
      items.push({ title, credit, url });
    }
  });

  return items;
}

/**
 * スポーツナビの最新ニュース一覧を取得
 */
export async function fetchNewsListPage(
  targetUrl = YAHOO_SPORTS_NAVI_URL,
  log?: Logger,
): Promise<NewsItem[]> {
  try {
    const response = await fetch(targetUrl, {
      headers: DEFAULT_FETCH_HEADERS,
    });

    if (!response.ok) {
      log?.warn(`Failed to fetch news list: HTTP ${response.status}`, {
        status: response.status,
      });
      return [];
    }

    const html = await response.text();
    return parseNewsListHtml(html);
  } catch (err) {
    log?.warn("Network error while fetching news list", {
      error: String(err),
    });
    return [];
  }
}

/**
 * 記事詳細ページからタイトル、本文、自記事の次ページ存在有無を抽出
 */
export function parseArticleHtml(
  html: string,
  pageNumber = 1,
  articleBaseUrl = "",
): { title: string; body: string; hasNextPage: boolean } {
  const $ = cheerio.load(html);

  // タイトル抽出
  let title = $(
    "article#uamods > header > h1, article#uamods-article > div > header > h1, article header h1",
  )
    .first()
    .text()
    .trim();

  // 本文抽出
  const paragraphs: string[] = [];
  const pageRegex = /\d+\/\d+ページ/;

  $(
    "article#uamods > div > div > p, article#uamods-article > div > section > div > p, article#uamods-article > div > section > div > *",
  ).each((_, el) => {
    const rawText = $(el).text();
    const filteredText = filterPhotoLines(rawText).trim();
    if (filteredText.length > 0 && !pageRegex.test(filteredText)) {
      paragraphs.push(filteredText);
    }
  });

  const body = paragraphs.join("\n");

  // 自記事の次ページリンク判定
  const articleIdMatch = articleBaseUrl.match(/articles\/([a-zA-Z0-9]+)/);
  const articleId = articleIdMatch ? articleIdMatch[1] : "";
  const nextPageNumber = pageNumber + 1;

  let hasNextPage = false;
  $("a").each((_, el) => {
    const href = $(el).attr("href");
    if (href && href.includes(`page=${nextPageNumber}`)) {
      if (!articleId || href.includes(articleId)) {
        hasNextPage = true;
        return false; // break each loop
      }
    }
  });

  return { title, body, hasNextPage };
}

/**
 * 記事URLから本文を取得（1〜5ページ巡回）
 */
export async function fetchFullArticleContent(
  articleUrl: string,
  log?: Logger,
): Promise<{ title: string; fullContent: string; page1Text: string } | null> {
  const page1Url = articleUrl.includes("?page=")
    ? articleUrl
    : `${articleUrl}?page=1`;

  const page1Res = await fetch(page1Url, {
    headers: DEFAULT_FETCH_HEADERS,
  });

  if (!page1Res.ok) {
    log?.warn(`Failed to fetch article page 1: HTTP ${page1Res.status}`, {
      url: page1Url,
      status: page1Res.status,
    });
    return null;
  }

  const page1Html = await page1Res.text();
  const page1Parsed = parseArticleHtml(page1Html, 1, articleUrl);

  let page1Content = page1Parsed.title
    ? `${page1Parsed.title} \n\n\n`
    : "";
  page1Content += normalizeNewlines(page1Parsed.body);

  const page1Text = `${page1Content}\n<${articleUrl}>`;

  // 1ページ目で早期キーワードチェック
  if (IGNORE_KEYWORDS.some((kw) => page1Text.includes(kw))) {
    return { title: page1Parsed.title, fullContent: "", page1Text };
  }

  let fullContent = page1Content;
  let currentHasNext = page1Parsed.hasNextPage;

  for (let page = 2; page <= 5 && currentHasNext; page++) {
    try {
      const pageRes = await fetch(`${articleUrl}?page=${page}`, {
        headers: DEFAULT_FETCH_HEADERS,
      });
      if (!pageRes.ok) break;

      const pageHtml = await pageRes.text();
      const parsed = parseArticleHtml(pageHtml, page, articleUrl);
      if (!parsed.body) break;

      fullContent += `\n\n${normalizeNewlines(parsed.body)}`;
      currentHasNext = parsed.hasNextPage;
    } catch {
      break;
    }
  }

  fullContent = `${normalizeNewlines(fullContent)}\n<${articleUrl}>`;

  // 全文でのキーワードチェック
  if (IGNORE_KEYWORDS.some((kw) => fullContent.includes(kw))) {
    return { title: page1Parsed.title, fullContent: "", page1Text };
  }

  return {
    title: page1Parsed.title,
    fullContent,
    page1Text,
  };
}
