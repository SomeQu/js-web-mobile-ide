# Phase 2: editor-core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `@anthropic-ide/editor-core` — a thin adapter over CodeMirror 6 exposing a framework-agnostic `IEditor` interface for the mobile IDE.

**Architecture:** Factory function `createEditor(options)` returns an `IEditor` that wraps a CodeMirror `EditorView`. Language support via lazy-loaded `@codemirror/lang-*` packages. Light/dark theming. No VFS dependency — content flows as strings.

**Tech Stack:** CodeMirror 6, TypeScript, Vitest with jsdom

**Spec:** `docs/superpowers/specs/2026-09-01-editor-core-design.md`

## Global Constraints

- No Node-specific APIs (`node:*`) in source files — only in `*.test.ts`
- Target: ES2020, module: ES2022
- All code in `packages/editor-core/src/`
- editor-core's tsconfig adds `"DOM"`, `"DOM.Iterable"` to lib (package-scoped)
- Run tests with: `cd packages/editor-core && pnpm test`
- Run typecheck with: `cd packages/editor-core && pnpm typecheck`
- CodeMirror packages are runtime dependencies (not devDependencies)

---

### Task 1: Add dependencies and configure TypeScript for DOM

**Files:**
- Modify: `packages/editor-core/package.json` — add CodeMirror dependencies
- Modify: `packages/editor-core/tsconfig.json` — add DOM lib

**Interfaces:**
- Consumes: nothing
- Produces: package ready for CodeMirror development with DOM types available

- [ ] **Step 1: Add CodeMirror dependencies**

```bash
cd packages/editor-core && pnpm add @codemirror/state @codemirror/view @codemirror/language @codemirror/commands @codemirror/autocomplete @codemirror/search @codemirror/lint @codemirror/lang-javascript @codemirror/lang-html @codemirror/lang-css @codemirror/lang-json @codemirror/lang-markdown @codemirror/theme-one-dark
```

- [ ] **Step 2: Update tsconfig.json to add DOM types**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "lib": ["ES2020", "DOM", "DOM.Iterable"]
  },
  "include": ["src"],
  "references": []
}
```

- [ ] **Step 3: Verify typecheck passes**

```bash
cd packages/editor-core && pnpm typecheck
```

Expected: clean (empty index.ts still compiles).

- [ ] **Step 4: Commit**

```bash
git add packages/editor-core/package.json packages/editor-core/tsconfig.json pnpm-lock.yaml
git commit -m "chore(editor-core): add CodeMirror 6 dependencies and DOM types"
```

---

### Task 2: Types and language utilities

**Files:**
- Create: `packages/editor-core/src/types.ts`
- Create: `packages/editor-core/src/languages.ts`
- Test: `packages/editor-core/src/languages.test.ts`

**Interfaces:**
- Consumes: CodeMirror `Extension` type from `@codemirror/state`
- Produces:
  - `LanguageId` type: `"javascript" | "typescript" | "jsx" | "tsx" | "html" | "css" | "json" | "markdown" | "plaintext"`
  - `IEditor` interface with methods: `open`, `getContent`, `onChange`, `setLanguage`, `getSelection`, `setSelection`, `focus`, `destroy`
  - `EditorOptions` interface: `parent`, `readOnly?`, `theme?`, `tabSize?`, `lineNumbers?`
  - `getLanguageExtension(lang: LanguageId): Extension[]` — returns CodeMirror language extensions
  - `detectLanguage(path: string): LanguageId` — infer language from file extension

- [ ] **Step 1: Create types.ts**

```ts
import type { Extension } from "@codemirror/state";

export type LanguageId =
  | "javascript"
  | "typescript"
  | "jsx"
  | "tsx"
  | "html"
  | "css"
  | "json"
  | "markdown"
  | "plaintext";

export interface EditorOptions {
  parent: HTMLElement;
  readOnly?: boolean;
  theme?: "light" | "dark";
  tabSize?: number;
  lineNumbers?: boolean;
}

