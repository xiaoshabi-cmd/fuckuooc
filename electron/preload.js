const { contextBridge, ipcRenderer } = require('electron');

// ============================================================
// 安全地暴露 API 到渲染进程
// ============================================================
contextBridge.exposeInMainWorld('electronAPI', {
  // 窗口控制
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close')
  },

  // 配置管理
  config: {
    read: () => ipcRenderer.invoke('config:read'),
    write: (cfg) => ipcRenderer.invoke('config:write', cfg)
  },

  // 自启动管理
  autostart: {
    status: () => ipcRenderer.invoke('autostart:status'),
    toggle: (enable) => ipcRenderer.invoke('autostart:toggle', enable)
  },

  // 任务管理
  task: {
    start: (options) => ipcRenderer.invoke('task:start', options),
    stop: () => ipcRenderer.invoke('task:stop'),
    status: () => ipcRenderer.invoke('task:status'),
    onStatus: (callback) => {
      const handler = (event, status) => callback(status);
      ipcRenderer.on('task:status', handler);
      return () => ipcRenderer.removeListener('task:status', handler);
    }
  },

  // 日志
  log: {
    subscribe: () => ipcRenderer.send('log:subscribe'),
    onEntry: (callback) => {
      const handler = (event, entry) => callback(entry);
      ipcRenderer.on('log:entry', handler);
      return () => ipcRenderer.removeListener('log:entry', handler);
    }
  },

  // 系统信息
  system: {
    info: () => ipcRenderer.invoke('system:info')
  }
});
