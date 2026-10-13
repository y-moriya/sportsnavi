import {
  INCLUDE_TITLES,
  IGNORE_TITLES,
  IGNORE_CREDITS,
  IGNORE_KEYWORDS,
} from "./config.js";
import type { NewsItem } from "./types.js";
import type { Logger } from "./logger.js";

export interface FilterResult {
  allowed: boolean;
  reason?: string;
}

/**
 * ニュース一覧のメタデータ（タイトル、クレジット、URL）に基づく許可判定
 */
export function evaluateNewsMetadata(item: NewsItem): FilterResult {
  if (item.url.includes("expert")) {
    return { allowed: false, reason: "expert_author" };
  }

  const isIncluded = INCLUDE_TITLES.some((title) => item.title.includes(title));
  if (!isIncluded) {
    return { allowed: false, reason: "title_not_included" };
  }

  const isIgnoredTitle = IGNORE_TITLES.some((title) => item.title.includes(title));
  if (isIgnoredTitle) {
    return { allowed: false, reason: "ignored_title" };
  }

  if (IGNORE_CREDITS.includes(item.credit)) {
    return { allowed: false, reason: "ignored_credit" };
  }

  return { allowed: true };
}

/**
 * ニュース一覧配列から条件を満たす記事のみを抽出
 */
export function filterNewsList(items: NewsItem[], log?: Logger): NewsItem[] {
  const ignoredTitles: string[] = [];
  const accepted: NewsItem[] = [];

  for (const item of items) {
    const result = evaluateNewsMetadata(item);
    if (result.allowed) {
      accepted.push(item);
    } else if (result.reason === "ignored_title") {
      ignoredTitles.push(item.title);
    }
  }

  if (ignoredTitles.length > 0 && log) {
    log.info("Filtered out news items by title", { ignoredTitles });
  }

  return accepted;
}

/**
 * 本文またはタイトルに除外キーワードが含まれているかを判定
 */
export function containsIgnoredKeywords(text: string): boolean {
  return IGNORE_KEYWORDS.some((kw) => text.includes(kw));
}
