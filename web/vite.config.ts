import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base: './'` keeps asset URLs relative so the build works on any static host
// (Vercel, Netlify, GitHub Pages sub-paths).
export default defineConfig({
  base: './',
  plugins: [react()],
});
