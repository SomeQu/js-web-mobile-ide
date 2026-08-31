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
