# Runtime Bridge Design Spec

## Overview

`@anthropic-ide/runtime-bridge` — TypeScript пакет, реализующий протокол коммуникации между IDE (основной WKWebView) и изолированной средой исполнения пользовательского кода (второй WKWebView, управляемый Swift). Пакет transport-agnostic: определяет протокол, типы сообщений и координацию, а конкретный транспорт подключается как адаптер.

## Architecture

### Execution Model

Два режима исполнения:

1. **Run-to-completion** — пользователь нажимает "Run", бандлированный JS исполняется целиком в чистом контексте. Результат (return value или ошибка) возвращается в IDE.

2. **REPL** — после run-to-completion (или отдельно) runtime сохраняет контекст. Пользователь вводит выражения по одному, каждое выполняется в том же контексте с доступом к ранее объявленным переменным.

Оба режима доступны через единый `RuntimeBridge` API. Run-to-completion создаёт чистый контекст; REPL работает в существующем.

### Isolation Target

Целевая среда исполнения — **второй WKWebView**, создаваемый Swift-слоем (`apps/ios-app`). Это обеспечивает:

- Отдельный процесс — краш пользовательского кода не затрагивает IDE
- Независимый JS heap — лимиты памяти изолированы
- Swift контролирует lifecycle — можно убить/перезапустить WKWebView
- `WKScriptMessageHandler` — нативный канал коммуникации iOS

Runtime-bridge как TS-пакет не зависит от конкретного транспорта. `MockTransport` поставляется для тестирования; `WebViewTransport` реализуется в `apps/ios-app`.

## Protocol

JSON-RPC 2.0 inspired, двунаправленный, JSON-сериализованный.

### Message Types

```ts
interface Request {
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

interface Response {
  id: string;
  result?: unknown;
  error?: { code: string; message: string; data?: unknown };
}

interface Notification {
  method: string;
  params?: Record<string, unknown>;
}

type Message = Request | Response | Notification;
```

Каждый `Request` получает ровно один `Response` с тем же `id`. `Notification` — fire-and-forget, без `id`.

### IDE → Runtime Methods

| Method | Params | Response | Description |
|--------|--------|----------|-------------|
| `exec` | `{ code: string, timeout?: number }` | `{ result?: unknown }` or error | Исполнить бандл в чистом контексте |
| `eval` | `{ expression: string }` | `{ result?: unknown }` or error | Выполнить выражение в REPL-контексте |
| `kill` | `{}` | `{ ok: true }` | Остановить текущее исполнение |
| `reset` | `{}` | `{ ok: true }` | Очистить REPL-контекст |
| `stdin.write` | `{ data: string }` | — (notification) | Отправить stdin-данные в runtime |
| `stdin.end` | `{}` | — (notification) | Закрыть stdin |

### Runtime → IDE Methods (запросы от guest)

| Method | Params | Response | Description |
|--------|--------|----------|-------------|
| `vfs.readFile` | `{ path: string }` | `{ data: string }` (base64) or error | Чтение файла из VFS |
| `vfs.writeFile` | `{ path: string, data: string }` (base64) | `{ ok: true }` or error | Запись файла в VFS |
| `vfs.readdir` | `{ path: string }` | `{ entries: string[] }` | Список файлов |
| `vfs.stat` | `{ path: string }` | `{ type, size, mtime }` or error | Статистика файла |
| `vfs.mkdir` | `{ path: string, recursive?: boolean }` | `{ ok: true }` or error | Создать директорию |
| `vfs.rmdir` | `{ path: string, recursive?: boolean }` | `{ ok: true }` or error | Удалить директорию |
| `vfs.unlink` | `{ path: string }` | `{ ok: true }` or error | Удалить файл |
| `vfs.rename` | `{ oldPath: string, newPath: string }` | `{ ok: true }` or error | Переименовать |
| `vfs.exists` | `{ path: string }` | `{ exists: boolean }` | Проверить существование |
| `vfs.symlink` | `{ target: string, path: string }` | `{ ok: true }` or error | Создать symlink |
| `vfs.readlink` | `{ path: string }` | `{ target: string }` or error | Прочитать symlink |
| `vfs.lstat` | `{ path: string }` | `{ type, size, mtime }` or error | lstat |
| `fetch` | `{ url: string, method?: string, headers?: Record<string,string>, body?: string }` | `{ status: number, headers: Record<string,string>, body: string }` | HTTP-запрос через нативный networking |

