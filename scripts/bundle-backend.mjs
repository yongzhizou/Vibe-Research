import esbuild from 'esbuild';
import fs from 'node:fs';

if (!fs.existsSync('dist-backend')) {
  fs.mkdirSync('dist-backend', { recursive: true });
}

console.log('正在使用 esbuild 编译后端模块...');

// 解决 1: Node.js 缺失的浏览器 Geometry & Canvas 全局对象（供给 pdfjs-dist / mammoth 等使用）
// 解决 2: ESM (import.meta.url) 在打包到 CommonJS 时的 undefined 问题
const polyfills = `
// 1. CommonJS URL / path polyfill
const { pathToFileURL: __pathToFileURL } = require('url');
const __import_meta_url = __pathToFileURL(__filename).href;

// 2. Browser Geometry & Canvas polyfill for pdfjs-dist in Node.js
if (typeof globalThis.DOMMatrix === 'undefined') {
  class DOMMatrix {
    constructor(init) {
      this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
      this.m11 = 1; this.m12 = 0; this.m13 = 0; this.m14 = 0;
      this.m21 = 0; this.m22 = 1; this.m23 = 0; this.m24 = 0;
      this.m31 = 0; this.m32 = 0; this.m33 = 1; this.m34 = 0;
      this.m41 = 0; this.m42 = 0; this.m43 = 0; this.m44 = 1;
      this.is2D = true;
      this.isIdentity = true;
      if (Array.isArray(init)) {
        if (init.length === 6) {
          this.a = this.m11 = init[0];
          this.b = this.m12 = init[1];
          this.c = this.m21 = init[2];
          this.d = this.m22 = init[3];
          this.e = this.m41 = init[4];
          this.f = this.m42 = init[5];
        } else if (init.length === 16) {
          this.m11 = init[0]; this.m12 = init[1]; this.m13 = init[2]; this.m14 = init[3];
          this.m21 = init[4]; this.m22 = init[5]; this.m23 = init[6]; this.m24 = init[7];
          this.m31 = init[8]; this.m32 = init[9]; this.m33 = init[10]; this.m34 = init[11];
          this.m41 = init[12]; this.m42 = init[13]; this.m43 = init[14]; this.m44 = init[15];
          this.a = this.m11; this.b = this.m12; this.c = this.m21; this.d = this.m22; this.e = this.m41; this.f = this.m42;
          this.is2D = false;
        }
      }
    }
    translate(tx = 0, ty = 0, tz = 0) { return new DOMMatrix(); }
    scale(scaleX = 1, scaleY = scaleX, scaleZ = 1) { return new DOMMatrix(); }
    multiply(other) { return new DOMMatrix(); }
    inverse() { return new DOMMatrix(); }
    transformPoint(point) { return point || { x: 0, y: 0, z: 0, w: 1 }; }
    toFloat32Array() { return new Float32Array([this.m11, this.m12, this.m13, this.m14, this.m21, this.m22, this.m23, this.m24, this.m31, this.m32, this.m33, this.m34, this.m41, this.m42, this.m43, this.m44]); }
    toFloat64Array() { return new Float64Array([this.m11, this.m12, this.m13, this.m14, this.m21, this.m22, this.m23, this.m24, this.m31, this.m32, this.m33, this.m34, this.m41, this.m42, this.m43, this.m44]); }
  }
  globalThis.DOMMatrix = DOMMatrix;
  globalThis.DOMMatrixReadOnly = DOMMatrix;
}
if (typeof globalThis.Path2D === 'undefined') {
  globalThis.Path2D = class Path2D {
    addPath() {}
    closePath() {}
    moveTo() {}
    lineTo() {}
    bezierCurveTo() {}
    quadraticCurveTo() {}
    arc() {}
    arcTo() {}
    ellipse() {}
    rect() {}
  };
}
if (typeof globalThis.ImageData === 'undefined') {
  globalThis.ImageData = class ImageData {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.data = new Uint8ClampedArray(width * height * 4);
    }
  };
}
if (typeof globalThis.DOMPoint === 'undefined') {
  globalThis.DOMPoint = class DOMPoint {
    constructor(x = 0, y = 0, z = 0, w = 1) {
      this.x = x; this.y = y; this.z = z; this.w = w;
    }
    static fromPoint(other) { return new DOMPoint(other?.x, other?.y, other?.z, other?.w); }
  };
  globalThis.DOMPointReadOnly = globalThis.DOMPoint;
}
if (typeof globalThis.DOMRect === 'undefined') {
  globalThis.DOMRect = class DOMRect {
    constructor(x = 0, y = 0, width = 0, height = 0) {
      this.x = x; this.y = y; this.width = width; this.height = height;
      this.top = y; this.left = x; this.right = x + width; this.bottom = y + height;
    }
    static fromRect(other) { return new DOMRect(other?.x, other?.y, other?.width, other?.height); }
  };
  globalThis.DOMRectReadOnly = globalThis.DOMRect;
}
`;

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
    js: polyfills,
  },
  external: [
    'fsevents',
  ],
};

try {
  // 1. 编译核心 API 入口为 api.cjs（匹配 isEntryPath 正则）
  await esbuild.build({
    ...commonOptions,
    entryPoints: ['orchestrator/src/api.ts'],
    outfile: 'dist-backend/api.cjs',
  });
  // 保持兼容性
  fs.copyFileSync('dist-backend/api.cjs', 'dist-backend/orchestrator.bundle.cjs');
  console.log('✓ 编排器主服务已编译: dist-backend/api.cjs');

  // 2. 编译 CLI run 入口
  await esbuild.build({
    ...commonOptions,
    entryPoints: ['orchestrator/src/run.ts'],
    outfile: 'dist-backend/run.cjs',
  });
  fs.copyFileSync('dist-backend/run.cjs', 'dist-backend/run.bundle.cjs');
  console.log('✓ 编排器 CLI 已编译: dist-backend/run.cjs');

  // 3. 编译 codex_sdk_worker
  await esbuild.build({
    ...commonOptions,
    entryPoints: ['orchestrator/src/codex_sdk_worker.ts'],
    outfile: 'dist-backend/codex_sdk_worker.js',
  });
  console.log('✓ Codex SDK Worker 已编译: dist-backend/codex_sdk_worker.js');

} catch (err) {
  console.error('编译后端失败:', err);
  process.exit(1);
}
