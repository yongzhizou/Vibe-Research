import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

if (!fs.existsSync('dist-backend')) {
  fs.mkdirSync('dist-backend', { recursive: true });
}

console.log('正在使用 esbuild 编译 orchestrator/src/api.ts...');

try {
  await esbuild.build({
    entryPoints: ['orchestrator/src/api.ts'],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile: 'dist-backend/orchestrator.bundle.cjs',
    sourcemap: false,
    external: [
      'fsevents',
    ],
  });
  console.log('✓ 编排器后端已成功生成到 dist-backend/orchestrator.bundle.cjs');
} catch (err) {
  console.error('编译后端失败:', err);
  process.exit(1);
}
