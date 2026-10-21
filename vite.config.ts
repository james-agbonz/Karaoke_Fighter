import path from 'path';
import { defineConfig, loadEnv, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import fs from 'fs';

// SPA fallback plugin for client-side routing
function spaFallback(): Plugin {
  return {
    name: 'spa-fallback',
    configureServer(server) {
      return () => {
        server.middlewares.use((req, res, next) => {
          const url = req.url || '';

          // Extract pathname without query string
          const pathname = url.split('?')[0];

          // Skip if it's an API request, HMR, or has a file extension
          if (
            url.startsWith('/socket.io') ||
            url.startsWith('/api') ||
            url.startsWith('/midi') ||
            url.startsWith('/lyrics') ||
            url.startsWith('/@') ||
            url.startsWith('/src/') ||
            url.startsWith('/node_modules/') ||
            /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|json|map|mid|midi)$/i.test(pathname)
          ) {
            return next();
          }

          // For all other routes, serve index.html to let React Router handle it
          req.url = '/index.html';
          next();
        });
      };
    }
  };
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const useLanHttps = process.env.LAN_HTTPS === 'true'; // dev:lan — HTTPS so phone mics work
    const useNgrok = process.env.NGROK === 'true';        // dev — original ngrok flow
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        // ngrok terminates TLS on 443; locally, default HMR just works
        hmr: useNgrok ? { clientPort: 443 } : true,
        allowedHosts: [
          '.ngrok-free.dev',
          '.ngrok-free.app',
          '.ngrok.io',
          'localhost'
        ],
        proxy: {
          '/socket.io': {
            target: 'http://localhost:3001',
            ws: true,
            changeOrigin: true
          },
          '/api': {
            target: 'http://localhost:3001',
            changeOrigin: true
          },
          '/midi': {
            target: 'http://localhost:3001',
            changeOrigin: true
          },
          '/lyrics': {
            target: 'http://localhost:3001',
            changeOrigin: true
          },
          // song packs (including freshly auto-generated ones) come from the game server
          '/songs': {
            target: 'http://localhost:3001',
            changeOrigin: true
          }
        }
      },
      plugins: [...(useLanHttps ? [basicSsl()] : []), react(), spaFallback()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      preview: {
        port: 3000,
        host: '0.0.0.0',
      }
    };
});
