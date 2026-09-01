// Minimal Node-compatible `url` shim for JavaScriptCore/WKWebView.
// No Node APIs used; self-contained. Wraps the host-provided WHATWG `URL`
// and `URLSearchParams` globals (present in JSC/WKWebView and in Node, which
// is what vitest runs under) — the ES2020 lib (no DOM) doesn't declare them,
// so minimal ambient shapes are declared local to this module.

declare class URLSearchParams {
  constructor(
    init?:
      | string
      | Record<string, string>
      | Iterable<[string, string]>
      | URLSearchParams,
  );
  append(name: string, value: string): void;
  delete(name: string): void;
  get(name: string): string | null;
  getAll(name: string): string[];
  has(name: string): boolean;
  set(name: string, value: string): void;
  sort(): void;
  toString(): string;
  forEach(
    callback: (value: string, key: string, parent: URLSearchParams) => void,
  ): void;
  entries(): IterableIterator<[string, string]>;
  keys(): IterableIterator<string>;
  values(): IterableIterator<string>;
  [Symbol.iterator](): IterableIterator<[string, string]>;
}

declare class URL {
  constructor(input: string, base?: string | URL);
  href: string;
  origin: string;
  protocol: string;
  username: string;
  password: string;
  host: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  searchParams: URLSearchParams;
  hash: string;
  toString(): string;
  toJSON(): string;
}

export interface UrlObject {
  protocol?: string | null;
  slashes?: boolean | null;
  auth?: string | null;
  host?: string | null;
  port?: string | null;
  hostname?: string | null;
  hash?: string | null;
  search?: string | null;
  query?: string | Record<string, unknown> | null;
  pathname?: string | null;
  path?: string | null;
  href?: string | null;
}

export interface Url extends UrlObject {
  protocol: string | null;
  slashes: boolean | null;
  auth: string | null;
  host: string | null;
  port: string | null;
  hostname: string | null;
  hash: string | null;
  search: string | null;
  query: string | null;
  pathname: string | null;
  path: string | null;
  href: string;
}

export function parse(urlString: string): Url {
  let u: URL;
  let slashes: boolean;
  try {
    u = new URL(urlString);
    slashes = urlString.includes("//");
  } catch {
    // Protocol-relative or otherwise base-less URL — try a fake base.
    if (urlString.startsWith("//")) {
      u = new URL(`http:${urlString}`);
      slashes = true;
    } else {
      u = new URL(urlString, "http://localhost");
      slashes = urlString.includes("//");
    }
  }

  const auth =
    u.username || u.password
      ? `${u.username}${u.password ? ":" + u.password : ""}`
      : null;
  const search = u.search || null;
  const hash = u.hash || null;
  const pathname = u.pathname || null;
  const path = pathname !== null ? pathname + (search ?? "") : null;
  const host = u.host || null;

  return {
    protocol: u.protocol || null,
    slashes,
    auth,
    host,
    port: u.port || null,
    hostname: u.hostname || null,
    hash,
    search,
    query: search ? search.slice(1) : null,
    pathname,
    path,
    href: u.href,
  };
}

export function format(urlObject: UrlObject | URL): string {
  if (urlObject instanceof URL) {
    return urlObject.toString();
  }

  const {
    protocol = "",
    slashes,
    auth,
    hostname,
    host,
    port,
    pathname = "",
    search,
    query,
    hash = "",
  } = urlObject;

  let result = "";
  if (protocol) {
    result += protocol.endsWith(":") ? protocol : protocol + ":";
  }

  const useSlashes = slashes || !!hostname || !!host;
  if (useSlashes) {
    result += "//";
  }

  if (auth) {
    result += auth + "@";
  }

  if (host) {
    result += host;
  } else if (hostname) {
    result += hostname;
    if (port) {
      result += ":" + port;
    }
  }

  if (pathname) {
    result += pathname.startsWith("/") || result === "" ? pathname : "/" + pathname;
  }

  if (search) {
    result += search.startsWith("?") ? search : "?" + search;
  } else if (query) {
    if (typeof query === "string") {
      result += query.startsWith("?") ? query : query.length ? "?" + query : "";
    } else {
      const qs = new URLSearchParams(
        query as Record<string, string>,
      ).toString();
      if (qs) {
        result += "?" + qs;
      }
    }
  }

  if (hash) {
    result += hash.startsWith("#") ? hash : "#" + hash;
  }

  return result;
}

export function resolve(from: string, to: string): string {
  const resolved = new URL(to, from);
  return resolved.toString();
}

// `URL`/`URLSearchParams` above are ambient *type* declarations only — they
// have no runtime binding in this module's scope. Re-exporting the bare
// identifiers would try to export an undeclared local binding, so instead
// pull the actual constructors off `globalThis` (where the JSC/WKWebView
// host, and Node under vitest, both provide them) and export those.
const GlobalURL = (globalThis as unknown as { URL: typeof URL }).URL;
const GlobalURLSearchParams = (
  globalThis as unknown as { URLSearchParams: typeof URLSearchParams }
).URLSearchParams;

export { GlobalURL as URL, GlobalURLSearchParams as URLSearchParams };

interface UrlModule {
  parse: typeof parse;
  format: typeof format;
  resolve: typeof resolve;
  URL: typeof URL;
  URLSearchParams: typeof URLSearchParams;
}

const url: UrlModule = {
  parse,
  format,
  resolve,
  URL: GlobalURL,
  URLSearchParams: GlobalURLSearchParams,
};

export default url;
