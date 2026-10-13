import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

export interface Config {
  webhookUrl: string;
  echoBreakerUrl: string;
  notifyIntervalMs: number;
  dataDir: string;
  historyFilePath: string;
  lockFilePath: string;
  axiomToken?: string;
  axiomDataset?: string;
}

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
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
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

export function loadConfig(): Config {
  const dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), "data");
  return {
    webhookUrl: process.env.WEBHOOK_URL || "",
    echoBreakerUrl:
      process.env.ECHO_BREAKER_URL ||
      "https://echo-breaker.euros21st.workers.dev/api/check-article",
    notifyIntervalMs: process.env.NOTIFY_INTERVAL_MS
      ? parseInt(process.env.NOTIFY_INTERVAL_MS, 10)
      : 90000,
    dataDir,
    historyFilePath: path.join(dataDir, "history.json"),
    lockFilePath: path.join(dataDir, "process.lock"),
    axiomToken: process.env.AXIOM_TOKEN,
    axiomDataset: process.env.AXIOM_DATASET,
  };
}
