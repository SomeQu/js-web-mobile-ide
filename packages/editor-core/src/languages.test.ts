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
  it("returns extensions for typescript", async () => {
    const ext = await getLanguageExtension("typescript");
    expect(ext.length).toBeGreaterThan(0);
  });

  it("returns extensions for javascript", async () => {
    const ext = await getLanguageExtension("javascript");
    expect(ext.length).toBeGreaterThan(0);
  });

  it("returns extensions for jsx", async () => {
    const ext = await getLanguageExtension("jsx");
    expect(ext.length).toBeGreaterThan(0);
  });

  it("returns extensions for html", async () => {
    const ext = await getLanguageExtension("html");
    expect(ext.length).toBeGreaterThan(0);
  });

  it("returns extensions for css", async () => {
    const ext = await getLanguageExtension("css");
    expect(ext.length).toBeGreaterThan(0);
  });

  it("returns extensions for json", async () => {
    const ext = await getLanguageExtension("json");
    expect(ext.length).toBeGreaterThan(0);
  });

  it("returns extensions for markdown", async () => {
    const ext = await getLanguageExtension("markdown");
    expect(ext.length).toBeGreaterThan(0);
  });

  it("returns empty array for plaintext", async () => {
    const ext = await getLanguageExtension("plaintext");
    expect(ext).toEqual([]);
  });
});
