// packages/runtime-bridge/src/types.ts

export interface Request {
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface ResponseError {
  code: ErrorCode;
  message: string;
  data?: unknown;
}

export interface Response {
  id: string;
  result?: unknown;
  error?: ResponseError;
}

export interface Notification {
  method: string;
  params?: Record<string, unknown>;
}

export type Message = Request | Response | Notification;

export type ErrorCode =
  | "TIMEOUT"
  | "KILLED"
  | "RUNTIME_ERROR"
  | "TRANSPORT_ERROR"
  | "VFS_ERROR"
  | "NETWORK_ERROR"
  | "INVALID_MESSAGE";

export type ConsoleLevel = "log" | "warn" | "error" | "info" | "debug";

export interface ConsoleEntry {
  level: ConsoleLevel;
  args: unknown[];
  timestamp: number;
}

export interface ExecOptions {
  timeout?: number;
}

export interface ExecResult {
  result?: unknown;
  console: ConsoleEntry[];
}

export interface FetchRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface FetchResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export function isRequest(msg: Message): msg is Request {
  return "id" in msg && "method" in msg;
}

export function isResponse(msg: Message): msg is Response {
  return "id" in msg && !("method" in msg);
}

export function isNotification(msg: Message): msg is Notification {
  return !("id" in msg) && "method" in msg;
}
