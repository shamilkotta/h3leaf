import { defineConfig } from "vite";
import { h3leaf } from "@h3leaf/vite";

export default defineConfig({
  plugins: [h3leaf({ base: "/api" })],
});