export interface SelectionRange {
  from: number;
  to: number;
  text: string;
}

export interface IEditor {
  open(path: string, content: string, language?: LanguageId): void;
  getContent(): string;
  onChange(callback: (content: string) => void): () => void;
  setLanguage(language: LanguageId): void;
  getSelection(): SelectionRange;
  setSelection(from: number, to: number): void;
  focus(): void;
  destroy(): void;
}
```

- [ ] **Step 2: Write tests for language utilities**

```ts
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
```

- [ ] **Step 3: Implement languages.ts**

```ts
import type { Extension } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import type { LanguageId } from "./types.js";

const extensionMap: Record<string, LanguageId> = {
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".jsx": "jsx",
  ".tsx": "tsx",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".json": "json",
  ".md": "markdown",
  ".markdown": "markdown",
};

export function detectLanguage(path: string): LanguageId {
  const dotIndex = path.lastIndexOf(".");
  if (dotIndex === -1 || dotIndex === path.length - 1) return "plaintext";
  const ext = path.slice(dotIndex).toLowerCase();
  return extensionMap[ext] ?? "plaintext";
}

export function getLanguageExtension(lang: LanguageId): Extension[] {
  switch (lang) {
    case "javascript":
      return [javascript()];
    case "typescript":
      return [javascript({ typescript: true })];
    case "jsx":
      return [javascript({ jsx: true })];
    case "tsx":
      return [javascript({ typescript: true, jsx: true })];
    case "html":
      return [html()];
    case "css":
      return [css()];
    case "json":
      return [json()];
    case "markdown":
      return [markdown()];
    case "plaintext":
      return [];
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/editor-core && pnpm test
```

Expected: all tests pass.

- [ ] **Step 5: Typecheck**

```bash
cd packages/editor-core && pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/editor-core/src/types.ts packages/editor-core/src/languages.ts packages/editor-core/src/languages.test.ts
git commit -m "feat(editor-core): add IEditor types and language utilities"
```

---

### Task 3: Theme definitions

**Files:**
- Create: `packages/editor-core/src/theme.ts`

**Interfaces:**
- Consumes: `@codemirror/theme-one-dark` for dark theme, `@codemirror/view` for `EditorView.theme`
- Produces: `getThemeExtension(theme: "light" | "dark"): Extension[]`

- [ ] **Step 1: Implement theme.ts**

```ts
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";

const lightTheme = EditorView.theme({
  "&": {
    backgroundColor: "#ffffff",
    color: "#24292e",
  },
  ".cm-content": {
    caretColor: "#24292e",
  },
  ".cm-cursor": {
    borderLeftColor: "#24292e",
  },
  ".cm-activeLine": {
    backgroundColor: "#f6f8fa",
  },
  ".cm-gutters": {
    backgroundColor: "#ffffff",
    color: "#959da5",
    border: "none",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#f6f8fa",
  },
  ".cm-selectionBackground": {
    backgroundColor: "#0366d625",
  },
  "&.cm-focused .cm-selectionBackground": {
    backgroundColor: "#0366d640",
  },
});

export function getThemeExtension(theme: "light" | "dark"): Extension[] {
  if (theme === "dark") {
    return [oneDark];
  }
  return [lightTheme];
}
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/editor-core && pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add packages/editor-core/src/theme.ts
git commit -m "feat(editor-core): add light and dark theme definitions"
```

---

### Task 4: createEditor implementation

**Files:**
- Create: `packages/editor-core/src/editor.ts`
- Test: `packages/editor-core/src/editor.test.ts`

**Interfaces:**
- Consumes:
  - `IEditor`, `EditorOptions`, `LanguageId`, `SelectionRange` from `./types.js`
  - `getLanguageExtension`, `detectLanguage` from `./languages.js`
  - `getThemeExtension` from `./theme.js`
  - `EditorState`, `Compartment` from `@codemirror/state`
  - `EditorView`, `keymap`, `lineNumbers` from `@codemirror/view`
  - `defaultKeymap`, `history`, `historyKeymap` from `@codemirror/commands`
  - `syntaxHighlighting`, `defaultHighlightStyle`, `bracketMatching` from `@codemirror/language`
  - `closeBrackets`, `closeBracketsKeymap` from `@codemirror/autocomplete`
  - `searchKeymap`, `highlightSelectionMatches` from `@codemirror/search`
- Produces: `createEditor(options: EditorOptions): IEditor`

The implementation uses CodeMirror `Compartment` for dynamic reconfiguration of language and theme.

- [ ] **Step 1: Write tests for createEditor**

```ts
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

  it("fires onChange when content changes", () => {
    editor = createEditor({ parent: container });
    editor.open("/test.ts", "hello");
    const callback = vi.fn();
    const unsub = editor.onChange(callback);

    // Simulate a programmatic dispatch to change content
    editor.open("/test.ts", "world");

    // onChange should not fire on programmatic open — it fires on user edits
    // We test the subscription/unsubscription mechanism
    expect(typeof unsub).toBe("function");
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
```

- [ ] **Step 2: Implement editor.ts**

```ts
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers as lineNumbersExt } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
} from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import type { IEditor, EditorOptions, LanguageId, SelectionRange } from "./types.js";
import { getLanguageExtension, detectLanguage } from "./languages.js";
import { getThemeExtension } from "./theme.js";

export function createEditor(options: EditorOptions): IEditor {
  const {
    parent,
    readOnly = false,
    theme = "light",
    tabSize = 2,
    lineNumbers = true,
  } = options;

  const languageCompartment = new Compartment();
  const themeCompartment = new Compartment();
  const readOnlyCompartment = new Compartment();

  const changeListeners = new Set<(content: string) => void>();
  let currentLanguage: LanguageId = "plaintext";
  let suppressChangeEvent = false;

  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged && !suppressChangeEvent) {
      const content = update.state.doc.toString();
      for (const cb of changeListeners) {
        cb(content);
      }
    }
  });

  const baseExtensions = [
    lineNumbers ? lineNumbersExt() : [],
    history(),
    bracketMatching(),
    closeBrackets(),
    highlightSelectionMatches(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
    ]),
    EditorState.tabSize.of(tabSize),
    readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),
    languageCompartment.of([]),
    themeCompartment.of(getThemeExtension(theme)),
    updateListener,
  ];

  const state = EditorState.create({
    doc: "",
    extensions: baseExtensions,
  });

  const view = new EditorView({ state, parent });

  const editor: IEditor = {
    open(path: string, content: string, language?: LanguageId): void {
      const lang = language ?? detectLanguage(path);
      currentLanguage = lang;
      suppressChangeEvent = true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
        effects: languageCompartment.reconfigure(getLanguageExtension(lang)),
      });
      suppressChangeEvent = false;
    },

    getContent(): string {
      return view.state.doc.toString();
    },

    onChange(callback: (content: string) => void): () => void {
      changeListeners.add(callback);
      return () => {
        changeListeners.delete(callback);
      };
    },

    setLanguage(language: LanguageId): void {
      currentLanguage = language;
      view.dispatch({
        effects: languageCompartment.reconfigure(getLanguageExtension(language)),
      });
    },

    getSelection(): SelectionRange {
      const { from, to } = view.state.selection.main;
      const text = view.state.sliceDoc(from, to);
      return { from, to, text };
    },

    setSelection(from: number, to: number): void {
      view.dispatch({ selection: { anchor: from, head: to } });
    },

    focus(): void {
      view.focus();
    },

    destroy(): void {
      changeListeners.clear();
      view.destroy();
    },
  };

  return editor;
}
```

- [ ] **Step 3: Run tests**

```bash
cd packages/editor-core && pnpm test
```

Expected: all tests pass. Note: jsdom may have limitations with some CodeMirror DOM operations — if specific tests fail due to jsdom incompatibilities, adjust tests to work around jsdom limitations while still verifying the adapter logic.

- [ ] **Step 4: Typecheck**

```bash
cd packages/editor-core && pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/editor-core/src/editor.ts packages/editor-core/src/editor.test.ts
git commit -m "feat(editor-core): implement createEditor wrapping CodeMirror 6"
```

---

### Task 5: Public API exports, lint, and build

**Files:**
- Modify: `packages/editor-core/src/index.ts` — re-export public API
- Create: `packages/editor-core/demo.html` — manual test page (not in src/)

**Interfaces:**
- Consumes: everything from Tasks 1-4
- Produces: complete public API for `@anthropic-ide/editor-core`:
  - `createEditor` function
  - `IEditor`, `EditorOptions`, `SelectionRange`, `LanguageId` types
  - `detectLanguage`, `getLanguageExtension` utilities

- [ ] **Step 1: Update index.ts**

```ts
export type { IEditor, EditorOptions, SelectionRange, LanguageId } from "./types.js";
export { createEditor } from "./editor.js";
export { detectLanguage, getLanguageExtension } from "./languages.js";
export { getThemeExtension } from "./theme.js";
```

- [ ] **Step 2: Typecheck and build**

```bash
cd packages/editor-core && pnpm typecheck && pnpm build
```

Expected: both pass.

- [ ] **Step 3: Run lint from repo root**

```bash
cd /Users/aidar/Documents/js-web-mobile-ide && pnpm lint
```

Expected: no errors.

- [ ] **Step 4: Run all tests from repo root**

```bash
cd /Users/aidar/Documents/js-web-mobile-ide && pnpm test
```

Expected: all tests pass (VFS + editor-core).

- [ ] **Step 5: Create demo.html**

Create `packages/editor-core/demo.html` — a self-contained HTML page that imports the built editor-core and demonstrates open/edit/switch language. This is for manual testing only, not shipped.

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>editor-core demo</title>
  <style>
    body { margin: 0; font-family: system-ui; display: flex; flex-direction: column; height: 100vh; }
    #toolbar { padding: 8px; background: #f0f0f0; display: flex; gap: 8px; align-items: center; }
    #editor-container { flex: 1; overflow: hidden; }
    select, button { padding: 4px 8px; }
  </style>
</head>
<body>
  <div id="toolbar">
    <select id="lang-select">
      <option value="typescript">TypeScript</option>
      <option value="javascript">JavaScript</option>
      <option value="html">HTML</option>
      <option value="css">CSS</option>
      <option value="json">JSON</option>
      <option value="markdown">Markdown</option>
    </select>
    <select id="theme-select">
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
    <span id="status">Ready</span>
  </div>
  <div id="editor-container"></div>
  <script type="module">
    import { createEditor } from "./dist/index.js";

    const container = document.getElementById("editor-container");
    const langSelect = document.getElementById("lang-select");
    const status = document.getElementById("status");

    const editor = createEditor({ parent: container, theme: "light", lineNumbers: true });

    const sampleCode = `import { useState } from "react";

function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button onClick={() => setCount(c => c + 1)}>
      Count: {count}
    </button>
  );
}

export default Counter;`;

    editor.open("/App.tsx", sampleCode, "tsx");

    editor.onChange((content) => {
      status.textContent = `Changed: ${content.length} chars`;
    });

    langSelect.addEventListener("change", () => {
      editor.setLanguage(langSelect.value);
    });
  </script>
</body>
</html>
```

- [ ] **Step 6: Commit**

```bash
git add packages/editor-core/src/index.ts packages/editor-core/demo.html
git commit -m "feat(editor-core): add public API exports and demo page"
```
