// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { getLanguageExtension, detectLanguage } from "./languages.js";

describe("detectLanguage", () => {
  it("detects .ts files", () => {
    expect(detectLanguage("/src/index.ts")).toBe("typescript");
  });

  it("detects .tsx files", () => {
    expect(detectLanguage("/src/App.tsx")).toBe("tsx");
  });

  it("detects .js files", () => {
    expect(detectLanguage("/src/main.js")).toBe("javascript");
  });

  it("detects .jsx files", () => {
    expect(detectLanguage("/src/App.jsx")).toBe("jsx");
  });

  it("detects .html files", () => {
    expect(detectLanguage("/index.html")).toBe("html");
  });

  it("detects .css files", () => {
    expect(detectLanguage("/style.css")).toBe("css");
  });

  it("detects .json files", () => {
    expect(detectLanguage("/package.json")).toBe("json");
  });

  it("detects .md files", () => {
    expect(detectLanguage("/README.md")).toBe("markdown");
  });

  it("returns plaintext for unknown extensions", () => {
    expect(detectLanguage("/file.xyz")).toBe("plaintext");
  });

  it("handles files with no extension", () => {
    expect(detectLanguage("/Makefile")).toBe("plaintext");
  });
});

describe("getLanguageExtension", () => {
  it("returns extensions for typescript", () => {
    const ext = getLanguageExtension("typescript");
    expect(ext.length).toBeGreaterThan(0);
  });

  it("returns extensions for javascript", () => {
    const ext = getLanguageExtension("javascript");
    expect(ext.length).toBeGreaterThan(0);
  });

  it("returns extensions for jsx", () => {
    const ext = getLanguageExtension("jsx");
    expect(ext.length).toBeGreaterThan(0);
  });

  it("returns extensions for html", () => {
    const ext = getLanguageExtension("html");
    expect(ext.length).toBeGreaterThan(0);
  });

  it("returns extensions for css", () => {
    const ext = getLanguageExtension("css");
    expect(ext.length).toBeGreaterThan(0);
  });

  it("returns extensions for json", () => {
    const ext = getLanguageExtension("json");
    expect(ext.length).toBeGreaterThan(0);
  });

  it("returns extensions for markdown", () => {
    const ext = getLanguageExtension("markdown");
    expect(ext.length).toBeGreaterThan(0);
  });

  it("returns empty array for plaintext", () => {
    const ext = getLanguageExtension("plaintext");
    expect(ext).toEqual([]);
  });
});
