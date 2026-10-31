// Tipos do intermediário (index.mjs), para os testes.
export interface LambdaEvent {
  rawPath?: string;
  rawQueryString?: string;
  headers?: Record<string, string>;
  body?: string;
  isBase64Encoded?: boolean;
  requestContext?: { http?: { method?: string } };
}
export interface LambdaResult {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
}
export function responder(event: LambdaEvent, deps: { chave?: string; fetch: (url: string, init?: RequestInit) => Promise<Response> }): Promise<LambdaResult>;
export function handler(event: LambdaEvent): Promise<LambdaResult>;
