import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri 期望固定端口 + 忽略 src-tauri 目录变化
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "chrome105",
    minify: "esbuild",
    sourcemap: false,
  },
});
