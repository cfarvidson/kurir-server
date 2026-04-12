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
    // React Compiler rules shipped with eslint-config-next v16.
    // Downgrade to warnings until the codebase is incrementally updated.
    rules: {
      "react-hooks/purity": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
];