### Runtime → IDE Notifications

| Method | Params | Description |
|--------|--------|-------------|
| `console` | `{ level: "log"\|"warn"\|"error"\|"info"\|"debug", args: unknown[] }` | Console output из пользовательского кода |
| `stdin.request` | `{}` | Runtime запрашивает stdin-ввод |
| `exit` | `{ code: number }` | Пользовательский process.exit() |

### Error Codes

```ts
type ErrorCode =
  | "TIMEOUT"          // exec превысил таймаут
  | "KILLED"           // исполнение прервано через kill()
  | "RUNTIME_ERROR"    // необработанное исключение в пользовательском коде
  | "TRANSPORT_ERROR"  // транспорт разорван/недоступен
  | "VFS_ERROR"        // ошибка VFS-операции
  | "NETWORK_ERROR"    // ошибка fetch-запроса
  | "INVALID_MESSAGE"; // невалидное сообщение протокола
```

## Module Structure

```
runtime-bridge/src/
  types.ts            — Message, Request, Response, Notification, ErrorCode, все интерфейсы протокола
  protocol.ts         — serialize/deserialize, generateId, createRequest/Response/Notification helpers
  transport.ts        — ITransport interface + MockTransport
  runtime.ts          — RuntimeBridge class (главный API)
  vfs-proxy.ts        — VfsProxy: обрабатывает vfs.* запросы от runtime, проксирует к IVirtualFileSystem
  network-proxy.ts    — NetworkProxy: обрабатывает fetch запросы от runtime
  console-capture.ts  — ConsoleEntry type, ConsoleCollector class
  guest.ts            — runtime-guest код: инжектится в sandbox, перехватывает console/fetch/__vfs
  index.ts            — public API exports
```

### types.ts

Все типы протокола. Без логики, только интерфейсы и type guards.

```ts
export interface Request {
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface Response {
  id: string;
  result?: unknown;
  error?: ResponseError;
}

export interface ResponseError {
  code: ErrorCode;
  message: string;
  data?: unknown;
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
  timeout?: number; // ms, default: 30000
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

export function isRequest(msg: Message): msg is Request;
export function isResponse(msg: Message): msg is Response;
export function isNotification(msg: Message): msg is Notification;
```

### protocol.ts

Stateless helpers для работы с протоколом.

```ts
export function generateId(): string;
export function serialize(msg: Message): string;
export function deserialize(raw: string): Message;
export function createRequest(method: string, params?: Record<string, unknown>): Request;
export function createResponse(id: string, result: unknown): Response;
export function createErrorResponse(id: string, code: ErrorCode, message: string, data?: unknown): Response;
export function createNotification(method: string, params?: Record<string, unknown>): Notification;
```

`generateId` — incrementing counter + random suffix, не UUID (лёгкость). `serialize`/`deserialize` — JSON.stringify/parse с валидацией структуры.

### transport.ts

```ts
export interface ITransport {
  send(message: string): void;
  onMessage(handler: (message: string) => void): void;
  close(): void;
}

export class MockTransport implements ITransport {
  // Два связанных конца: ide-side и runtime-side
  // send на одном вызывает onMessage на другом
  static createPair(): [MockTransport, MockTransport];
  send(message: string): void;
  onMessage(handler: (message: string) => void): void;
  close(): void;
  readonly messages: string[]; // recorded for assertions
}
```

`MockTransport.createPair()` создаёт пару связанных транспортов для тестирования — один для IDE-стороны (RuntimeBridge), другой для guest-стороны.

### runtime.ts — RuntimeBridge

