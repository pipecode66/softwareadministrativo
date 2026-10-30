import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

// Dedicated local environment: never proxies to the deployed application.
export default mergeConfig(base, defineConfig({
  define: { 'import.meta.env.VITE_USE_API': JSON.stringify('true') },
  server: {
    host: '127.0.0.1', port: 5175, strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:3002', changeOrigin: false } },
  },
}));
