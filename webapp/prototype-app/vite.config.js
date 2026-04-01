import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2020',
    minify: 'terser',
    terserOptions: {
      compress: {
        passes: 1,
      },
      mangle: {
        // Prevent terser from reusing names that collide with TDZ variables
        reserved: [],
        toplevel: false,
      },
    },
  },
})
