import { defineConfig, globalIgnores } from "eslint/config";
import nextPlugin from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextPlugin,
  globalIgnores([".next/", "node_modules/", "site/"]),
  {
    rules: {
      // React Compiler rules shipped with eslint-config-next v16.
      // Downgrade to warnings until the codebase is incrementally updated.
      "react-hooks/purity": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
]);
