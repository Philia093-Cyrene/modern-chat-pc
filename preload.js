// preload.js
// 通过contextBridge暴露必要的API给渲染进程
const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');

console.log('[preload] preload.js loaded at:', __dirname);

// 获取web目录和项目根目录的绝对路径
const webDir = path.join(__dirname, 'web');
const projectRoot = __dirname;
console.log('[preload] Web directory:', webDir);
console.log('[preload] Project root:', projectRoot);

// 定义API对象
const electronAPI = {
  // 获取应用路径
  getUserDataPath: () => ipcRenderer.invoke('get-user-data-path'),
  
  // 保存配置
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  
  // 获取资源目录路径
  getResourcesPath: () => ipcRenderer.invoke('get-resources-path'),
  
  // 屏幕捕获
  desktopCapturer: {
    getSources: () => ipcRenderer.invoke('desktop-capturer-get-sources')
  },
  
  // 获取文档目录路径
  getDocumentsPath: () => ipcRenderer.invoke('get-documents-path'),
  
  // 文件系统操作
  fs: {
    existsSync: (filePath) => ipcRenderer.invoke('fs-exists-sync', filePath),
    mkdirSync: (filePath, options) => ipcRenderer.invoke('fs-mkdir-sync', filePath, options),
    writeFileSync: (filePath, data) => ipcRenderer.invoke('fs-write-file-sync', filePath, data),
    writeBinaryFile: (filePath, base64) => ipcRenderer.invoke('fs-write-binary-file', filePath, base64),
    readFileSync: (filePath) => ipcRenderer.invoke('fs-read-file-sync', filePath),
    saveFile: (buffer, filename) => ipcRenderer.invoke('fs-save-file', buffer, filename)
  },
  
  // 路径操作
  path: {
    join: (...paths) => ipcRenderer.invoke('path-join', ...paths),
    dirname: (filePath) => ipcRenderer.invoke('path-dirname', filePath)
  },
  
  // 对话框操作
  dialog: {
    showOpenDialog: (options) => ipcRenderer.invoke('dialog-show-open-dialog', options)
  },
  
  // 窗口操作
  window: {
    createWindow: (options) => ipcRenderer.invoke('create-window', options)
  },
  
  // 目录选择
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  
  // 任务栏图标操作
  tray: {
    // 设置消息提示图标（有未读消息）
    setMessageIcon: () => ipcRenderer.invoke('tray-set-message-icon'),
    // 设置消息图标并闪烁（模仿QQ）
    setMessageIconWithBlink: () => ipcRenderer.invoke('tray-set-message-icon-blink'),
    // 停止图标闪烁
    stopBlink: () => ipcRenderer.invoke('tray-stop-icon-blink'),
    // 设置视频播放图标
    setVideoIcon: (progress) => ipcRenderer.invoke('tray-set-video-icon', progress),
    // 设置音频播放图标
    setAudioIcon: (progress) => ipcRenderer.invoke('tray-set-audio-icon', progress),
    // 设置下载图标（带进度）
    setDownloadIcon: (progress) => ipcRenderer.invoke('tray-set-download-icon', progress),
    // 清除下载状态
    clearDownload: () => ipcRenderer.invoke('tray-clear-download'),
    // 恢复默认图标
    setDefaultIcon: () => ipcRenderer.invoke('tray-set-default-icon'),
    // 设置播放状态（用于优先级判断）
    setPlaybackStatus: (type, isPlaying) => ipcRenderer.invoke('tray-set-playback-status', type, isPlaying)
  },
  
  // 截图相关
  screenshot: {
    // 监听截图触发事件
    onTrigger: (callback) => {
      ipcRenderer.on('trigger-screenshot', () => callback());
    },
    // 移除截图监听
    removeListener: () => {
      ipcRenderer.removeAllListeners('trigger-screenshot');
    },
    // 截图完成
    complete: (dataUrl) => ipcRenderer.invoke('screenshot-complete', dataUrl),
    // 取消截图
    cancel: () => ipcRenderer.invoke('screenshot-cancel'),
    // 监听截图完成事件
    onComplete: (callback) => {
      ipcRenderer.on('screenshot-done', (event, dataUrl) => callback(dataUrl));
    },
    // 移除截图完成监听
    removeCompleteListener: () => {
      ipcRenderer.removeAllListeners('screenshot-done');
    }
  },
  
  // 更新操作
  downloadUpdate: (buffer, filename) => ipcRenderer.invoke('download-update', buffer, filename),
  
  // 极速下载（使用 aria2c）
  speedDownload: (downloadUrl) => ipcRenderer.invoke('speed-download', downloadUrl),
  
  // 普通下载（带进度）
  normalDownload: (downloadUrl) => ipcRenderer.invoke('normal-download', downloadUrl),
  
  // 下载进度监听
  onDownloadProgress: (callback) => {
    ipcRenderer.on('download-progress', (_event, data) => callback(data));
  },
  
  // 检查API是否可用
  isAvailable: true,
  
  // 版本信息
  version: '0.0.3',
  
  // web目录路径
  __dirname: webDir,
  
  // 项目根目录路径
  projectRoot: projectRoot
};

// 尝试暴露API
try {
  contextBridge.exposeInMainWorld('electronAPI', electronAPI);
  console.log('[preload] electronAPI exposed successfully via contextBridge');
} catch (error) {
  console.error('[preload] Failed to expose electronAPI via contextBridge:', error);
  // 尝试直接设置
  try {
    window.electronAPI = electronAPI;
    console.log('[preload] electronAPI exposed directly on window');
  } catch (e) {
    console.error('[preload] Failed to expose electronAPI:', e);
  }
}

console.log('[preload] preload.js initialization complete');
