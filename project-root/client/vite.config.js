import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/chatbot': {
        target: 'http://127.0.0.1:3004',
        rewrite: requestPath => requestPath.replace(/^\/chatbot/, ''),
      },
      '/nlp': {
        target: 'http://127.0.0.1:3002',
        rewrite: requestPath => requestPath.replace(/^\/nlp/, ''),
      },
      '/api': {
        target: 'http://127.0.0.1:3001',
        rewrite: requestPath => requestPath.replace(/^\/api/, ''),
      },
    },
  },
});
