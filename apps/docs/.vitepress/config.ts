import { defineConfig } from "vitepress";

export default defineConfig({
  title: "h3leaf",
  description: "File-based API routing for H3 and Cloudflare Workers",
  cleanUrls: true,
  srcExclude: ["README.md"],
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "npm", link: "https://www.npmjs.com/package/h3leaf" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting started", link: "/guide/getting-started" },
          { text: "Routing", link: "/guide/routing" },
          { text: "Handlers", link: "/guide/handlers" },
          { text: "Middleware", link: "/guide/middleware" },
          { text: "App entry", link: "/guide/app-entry" },
          { text: "Typed client", link: "/guide/client" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "CLI", link: "/guide/cli" },
          { text: "Vite plugin", link: "/guide/vite" },
          { text: "Generated module", link: "/guide/output" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/shamilkotta/h3leaf" }],
    editLink: {
      pattern: "https://github.com/shamilkotta/h3leaf/edit/main/packages/h3leaf/README.md",
      text: "Edit this page (sourced from the package README)",
    },
  },
});
