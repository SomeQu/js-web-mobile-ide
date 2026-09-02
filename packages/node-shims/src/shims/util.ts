// Minimal Node-compatible `util` shim for JavaScriptCore/WKWebView.
// No Node APIs used; self-contained.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;
type Callback = (err: unknown, value?: unknown) => void;

// `TextEncoder`/`TextDecoder` are provided by the JavaScriptCore/WKWebView
// host (and by Node, which is what vitest runs under), but the ES2020 lib
// (no DOM) doesn't declare them — add minimal ambient shapes local to this
// module, same pattern as `url.ts` uses for `URL`/`URLSearchParams`.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean });
  decode(input?: Uint8Array): string;
}

// The declarations above are ambient *types* only — no runtime binding in
// this module's scope. Pull the actual constructors off `globalThis` (where
// the JSC/WKWebView host, and Node under vitest, both provide them).
const GlobalTextEncoder = (
  globalThis as unknown as { TextEncoder: typeof TextEncoder }
).TextEncoder;
const GlobalTextDecoder = (
  globalThis as unknown as { TextDecoder: typeof TextDecoder }
).TextDecoder;

export { GlobalTextEncoder as TextEncoder, GlobalTextDecoder as TextDecoder };

export function inherits(ctor: AnyFn, superCtor: AnyFn): void {
  Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
  (ctor as unknown as { super_: AnyFn }).super_ = superCtor;
}

export function promisify(fn: AnyFn): (...args: unknown[]) => Promise<unknown> {
  return function (...args: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const cb: Callback = (err, value) => {
        if (err) {
          reject(err);
        } else {
          resolve(value);
        }
      };
      fn(...args, cb);
    });
  };
}

export function callbackify(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fn: (...args: any[]) => Promise<unknown>,
): (...args: unknown[]) => void {
  return function (...args: unknown[]): void {
    const cb = args.pop() as Callback;
    fn(...args).then(
      (value) => cb(null, value),
      (err) => cb(err),
    );
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function deprecate<T extends AnyFn>(fn: T, _msg?: string): T {
  // No-op in this shim: no console warning machinery is guaranteed present
  // in every host, so `deprecate` simply behaves like the original function.
  return fn;
}

function formatArg(spec: string, arg: unknown): string {
  switch (spec) {
    case "s":
      return typeof arg === "string" ? arg : inspect(arg);
    case "d":
    case "i":
      return String(Number(arg));
    case "f":
      return String(Number(arg));
    case "j":
      try {
        return JSON.stringify(arg);
      } catch {
        return "[Circular]";
      }
    case "o":
    case "O":
      return inspect(arg);
    default:
      return "";
  }
}

const FORMAT_SPECIFIERS = new Set(["s", "d", "i", "f", "j", "o", "O"]);

export function format(fmt?: unknown, ...args: unknown[]): string {
  if (typeof fmt !== "string") {
    const all = fmt === undefined ? args : [fmt, ...args];
    return all.map((a) => (typeof a === "string" ? a : inspect(a))).join(" ");
  }

  let argIndex = 0;
  let result = "";

  for (let i = 0; i < fmt.length; i++) {
    const ch = fmt[i];
    if (ch === "%" && i + 1 < fmt.length) {
      const spec = fmt[i + 1];
      if (spec === "%") {
        result += "%";
        i++;
        continue;
      }
      if (FORMAT_SPECIFIERS.has(spec)) {
        if (argIndex < args.length) {
          result += formatArg(spec, args[argIndex++]);
        } else {
          result += "%" + spec;
        }
        i++;
        continue;
      }
    }
    result += ch;
  }

  while (argIndex < args.length) {
    const arg = args[argIndex++];
    result += " " + (typeof arg === "string" ? arg : inspect(arg));
  }

  return result;
}

export interface InspectOptions {
  depth?: number;
}

export function inspect(
  value: unknown,
  opts?: InspectOptions,
  _seen?: Set<unknown>,
  _depth = 0,
): string {
  const seen = _seen ?? new Set<unknown>();
  const maxDepth = opts?.depth ?? 2;

  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }

  const t = typeof value;
  if (t === "string") {
    return JSON.stringify(value);
  }
  if (
    t === "number" ||
    t === "boolean" ||
    t === "bigint" ||
    t === "symbol" ||
    t === "function"
  ) {
    return String(value);
  }

  if (t === "object") {
    if (seen.has(value)) {
      return "[Circular *1]";
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (value instanceof RegExp) {
      return value.toString();
    }
    if (Array.isArray(value)) {
      if (_depth > maxDepth) {
        return "[Array]";
      }
      seen.add(value);
      const items = value.map((v) => inspect(v, opts, seen, _depth + 1));
      seen.delete(value);
      return `[ ${items.join(", ")} ]`;
    }

    if (_depth > maxDepth) {
      return "[Object]";
    }
    seen.add(value);
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    const parts = keys.map(
      (k) => `${k}: ${inspect(obj[k], opts, seen, _depth + 1)}`,
    );
    seen.delete(value);
    const ctorName = (obj.constructor && obj.constructor.name) || "";
    const prefix = ctorName && ctorName !== "Object" ? ctorName + " " : "";
    return `${prefix}{ ${parts.join(", ")} }`;
  }

  return String(value);
}

export const types = {
  isDate: (v: unknown): v is Date => v instanceof Date,
  isRegExp: (v: unknown): v is RegExp => v instanceof RegExp,
  isArray: (v: unknown): v is unknown[] => Array.isArray(v),
  isString: (v: unknown): v is string => typeof v === "string",
  isNumber: (v: unknown): v is number => typeof v === "number",
  isBoolean: (v: unknown): v is boolean => typeof v === "boolean",
  isNull: (v: unknown): v is null => v === null,
  isUndefined: (v: unknown): v is undefined => v === undefined,
  isNullOrUndefined: (v: unknown): boolean => v === null || v === undefined,
  isFunction: (v: unknown): v is AnyFn => typeof v === "function",
  isObject: (v: unknown): boolean => v !== null && typeof v === "object",
  isSymbol: (v: unknown): v is symbol => typeof v === "symbol",
  isError: (v: unknown): v is Error => v instanceof Error,
  isBuffer: (v: unknown): boolean =>
    !!v &&
    typeof v === "object" &&
    (v as { _isBuffer?: boolean })._isBuffer === true,
};

interface UtilModule {
  inherits: typeof inherits;
  promisify: typeof promisify;
  callbackify: typeof callbackify;
  deprecate: typeof deprecate;
  format: typeof format;
  inspect: typeof inspect;
  types: typeof types;
  TextEncoder: typeof TextEncoder;
  TextDecoder: typeof TextDecoder;
}

const util: UtilModule = {
  inherits,
  promisify,
  callbackify,
  deprecate,
  format,
  inspect,
  types,
  TextEncoder: GlobalTextEncoder,
  TextDecoder: GlobalTextDecoder,
};

export default util;
