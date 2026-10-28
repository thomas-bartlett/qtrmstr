import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://thomas-bartlett.github.io",
  base: "/qtrmstr",
  output: "static",
  trailingSlash: "always",
  build: { inlineStylesheets: "never" },
  devToolbar: { enabled: false },
  markdown: { syntaxHighlight: false },
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        "connect-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ],
    },
  },
});
