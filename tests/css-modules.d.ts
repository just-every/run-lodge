// The test Worker bundles stylesheets as text (tests/harness.mjs).
declare module '*.css' { const text: string; export default text }
