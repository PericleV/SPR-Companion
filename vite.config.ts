import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base './': relative asset paths, so the build works from any folder of any static host (GitHub Pages);
// ES-module workers (simulation, sweep and optimization run off the UI thread)
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  // one bundle with the material library (~0.5 MB, 165 kB compressed)
  build: { chunkSizeWarningLimit: 900 },
})
