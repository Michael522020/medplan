import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  /**
   * 项目根固定为本配置文件所在目录。
   *
   * 不设 root 时 Vite 用 cwd 作为根，导致
   * `vite build --config apps/web/vite.config.ts`（从仓库根执行）
   * 找不到 `apps/web/index.html` 而报 UNRESOLVED_ENTRY。
   * 显式设定后，无论从仓库根还是从 apps/web 执行都指向同一入口。
   */
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {
      // `@/` 指向 src/。与 tsconfig.json 的 paths 保持一致，
      // 否则 tsc 与 vite 会对同一路径给出不同解析结果。
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // 后端 API 走同源代理，避免开发期跨域配置
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        /**
         * 分包策略。
         *
         * ## 为什么**不**手动把 Cornerstone 分成一个 chunk
         *
         * 早期版本用 manualChunks 把 `@cornerstonejs/*` 归到 'cornerstone'。
         * 但阅片区改懒加载后，手动分包的语义就反了：
         *
         * - 手动 chunk 是**所有**引用者的公共依赖，会被入口 chunk 静态 import；
         * - 于是 4MB 的 Cornerstone 仍然在首屏下载 —— 懒加载白做了。
         *
         * 现在交给 Rollup 的自动分包：动态 import 天然形成异步边界，
         * Cornerstone 会整块落进 viewer-page 的异步 chunk，首屏不下载。
         *
         * ## 为什么 react 仍然手动分
         *
         * React 是**所有**页面都要用的，它的 chunk 必然在首屏。
         * 手动命名让它有稳定的文件名与缓存键（内容变更时才失效），
         * 而不是随业务代码变动而改名 —— 静态资源的长缓存靠的是文件名稳定。
         */
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('react-dom') || id.includes('/react/')) {
            return 'react';
          }
          return undefined;
        },
      },
    },
  },
  // wasm 需作为资源引入：JPEG2000 / JPEG XL 解码器
  assetsInclude: ['**/*.wasm'],
  optimizeDeps: {
    exclude: ['@cornerstonejs/codec-libjxl', '@cornerstonejs/codec-openjpeg'],
  },
});
