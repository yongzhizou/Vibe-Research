import esbuild from 'esbuild';
import fs from 'node:fs';

if (!fs.existsSync('dist-backend')) {
  fs.mkdirSync('dist-backend', { recursive: true });
}

console.log('正在使用 esbuild 编译后端模块...');

// 解决 ESM (import.meta.url) 在打包到 CommonJS 时的 undefined 报错问题
const commonOptions = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: false,
  define: {
    'import.meta.url': '__import_meta_url',
  },
  banner: {
    js: `
const { pathToFileURL: __pathToFileURL } = require('url');
const __import_meta_url = __pathToFileURL(__filename).href;
`,
  },
  external: [
    'fsevents',
  ],
};

try {
  // 1. 编译核心 API 入口
  await esbuild.build({
    ...commonOptions,
    entryPoints: ['orchestrator/src/api.ts'],
    outfile: 'dist-backend/orchestrator.bundle.cjs',
  });
  console.log('✓ 编排器主服务已编译: dist-backend/orchestrator.bundle.cjs');

  // 2. 编译 CLI run 入口
  await esbuild.build({
    ...commonOptions,
    entryPoints: ['orchestrator/src/run.ts'],
    outfile: 'dist-backend/run.bundle.cjs',
  });
  console.log('✓ 编排器 CLI 已编译: dist-backend/run.bundle.cjs');

} catch (err) {
  console.error('编译后端失败:', err);
  process.exit(1);
}