Главный API пакета.

```ts
export interface RuntimeBridgeOptions {
  transport: ITransport;
  vfs?: IVirtualFileSystem;
  networkEnabled?: boolean;    // default: false
  defaultTimeout?: number;     // default: 30000ms
  onConsole?: (entry: ConsoleEntry) => void;
  onStdinRequest?: () => void;
  onExit?: (code: number) => void;
}

export class RuntimeBridge {
  constructor(options: RuntimeBridgeOptions);

  // Run-to-completion: исполняет код в чистом контексте
  exec(code: string, options?: ExecOptions): Promise<ExecResult>;

  // REPL: выполняет выражение в существующем контексте
  eval(expression: string): Promise<unknown>;

  // Lifecycle
  kill(): Promise<void>;
  reset(): Promise<void>;

  // Stdin
  writeStdin(data: string): void;
  endStdin(): void;

  // Console subscription (альтернатива onConsole в options)
  onConsole(handler: (entry: ConsoleEntry) => void): () => void; // returns unsubscribe

  // State
  readonly isExecuting: boolean;

  // Cleanup
  destroy(): void;
}
```

**Внутренняя логика:**
- `exec` отправляет `Request{method:"exec"}`, ждёт `Response`, собирает console entries по пути
- Timeout: запускает таймер, при истечении отправляет `kill` и reject'ит промис с `TIMEOUT`
- `kill` отправляет `Request{method:"kill"}` — транспорт/нативный слой должен прервать исполнение
- Входящие `vfs.*` запросы делегируются `VfsProxy`
- Входящие `fetch` запросы делегируются `NetworkProxy`
- Входящие `console` notifications передаются подписчикам
- `destroy` закрывает транспорт и очищает все pending promises

### vfs-proxy.ts

```ts
export class VfsProxy {
  constructor(vfs: IVirtualFileSystem);

  // Обрабатывает входящий vfs.* Request, возвращает Response
  handleRequest(request: Request): Promise<Response>;
}
```

Маппинг: `vfs.readFile` → `vfs.readFile(path)` → base64-encode результат. `vfs.writeFile` → base64-decode data → `vfs.writeFile(path, decoded)`. Ошибки VFS маппятся в `VFS_ERROR` response.

Данные файлов передаются в **base64** — единственный безопасный способ передачи бинарных данных через JSON. Текстовые файлы при необходимости могут передаваться как UTF-8 строки с флагом `encoding: "utf8"` в params.

### network-proxy.ts

```ts
export interface NetworkHandler {
  fetch(request: FetchRequest): Promise<FetchResponse>;
}

export class NetworkProxy {
  constructor(handler?: NetworkHandler);

  handleRequest(request: Request): Promise<Response>;
}
```

Если `handler` не предоставлен, все fetch-запросы возвращают `NETWORK_ERROR` с сообщением "Network access disabled". В продакшне handler реализует Swift через `URLSession`.

### console-capture.ts

```ts
export class ConsoleCollector {
  readonly entries: ConsoleEntry[];

  push(level: ConsoleLevel, args: unknown[]): void;
  clear(): void;
  drain(): ConsoleEntry[]; // возвращает и очищает
}
```

### guest.ts — Runtime Guest Code

Код, который инжектится в sandbox (второй WKWebView) перед исполнением пользовательского кода. Экспортируется как **строка** (pre-compiled).

```ts
export const GUEST_BOOTSTRAP: string;
```

Guest bootstrap делает:

1. **Console interception** — заменяет `console.log/warn/error/info/debug` на обёртки, которые:
   - Сериализуют аргументы (handle circular refs, functions, symbols)
   - Шлют `Notification{method:"console"}` через транспорт
   - Также вызывают оригинальный console (для отладки через Safari Web Inspector)

2. **VFS proxy** — устанавливает `globalThis.__vfs` как объект, чей каждый метод:
   - Шлёт `Request{method:"vfs.<method>"}` через транспорт
   - Ждёт `Response` с тем же `id`
   - Возвращает результат или бросает ошибку
   - Base64 decode/encode для бинарных данных

