// POSIX-only path shim for JavaScriptCore/WKWebView. No Node APIs used.

export const sep = "/";
export const delimiter = ":";

interface ParsedPath {
  root: string;
  dir: string;
  base: string;
  ext: string;
  name: string;
}

function splitSegments(p: string): string[] {
  return p.split("/").filter((segment) => segment.length > 0);
}

function normalizeSegments(segments: string[]): string[] {
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") {
        out.pop();
      } else {
        out.push("..");
      }
      continue;
    }
    out.push(segment);
  }
  return out;
}

export function normalize(p: string): string {
  if (p === "") {
    return ".";
  }
  const isAbs = isAbsolute(p);
  const trailingSlash = p.length > 1 && p.endsWith("/");
  const rawSegments = splitSegments(p);
  let segments = normalizeSegments(rawSegments);

  if (isAbs) {
    // Leading .. segments are meaningless at the root; drop them.
    segments = segments.filter((s) => s !== "..");
  }

  let result = segments.join("/");
  if (isAbs) {
    result = "/" + result;
  } else if (result === "") {
    result = ".";
  }
  if (trailingSlash && result !== "/" && !result.endsWith("/")) {
    result += "/";
  }
  return result;
}

export function join(...parts: string[]): string {
  if (parts.length === 0) {
    return ".";
  }
  const joined = parts.filter((p) => p.length > 0).join("/");
  if (joined === "") {
    return ".";
  }
  return normalize(joined);
}

export function isAbsolute(p: string): boolean {
  return p.startsWith("/");
}

export function resolve(...parts: string[]): string {
  let resolvedSegments: string[] = [];
  let hitAbsolute = false;

  for (let i = parts.length - 1; i >= 0 && !hitAbsolute; i--) {
    const part = parts[i];
    if (!part || part.length === 0) {
      continue;
    }
    resolvedSegments = splitSegments(part).concat(resolvedSegments);
    if (isAbsolute(part)) {
      hitAbsolute = true;
    }
  }

  // Default root is "/" when no absolute segment was found.
  const normalized = normalizeSegments(resolvedSegments).filter((s) => s !== "..");
  return "/" + normalized.join("/");
}

export function relative(from: string, to: string): string {
  const fromAbs = resolve(from);
  const toAbs = resolve(to);

  if (fromAbs === toAbs) {
    return "";
  }

  const fromParts = splitSegments(fromAbs);
  const toParts = splitSegments(toAbs);

  let commonLength = 0;
  const minLength = Math.min(fromParts.length, toParts.length);
  while (commonLength < minLength && fromParts[commonLength] === toParts[commonLength]) {
    commonLength++;
  }

  const upCount = fromParts.length - commonLength;
  const downParts = toParts.slice(commonLength);

  const resultParts = [...Array(upCount).fill(".."), ...downParts];
  return resultParts.join("/");
}

export function dirname(p: string): string {
  if (p === "") {
    return ".";
  }
  const isAbs = isAbsolute(p);
  const trimmed = p.endsWith("/") && p.length > 1 ? p.slice(0, -1) : p;
  const lastSlash = trimmed.lastIndexOf("/");

  if (lastSlash === -1) {
    return isAbs ? "/" : ".";
  }
  if (lastSlash === 0) {
    return "/";
  }
  return trimmed.slice(0, lastSlash);
}

export function basename(p: string, ext?: string): string {
  const trimmed = p.endsWith("/") && p.length > 1 ? p.slice(0, -1) : p;
  const lastSlash = trimmed.lastIndexOf("/");
  let base = lastSlash === -1 ? trimmed : trimmed.slice(lastSlash + 1);

  if (ext && ext.length > 0 && base.endsWith(ext) && base !== ext) {
    base = base.slice(0, base.length - ext.length);
  }
  return base;
}

export function extname(p: string): string {
  const base = basename(p);
  const lastDot = base.lastIndexOf(".");
  if (lastDot <= 0) {
    // No dot, or dot is the first character (dotfile like ".hidden").
    return "";
  }
  return base.slice(lastDot);
}

export function parse(p: string): ParsedPath {
  const root = isAbsolute(p) ? "/" : "";
  const dir = dirname(p);
  const base = basename(p);
  const ext = extname(base);
  const name = ext.length > 0 ? base.slice(0, base.length - ext.length) : base;

  return { root, dir, base, ext, name };
}

export function format(pathObject: Partial<ParsedPath>): string {
  const dir = pathObject.dir ?? "";
  const root = pathObject.root ?? "";
  const base = pathObject.base ?? "";
  const name = pathObject.name ?? "";
  const ext = pathObject.ext ?? "";

  const resolvedBase = base || `${name}${ext}`;
  const resolvedDir = dir || root;

  if (!resolvedDir) {
    return resolvedBase;
  }
  if (resolvedDir === "/") {
    return `/${resolvedBase}`;
  }
  return `${resolvedDir}/${resolvedBase}`;
}

interface PathModule {
  sep: string;
  delimiter: string;
  normalize: typeof normalize;
  join: typeof join;
  isAbsolute: typeof isAbsolute;
  resolve: typeof resolve;
  relative: typeof relative;
  dirname: typeof dirname;
  basename: typeof basename;
  extname: typeof extname;
  parse: typeof parse;
  format: typeof format;
  posix: PathModule;
}

const path: PathModule = {
  sep,
  delimiter,
  normalize,
  join,
  isAbsolute,
  resolve,
  relative,
  dirname,
  basename,
  extname,
  parse,
  format,
  posix: undefined as unknown as PathModule,
};

// `posix` is a self-reference: this module is POSIX-only, so `path.posix === path`.
Object.assign(path, { posix: path });

export const posix = path;

export default path;
