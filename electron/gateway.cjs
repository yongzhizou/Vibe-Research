const http = require('http');
const fs = require('fs');
const path = require('path');

/**
 * 本地静态页面网关与反向代理
 * 1. 托管 React 前端静态构建产物，支持客户端路由（SPA 404 fallback 到 index.html）
 * 2. 拦截 /api/* 请求，自动注入本地 api.token 并反向代理到 8765 后端编排服务
 */
function createGateway({ staticDir, apiPort = 8765, tokenFilePath, listenPort = 5930 }) {
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
  };

  const getApiToken = () => {
    try {
      if (tokenFilePath && fs.existsSync(tokenFilePath)) {
        return fs.readFileSync(tokenFilePath, 'utf8').trim();
      }
    } catch { }
    return '';
  };

  const server = http.createServer((req, res) => {
    const reqUrl = req.url || '/';

    // 1. 代理 /api/* 请求到本地 8765 后端
    if (reqUrl.startsWith('/api/') || reqUrl === '/api') {
      const targetPath = reqUrl.replace(/^\/api/, '') || '/';
      const token = getApiToken();

      const proxyHeaders = {
        ...req.headers,
        host: `127.0.0.1:${apiPort}`,
        origin: `http://127.0.0.1:${listenPort}`,
      };
      if (token) {
        proxyHeaders.authorization = `Bearer ${token}`;
      }

      const proxyReq = http.request({
        hostname: '127.0.0.1',
        port: apiPort,
        path: targetPath,
        method: req.method,
        headers: proxyHeaders,
      }, (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (err) => {
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            error: 'api_unreachable',
            message: '后端编排服务尚未就绪或连接失败: ' + err.message
          }));
        }
      });

      req.pipe(proxyReq);
      return;
    }

    // 2. 静态页面文件解析与 SPA fallback
    const parsedPath = reqUrl.split('?')[0];
    let filePath = path.join(staticDir, parsedPath);

    // 检查文件是否存在
    let isFile = false;
    try {
      const stat = fs.statSync(filePath);
      isFile = stat.isFile();
    } catch {
      isFile = false;
    }

    // 如果不是具体文件，则回退到 index.html 以支持 React Router
    if (!isFile) {
      filePath = path.join(staticDir, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
      } else {
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': ext === '.html' ? 'no-cache' : 'max-age=31536000',
        });
        res.end(content);
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(listenPort, '127.0.0.1', () => {
      resolve(server);
    });
    server.on('error', reject);
  });
}

module.exports = { createGateway };
