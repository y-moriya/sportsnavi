import { fetchWithRetry } from "./http.js";

export class GeminiClient {
  private apiKey: string;
  private baseUrl =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * テキストの埋め込みベクトル（768次元）を生成
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.apiKey) {
      throw new Error("GEMINI_API_KEY is not configured");
    }

    const url = `${this.baseUrl}?key=${this.apiKey}`;
    const response = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: {
            parts: [{ text }],
          },
          outputDimensionality: 768,
        }),
      },
      {
        timeoutMs: 10_000,
        retries: 3,
        label: "Gemini embedding",
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API Error: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as {
      embedding?: { values?: number[] };
    };

    if (!data.embedding?.values) {
      throw new Error("Gemini API returned no embedding values");
    }

    return data.embedding.values;
  }
}
