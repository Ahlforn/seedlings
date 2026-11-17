import { defineConfig } from 'vite'

// Builds the watch page only. The server runs straight from src/ with Node.
export default defineConfig({
  root: 'web',
  build: { outDir: '../dist/web', emptyOutDir: true },
})
