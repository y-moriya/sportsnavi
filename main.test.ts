import {
  filterNews,
  getNewsArticleExpert,
  getNewsArticleNormal,
} from "./main.ts";
import { assertEquals } from "https://deno.land/std@0.194.0/testing/asserts.ts";

// test for getNewsArticle
Deno.test("getNewsArticle", async () => {
  const url =
    "https://news.yahoo.co.jp/articles/1c346f4a4453923817f0436fc35a43b5fbc334c0?page=2";
  await getNewsArticleNormal(url);
});

// test for getNewsArticleExpert
Deno.test("getNewsArticleExpert", async () => {
  const url =
    "https://news.yahoo.co.jp/expert/articles/d735e238883cc597b8629f0597ca12c89f3edb65?page=1";
  await getNewsArticleExpert(url);
});

// // test for splitContent
// Deno.test("splitContentIntoChunks", () => {
//   const originalContent =
//     `【プレビュー】盗塁阻止率6割超のDeNA・山本祐大に注目！7連勝中の首位・阪神と最下位・ヤクルトが対戦、ほか ｜ セ・リーグ ｜ プロ野球

// 4月26日～28日に開催されるセ・リーグの見どころを紹介。

// 5位のDeNAと2位の巨人が対戦。

// DeNAの注目は山本祐大。
// 規定打席にこそ達していないものの、16試合で打率.333、9打点の好成績。
// 現在3試合連続でマルチ安打を放つなど好調だ。
// さらに最大の武器である強肩を活かした盗塁阻止率は、リーグトップの.615をマークしている。
// 攻守で存在感を示す正捕手候補に注目だ。

// 一方の巨人は、髙橋礼に注目。
// トレードで巨人にやってきたアンダースロー右腕は、開幕ローテーションを掴みここまで毎週日曜日に登板。
// 4試合で2勝0敗、防御率0.38と圧巻のパフォーマンスを発揮している。
// 2019年新人王に輝いた男が、巨人の覇権奪回の鍵になるかもしれない。

// 首位の阪神と最下位のヤクルトが対戦。

// 引き分けを挟んで7連勝と絶好調の阪神。
// 注目はチームを支えるブルペン陣だ。
// クローザーのゲラは12試合で0勝1敗、4セーブ、防御率0.75、岩崎優は10試合で1勝0敗、3セーブ、防御率0.00、桐敷拓馬は10試合で2勝0敗、防御率1.86と抜群の安定感を誇っている。
// さらに島本浩也らも好投を見せており、盤石の布陣を築いている。

// 一方のヤクルトは、オスナ、サンタナの助っ人砲に注目。
// オスナはここまで21試合で打率.299、5本塁打、17打点、サンタナは21試合で打率.315、2本塁打、11打点の好成績。
// 25日の広島戦ではオスナの今季2本目の満塁弾、サンタナのサヨナラ弾で勝利した。
// 阪神中継ぎ陣との勝負は見どころ充分だ。

// 3位の中日と、1ゲーム差で追う4位の広島が対戦（27、28日）。

// 直近7試合で1勝6敗と調子を落としている中日。
// 注目は岡林勇希だ。
// 19日の阪神戦から復帰し、主に1番で出場。
// 6試合で打率.136、1打点と本来の調子ではないものの、25日の巨人戦では初の長打となるタイムリーツーベースも放った。
// 調子を落としているチームを勢いづける活躍に期待したい。

// 直近7試合で4勝1敗2分と好調の広島は、野間峻祥に注目。
// 主に1番、3番に入り、ここまで17試合で打率.318、7打点。
// 打率はリーグトップの好成績だ。
// 二塁打7本、三塁打2本はいずれもリーグトップタイ。
// 快足を活かした活躍を見せている。

//  <https://news.yahoo.co.jp/articles/6cdc8bea71fe5154db7be1a58832ac3a51ed5803>`;

//   const contents = splitContentIntoChunks(originalContent, 2000);
//   const convertedContent = normalizeNewlinesInChunks(contents);
//   Deno.stdout.writeSync(new TextEncoder().encode(convertedContent.join("\n")));
// });

// test for filterNews
Deno.test("filterNews", () => {
  const news1 = {
    title: "タイトルに hanshin を含まない",
    credit: "Yahoo!ニュース",
    url:
      "https://news.yahoo.co.jp/articles/1c346f4a4453923817f0436fc35a43b5fbc334c0",
  };

  const filteredNews1 = filterNews([news1]);
  assertEquals(filteredNews1, []);

  const news2 = {
    title: "タイトルに 阪神 を含む",
    credit: "Yahoo!ニュース",
    url:
      "https://news.yahoo.co.jp/articles/1c346f4a4453923817f0436fc35a43b5fbc334c0",
  };

  const filteredNews2 = filterNews([news2]);
  assertEquals(filteredNews2, [news2]);

  const news3 = {
    title: "タイトルに 阪神 と 虎になれ を含む",
    credit: "Yahoo!ニュース",
    url:
      "https://news.yahoo.co.jp/articles/1c346f4a4453923817f0436fc35a43b5fbc334c0",
  };

  const filteredNews3 = filterNews([news3]);
  assertEquals(filteredNews3, []);
});
