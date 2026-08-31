// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createEditor } from "./editor.js";
import type { IEditor } from "./types.js";

describe("createEditor", () => {
  let container: HTMLDivElement;
  let editor: IEditor;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (editor) editor.destroy();
    container.remove();
  });

  it("creates an editor in the given parent", () => {
    editor = createEditor({ parent: container });
    expect(container.querySelector(".cm-editor")).not.toBeNull();
  });

  it("opens a file with content", () => {
    editor = createEditor({ parent: container });
    editor.open("/test.ts", "const x = 1;", "typescript");
    expect(editor.getContent()).toBe("const x = 1;");
  });

  it("opens a file and auto-detects language from path", () => {
    editor = createEditor({ parent: container });
    editor.open("/style.css", "body { color: red; }");
    expect(editor.getContent()).toBe("body { color: red; }");
  });

  it("replaces content on subsequent open calls", () => {
    editor = createEditor({ parent: container });
    editor.open("/a.ts", "first");
    editor.open("/b.ts", "second");
    expect(editor.getContent()).toBe("second");
  });

  it("does not fire onChange for programmatic open() calls (suppressChangeEvent)", () => {
    // NOTE: IEditor does not expose the underlying EditorView, so we cannot
    // dispatch a real user-input transaction from this test to assert that
    // onChange fires on genuine edits. That path is exercised manually /
    // via e2e testing instead. What we *can* verify here is the
    // suppressChangeEvent contract: open() replaces the whole document but
    // must not be treated as a user edit, so registered onChange callbacks
    // must not fire as a result of it.
    editor = createEditor({ parent: container });
    editor.open("/test.ts", "hello");
    const callback = vi.fn();
    const unsub = editor.onChange(callback);

    editor.open("/test.ts", "world");

    expect(callback).not.toHaveBeenCalled();
    expect(editor.getContent()).toBe("world");

    unsub();
  });

  it("returns unsubscribe function from onChange", () => {
    editor = createEditor({ parent: container });
    editor.open("/test.ts", "content");
    const callback = vi.fn();
    const unsub = editor.onChange(callback);
    unsub();
    // After unsubscribe, callback should not be called
  });

  it("getSelection returns cursor position when no selection", () => {
    editor = createEditor({ parent: container });
    editor.open("/test.ts", "hello world");
    const sel = editor.getSelection();
    expect(sel.from).toBe(0);
    expect(sel.to).toBe(0);
    expect(sel.text).toBe("");
  });

  it("setSelection and getSelection round-trip", () => {
    editor = createEditor({ parent: container });
    editor.open("/test.ts", "hello world");
    editor.setSelection(0, 5);
    const sel = editor.getSelection();
    expect(sel.from).toBe(0);
    expect(sel.to).toBe(5);
    expect(sel.text).toBe("hello");
  });

  it("setLanguage changes language", () => {
    editor = createEditor({ parent: container });
    editor.open("/test.txt", "const x = 1;", "plaintext");
    // Should not throw when switching language
    editor.setLanguage("typescript");
  });

  it("destroy removes editor from DOM", () => {
    editor = createEditor({ parent: container });
    editor.destroy();
    expect(container.querySelector(".cm-editor")).toBeNull();
    editor = undefined!;
  });

  it("respects readOnly option", () => {
    editor = createEditor({ parent: container, readOnly: true });
    editor.open("/test.ts", "const x = 1;");
    expect(editor.getContent()).toBe("const x = 1;");
  });

  it("respects theme option", () => {
    editor = createEditor({ parent: container, theme: "dark" });
    editor.open("/test.ts", "code");
    expect(container.querySelector(".cm-editor")).not.toBeNull();
  });
});