3. **Fetch proxy** — заменяет `globalThis.fetch` на обёртку:
   - Сериализует Request → `Request{method:"fetch"}`
   - Десериализует Response
   - Если network disabled — бросает `TypeError("Network access disabled")`

4. **Stdin** — устанавливает `globalThis.__stdin` как readable-like:
   - `read()` — шлёт `Notification{method:"stdin.request"}`, ждёт `stdin.write` данные
   - Связывает с `process.stdin` из node-shims если доступен

5. **Exec handler** — слушает `Request{method:"exec"}`:
   - Оборачивает `code` в `async function` и вызывает
   - Ловит исключения, формирует error response
   - Возвращает `Response{result}` по завершении

6. **Eval handler** — слушает `Request{method:"eval"}`:
   - Выполняет через `eval()` в сохранённом scope
   - Возвращает результат

7. **Kill handler** — слушает `Request{method:"kill"}`:
   - Устанавливает флаг, который проверяется в event loop
   - Реальное прерывание — ответственность нативного слоя (terminate WKWebView)

8. **Transport adapter** — guest-side использует `globalThis.__bridge_send(msg)` и `globalThis.__bridge_onMessage` — эти функции предоставляются нативным слоем (Swift `WKScriptMessageHandler`). Guest не знает о конкретном транспорте.

## Dependencies

```json
{
  "peerDependencies": {
    "@anthropic-ide/vfs": "workspace:*"
  },
  "devDependencies": {
    "@anthropic-ide/vfs": "workspace:*"
  }
}
```

Нет внешних npm-зависимостей. Протокол и транспорт — чистый TypeScript.

## Testing Strategy

Все тесты работают через `MockTransport` — без реального WKWebView.

### Unit Tests

- **protocol.ts**: serialize/deserialize roundtrip, generateId uniqueness, createRequest/Response helpers, invalid message handling
- **transport.ts**: MockTransport.createPair() communication, message recording, close behavior
- **vfs-proxy.ts**: каждый vfs.* метод roundtrip через mock VFS (MemoryFS), error mapping, base64 encoding
- **network-proxy.ts**: successful fetch roundtrip, network disabled error, handler errors
- **console-capture.ts**: push/drain/clear, entry structure, timestamp
- **runtime.ts**: exec success/error/timeout, eval, kill during exec, reset, console collection, stdin flow, destroy cleanup, concurrent exec rejection

### Integration Pattern

Тест создаёт `MockTransport.createPair()`, подключает `RuntimeBridge` к одному концу, эмулирует guest-поведение на другом:

```ts
const [ideSide, guestSide] = MockTransport.createPair();
const bridge = new RuntimeBridge({ transport: ideSide, vfs: memoryFs });

// Эмулируем guest: слушаем exec, отвечаем
guestSide.onMessage((raw) => {
  const msg = deserialize(raw);
  if (isRequest(msg) && msg.method === "exec") {
    guestSide.send(serialize(createResponse(msg.id, { result: 42 })));
  }
});

const result = await bridge.exec("1 + 1");
expect(result.result).toBe(42);
```

### Guest Tests

`guest.ts` тестируется отдельно — он экспортирует строку, но внутренняя логика (console interception, VFS proxy) проверяется через eval в тестовом контексте с mock `__bridge_send`/`__bridge_onMessage`.

## Constraints

- ES2020 target — нет optional chaining assignment (??=), нет top-level await
- Нет Node-specific APIs в source (только в *.test.ts)
- Нет внешних npm-зависимостей
- Cross-package imports только через exported interfaces из index.ts
- Guest code (`GUEST_BOOTSTRAP`) должен быть самодостаточным — никаких import'ов, только `globalThis`
- Бинарные данные через JSON → base64 encoding
- Таймаут по умолчанию: 30 секунд
- `kill` не гарантирует мгновенную остановку JS — это ответственность транспорта/нативного слоя
