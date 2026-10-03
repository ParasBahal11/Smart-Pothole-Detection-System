import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const proxyTarget = env.VITE_PROXY_TARGET || 'http://localhost:5000';

  const proxyOptions = {
    target: proxyTarget,
    changeOrigin: true,
    secure: true,
    configure(proxy) {
      proxy.on('proxyReq', (proxyReq) => proxyReq.removeHeader('origin'));
    },
  };

  return {
    plugins: [react()],
    server: {
      port: 5173,
      host: true,
      proxy: {
        '/api': proxyOptions,
        '/uploads': proxyOptions,
      },
    },
  };
});
