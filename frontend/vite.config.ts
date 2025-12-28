import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // mermaid 库本身约 534KB，已经是懒加载，提高阈值避免警告
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          // 将 highlight.js 单独打包（懒加载）
          'highlight': ['highlight.js'],
          // KaTeX 单独打包（懒加载）
          'katex': ['katex', 'rehype-katex'],
          // Mermaid 单独打包（懒加载）
          'mermaid': ['mermaid'],
          // 将 React 相关库单独打包
          'react-vendor': ['react', 'react-dom'],
          // Radix UI 组件
          'radix': ['@radix-ui/react-avatar', '@radix-ui/react-scroll-area', '@radix-ui/react-slot'],
        },
      },
    },
  },
})
