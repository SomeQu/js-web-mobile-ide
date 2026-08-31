import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: {
      globals: {
        ...globals.es2020,
      },
    },
  },
  {
    files: ["packages/*/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:*"],
              message:
                "Node built-in modules are not available in JavaScriptCore. Use platform-agnostic alternatives.",
            },
          ],
        },
      ],
    },
  },
  {
    ignores: ["**/dist/", "**/node_modules/", "**/*.config.js"],
  },
);
