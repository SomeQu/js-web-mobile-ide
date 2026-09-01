import { describe, expect, it } from "vitest";
import querystring, {
  decode,
  encode,
  escape,
  parse,
  stringify,
  unescape,
} from "./querystring.js";

describe("querystring.parse", () => {
  it("parses simple pairs", () => {
    expect(parse("a=1&b=2")).toEqual({ a: "1", b: "2" });
  });

  it("collects repeated keys into an array", () => {
    expect(parse("a=1&a=2")).toEqual({ a: ["1", "2"] });
  });

  it("supports a custom separator", () => {
    expect(parse("a=1;b=2", ";")).toEqual({ a: "1", b: "2" });
  });

  it("returns an empty object for an empty string", () => {
    expect(parse("")).toEqual({});
  });
});

describe("querystring.stringify", () => {
  it("stringifies simple pairs", () => {
    expect(stringify({ a: "1", b: "2" })).toBe("a=1&b=2");
  });

  it("stringifies arrays as repeated keys", () => {
    expect(stringify({ a: ["1", "2"] })).toBe("a=1&a=2");
  });
});

describe("querystring.escape/unescape", () => {
  it("wraps encodeURIComponent/decodeURIComponent", () => {
    expect(escape("a b&c")).toBe(encodeURIComponent("a b&c"));
    expect(unescape("a%20b%26c")).toBe(decodeURIComponent("a%20b%26c"));
  });
});

describe("querystring aliases", () => {
  it("encode is an alias for stringify", () => {
    expect(encode).toBe(stringify);
  });

  it("decode is an alias for parse", () => {
    expect(decode).toBe(parse);
  });
});

describe("querystring default export", () => {
  it("has all named functions", () => {
    expect(querystring.parse).toBe(parse);
    expect(querystring.stringify).toBe(stringify);
    expect(querystring.escape).toBe(escape);
    expect(querystring.unescape).toBe(unescape);
    expect(querystring.encode).toBe(encode);
    expect(querystring.decode).toBe(decode);
  });
});
