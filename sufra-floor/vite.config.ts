import { defineConfig } from 'vite'

// React comes from the CDN as UMD globals; the bundle is a single IIFE.
export default defineConfig({
  esbuild: { jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment' },
  build: {
    outDir: 'dist',
    cssCodeSplit: false,
    lib: { entry: 'src/main.tsx', name: 'SufraFloor', formats: ['iife'], fileName: () => 'app.js' },
    rollupOptions: {
      external: ['react', 'react-dom', 'react-dom/client'],
      output: { globals: { react: 'React', 'react-dom': 'ReactDOM', 'react-dom/client': 'ReactDOM' }, assetFileNames: 'app.[ext]' },
    },
  },
  test: { globals: true, include: ['src/**/*.test.ts'] },
})
