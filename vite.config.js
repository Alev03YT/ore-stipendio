import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages: https://<user>.github.io/<repo>/
export default defineConfig({
  plugins: [react()],
  base: "/ore-stipendio/",
});
