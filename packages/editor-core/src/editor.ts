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
