import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: '/b_panels_frontend/',
  build: {
    outDir: '../custom_components/b_panels/frontend',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Split stable third-party code into its own long-lived chunks so a
        // frontend change only re-downloads the app bundle, not React + the HA
        // client. Keeps the kiosk's first paint fast on slow iPad reloads.
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-ha': ['home-assistant-js-websocket'],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
