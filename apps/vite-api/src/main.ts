import { createClient } from "h3leaf/client";
import type { Routes } from "../.h3leaf/routes";

const api = createClient<Routes>();
const output = document.querySelector("#output");

Promise.all([
  api.json("/api/hello", { query: { from: "vite" } }),
  api.json("/api/posts/:id?", { params: { id: "1" } }),
])
  .then(([hello, post]) => JSON.stringify({ hello, post }, null, 2))
  .catch((error: unknown) => String(error))
  .then((text) => {
    if (output) output.textContent = text;
  });
