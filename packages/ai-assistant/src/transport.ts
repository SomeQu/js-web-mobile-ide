// packages/ai-assistant/src/transport.ts

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface IHttpTransport {
  request(
    url: string,
    options: {
      method: string;
      headers: Record<string, string>;
      body?: string;
    },
  ): Promise<HttpResponse>;

  stream(
    url: string,
    options: {
      method: string;
      headers: Record<string, string>;
      body?: string;
    },
    onChunk: (chunk: string) => void,
  ): Promise<void>;
}
