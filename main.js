const electron = require('electron');
const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const ipcMain = electron.ipcMain;
const dialog = electron.dialog;
const Menu = electron.Menu;
const desktopCapturer = electron.desktopCapturer;
const globalShortcut = electron.globalShortcut;
const screen = electron.screen;
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow;

// 全局配置存储（内存中）
let globalConfig = {
    cachePath: '',
    downloadPath: ''
};

// 获取preload.js的绝对路径
const preloadPath = path.resolve(__dirname, 'preload.js');
console.log('Preload path:', preloadPath);
console.log('Preload exists:', fs.existsSync(preloadPath));

// 获取应用图标路径
const iconPath = path.join(__dirname, 'assets', 'ico.ico');
console.log('Icon path:', iconPath);
console.log('Icon exists:', fs.existsSync(iconPath));

function createWindow() {
  if (process.platform === 'win32') {
    app.setPath('userData', path.join(app.getPath('appData'), 'Modern Chat'));
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: false,
      enableRemoteModule: false,
      sandbox: false,
      allowDisplayingInsecureContent: true,
      allowRunningInsecureContent: true
    },
    frame: true,
    titleBarStyle: 'default',
    icon: iconPath
  });

  mainWindow.loadFile('web/login.html');

  mainWindow.webContents.openDevTools(); // 自动打开开发者工具

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 窗口获得焦点后停止任务栏闪烁（与 QQ 行为一致）
  mainWindow.on('focus', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.flashFrame(false);
      } catch (e) {
        /* ignore */
      }
    }
  });

  // 监听新窗口创建事件
  mainWindow.webContents.on('new-window', (event, url, _frameName, _disposition, options) => {
    event.preventDefault();
    const newWindow = new BrowserWindow({
      ...options,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        webSecurity: false,
        enableRemoteModule: false,
        sandbox: false,
        allowDisplayingInsecureContent: true,
        allowRunningInsecureContent: true
      },
      icon: iconPath
    });
    newWindow.loadURL(url);
    newWindow.webContents.openDevTools(); // 自动打开开发者工具
    event.newGuest = newWindow;
  });
}

