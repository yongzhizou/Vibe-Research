const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const { createGateway } = require('./gateway.cjs');

let mainWindow = null;
let backendProcess = null;
let gatewayServer = null;
let backendStderrOutput = '';

const isPackaged = app.isPackaged;
const repoRoot = path.resolve(__dirname, '..');
const resourcesPath = isPackaged ? process.resourcesPath : repoRoot;

// 用户数据目录：放在系统的 AppData/Application Support，避免 C 盘权限问题
const userDataDir = path.join(app.getPath('userData'), 'workspace');
if (!fs.existsSync(userDataDir)) {
  fs.mkdirSync(userDataDir, { recursive: true });
}
const tokenFilePath = path.join(userDataDir, 'api.token');

/**
 * 原生进程树终止函数
 * Windows 下直接使用系统自带的 taskkill.exe /T /F（完全不需要第三方依赖）
 * POSIX 下使用进程组负号 kill
 */
function killProcessTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        process.kill(pid, 'SIGKILL');
      }
    }
  } catch { }
}

// 轮询检查后端 8765 端口就绪
function waitForBackendReady(port = 8765, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      // 若子进程提前异常退出，立即报错，不傻等 30 秒
      if (backendProcess && backendProcess.exitCode !== null) {
        return reject(new Error(`后端服务异常退出（退出码 ${backendProcess.exitCode}）:\n${backendStderrOutput || '无详细错误输出'}`));
      }

      let token = '';
      try {
        if (fs.existsSync(tokenFilePath)) {
          token = fs.readFileSync(tokenFilePath, 'utf8').trim();
        }
      } catch { }

      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const req = http.get({
        hostname: '127.0.0.1',
        port,
        path: '/health',
        headers,
      }, (res) => {
        if (res.statusCode === 200) return resolve();
        retry();
      });

      req.on('error', retry);
      req.end();
    };

    const retry = () => {
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`后端服务启动超时（等待超过 ${timeoutMs / 1000} 秒）:\n${backendStderrOutput || '请检查后台服务'}`));
      }
      setTimeout(check, 400);
    };

    check();
  });
}

async function startBackend() {
  const backendScript = isPackaged
    ? path.join(resourcesPath, 'backend', 'orchestrator.bundle.cjs')
    : path.join(repoRoot, 'orchestrator', 'src', 'api.ts');

  // 便携 Python 路径
  let pythonBin = '';
  if (isPackaged) {
    pythonBin = path.join(resourcesPath, 'backend', 'python', 'python.exe');
  } else {
    const winVenv = path.join(repoRoot, '.venv', 'Scripts', 'python.exe');
    const unixVenv = path.join(repoRoot, '.venv', 'bin', 'python');
    pythonBin = fs.existsSync(winVenv) ? winVenv : (fs.existsSync(unixVenv) ? unixVenv : 'python3');
  }

  const backendDir = isPackaged ? path.join(resourcesPath, 'backend') : repoRoot;
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1', // 让 Electron 自带的 Node 解释器运行后端 JS
    VRA_DATA_ROOT: userDataDir,
    VRA_REPO_ROOT: backendDir,
    PYTHON_EXECUTABLE: pythonBin,
  };


  if (isPackaged && fs.existsSync(pythonBin)) {
    const pythonHome = path.dirname(pythonBin);
    env.PYTHONHOME = pythonHome;
    env.PATH = `${pythonHome};${path.join(pythonHome, 'Scripts')};${process.env.PATH || ''}`;
  }

  const args = [backendScript, '--port', '8765', '--host', '127.0.0.1'];
  backendStderrOutput = '';

  // 在打包模式下 process.execPath 是 VibeResearch.exe
  backendProcess = spawn(process.execPath, args, {
    cwd: isPackaged ? path.join(resourcesPath, 'backend') : repoRoot,
    env,
    stdio: 'pipe',
    windowsHide: true,
  });

  backendProcess.stdout.on('data', (d) => console.log(`[API Stdout] ${d}`));
  backendProcess.stderr.on('data', (d) => {
    const msg = d.toString();
    console.error(`[API Stderr] ${msg}`);
    backendStderrOutput += msg;
  });

  backendProcess.on('exit', (code) => {
    console.log(`[API Exit] 进程退出，退出码: ${code}`);
  });

  await waitForBackendReady(8765);
}

async function startGateway() {
  const staticDir = isPackaged
    ? path.join(resourcesPath, 'dist-ui')
    : path.join(repoRoot, 'desktop', 'dist');

  gatewayServer = await createGateway({
    staticDir,
    apiPort: 8765,
    tokenFilePath,
    listenPort: 5930,
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1080,
    minHeight: 720,
    title: 'Vibe Research - 个人投研工作台',
    backgroundColor: '#090d16',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL('http://127.0.0.1:5930');
}

function cleanupProcesses() {
  if (backendProcess && backendProcess.pid) {
    killProcessTree(backendProcess.pid);
    backendProcess = null;
  }
  if (gatewayServer) {
    try {
      gatewayServer.close();
    } catch { }
    gatewayServer = null;
  }
}

app.whenReady().then(async () => {
  try {
    await startBackend();
    await startGateway();
    createWindow();
  } catch (err) {
    cleanupProcesses();
    dialog.showErrorBox('Vibe Research 启动失败', err.message || String(err));
    app.quit();
  }
});

app.on('before-quit', cleanupProcesses);

app.on('window-all-closed', () => {
  cleanupProcesses();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
