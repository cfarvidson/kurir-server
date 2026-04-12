import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default [
  ...nextCoreWebVitals,
  {
    // Workaround: eslint-plugin-react@7.37.x uses the removed context.getFilename()
    // API when react.version is set to "detect". Setting it explicitly avoids the
    // crash. Remove once eslint-plugin-react releases ESLint 10 support.
    // See: https://github.com/jsx-eslint/eslint-plugin-react/issues/3977
    settings: {
      react: {
        version: "19",
      },
    },
    // New React Compiler rules from eslint-plugin-react-hooks v7 — downgrade to
    // warnings so the upgrade doesn't break the build. Address these separately.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
];