app.whenReady().then(() => {
  createWindow();
  
  // 完全禁用应用菜单
  Menu.setApplicationMenu(null);

  // 截图窗口引用
  let screenshotWindow = null;

  // 注册全局快捷键 Ctrl+Alt+D 用于截图
  const ret = globalShortcut.register('CommandOrControl+Alt+D', () => {
    console.log('[main] 全局快捷键 Ctrl+Alt+D 被触发');
    
    if (screenshotWindow) {
      screenshotWindow.close();
      screenshotWindow = null;
      return;
    }
    
    // 获取所有显示器的边界，计算总的屏幕区域
    const displays = electron.screen.getAllDisplays();
    let totalWidth = 0;
    let totalHeight = 0;
    let minX = 0;
    let minY = 0;
    
    for (const display of displays) {
      totalWidth = Math.max(totalWidth, display.bounds.x + display.bounds.width);
      totalHeight = Math.max(totalHeight, display.bounds.y + display.bounds.height);
      minX = Math.min(minX, display.bounds.x);
      minY = Math.min(minY, display.bounds.y);
    }
    
    // 创建截图窗口（覆盖所有显示器）
    screenshotWindow = new BrowserWindow({
      width: totalWidth,
      height: totalHeight,
      x: minX,
      y: minY,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        enableRemoteModule: true,
        devTools: false
      }
    });
    
    screenshotWindow.loadURL(`file://${__dirname}/web/screenshot.html`);
    
    screenshotWindow.on('closed', () => {
      screenshotWindow = null;
    });
  });
  
  if (!ret) {
    console.error('[main] 全局快捷键注册失败');
  } else {
    console.log('[main] 全局快捷键 Ctrl+Alt+D 注册成功');
  }

  // 监听所有窗口创建事件，确保新窗口使用自定义图标
  app.on('browser-window-created', (_event, win) => {
    // 设置窗口图标，确保不会显示 Electron 默认图标
    win.setIcon(iconPath);
    
    if (win !== screenshotWindow) {
      win.webContents.openDevTools();
    }
  });

  // 注册IPC事件处理程序
  ipcMain.handle('get-user-data-path', () => {
    return app.getPath('userData');
  });
  
  // 获取资源目录路径
  ipcMain.handle('get-resources-path', () => {
    return path.join(process.resourcesPath, 'resources');
  });
  
  // 获取显示器信息
  ipcMain.handle('get-displays', () => {
    return screen.getAllDisplays();
  });

  // 屏幕捕获处理（只获取屏幕，不获取窗口）
  ipcMain.handle('desktop-capturer-get-sources', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 3840, height: 2160 }
      });
      return sources;
    } catch (error) {
      console.error('[main] desktopCapturer error:', error);
      return [];
    }
  });

  // 截图完成处理
  ipcMain.handle('screenshot-complete', async (_event, dataUrl) => {
    console.log('[main] 截图完成，通知主窗口');
    if (screenshotWindow) {
      screenshotWindow.close();
      screenshotWindow = null;
    }
    
    // 通知主窗口截图完成
    if (mainWindow) {
      mainWindow.webContents.send('screenshot-done', dataUrl);
    }
  });

  // 截图取消处理
  ipcMain.handle('screenshot-cancel', () => {
    console.log('[main] 截图取消');
    if (screenshotWindow) {
      screenshotWindow.close();
      screenshotWindow = null;
    }
  });

  ipcMain.handle('get-documents-path', () => {
    return app.getPath('documents');
  });

  ipcMain.handle('fs-exists-sync', (_event, path) => {
    return fs.existsSync(path);
  });

  ipcMain.handle('fs-mkdir-sync', (_event, path, options) => {
    return fs.mkdirSync(path, options);
  });

  ipcMain.handle('fs-write-file-sync', (_event, path, data) => {
    return fs.writeFileSync(path, data);
  });

  ipcMain.handle('fs-read-file-sync', (_event, path) => {
    return fs.readFileSync(path, 'utf-8');
  });
  
  // 保存配置到内存
  ipcMain.handle('save-config', (_event, config) => {
    console.log('[main] Saving config:', config);
    globalConfig = { ...globalConfig, ...config };
    console.log('[main] Config saved:', globalConfig);
    return true;
  });

  ipcMain.handle('fs-write-binary-file', (_event, filePath, base64) => {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    return { success: true };
  });

  ipcMain.handle('fs-save-file', async (_event, buffer, filename) => {
    try {
      let downloadDir = app.getPath('downloads');
      
      // 使用内存中的全局配置
      if (globalConfig.downloadPath && globalConfig.downloadPath.trim()) {
        downloadDir = globalConfig.downloadPath;
      } else if (globalConfig.cachePath && globalConfig.cachePath.trim()) {
        downloadDir = globalConfig.cachePath;
      }
      
      if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir, { recursive: true });
      }
      
      const filePath = path.join(downloadDir, filename);
      fs.writeFileSync(filePath, Buffer.from(buffer));
      
      return { success: true, path: filePath };
    } catch (error) {
      console.error('[main] saveFile error:', error);
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('path-join', (_event, ...paths) => {
    return path.join(...paths);
  });

  ipcMain.handle('path-dirname', (_event, filePath) => {
    return path.dirname(filePath);
  });

  ipcMain.handle('dialog-show-open-dialog', (_event, options) => {
    return dialog.showOpenDialog(mainWindow, options);
  });

  ipcMain.handle('create-window', (_event, options) => {
    // 只提取需要的属性，避免传递无法序列化的对象
    const { width, height, resizable, url } = options;
    
    const newWindow = new BrowserWindow({
      width: width || 800,
      height: height || 600,
      resizable: resizable !== undefined ? resizable : true,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        webSecurity: false,
        enableRemoteModule: false,
        sandbox: false
      }
    });
    newWindow.loadURL(url);
    newWindow.webContents.openDevTools(); // 自动打开开发者工具
    return newWindow.id;
  });
  
  // 监听选择目录事件
  ipcMain.handle('select-directory', async (event) => {
    // 获取当前窗口
    const win = BrowserWindow.fromWebContents(event.sender);
    
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory']
    });
    
    if (!result.canceled) {
      return result.filePaths[0];
    }
    return null;
  });

  // 播放状态追踪
  let playbackStatus = {
    hasMessage: false,
    isVideoPlaying: false,
    isAudioPlaying: false,
    isDownloading: false,
    currentIcon: 'default',
    videoProgress: 0,
    audioProgress: 0,
    downloadProgress: 0
  };

  // 图标路径
  const iconPaths = {
    default: path.join(__dirname, 'assets', 'ico.ico'),
    message: path.join(__dirname, 'assets', 'ico.ico'),
    video: path.join(__dirname, 'assets', 'video.ico'),
    audio: path.join(__dirname, 'assets', 'audio.ico'),
    download: path.join(__dirname, 'assets', 'download.ico')
  };

  // 设置消息图标（优先级最高）
  ipcMain.handle('tray-set-message-icon', () => {
    playbackStatus.hasMessage = true;
    stopIconBlink();
    updateTaskbarIcon('message');
    return { success: true };
  });

  // 设置消息图标并闪烁（模仿QQ）
  let blinkTimer = null;
  let isBlinking = false;
  
  ipcMain.handle('tray-set-message-icon-blink', () => {
    playbackStatus.hasMessage = true;
    startIconBlink();
    return { success: true };
  });

  // 开始新消息提醒：Windows/Linux 使用任务栏按钮闪烁（与 QQ 类似）；macOS 使用 Dock 弹跳
  function startIconBlink() {
    if (isBlinking) return;

    isBlinking = true;

    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        if (process.platform === 'win32' || process.platform === 'linux') {
          mainWindow.flashFrame(true);
        } else if (process.platform === 'darwin' && app.dock) {
          app.dock.bounce('informational');
        }
      } catch (e) {
        console.warn('[main] flashFrame/bounce:', e);
      }

      // 仅当消息图标与默认图标为不同文件时才交替 setIcon（当前项目两者常为同一 ico，交替无效）
      const msgIco = iconPaths.message;
      const defIco = iconPaths.default;
      if (msgIco !== defIco && fs.existsSync(msgIco) && fs.existsSync(defIco)) {
        let showMsg = true;
        blinkTimer = setInterval(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setIcon(showMsg ? msgIco : defIco);
            showMsg = !showMsg;
          }
        }, 500);
      }
    }

    console.log('[main] 任务栏新消息提醒已开启（flashFrame / Dock bounce）');
  }

  // 停止图标闪烁 / 任务栏高亮
  function stopIconBlink() {
    if (blinkTimer) {
      clearInterval(blinkTimer);
      blinkTimer = null;
    }
    isBlinking = false;

    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.flashFrame(false);
      } catch (e) {
        /* ignore */
      }
      if (playbackStatus.hasMessage) {
        updateTaskbarIcon('message');
      } else {
        updateTaskbarIconBasedOnStatus();
      }
    }

    console.log('[main] 任务栏新消息提醒已停止');
  }

  // IPC：停止图标闪烁
  ipcMain.handle('tray-stop-icon-blink', () => {
    stopIconBlink();
    return { success: true };
  });

  // 设置视频播放图标
  ipcMain.handle('tray-set-video-icon', (_event, progress) => {
    playbackStatus.isVideoPlaying = true;
    playbackStatus.videoProgress = progress || 0;
    if (!playbackStatus.hasMessage) {
      updateTaskbarIcon('video', playbackStatus.videoProgress);
    }
    return { success: true };
  });

  // 下载更新包
  ipcMain.handle('download-update', async (_event, buffer, filename) => {
    try {
      const userDataPath = app.getPath('userData');
      const updateDir = path.join(userDataPath, 'updates');
      
      if (!fs.existsSync(updateDir)) {
        fs.mkdirSync(updateDir, { recursive: true });
      }
      
      const updatePath = path.join(updateDir, filename);
      fs.writeFileSync(updatePath, Buffer.from(buffer));
      
      // 延迟一点时间确保文件句柄完全释放后再运行安装程序
      setTimeout(() => {
        // 启动更新程序
        require('child_process').execFile(updatePath, [], (error) => {
          if (error) {
            console.error('启动更新失败:', error);
          } else {
            app.quit();
          }
        });
      }, 500);
      
      return { success: true, path: updatePath };
    } catch (error) {
      console.error('下载更新失败:', error);
      return { success: false, message: error.message };
    }
  });
  
  // 使用 aria2c 极速下载
  ipcMain.handle('speed-download', async (_event, downloadUrl) => {
    return new Promise((resolve, reject) => {
      try {
        // 获取下载目录
        const downloadDir = app.getPath('downloads');
        const filename = downloadUrl.split('/').pop() || 'modern-chat-setup.exe';
        const outputPath = path.join(downloadDir, filename);
        
        // 构建 aria2c 命令 - 尝试多个可能的路径
        let aria2cPath = path.join(process.resourcesPath, 'aria2c.exe');
        
        // 如果资源目录中没有，尝试嵌套的 resources 目录
        if (!fs.existsSync(aria2cPath)) {
          console.log('[main] aria2c not found in resources, trying nested resources directory');
          aria2cPath = path.join(process.resourcesPath, 'resources', 'aria2c.exe');
        }
        
        // 如果还没有，尝试在应用目录中查找
        if (!fs.existsSync(aria2cPath)) {
          console.log('[main] aria2c not found in nested resources, trying app directory');
          aria2cPath = path.join(__dirname, 'resources', 'aria2c.exe');
        }
        
        // 如果还没有，尝试应用目录的嵌套 resources
        if (!fs.existsSync(aria2cPath)) {
          console.log('[main] aria2c not found in app resources, trying app nested resources');
          aria2cPath = path.join(__dirname, 'resources', 'resources', 'aria2c.exe');
        }
        
        // 如果还是找不到，返回错误
        if (!fs.existsSync(aria2cPath)) {
          console.error('[main] aria2c.exe not found in any of the expected paths');
          return reject(new Error('aria2c.exe 未找到'));
        }
        
        console.log('[main] Starting aria2c download:', { aria2cPath, downloadUrl, outputPath });
        
        // 启动 aria2c 进程
        const aria2c = spawn(aria2cPath, [
          '-s', '16',
          '-x', '16',
          '-o', filename,
          '-d', downloadDir,
          downloadUrl
        ]);
        
        // 监听标准输出（进度信息）
        aria2c.stdout.on('data', (data) => {
          const output = data.toString();
          console.log('[aria2c] stdout:', output);
          
          // 解析进度信息: [#ce7dfc 6.3MiB/69MiB(9%) CN:2 DL:4.1MiB ETA:14s]
          const match = output.match(/\[#[\w]+\s+([\d.]+MiB)\/([\d.]+MiB)\((\d+)%\)\s+CN:\d+\s+DL:([\d.]+MiB)\s+ETA:(\d+s?m?h?)/);
          if (match) {
            const progressData = {
              downloaded: match[1],
              total: match[2],
              percent: parseInt(match[3]),
              speed: match[4],
              eta: match[5]
            };
            console.log('[aria2c] Progress:', progressData);
            
            // 发送进度到渲染进程
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('download-progress', progressData);
            }
          }
        });
        
        // 监听错误输出
        aria2c.stderr.on('data', (data) => {
          console.error('[aria2c] stderr:', data.toString());
        });
        
        // 监听进程结束
        aria2c.on('close', (code) => {
          console.log('[aria2c] process exited with code:', code);
          if (code === 0) {
            // 下载成功
            resolve({ success: true, path: outputPath });
            
            // 发送完成信号
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('download-progress', {
                percent: 100,
                downloaded: '100%',
                total: '100%',
                speed: '0MiB',
                eta: '0s',
                completed: true
              });
            }
            
            // 延迟一点时间确保文件句柄完全释放后再运行安装程序
            setTimeout(() => {
              require('child_process').execFile(outputPath, [], (error) => {
                if (error) {
                  console.error('启动安装程序失败:', error);
                } else {
                  app.quit();
                }
              });
            }, 500);
          } else {
            reject(new Error(`下载失败，退出码: ${code}`));
          }
        });
        
        // 监听错误
        aria2c.on('error', (error) => {
          console.error('[aria2c] error:', error);
          reject(error);
        });
        
        // 返回进程引用（用于取消）
        return { success: true, message: '下载已开始' };
        
      } catch (error) {
        console.error('[main] speed download error:', error);
        reject(error);
      }
    });
  });
  
  // 普通下载（带进度）
  ipcMain.handle('normal-download', async (_event, downloadUrl) => {
    return new Promise((resolve, reject) => {
      const https = require('https');
      const http = require('http');
      const url = require('url');
      
      const parsedUrl = url.parse(downloadUrl);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;
      const downloadDir = app.getPath('downloads');
      const filename = downloadUrl.split('/').pop() || 'modern-chat-setup.exe';
      const outputPath = path.join(downloadDir, filename);
      
      let receivedBytes = 0;
      let totalBytes = 0;
      let lastReceivedBytes = 0;
      let lastTime = Date.now();
      let speeds = [];
      
      const request = protocol.get(downloadUrl, (response) => {
        if (response.statusCode !== 200) {
          return reject(new Error(`下载失败，HTTP状态码: ${response.statusCode}`));
        }
        
        totalBytes = parseInt(response.headers['content-length'], 10);
        
        const fileStream = fs.createWriteStream(outputPath);
        
        response.on('data', (chunk) => {
          receivedBytes += chunk.length;
          
          // 计算速度和剩余时间
          const now = Date.now();
          const timeElapsed = (now - lastTime) / 1000;
          
          if (timeElapsed >= 0.5) { // 每0.5秒更新一次速度
            const currentSpeed = (receivedBytes - lastReceivedBytes) / timeElapsed;
            speeds.push(currentSpeed);
            
            // 保持最近10秒的速度数据
            if (speeds.length > 20) {
              speeds.shift();
            }
            
            lastReceivedBytes = receivedBytes;
            lastTime = now;
          }
          
          const percent = totalBytes > 0 ? Math.round((receivedBytes / totalBytes) * 100) : 0;
          
          let speed = '0MB/s';
          let eta = '计算中';
          
          if (speeds.length > 0) {
            const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
            speed = formatBytes(avgSpeed) + '/s';
            
            if (totalBytes > receivedBytes && avgSpeed > 0) {
              const remainingBytes = totalBytes - receivedBytes;
              const remainingSeconds = remainingBytes / avgSpeed;
              eta = formatTime(remainingSeconds);
            } else {
              eta = '0s';
            }
          }
          
          // 发送进度到渲染进程
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('download-progress', {
              downloaded: formatBytes(receivedBytes),
              total: formatBytes(totalBytes),
              percent: percent,
              speed: speed,
              eta: eta
            });
          }
        });
        
        response.pipe(fileStream);
        
        fileStream.on('finish', () => {
          // 发送完成信号
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('download-progress', {
              percent: 100,
              downloaded: formatBytes(totalBytes),
              total: formatBytes(totalBytes),
              speed: '0MiB',
              eta: '0s',
              completed: true
            });
          }
          
          resolve({ success: true, path: outputPath });
        });
        
        // 等待文件完全关闭后再运行安装程序
        fileStream.on('close', () => {
          // 延迟一点时间确保文件句柄完全释放
          setTimeout(() => {
            // 运行下载的安装程序并退出APP
            require('child_process').execFile(outputPath, [], (error) => {
              if (error) {
                console.error('启动安装程序失败:', error);
              } else {
                app.quit();
              }
            });
          }, 500);
        });
        
        fileStream.on('error', (error) => {
          fs.unlinkSync(outputPath);
          reject(error);
        });
      });
      
      request.on('error', (error) => {
        reject(error);
      });
      
      request.end();
    });
  });
  
  // 格式化字节数
  function formatBytes(bytes) {
    if (bytes === 0) return '0B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + sizes[i];
  }

  // 格式化时间（秒 -> 人类可读格式）
  function formatTime(seconds) {
    if (seconds < 60) return Math.round(seconds) + 's';
    if (seconds < 3600) return Math.round(seconds / 60) + 'm';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    return hours + 'h ' + minutes + 'm';
  }

  // 设置音频播放图标
  ipcMain.handle('tray-set-audio-icon', (_event, progress) => {
    playbackStatus.isAudioPlaying = true;
    playbackStatus.audioProgress = progress || 0;
    if (!playbackStatus.hasMessage && !playbackStatus.isVideoPlaying) {
      updateTaskbarIcon('audio', playbackStatus.audioProgress);
    }
    return { success: true };
  });

  // 设置下载图标（带进度）
  ipcMain.handle('tray-set-download-icon', (_event, progress) => {
    playbackStatus.isDownloading = true;
    playbackStatus.downloadProgress = progress || 0;
    if (!playbackStatus.hasMessage && !playbackStatus.isVideoPlaying && !playbackStatus.isAudioPlaying) {
      updateTaskbarIcon('download', playbackStatus.downloadProgress);
    }
    return { success: true };
  });

  // 清除下载状态
  ipcMain.handle('tray-clear-download', () => {
    playbackStatus.isDownloading = false;
    playbackStatus.downloadProgress = 0;
    updateTaskbarIconBasedOnStatus();
    return { success: true };
  });

  // 恢复默认图标
  ipcMain.handle('tray-set-default-icon', () => {
    playbackStatus.hasMessage = false;
    playbackStatus.isVideoPlaying = false;
    playbackStatus.isAudioPlaying = false;
    playbackStatus.videoProgress = 0;
    playbackStatus.audioProgress = 0;
    updateTaskbarIcon('default');
    return { success: true };
  });

  // 设置播放状态
  ipcMain.handle('tray-set-playback-status', (_event, type, isPlaying) => {
    if (type === 'video') {
      playbackStatus.isVideoPlaying = isPlaying;
    } else if (type === 'audio') {
      playbackStatus.isAudioPlaying = isPlaying;
    }
    
    updateTaskbarIconBasedOnStatus();
    return { success: true };
  });

  // 更新任务栏图标
  function updateTaskbarIcon(iconType, progress = null) {
    const iconPath = iconPaths[iconType];
    // 获取所有打开的窗口
    const allWindows = BrowserWindow.getAllWindows();
    
    allWindows.forEach(window => {
      if (fs.existsSync(iconPath)) {
        window.setIcon(iconPath);
      }
      
      // 如果有进度，设置进度条（Windows任务栏）
      if (window.setProgressBar && progress !== null && progress !== undefined) {
        window.setProgressBar(progress);
      } else if (window.setProgressBar && iconType !== 'video' && iconType !== 'audio') {
        window.setProgressBar(-1); // 清除进度条
      }
    });
    
    playbackStatus.currentIcon = iconType;
  }

  // 根据状态更新图标（考虑优先级）
  function updateTaskbarIconBasedOnStatus() {
    if (playbackStatus.hasMessage) {
      updateTaskbarIcon('message');
    } else if (playbackStatus.isVideoPlaying) {
      updateTaskbarIcon('video', playbackStatus.videoProgress);
    } else if (playbackStatus.isAudioPlaying) {
      updateTaskbarIcon('audio', playbackStatus.audioProgress);
    } else {
      updateTaskbarIcon('default');
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 应用退出时取消注册全局快捷键
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  console.log('[main] 全局快捷键已全部取消注册');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
