# Modern Chat

基于 Electron 的现代化聊天软件桌面客户端。

## 功能特性

- 📱 **现代化界面** - 简洁美观的聊天界面设计
- 📷 **截图功能** - 支持全局快捷键 `Ctrl+Alt+D` 进行截图
- 📹 **视频播放** - 内置视频播放器，支持任务栏进度显示
- 🎵 **音频播放** - 支持音频消息播放
- 📥 **文件下载** - 支持高速下载（aria2c）和普通下载两种模式
- 🔔 **消息提醒** - 任务栏闪烁提醒，模仿 QQ 行为
- ⚡ **自动更新** - 支持应用自动更新

## 技术栈

- **框架**: Electron 31.x
- **构建工具**: electron-builder
- **前端**: HTML5 / CSS3 / JavaScript
- **UI组件**: LayUI

## 快速开始

### 前置要求

- Node.js >= 18.0.0
- npm >= 9.0.0

### 安装依赖

```bash
npm install
```

### 开发运行

```bash
npm start
```

### 构建打包

```bash
# 构建所有平台
npm run build

# 仅构建 Windows 版本
npm run build-win

# 构建便携版
npm run build-win-portable

# 仅打包不发布
npm run dist

# 仅打包到目录
npm run pack
```

## 项目结构

```
CHAT-EXE/
├── assets/              # 静态资源
│   ├── ico.ico          # 默认图标
│   ├── video.ico        # 视频播放图标
│   ├── audio.ico        # 音频播放图标
│   └── download.ico     # 下载图标
├── config/              # 配置文件
│   └── config.json
├── resources/           # 额外资源
│   ├── aria2c.exe       # 高速下载工具
│   ├── privacy_policy.md
│   └── terms_of_service.md
├── web/                 # Web 前端资源
│   ├── chat.html        # 聊天页面
│   ├── login.html       # 登录页面
│   ├── setting.html     # 设置页面
│   ├── screenshot.html  # 截图页面
│   ├── video-player.html# 视频播放器
│   ├── image-viewer.html# 图片查看器
│   ├── css/             # 样式文件
│   └── js/              # JavaScript 文件
├── main.js              # 主进程入口
├── preload.js           # 预加载脚本
├── package.json         # 项目配置
└── README.md            # 项目说明
```

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+Alt+D` | 截图 |

## IPC API

主进程提供以下 IPC 接口供渲染进程调用：

- `get-user-data-path` - 获取用户数据目录
- `get-resources-path` - 获取资源目录路径
- `get-displays` - 获取显示器信息
- `desktop-capturer-get-sources` - 获取屏幕捕获源
- `screenshot-complete` - 截图完成
- `screenshot-cancel` - 取消截图
- `fs-exists-sync` - 文件存在检查
- `fs-mkdir-sync` - 创建目录
- `fs-write-file-sync` - 写入文件
- `fs-read-file-sync` - 读取文件
- `fs-write-binary-file` - 写入二进制文件
- `fs-save-file` - 保存文件
- `path-join` - 路径拼接
- `path-dirname` - 获取父目录
- `dialog-show-open-dialog` - 打开文件对话框
- `select-directory` - 选择目录
- `create-window` - 创建新窗口
- `tray-set-message-icon` - 设置消息图标
- `tray-set-message-icon-blink` - 设置消息图标并闪烁
- `tray-stop-icon-blink` - 停止图标闪烁
- `tray-set-video-icon` - 设置视频播放图标
- `tray-set-audio-icon` - 设置音频播放图标
- `tray-set-download-icon` - 设置下载图标
- `tray-clear-download` - 清除下载状态
- `tray-set-default-icon` - 恢复默认图标
- `tray-set-playback-status` - 设置播放状态
- `download-update` - 下载更新包
- `speed-download` - 高速下载（aria2c）
- `normal-download` - 普通下载

## 许可证

MIT License

## 作者

Modern Chat Team