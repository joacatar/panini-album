import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

const useHttps = process.env.VITE_HTTPS === "1";

export default defineConfig({
  root: ".",
  publicDir: "public",
  plugins: useHttps ? [basicSsl()] : [],
  build: {
    outDir: "dist",
  },
  server: {
    port: 5173,
    host: true,
  },
});
