export default [
  {
    files: ["src/**/*.js", "test/**/*.js"],
    rules: {
      "no-var": "error",
      "prefer-const": "error",
      "eqeqeq": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
      "curly": ["error", "multi-line"],
    },
  },
];
