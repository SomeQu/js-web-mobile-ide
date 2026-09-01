import { describe, expect, it } from "vitest";
import url, {
  URL,
  URLSearchParams,
  format,
  parse,
  resolve,
} from "./url.js";

describe("url.parse", () => {
  it("parses a full URL into its fields", () => {
    const parsed = parse("https://example.com:8080/path?q=1#hash");
    expect(parsed.protocol).toBe("https:");
    expect(parsed.hostname).toBe("example.com");
    expect(parsed.port).toBe("8080");
    expect(parsed.pathname).toBe("/path");
    expect(parsed.search).toBe("?q=1");
    expect(parsed.query).toBe("q=1");
    expect(parsed.hash).toBe("#hash");
    expect(parsed.path).toBe("/path?q=1");
    expect(parsed.slashes).toBe(true);
  });

  it("parses a protocol-relative URL", () => {
    const parsed = parse("//example.com/path");
    expect(parsed.slashes).toBe(true);
    expect(parsed.hostname).toBe("example.com");
    expect(parsed.pathname).toBe("/path");
  });
});

describe("url.format", () => {
  it("formats a plain object into a URL string", () => {
    expect(
      format({
        protocol: "https:",
        hostname: "example.com",
        pathname: "/path",
      }),
    ).toBe("https://example.com/path");
  });

  it("formats a URL instance via toString", () => {
    const u = new URL("https://example.com/path");
    expect(format(u)).toBe(u.toString());
  });
});

describe("url.resolve", () => {
  it("resolves a relative path against a base", () => {
    expect(resolve("https://example.com/a/b", "../c")).toBe(
      "https://example.com/c",
    );
  });

  it("resolves an absolute URL, ignoring the base", () => {
    expect(resolve("https://example.com/a/b", "https://other.com")).toBe(
      "https://other.com/",
    );
  });
});

describe("url globals", () => {
  it("re-exports URL and URLSearchParams", () => {
    const u = new URL("https://example.com/?a=1");
    expect(u.hostname).toBe("example.com");
    const params = new URLSearchParams("a=1&b=2");
    expect(params.get("a")).toBe("1");
    expect(params.get("b")).toBe("2");
  });
});

describe("url default export", () => {
  it("has all named functions", () => {
    expect(url.parse).toBe(parse);
    expect(url.format).toBe(format);
    expect(url.resolve).toBe(resolve);
    expect(url.URL).toBe(URL);
    expect(url.URLSearchParams).toBe(URLSearchParams);
  });
});
