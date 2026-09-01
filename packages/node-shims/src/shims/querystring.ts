// Minimal Node-compatible `querystring` shim for JavaScriptCore/WKWebView.
// No Node APIs used; self-contained.

export type ParsedQs = Record<string, string | string[]>;

export function escape(str: string): string {
  return encodeURIComponent(str);
}

export function unescape(str: string): string {
  return decodeURIComponent(str);
}

export function parse(
  input: string,
  sep = "&",
  eq = "=",
): ParsedQs {
  const result: ParsedQs = {};
  if (!input) {
    return result;
  }

  const pairs = input.split(sep);
  for (const pair of pairs) {
    if (pair === "") {
      continue;
    }
    const idx = pair.indexOf(eq);
    let key: string;
    let value: string;
    if (idx === -1) {
      key = pair;
      value = "";
    } else {
      key = pair.slice(0, idx);
      value = pair.slice(idx + eq.length);
    }

    key = unescape(key.replace(/\+/g, " "));
    value = unescape(value.replace(/\+/g, " "));

    const existing = result[key];
    if (existing === undefined) {
      result[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      result[key] = [existing, value];
    }
  }

  return result;
}

export function stringify(
  obj: Record<string, unknown>,
  sep = "&",
  eq = "=",
): string {
  if (!obj) {
    return "";
  }

  const parts: string[] = [];
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const encodedKey = escape(key);
    if (Array.isArray(value)) {
      for (const v of value) {
        parts.push(`${encodedKey}${eq}${escape(String(v))}`);
      }
    } else if (value === undefined) {
      continue;
    } else {
      parts.push(`${encodedKey}${eq}${escape(String(value))}`);
    }
  }

  return parts.join(sep);
}

export const encode = stringify;
export const decode = parse;

interface QuerystringModule {
  parse: typeof parse;
  stringify: typeof stringify;
  escape: typeof escape;
  unescape: typeof unescape;
  encode: typeof encode;
  decode: typeof decode;
}

const querystring: QuerystringModule = {
  parse,
  stringify,
  escape,
  unescape,
  encode,
  decode,
};

export default querystring;
