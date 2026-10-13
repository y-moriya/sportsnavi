export interface NewsItem {
  title: string;
  credit: string;
  url: string;
}

export interface ArticleDetail {
  title: string;
  url: string;
  fullContent: string;
  page1Text: string;
}

export interface CheckArticleRequest {
  media_name: string;
  url: string;
  title: string;
  content: string;
}

export interface CheckArticleResponse {
  is_duplicate: boolean;
  similarity_score: number;
  verification_result?: boolean;
  message: string;
  debug_info?: {
    most_similar_article: {
      title: string;
      url: string;
      score: number;
    } | null;
  };
}
