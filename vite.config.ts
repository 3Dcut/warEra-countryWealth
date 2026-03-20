import { defineConfig } from 'vite'

export default defineConfig({
  // Setting base to './' ensures that all assets are loaded relative to the index.html
  // This is required for GitHub Pages deployment.
  base: './',
})
