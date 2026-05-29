const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');

// ============================================================
// 全局状态
// ============================================================
let mainWindow = null;
let tray = null;
let taskRunner = null;
const logEmitter = new EventEmitter();
const APP_NAME = 'FuckUOOC';
const startHidden = process.argv.includes('--hidden');
const gotSingleLock = app.requestSingleInstanceLock();

if (!gotSingleLock) {
  app.quit();
}

// ============================================================
// 配置管理
// ============================================================
const CONFIG_PATH = path.join(__dirname, '..', 'config.txt');

function readConfig() {
  const cfg = {};
  if (!fs.existsSync(CONFIG_PATH)) return cfg;
  for (const line of fs.readFileSync(CONFIG_PATH, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    if (key) cfg[key] = val;
  }
  return cfg;
}

function writeConfig(cfg) {
  const lines = [];
  lines.push('# UOOC 账号');
  lines.push(`USERNAME=${cfg.USERNAME || ''}`);
  lines.push(`PASSWORD=${cfg.PASSWORD || ''}`);
  lines.push('');
  lines.push('# LLM 配置');
  lines.push(`API_KEY=${cfg.API_KEY || ''}`);
  lines.push('');
  lines.push('# 默认模型（答题用）');
  lines.push(`MODEL=${cfg.MODEL || 'doubao-seed-2-0-mini-260215'}`);
  lines.push('');
  lines.push('# 重试模型（答错后重做用，用更强的模型）');
  lines.push(`RETRY_MODEL=${cfg.RETRY_MODEL || 'doubao-seed-2-0-lite-260215'}`);
  lines.push('');
  lines.push('# API 地址');
  lines.push(`BASE_URL=${cfg.BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions'}`);
  lines.push('');
  lines.push('# 运行设置');
  lines.push(`HEADLESS=${cfg.HEADLESS || 'false'}`);
  lines.push(`SLOW_MO=${cfg.SLOW_MO || '100'}`);
  lines.push(`COURSE_CONCURRENCY=${cfg.COURSE_CONCURRENCY || '3'}`);
  lines.push(`MAX_COURSES=${cfg.MAX_COURSES || '0'}`);
  lines.push('');
  lines.push('# 功能开关');
  lines.push(`ENABLE_LEARNING=${cfg.ENABLE_LEARNING || 'true'}`);
  lines.push(`ENABLE_DISCUSSION=${cfg.ENABLE_DISCUSSION || 'false'}`);
  lines.push(`ENABLE_HOMEWORK=${cfg.ENABLE_HOMEWORK || 'false'}`);
  lines.push('');
  lines.push('# 评论设置');
  lines.push(`DISCUSSION_INTERVAL_MS=${cfg.DISCUSSION_INTERVAL_MS || '65000'}`);
  lines.push(`DISCUSSION_MAX_POSTS=${cfg.DISCUSSION_MAX_POSTS || '3'}`);
  lines.push(`DISCUSSION_SCAN_PAGES=${cfg.DISCUSSION_SCAN_PAGES || '1'}`);
  lines.push(`DISCUSSION_MAX_ROUNDS=${cfg.DISCUSSION_MAX_ROUNDS || '5'}`);
  lines.push('');
  lines.push('# 作业设置');
  lines.push(`HOMEWORK_MAX_TASKS=${cfg.HOMEWORK_MAX_TASKS || '0'}`);
  fs.writeFileSync(CONFIG_PATH, lines.join('\n'), 'utf-8');
}

// ============================================================
// 开机自启动管理
// ============================================================
function getAutoLaunchStatus() {
  const settings = app.getLoginItemSettings();
  return settings.openAtLogin;
}

function setAutoLaunch(enable) {
  app.setLoginItemSettings({
    openAtLogin: enable,
    path: process.execPath,
    args: ['--hidden']
  });
  logEmitter.emit('log', {
    level: 'info',
    message: `开机自启动已${enable ? '开启' : '关闭'}`
  });
}

// ============================================================
// 任务运行器（封装现有业务逻辑）
// ============================================================
class TaskRunner extends EventEmitter {
  constructor() {
    super();
    this.running = false;
    this.abortController = null;
    this.stats = {
      totalCourses: 0,
      completedCourses: 0,
      failedCourses: 0,
      runningCourses: 0,
      currentCourse: null,
      startTime: null
    };
  }

  async start(options = {}) {
    if (this.running) return;

    // 校验必要配置
    const cfg = readConfig();
    if (!cfg.USERNAME || !cfg.PASSWORD) {
      logEmitter.emit('log', { level: 'error', message: '请先在配置页面填写 USERNAME 和 PASSWORD' });
      this.emit('status', { running: false, stats: this.stats, error: '缺少账号配置' });
      return;
    }
    if (!cfg.API_KEY) {
      logEmitter.emit('log', { level: 'error', message: '请先在配置页面填写 API_KEY' });
      this.emit('status', { running: false, stats: this.stats, error: '缺少 API Key 配置' });
      return;
    }

    this.running = true;
    this.abortController = new AbortController();
    this.stats = {
      totalCourses: 0,
      completedCourses: 0,
      failedCourses: 0,
      runningCourses: 0,
      currentCourse: null,
      startTime: Date.now()
    };
    this.emit('status', { running: true, stats: this.stats });

    try {
      // 重定向 console.log 到日志发射器
      const originalLog = console.log;
      const originalError = console.error;

      console.log = (...args) => {
        originalLog(...args);
        const message = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
        logEmitter.emit('log', { level: 'info', message, timestamp: Date.now() });
      };
      console.error = (...args) => {
        originalError(...args);
        const message = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
        logEmitter.emit('log', { level: 'error', message, timestamp: Date.now() });
      };

      // 动态加载并运行现有业务逻辑
      // 设置环境变量跳过 config.js 的 process.exit 校验
      process.env.FUCKUOOC_SKIP_VALIDATION = '1';
      const { run } = require('../utils/login');
      await run(options);

      // 恢复原始 console
      console.log = originalLog;
      console.error = originalError;

      this.stats.completedCourses = this.stats.totalCourses;
      this.emit('status', { running: false, stats: this.stats, completed: true });
    } catch (err) {
      logEmitter.emit('log', { level: 'error', message: `任务执行失败: ${err.message}` });
      this.emit('status', { running: false, stats: this.stats, error: err.message });
    } finally {
      this.running = false;
      this.abortController = null;
    }
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    if (this.abortController) {
      this.abortController.abort();
    }
    logEmitter.emit('log', { level: 'warn', message: '正在停止任务...' });
    this.emit('status', { running: false, stats: this.stats, stopped: true });
  }

  updateStats(update) {
    Object.assign(this.stats, update);
    this.emit('status', { running: this.running, stats: this.stats });
  }
}

// ============================================================
// 窗口管理
// ============================================================
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#1A1D23',
    icon: fs.existsSync(path.join(__dirname, 'renderer', 'icon.png'))
      ? path.join(__dirname, 'renderer', 'icon.png')
      : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (!startHidden) {
      mainWindow.show();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 开发模式打开 DevTools
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  return mainWindow;
}

function createTray() {
  const iconPath = path.join(__dirname, 'renderer', 'icon.png');
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) throw new Error('icon empty');
  } catch {
    // 如果没有图标文件，创建一个简单的 16x16 图标
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  const contextMenu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { type: 'separator' },
    { label: '开机自启动', type: 'checkbox', checked: getAutoLaunchStatus(), click: (item) => { setAutoLaunch(item.checked); } },
    { type: 'separator' },
    { label: '退出', click: () => { app.quit(); } }
  ]);

  tray.setToolTip(APP_NAME);
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ============================================================
// IPC 通信处理
// ============================================================
function setupIPC() {
  // 窗口控制
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.on('window:close', () => mainWindow?.hide());

  // 配置管理
  ipcMain.handle('config:read', () => readConfig());
  ipcMain.handle('config:write', (event, cfg) => {
    writeConfig(cfg);
    return { success: true };
  });

  // 自启动管理
  ipcMain.handle('autostart:status', () => getAutoLaunchStatus());
  ipcMain.handle('autostart:toggle', (event, enable) => {
    setAutoLaunch(enable);
    return getAutoLaunchStatus();
  });

  // 任务管理
  ipcMain.handle('task:start', async (event, options) => {
    if (!taskRunner) {
      taskRunner = new TaskRunner();
      taskRunner.on('status', (status) => {
        mainWindow?.webContents.send('task:status', status);
      });
    }
    await taskRunner.start(options);
    return { success: true };
  });

  ipcMain.handle('task:stop', () => {
    if (taskRunner) taskRunner.stop();
    return { success: true };
  });

  ipcMain.handle('task:status', () => {
    return {
      running: taskRunner?.running || false,
      stats: taskRunner?.stats || null
    };
  });

  // 日志监听
  ipcMain.on('log:subscribe', (event) => {
    const handler = (log) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('log:entry', log);
      }
    };
    logEmitter.on('log', handler);
    event.sender.on('destroyed', () => {
      logEmitter.off('log', handler);
    });
  });

  // 系统信息
  ipcMain.handle('system:info', () => ({
    nodeVersion: process.version,
    electronVersion: process.versions.electron,
    platform: process.platform,
    arch: process.arch,
    appVersion: app.getVersion()
  }));
}

// ============================================================
// 应用生命周期
// ============================================================
app.whenReady().then(() => {
  setupIPC();
  createMainWindow();
  createTray();

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

app.on('window-all-closed', () => {
  // 不退出，保持托盘运行
});

app.on('before-quit', () => {
  if (taskRunner?.running) {
    taskRunner.stop();
  }
});
