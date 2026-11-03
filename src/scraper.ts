import * as cheerio from "cheerio";
import { DEFAULT_FETCH_HEADERS } from "./config.js";
import { fetchWithRetry } from "./http.js";
import type { NewsItem, ArticleDetail } from "./types.js";
import type { Logger } from "./logger.js";
import { filterNewsList, evaluateNewsMetadata } from "./filters.js";
import { normalizeNewlines } from "./discord.js";

export { NewsItem, ArticleDetail };
export { normalizeNewlines };

export const YAHOO_SPORTS_NAVI_URL =
  "https://sports.yahoo.co.jp/list/news/npb?genre=npb&team=5";

export type BracketKind = "media" | "navigation" | "content";

const MEDIA_TAG_PATTERNS: RegExp[] = [
  /^(?:写真|フォト|連続写真|秘蔵写真|報道写真)(?:あり|を見る|見る|一覧|特集|まとめ|ギャラリー|ニュース)?$/i,
  /^(?:写真|フォト|連続写真)[・:：\s]/i,
  /^(?:動画|映像|ビデオ|ムービー|音声)(?:あり|を見る|見る|一覧|特集|まとめ|配信|中継)?$/i,
  /^(?:動画|映像|ビデオ)[・:：\s]/i,
  /^(?:イラスト|画像|図表|グラフ|チャート|インフォグラフィック|マップ|地図|図解|図版)(?:あり|を見る|見る|一覧)?$/i,
  /^図$/,
  /^(?:イラスト|画像|図表)[・:：\s]/i,
  /^関連(?:記事|写真|動画|画像|リンク|情報)(?:はこちら)?$/,
  /^過去(?:記事|ニュース)$/,
  /^(?:外部サイト|外部リンク)$/,
  /^(?:SNS|Twitter|ツイッター|Instagram|インスタ(?:グラム)?|YouTube|ユーチューブ|TikTok|ティックトック|Facebook|フェイスブック|X)$/i,
  /^(?:photos?|videos?|movies?|images?|illustrations?|graphics?|charts?|maps?)$/i,
];

const NAVIGATION_TAG_PATTERNS: RegExp[] = [
  /^(?:.+リーグ)?順位表$/,
  /^一覧$/,
  /^まとめ$/,
];

export function classifyBracketTag(rawTag: string): BracketKind {
  const tag = rawTag.trim();
  if (!tag) return "content";
  for (const pattern of MEDIA_TAG_PATTERNS) {
    if (pattern.test(tag)) return "media";
  }
  for (const pattern of NAVIGATION_TAG_PATTERNS) {
    if (pattern.test(tag)) return "navigation";
  }
  return "content";
}

export function shouldRemoveBracketLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("【")) return false;
  const match = trimmed.match(/^【([^】]+)】/);
  if (!match) return false;
  const tag = match[1].trim();
  return classifyBracketTag(tag) !== "content";
}

/**
 * 写真・動画・メディアキャプション行を除去（見出しや本文ブラケットは保持）
 */
export function filterPhotoLines(text: string): string {
  const lines = text.split("\n");
  const filteredLines = lines
    .map((line) => line.replace(/^[ \t]+|[ \t]+$/g, ""))
    .filter((line) => !shouldRemoveBracketLine(line));
  return filteredLines.join("\n");
}

/**
 * ニュース一覧のフィルタリング（後方互換用エイリアス）
 */
export function filterNews(newsItems: NewsItem[], log?: Logger): NewsItem[] {
  return filterNewsList(newsItems, log);
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
    const response = await fetchWithRetry(
      targetUrl,
      { headers: DEFAULT_FETCH_HEADERS },
      {
        timeoutMs: 10_000,
        retries: 3,
        label: "news list",
        onRetry: (err, attempt, delay) => {
          log?.info(
            `Retrying news list fetch (attempt ${attempt}) in ${delay}ms`,
            { error: String(err) },
          );
        },
      },
    );

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

  // 自記事の次ページリンク判定
  const articleIdMatch = articleBaseUrl.match(/articles\/([a-zA-Z0-9]+)/);
  const articleId = articleIdMatch ? articleIdMatch[1] : "";
  const nextPageNumber = pageNumber + 1;

  let hasNextPage = false;
  $(`a[href*="page=${nextPageNumber}"]`).each((_, el) => {
    const href = $(el).attr("href");
    if (href) {
      if (!articleId || href.includes(articleId)) {
        hasNextPage = true;
        return false;
      }
    }
  });

  // タイトル抽出
  const title = $(
    "article#uamods > header > h1, article#uamods-article > div > header > h1, article header h1",
  )
    .first()
    .text()
    .trim();

  // 写真・メディア関連リンクを DOM から除去
  $("article a, div a").each((_, el) => {
    const linkText = $(el).text().trim();
    if (shouldRemoveBracketLine(linkText)) {
      $(el).remove();
    }
  });

  // <br> タグを改行文字に置換（段落内改行および写真リンク前後の改行を復元）
  $("br").replaceWith("\n");

  // 本文抽出
  const paragraphs: string[] = [];
  const pageRegex = /\d+\/\d+ページ/;

  let $paragraphs = $(
    "article#uamods > div > div > p, article#uamods-article > div > section > div > p",
  );

  if ($paragraphs.length === 0) {
    $paragraphs = $(
      "article#uamods > div > div > *, article#uamods-article > div > section > div > *",
    );
  }

  if ($paragraphs.length === 0) {
    $paragraphs = $("article p");
  }

  $paragraphs.each((_, el) => {
    const rawText = $(el).text();
    const filteredText = filterPhotoLines(rawText).trim();
    if (filteredText.length > 0 && !pageRegex.test(filteredText)) {
      paragraphs.push(filteredText);
    }
  });

  const body = normalizeNewlines(paragraphs.join("\n"));

  return { title, body, hasNextPage };
}

/**
 * 記事URLから本文を取得（1〜5ページ巡回して結合）
 */
export async function fetchFullArticleContent(
  articleUrl: string,
  log?: Logger,
): Promise<ArticleDetail | null> {
  const page1Url = articleUrl.includes("?page=")
    ? articleUrl
    : `${articleUrl}?page=1`;

  let page1Res: Response;
  try {
    page1Res = await fetchWithRetry(
      page1Url,
      { headers: DEFAULT_FETCH_HEADERS },
      {
        timeoutMs: 10_000,
        retries: 3,
        label: "article page 1",
        onRetry: (err, attempt, delay) => {
          log?.info(
            `Retrying article page 1 fetch (attempt ${attempt}) in ${delay}ms`,
            { url: page1Url, error: String(err) },
          );
        },
      },
    );
  } catch (err) {
    log?.warn(`Network error fetching article page 1`, {
      url: page1Url,
      error: String(err),
    });
    return null;
  }

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
  let fullContent = page1Content;
  let currentHasNext = page1Parsed.hasNextPage;

  for (let page = 2; page <= 5 && currentHasNext; page++) {
    try {
      const pageRes = await fetchWithRetry(
        `${articleUrl}?page=${page}`,
        { headers: DEFAULT_FETCH_HEADERS },
        { timeoutMs: 10_000, retries: 2, label: `article page ${page}` },
      );
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

  return {
    title: page1Parsed.title,
    url: articleUrl,
    fullContent,
    page1Text,
  };
}
