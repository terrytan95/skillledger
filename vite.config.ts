import path from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: { entry: 'electron/main.ts' },
      preload: { input: path.join(__dirname, 'electron/preload.ts') },
    }),
  ],
  test: {
    environment: 'node',
    include: ['electron/**/*.test.ts'],
  },
})
