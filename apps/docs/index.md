---
layout: home

hero:
  name: h3leaf
  text: File-based API routing for H3
  tagline: Compile a directory of route files into one Web-standard fetch handler for Cloudflare Workers.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/shamilkotta/h3leaf

features:
  - title: File routes
    details: "[id], [[id]], [...path], [[...path]], and (group) segments with per-method exports."
  - title: Workers-ready
    details: One ESM bundle with Cloudflare env, waitUntil, and scheduled / queue handlers wired up.
  - title: Middleware
    details: Per-directory _middleware modules, scoped to the routes beneath them.
  - title: Typed client
    details: Generated route types plus h3leaf/client for checked paths, params, and responses.
  - title: CLI or Vite
    details: h3leaf build / dev, or one vite build for your site and its API Worker.
---
