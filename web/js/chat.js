const OFFICIAL_SERVER = 'https://chat.hyacine.com.cn/chat/api-pc.php';

function getApiBaseUrl() {
    const customServer = localStorage.getItem('custom_server');
    return customServer || OFFICIAL_SERVER;
}
const SERVER_BASE_URL = 'https://chat.hyacine.com.cn/chat';

// access_key 存储变量
let accessKey = localStorage.getItem('access_key') || '';

// 设置 access_key
function setAccessKey(key) {
    accessKey = key;
    localStorage.setItem('access_key', key);
}

// 当前应用版本
const CURRENT_VERSION = 'V0.0.3';

// 官方版本检查地址（始终从官方服务器检查更新）
const OFFICIAL_VERSION_URL = 'https://chat.hyacine.com.cn/version-app-pc.json';

// IndexedDB 缓存
let db;

// 消息提示音播放器
let notificationAudio = null;

// 播放状态追踪
let playbackStates = {
    hasUnreadMessage: false,
    isVideoPlaying: false,
    isAudioPlaying: false
};

// 初始化提示音播放器
function initNotificationAudio() {
    notificationAudio = new Audio('wav/Msg.wav');
    notificationAudio.volume = 0.5;
}

// 播放消息提示音
function playNotificationSound() {
    if (notificationAudio) {
        notificationAudio.currentTime = 0;
        notificationAudio.play().catch(err => {
            console.error('播放提示音失败:', err);
        });
    }
}

// 设置消息图标（有未读消息）
async function setMessageIcon() {
    if (window.electronAPI && window.electronAPI.tray) {
        try {
            await window.electronAPI.tray.setMessageIcon();
            playbackStates.hasUnreadMessage = true;
        } catch (err) {
            console.error('设置消息图标失败:', err);
        }
    }
}

// 设置消息图标并闪烁（模仿QQ）
async function setMessageIconWithBlink() {
    if (window.electronAPI && window.electronAPI.tray) {
        try {
            await window.electronAPI.tray.setMessageIconWithBlink();
            playbackStates.hasUnreadMessage = true;
        } catch (err) {
            console.error('设置消息图标闪烁失败:', err);
            // 如果闪烁失败，回退到普通图标
            await setMessageIcon();
        }
    }
}

// 停止消息图标闪烁
async function stopMessageBlink() {
    if (window.electronAPI && window.electronAPI.tray) {
        try {
            await window.electronAPI.tray.stopBlink();
        } catch (err) {
            console.error('停止图标闪烁失败:', err);
        }
    }
}

// 设置视频播放状态
async function setVideoPlaybackStatus(isPlaying, progress = 0) {
    if (window.electronAPI && window.electronAPI.tray) {
        try {
            playbackStates.isVideoPlaying = isPlaying;
            if (isPlaying) {
                await window.electronAPI.tray.setVideoIcon(progress);
            } else {
                await window.electronAPI.tray.setPlaybackStatus('video', false);
            }
        } catch (err) {
            console.error('设置视频播放状态失败:', err);
        }
    }
}

// 设置音频播放状态
async function setAudioPlaybackStatus(isPlaying, progress = 0) {
    if (window.electronAPI && window.electronAPI.tray) {
        try {
            playbackStates.isAudioPlaying = isPlaying;
            if (isPlaying) {
                await window.electronAPI.tray.setAudioIcon(progress);
            } else {
                await window.electronAPI.tray.setPlaybackStatus('audio', false);
            }
        } catch (err) {
            console.error('设置音频播放状态失败:', err);
        }
    }
}

// 清除所有状态，恢复默认图标
async function clearAllPlaybackStates() {
    if (window.electronAPI && window.electronAPI.tray) {
        try {
            await window.electronAPI.tray.setDefaultIcon();
            playbackStates.hasUnreadMessage = false;
            playbackStates.isVideoPlaying = false;
            playbackStates.isAudioPlaying = false;
        } catch (err) {
            console.error('清除播放状态失败:', err);
        }
    }
}

// 检查未读消息
async function checkUnreadMessages() {
    const result = await fetchAPI('unread', 'count');
    if (result.success && result.data && result.data.count) {
        const unreadCount = result.data.count;
        if (unreadCount && unreadCount.length > 0) {
            playNotificationSound();
            setMessageIconWithBlink();
        }
    }
}

// 初始化 IndexedDB
function initIndexedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('ModernChatCache', 3);
        
        request.onerror = (event) => {
            console.error('IndexedDB 初始化失败:', event.target.error);
            reject(event.target.error);
        };
        
        request.onsuccess = (event) => {
            db = event.target.result;
            console.log('IndexedDB 初始化成功');
            resolve(db);
        };
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            
            // 创建消息存储
            if (!db.objectStoreNames.contains('messages')) {
                const messageStore = db.createObjectStore('messages', { keyPath: 'id' });
                messageStore.createIndex('contactId', 'contactId', { unique: false });
            }
            
            // 创建文件存储
            if (!db.objectStoreNames.contains('files')) {
                const fileStore = db.createObjectStore('files', { keyPath: 'url' });
                fileStore.createIndex('type', 'type', { unique: false });
            }
            
            // 创建视频缓存存储
            if (!db.objectStoreNames.contains('videos')) {
                const videoStore = db.createObjectStore('videos', { keyPath: 'url' });
                videoStore.createIndex('cachedAt', 'cachedAt', { unique: false });
            }
            
            // 创建音频缓存存储
            if (!db.objectStoreNames.contains('audios')) {
                const audioStore = db.createObjectStore('audios', { keyPath: 'url' });
                audioStore.createIndex('cachedAt', 'cachedAt', { unique: false });
            }
            
            // 创建失败文件存储
            if (!db.objectStoreNames.contains('failedFiles')) {
                const failedStore = db.createObjectStore('failedFiles', { keyPath: 'url' });
                failedStore.createIndex('failedAt', 'failedAt', { unique: false });
            }
        };
    });
}

// 缓存消息
function cacheMessage(message, contactId) {
    if (!db) return;
    
    const transaction = db.transaction(['messages'], 'readwrite');
    const store = transaction.objectStore('messages');
    
    const cachedMessage = {
        id: message.id,
        contactId: contactId,
        ...message,
        cachedAt: new Date().toISOString()
    };
    
    store.put(cachedMessage);
}

// 获取缓存的消息
function getCachedMessages(contactId) {
    if (!db) return Promise.resolve([]);
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['messages'], 'readonly');
        const store = transaction.objectStore('messages');
        const index = store.index('contactId');
        const request = index.getAll(contactId);
        
        request.onsuccess = () => {
            // 按时间正序排序（最新消息在最后）
            const sortedMessages = request.result.sort((a, b) => {
                const timeA = a.created_at || a.time;
                const timeB = b.created_at || b.time;
                const dateA = timeA ? new Date(timeA) : new Date(0);
                const dateB = timeB ? new Date(timeB) : new Date(0);
                return dateA.getTime() - dateB.getTime();
            });
            resolve(sortedMessages);
        };
        
        request.onerror = () => {
            reject(request.error);
        };
    });
}

// 缓存文件
function cacheFile(url, data, type) {
    if (!db) return;
    
    const transaction = db.transaction(['files'], 'readwrite');
    const store = transaction.objectStore('files');
    
    const cachedFile = {
        url: url,
        data: data,
        type: type,
        cachedAt: new Date().toISOString()
    };
    
    store.put(cachedFile);
}

// 获取缓存的文件（支持模糊匹配）
function getCachedFile(url) {
    if (!db) return Promise.resolve(null);
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['files'], 'readonly');
        const store = transaction.objectStore('files');
        const request = store.get(url);
        
        request.onsuccess = () => {
            // 先尝试精确匹配
            if (request.result) {
                console.log(`[Cache] 精确匹配找到缓存: ${url}`);
                resolve(request.result);
            } else {
                // 精确匹配失败，尝试模糊匹配（通过文件名）
                const fileName = url.split('/').pop().split('?')[0];
                console.log(`[Cache] 精确匹配失败，尝试按文件名 "${fileName}" 查找`);
                
                const allKeysRequest = store.getAllKeys();
                allKeysRequest.onsuccess = () => {
                    const allKeys = allKeysRequest.result;
                    let found = null;
                    
                    for (const key of allKeys) {
                        const cachedFileName = key.split('/').pop().split('?')[0];
                        if (cachedFileName === fileName) {
                            const getRequest = store.get(key);
                            getRequest.onsuccess = () => {
                                found = getRequest.result;
                                if (found) {
                                    console.log(`[Cache] 文件名匹配找到缓存: ${key}`);
                                }
                                resolve(found);
                            };
                            getRequest.onerror = () => resolve(null);
                            return;
                        }
                    }
                    
                    resolve(null);
                };
                allKeysRequest.onerror = () => resolve(null);
            }
        };
        
        request.onerror = () => {
            reject(request.error);
        };
    });
}

// 缓存音频
function cacheAudio(url, blob) {
    if (!db) return Promise.reject('IndexedDB not initialized');
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['audios'], 'readwrite');
        const store = transaction.objectStore('audios');
        
        const cachedAudio = {
            url: url,
            blob: blob,
            cachedAt: new Date().toISOString()
        };
        
        const request = store.put(cachedAudio);
        request.onsuccess = () => {
            console.log(`[Cache] 音频已缓存: ${url}`);
            resolve();
        };
        request.onerror = () => {
            console.error(`[Cache] 音频缓存失败: ${url}`, request.error);
            reject(request.error);
        };
    });
}

// 获取缓存的音频
function getCachedAudio(url) {
    if (!db) return Promise.resolve(null);
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['audios'], 'readonly');
        const store = transaction.objectStore('audios');
        const request = store.get(url);
        
        request.onsuccess = () => {
            if (request.result) {
                console.log(`[Cache] 找到缓存的音频: ${url}`);
                resolve(request.result.blob);
            } else {
                const fileName = url.split('/').pop().split('?')[0];
                const allKeysRequest = store.getAllKeys();
                allKeysRequest.onsuccess = () => {
                    const allKeys = allKeysRequest.result;
                    let foundBlob = null;
                    
                    for (const key of allKeys) {
                        const cachedFileName = key.split('/').pop().split('?')[0];
                        if (cachedFileName === fileName) {
                            const getRequest = store.get(key);
                            getRequest.onsuccess = () => {
                                foundBlob = getRequest.result?.blob;
                                if (foundBlob) {
                                    console.log(`[Cache] 文件名匹配找到音频: ${key}`);
                                }
                                resolve(foundBlob);
                            };
                            getRequest.onerror = () => resolve(null);
                            return;
                        }
                    }
                    resolve(null);
                };
                allKeysRequest.onerror = () => resolve(null);
            }
        };
        
        request.onerror = () => {
            reject(request.error);
        };
    });
}

// 获取视频缩略图（第5秒的画面）
async function getVideoThumbnail(videoUrl, previewElement, timestamp = 5) {
    try {
        // 创建隐藏的视频元素
        const video = document.createElement('video');
        video.src = videoUrl;
        video.crossOrigin = 'anonymous';
        video.muted = true;
        video.preload = 'metadata';
        
        // 等待元数据加载
        await new Promise((resolve, reject) => {
            video.onloadedmetadata = () => resolve();
            video.onerror = () => reject(new Error('视频加载失败'));
        });
        
        // 如果视频时长小于5秒，使用视频时长的一半
        const seekTime = Math.min(timestamp, video.duration / 2);
        video.currentTime = seekTime;
        
        // 等待seek完成
        await new Promise((resolve) => {
            video.onseeked = () => resolve();
        });
        
        // 创建canvas截图
        const canvas = document.createElement('canvas');
        canvas.width = 300;
        canvas.height = 180;
        const ctx = canvas.getContext('2d');
        
        // 绘制视频帧到canvas
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // 转换为dataURL
        const thumbnailDataUrl = canvas.toDataURL('image/jpeg', 0.8);
        
        // 更新预览元素
        if (previewElement) {
            const img = previewElement.querySelector('.video-thumbnail-img');
            if (img) {
                img.src = thumbnailDataUrl;
            }
        }
        
        return thumbnailDataUrl;
    } catch (error) {
        console.error('获取视频缩略图失败:', error);
        return null;
    }
}

// 缓存视频缩略图
function cacheVideoThumbnail(videoUrl, thumbnailDataUrl) {
    if (!db) return Promise.reject('IndexedDB not initialized');
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['videos'], 'readwrite');
        const store = transaction.objectStore('videos');
        
        const request = store.get(videoUrl);
        request.onsuccess = () => {
            const videoData = request.result || { url: videoUrl };
            videoData.thumbnail = thumbnailDataUrl;
            videoData.thumbnailCachedAt = new Date().toISOString();
            
            const updateRequest = store.put(videoData);
            updateRequest.onsuccess = () => {
                console.log('[Chat] 视频缩略图已缓存:', videoUrl);
                resolve();
            };
            updateRequest.onerror = () => reject(updateRequest.error);
        };
        request.onerror = () => reject(request.error);
    });
}

// 获取缓存的视频缩略图
function getCachedVideoThumbnail(videoUrl) {
    if (!db) return Promise.resolve(null);
    
    return new Promise((resolve) => {
        const transaction = db.transaction(['videos'], 'readonly');
        const store = transaction.objectStore('videos');
        const request = store.get(videoUrl);
        
        request.onsuccess = () => {
            const videoData = request.result;
            if (videoData && videoData.thumbnail) {
                resolve(videoData.thumbnail);
            } else {
                resolve(null);
            }
        };
        request.onerror = () => resolve(null);
    });
}

// 修改视频预览显示
function updateVideoPreview(previewElement, videoUrl, displayName) {
    previewElement.innerHTML = `
        <div class="video-placeholder" style="width: 300px; height: 180px; background: #f5f5f5; border-radius: 4px; position: relative; overflow: hidden; cursor: pointer;" onclick="openVideoPlayer('${escapeHtml(videoUrl)}', '${escapeHtml(displayName)}')">
            <img class="video-thumbnail-img" src="" alt="${escapeHtml(displayName)}" style="width: 100%; height: 100%; object-fit: cover; display: none;">
            <div class="video-thumbnail-placeholder" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: linear-gradient(135deg, #f5f5f5 0%, #e0e0e0 100%);">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #667eea; margin-bottom: 10px;">
                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
                <div style="font-size: 14px; color: #333; text-align: center; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(displayName)}</div>
                <div style="font-size: 12px; color: #888; margin-top: 5px;">点击播放</div>
            </div>
            <div class="video-play-overlay" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 64px; height: 64px; background: rgba(0, 0, 0, 0.5); border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="white">
                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
            </div>
        </div>
        <button class="download-btn" onclick="downloadFile('${escapeHtml(videoUrl)}', '${escapeHtml(displayName)}'); event.stopPropagation();" style="display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; background: linear-gradient(135deg, #3498db 0%, #2980b9 100%); color: white; border: none; border-radius: 8px; cursor: pointer; transition: all 0.2s ease; box-shadow: 0 2px 4px rgba(52, 152, 219, 0.3); margin-top: 10px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
        </button>
    `;
    
    // 尝试加载缩略图
    const loadThumbnail = async () => {
        const img = previewElement.querySelector('.video-thumbnail-img');
        const placeholder = previewElement.querySelector('.video-thumbnail-placeholder');
        if (!img) return;
        
        try {
            const cachedThumbnail = await getCachedVideoThumbnail(videoUrl);
            if (cachedThumbnail) {
                img.src = cachedThumbnail;
                img.style.display = 'block';
                if (placeholder) placeholder.style.display = 'none';
                return;
            }
            
            const thumbnailDataUrl = await getVideoThumbnail(videoUrl, previewElement);
            if (thumbnailDataUrl) {
                img.src = thumbnailDataUrl;
                img.style.display = 'block';
                if (placeholder) placeholder.style.display = 'none';
                await cacheVideoThumbnail(videoUrl, thumbnailDataUrl);
            }
        } catch (error) {
            console.error('加载视频缩略图失败:', error);
        }
    };
    
    loadThumbnail();
}
function cacheVideo(url, blob) {
    if (!db) return Promise.reject('IndexedDB not initialized');
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['videos'], 'readwrite');
        const store = transaction.objectStore('videos');
        
        const cachedVideo = {
            url: url,
            blob: blob,
            cachedAt: new Date().toISOString()
        };
        
        const request = store.put(cachedVideo);
        
        request.onsuccess = () => {
            console.log('[Chat] 视频已缓存:', url);
            resolve();
        };
        
        request.onerror = () => {
            console.error('[Chat] 视频缓存失败:', request.error);
            reject(request.error);
        };
    });
}

// 获取缓存的视频
function getCachedVideo(url) {
    if (!db) return Promise.resolve(null);
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['videos'], 'readonly');
        const store = transaction.objectStore('videos');
        const request = store.get(url);
        
        request.onsuccess = () => {
            resolve(request.result);
        };
        
        request.onerror = () => {
            reject(request.error);
        };
    });
}

// 记录加载失败的文件
function recordFailedFile(url) {
    if (!db) return Promise.reject('IndexedDB not initialized');
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['failedFiles'], 'readwrite');
        const store = transaction.objectStore('failedFiles');
        
        const failedFile = {
            url: url,
            failedAt: new Date().toISOString()
        };
        
        const request = store.put(failedFile);
        
        request.onsuccess = () => {
            console.log('[Chat] 文件已标记为失败:', url);
            resolve();
        };
        
        request.onerror = () => {
            console.error('[Chat] 记录失败文件失败:', request.error);
            reject(request.error);
        };
    });
}

// 检查文件是否加载失败过
function isFileFailed(url) {
    if (!db) return Promise.resolve(false);
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['failedFiles'], 'readonly');
        const store = transaction.objectStore('failedFiles');
        const request = store.get(url);
        
        request.onsuccess = () => {
            resolve(request.result !== undefined);
        };
        
        request.onerror = () => {
            reject(request.error);
        };
    });
}

/** 与 loadFilePreview / findValidFileUrl 一致的候选 URL 列表（用于批量标记失败） */
function getCandidateUrlsForFilename(filename) {
    const urls = [];
    if (!filename) return urls;
    if (filename.startsWith('http://') || filename.startsWith('https://')) {
        urls.push(filename);
    }
    let actualFilename = filename;
    if (filename.includes('/')) {
        actualFilename = filename.split('/').pop().split('?')[0];
    }
    urls.push(`${SERVER_BASE_URL}/uploads/${actualFilename}`);
    urls.push(`${SERVER_BASE_URL}/${actualFilename}`);
    return [...new Set(urls.filter(Boolean))];
}

async function recordFailedUrls(urls) {
    const list = Array.isArray(urls) ? urls : getCandidateUrlsForFilename(urls);
    for (const u of list) {
        if (!u) continue;
        try {
            await recordFailedFile(u);
        } catch (e) {
            console.warn('[Chat] recordFailedFile:', e);
        }
    }
}

function removeFailedFile(url) {
    if (!db) return Promise.resolve();
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['failedFiles'], 'readwrite');
        const store = transaction.objectStore('failedFiles');
        const request = store.delete(url);
        
        request.onsuccess = () => {
            console.log('已清除失败记录:', url);
            resolve();
        };
        
        request.onerror = () => {
            reject(request.error);
        };
    });
}

async function clearFailedUrls(urls) {
    const list = Array.isArray(urls) ? urls : getCandidateUrlsForFilename(urls);
    for (const u of list) {
        if (!u) continue;
        try {
            await removeFailedFile(u);
        } catch (e) {
            console.warn('[Chat] removeFailedFile:', e);
        }
    }
}

// 轻量提示（截图/粘贴成功等）
function showToast(message, duration = 2200) {
    let el = document.getElementById('app-toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'app-toast';
        el.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);max-width:90%;background:rgba(15,23,42,.92);color:#fff;padding:10px 20px;border-radius:10px;z-index:999999;font-size:14px;box-shadow:0 4px 24px rgba(0,0,0,.2);pointer-events:none;opacity:0;transition:all .25s ease';
        document.body.appendChild(el);
    }
    // 确保元素可见
    el.style.display = 'block';
    el.style.opacity = '0';
    el.textContent = message;
    
    // 显示动画
    requestAnimationFrame(() => { 
        el.style.opacity = '1'; 
    });
    
    // 清除之前的定时器
    clearTimeout(window.__appToastTimer);
    
    // 隐藏并移除元素
    window.__appToastTimer = setTimeout(() => {
        el.style.opacity = '0';
        // 等待淡出动画完成后移除元素
        setTimeout(() => {
            el.style.display = 'none';
        }, 250);
    }, duration);
}
window.showToast = showToast;

// 下载并缓存文件（带进度回调）
async function downloadAndCacheFile(url, type, onProgress = null, onComplete = null) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            if (response.status === 404 || response.status === 403) {
                await recordFailedUrls(getCandidateUrlsForFilename(url));
            }
            throw new Error('Network response was not ok');
        }
        
        const contentLength = response.headers.get('content-length');
        const totalSize = contentLength ? parseInt(contentLength) : 0;
        const reader = response.body.getReader();
        
        let receivedSize = 0;
        const chunks = [];
        
        while (true) {
            const { done, value } = await reader.read();
            
            if (done) {
                break;
            }
            
            chunks.push(value);
            receivedSize += value.length;
            
            if (onProgress && totalSize > 0) {
                const progress = receivedSize / totalSize;
                onProgress(progress);
                
                if (window.electronAPI && window.electronAPI.tray) {
                    try {
                        await window.electronAPI.tray.setDownloadIcon(progress);
                    } catch (err) {
                        console.error('更新任务栏下载图标失败:', err);
                    }
                }
            }
        }
        
        const blob = new Blob(chunks);
        const fileReader = new FileReader();
        
        return new Promise((resolve) => {
            fileReader.onloadend = async () => {
                const dataUrl = fileReader.result;
                cacheFile(url, dataUrl, type);
                
                if (window.electronAPI && window.electronAPI.tray) {
                    try {
                        await window.electronAPI.tray.clearDownload();
                    } catch (err) {
                        console.error('清除任务栏下载图标失败:', err);
                    }
                }
                
                if (onComplete) {
                    onComplete(dataUrl);
                }
                resolve(dataUrl);
            };
            fileReader.readAsDataURL(blob);
        });
    } catch (error) {
        console.error('下载文件失败:', error);
        
        if (window.electronAPI && window.electronAPI.tray) {
            try {
                await window.electronAPI.tray.clearDownload();
            } catch (err) {
                console.error('清除任务栏下载图标失败:', err);
            }
        }
        return null;
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getDefaultAvatarSVG(name) {
    const colors = [
        '#667eea', '#764ba2', '#f093fb', '#f5576c',
        '#4facfe', '#00f2fe', '#43e97b', '#38f9d7',
        '#fa709a', '#fee140', '#a18cd1', '#fbc2eb'
    ];
    const colorIndex = name ? name.charCodeAt(0) % colors.length : 0;
    const backgroundColor = colors[colorIndex];
    let initial = '?';
    if (name) {
        const firstChar = name.charAt(0);
        if (/[a-zA-Z]/.test(firstChar)) {
            initial = firstChar.toUpperCase();
        } else if (/[\u4e00-\u9fa5]/.test(firstChar)) {
            initial = firstChar;
        }
    }

    const svgContent = `
        <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="50" fill="${backgroundColor}"/>
            <text x="50" y="65" font-family="Arial, sans-serif" font-size="45" fill="white" text-anchor="middle" font-weight="bold">${initial}</text>
        </svg>
    `.trim();

    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`;
}

function getAvatarUrl(avatarPath) {
    if (!avatarPath) return null;
    if (avatarPath.startsWith('http://') || avatarPath.startsWith('https://')) {
        return avatarPath;
    }
    if (avatarPath.startsWith('data:')) {
        return avatarPath;
    }
    if (avatarPath.includes('chatuploads')) {
        return SERVER_BASE_URL + '/' + avatarPath.replace(/^\//, '');
    }
    return SERVER_BASE_URL + '/' + avatarPath;
}

async function checkFileExists(url) {
    try {
        const response = await fetch(url, {
            method: 'HEAD'
        });
        return { exists: response.ok, status: response.status };
    } catch {
        return { exists: false, status: 0 };
    }
}

async function findValidFileUrl(filename) {
    if (!filename) return null;

    let urlsToCheck = [];

    if (filename.startsWith('http://') || filename.startsWith('https://')) {
        urlsToCheck.push(filename);
    }

    let actualFilename = filename;
    if (filename.includes('/')) {
        const parts = filename.split('/');
        actualFilename = parts[parts.length - 1];
    }

    urlsToCheck.push(`${SERVER_BASE_URL}/uploads/${actualFilename}`);
    urlsToCheck.push(`${SERVER_BASE_URL}/${actualFilename}`);

    for (const url of urlsToCheck) {
        // 优先检查本地缓存是否存在该文件
        const cachedFile = await getCachedFile(url);
        if (cachedFile) {
            console.log('[Chat] 文件已在本地缓存中:', url);
            return url;
        }

        const hasFailed = await isFileFailed(url);
        if (hasFailed) {
            console.log('[Chat] 文件已标记为失败(404/403)，跳过:', url);
            continue;
        }

        const result = await checkFileExists(url);
        if (result.exists) {
            return url;
        } else if (result.status === 404 || result.status === 403) {
            console.log(`[Chat] 文件返回${result.status}，记录失败:`, url);
            await recordFailedFile(url);
        }
    }

    return null;
}

let currentContact = null;
let userInfo = null;
let contacts = {
    messages: [],
    friends: [],
    groups: []
};
let messageCache = {};
let messages = {};
let currentTab = 'messages';

// 记录每个联系人/群聊的最后消息时间
let lastMessageTimes = {};

// 消息轮询间隔（毫秒）
const POLL_INTERVAL = 5000;
// 轮询定时器
let pollTimer = null;

let lastCheckTime = 0;
let checkResult = null;

async function checkUserAndIP() {
    const now = Date.now();
    
    if (now - lastCheckTime < 5000) {
        return checkResult;
    }
    
    try {
        const [userResult, ipResult] = await Promise.all([
            fetch(getApiBaseUrl(), {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resource: 'user_check' })
            }).then(r => r.json()),
            fetch(getApiBaseUrl(), {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resource: 'ip_check' })
            }).then(r => r.json())
        ]);
        
        lastCheckTime = now;
        
        if (!userResult.success && userResult.code >= 8526 && userResult.code <= 9999) {
            checkResult = { success: false, type: 'user', ...userResult };
            return checkResult;
        }
        
        if (!ipResult.success && ipResult.code >= 3526 && ipResult.code <= 8526) {
            checkResult = { success: false, type: 'ip', ...ipResult };
            return checkResult;
        }
        
        checkResult = { success: true };
        return checkResult;
    } catch (error) {
        console.error('[Check] 用户和IP检查失败:', error);
        return { success: true };
    }
}

async function handleBanError(result) {
    let message = result.message || '账号异常';
    let details = [];
    
    if (result.type === 'user') {
        if (result.ban_time) details.push('封禁时间：' + result.ban_time);
        if (result.ban_end_time) details.push('解封时间：' + result.ban_end_time);
    } else if (result.type === 'ip') {
        if (result.ip_ban_time) details.push('封禁时间：' + result.ip_ban_time);
        if (result.ip_ban_end_time) details.push('解封时间：' + result.ip_ban_end_time);
    }
    if (result.Remaining) details.push('剩余时间：' + result.Remaining);
    
    const fullMessage = message + (details.length > 0 ? '\n' + details.join('\n') : '');
    
    alert(fullMessage);
    
    logout();
    
    window.location.href = 'login.html';
}

async function fetchAPI(resource, action, data = {}) {
    const skipCheckResources = ['user_check', 'ip_check', 'version'];
    
    if (!skipCheckResources.includes(resource)) {
        const check = await checkUserAndIP();
        if (!check.success) {
            await handleBanError(check);
            return { success: false, message: '账号或IP被封禁' };
        }
    }
    
    try {
        console.log(`[API] 请求: ${resource}/${action}`, data);

        const response = await fetch(getApiBaseUrl(), {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                resource,
                action,
                access_key: accessKey,
                ...data
            })
        });

        if (!response.ok) {
            console.error(`[API] HTTP错误: ${response.status} ${response.statusText} - ${resource}/${action}`);
            if (response.status === 500) {
                try {
                    const errorText = await response.text();
                    console.error(`[API] 500错误详情:`, errorText);
                } catch (e) {
                    console.error(`[API] 无法获取500错误详情:`, e);
                }
            }
            return { success: false, message: `HTTP错误: ${response.status}` };
        }

        const result = await response.json();
        console.log(`[API] 响应: ${resource}/${action}`, result);
        
        if (!result.success && result.code) {
            if (result.code >= 8526 && result.code <= 9999) {
                await handleBanError({ ...result, type: 'user' });
            } else if (result.code >= 3526 && result.code <= 8526) {
                await handleBanError({ ...result, type: 'ip' });
            }
        }
        
        return result;
    } catch (error) {
        console.error(`[API] 请求失败: ${resource}/${action} -`, error.message, error);
        return { success: false, message: '网络错误: ' + error.message };
    }
}

// 加载最后消息时间记录
function loadLastMessageTimes() {
    try {
        const saved = localStorage.getItem('lastMessageTimes');
        if (saved) {
            lastMessageTimes = JSON.parse(saved);
            console.log('[Chat] 已加载最后消息时间记录:', lastMessageTimes);
        }
    } catch (error) {
        console.error('[Chat] 加载最后消息时间失败:', error);
        lastMessageTimes = {};
    }
}

// 保存最后消息时间记录
function saveLastMessageTimes() {
    try {
        localStorage.setItem('lastMessageTimes', JSON.stringify(lastMessageTimes));
        console.log('[Chat] 已保存最后消息时间记录');
    } catch (error) {
        console.error('[Chat] 保存最后消息时间失败:', error);
    }
}

// 更新联系人的最后消息时间
function updateLastMessageTime(contactId, time) {
    if (!lastMessageTimes[contactId] || lastMessageTimes[contactId] < time) {
        lastMessageTimes[contactId] = time;
        saveLastMessageTimes();
    }
}

// 获取联系人的最后消息时间
function getLastMessageTime(contactId) {
    return lastMessageTimes[contactId] || null;
}

// 标记消息为已读
async function markMessagesAsRead(contactId, contactType) {
    try {
        let result;
        if (contactType === 'group') {
            result = await fetchAPI('groups', 'mark_read', { group_id: contactId });
        } else {
            result = await fetchAPI('messages', 'mark_read', { friend_id: contactId });
        }
        
        if (result && result.success) {
            console.log(`[Chat] 已标记 ${contactType} ${contactId} 的消息为已读`);
            // 更新本地未读计数显示
            const contactItem = document.querySelector(`.contact-item[data-id="${contactId}"][data-type="${contactType}"]`);
            if (contactItem) {
                const badge = contactItem.querySelector('.unread-badge');
                if (badge) {
                    badge.remove();
                }
            }
        } else {
            console.error(`[Chat] 标记已读失败:`, result?.message);
        }
    } catch (error) {
        console.error(`[Chat] 标记已读请求失败:`, error);
    }
}

// 开始消息轮询（全局轮询所有会话）
function startMessagePolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
    }
    
    pollTimer = setInterval(async () => {
        try {
            // 轮询未读消息列表（全局）
            const result = await fetchAPI('unread', 'list');
            
            if (result && result.success && result.data) {
                const { friends = [], groups = [] } = result.data;
                let hasNewMessages = false;
                
                // 检查好友会话
                for (const session of friends) {
                    const contactId = session.id;
                    const lastTime = getLastMessageTime(contactId);
                    
                    if (!lastTime || session.last_time > lastTime) {
                        hasNewMessages = true;
                        updateLastMessageTime(contactId, session.last_time);
                    }
                }
                
                // 检查群聊会话
                for (const session of groups) {
                    const contactId = session.id;
                    const lastTime = getLastMessageTime(contactId);
                    
                    if (!lastTime || session.last_time > lastTime) {
                        hasNewMessages = true;
                        updateLastMessageTime(contactId, session.last_time);
                    }
                }
                
                // 如果有新消息，刷新会话信息和联系人列表
                if (hasNewMessages) {
                    console.log('[Chat] 检测到新消息');
                    
                    // 刷新会话信息（获取最新未读计数和最后消息）
                    await loadSessionsInfo();
                    
                    // 重新渲染联系人列表显示最新状态
                    await renderContacts();
                    
                    // 如果当前有选中的联系人，重新加载消息
                    if (currentContact && currentContact.originalId && currentContact.type) {
                        console.log(`[Chat] 轮询到新消息，重新加载联系人: id=${currentContact.originalId}, type=${currentContact.type}`);
                        await loadMessages(currentContact.originalId, currentContact.type);
                    }
                    
                    // 播放提示音并设置任务栏图标闪烁
                    playNotificationSound();
                    setMessageIconWithBlink();
                }
            }
        } catch (error) {
            console.error('[Chat] 轮询消息失败:', error);
        }
    }, POLL_INTERVAL);
    
    console.log('[Chat] 全局消息轮询已启动');
}

// 停止消息轮询
function stopMessagePolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
        console.log('[Chat] 消息轮询已停止');
    }
}

async function loadUserData() {
    const result = await fetchAPI('user', 'get_info');
    if (result.success) {
        userInfo = result.data;
        const avatarUrl = getAvatarUrl(userInfo.avatar);
        document.getElementById('userAvatar').src = avatarUrl || getDefaultAvatarSVG(userInfo.username);
        document.getElementById('userNameMini').textContent = userInfo.username;
        document.getElementById('userEmailMini').textContent = userInfo.email || '未设置邮箱';
    } else {
        console.error('加载用户信息失败:', result.message);
        document.getElementById('userAvatar').src = getDefaultAvatarSVG('');
        document.getElementById('userNameMini').textContent = '未登录';
        document.getElementById('userEmailMini').textContent = '';
    }
}

async function loadFriends() {
    const friendsResult = await fetchAPI('friends', 'list');

    if (friendsResult.success) {
        contacts.friends = friendsResult.data.map(friend => ({
            id: friend.id,
            name: friend.username,
            type: 'friend',
            avatar: getAvatarUrl(friend.avatar),
            lastMessage: '',
            lastSender: '',
            unreadCount: 0
        }));
    }
}

async function loadGroups() {
    const groupsResult = await fetchAPI('groups', 'list');

    if (groupsResult.success) {
        contacts.groups = groupsResult.data.map(group => ({
            id: group.id,
            name: group.name,
            type: 'group',
            avatar: null,
            owner_id: group.owner_id,
            is_admin: group.is_admin,
            lastMessage: '',
            lastSender: '',
            unreadCount: 0
        }));
    }
}

async function loadSessionsInfo() {
    try {
        const result = await fetchAPI('unread', 'list');
        if (result.success && result.data) {
            const { friends = [], groups = [] } = result.data;
            
            // 处理好友会话
            friends.forEach(session => {
                const contact = contacts.friends.find(f => f.id == session.id);
                if (contact) {
                    contact.unreadCount = session.unread_count || 0;
                    contact.lastSender = session.sender_name || '';
                    
                    let lastMsg = session.last_message;
                    let msgType = session.message_type;
                    
                    console.log(`[Session] 联系人 ${contact.name} (${contact.id}): last_message="${lastMsg}", message_type="${msgType}"`);
                    
                    contact.lastMessage = formatLastMessage(lastMsg, msgType);
                    contact.lastTime = session.last_time || '';
                }
            });
            
            // 处理群聊会话
            groups.forEach(session => {
                const contact = contacts.groups.find(g => g.id == session.id);
                if (contact) {
                    contact.unreadCount = session.unread_count || 0;
                    contact.lastSender = session.sender_name || '';
                    
                    let lastMsg = session.last_message;
                    let msgType = session.message_type;
                    
                    console.log(`[Session] 群聊 ${contact.name} (${contact.id}): last_message="${lastMsg}", message_type="${msgType}"`);
                    
                    contact.lastMessage = formatLastMessage(lastMsg, msgType);
                    contact.lastTime = session.last_time || '';
                }
            });
        }
    } catch (error) {
        console.error('加载会话信息失败:', error);
    }
}

function formatLastMessage(message, type) {
    if (!message) return '';
    
    if (type) {
        switch (type.toLowerCase()) {
            case 'image':
            case 'img':
                return '[图片]';
            case 'file':
            case 'document':
                return '[文件]';
            case 'audio':
            case 'voice':
                return '[语音]';
            case 'video':
                return '[视频]';
            default:
                break;
        }
    }
    
    const lowerMessage = message.toLowerCase();
    
    const videoExts = ['mp4', 'mov', 'avi', 'webm', 'mkv', 'ts', 'flv', 'wmv'];
    const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma'];
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'];
    
    let extension = '';
    try {
        const urlObj = new URL(message);
        const pathname = urlObj.pathname;
        const parts = pathname.split('.');
        if (parts.length > 1) {
            extension = parts[parts.length - 1].toLowerCase();
        }
    } catch {
        const parts = message.split('.');
        if (parts.length > 1) {
            extension = parts[parts.length - 1].toLowerCase();
        }
    }
    
    if (videoExts.includes(extension)) {
        return '[视频]';
    } else if (audioExts.includes(extension)) {
        return '[语音]';
    } else if (imageExts.includes(extension)) {
        return '[图片]';
    } else if (lowerMessage.includes('uploads/')) {
        return '[文件]';
    }
    
    if (message.length > 50) {
        return message.substring(0, 50) + '...';
    }
    
    return message;
}

function getContactById(id, type = null) {
    const stringId = String(id);
    if (type === 'friend') {
        return contacts.friends.find(contact => String(contact.id) === stringId);
    } else if (type === 'group') {
        return contacts.groups.find(contact => String(contact.id) === stringId);
    } else {
        // 先找好友，再找群聊
        const friend = contacts.friends.find(contact => String(contact.id) === stringId);
        if (friend) return friend;
        return contacts.groups.find(contact => String(contact.id) === stringId);
    }
}

function ensureMessageShape(m) {
    const x = { ...m };
    if (!x.sender && userInfo) {
        x.sender = String(x.sender_id) === String(userInfo.id) ? 'me' : 'other';
    }
    return x;
}

function buildMessageFromApiRow(msg, contactId, contactType) {
    let senderName = msg.sender_name || msg.sender_username || msg.username || msg.name || '未知';
    let senderAvatar = msg.avatar ? getAvatarUrl(msg.avatar) : (msg.sender_avatar ? getAvatarUrl(msg.sender_avatar) : null);
    if (msg.sender_id && String(msg.sender_id) !== String(userInfo?.id)) {
        let contact;
        if (contactType === 'friend') {
            contact = getContactById(contactId, 'friend');
        } else {
            contact = getContactById(msg.sender_id, 'friend');
        }
        if (contact) {
            senderName = contact.name;
            senderAvatar = contact.avatar;
        }
    }

    let content = msg.content || '';
    let fileName = null;

    if (msg.file_info) {
        let fi = msg.file_info;
        if (typeof fi === 'string') {
            try {
                fi = JSON.parse(fi);
            } catch (e) {
                fi = {};
            }
        }
        fileName = fi.file_name || fi.original_name || null;
        if (!content) {
            content = fileName || msg.file_path || msg.file_name || '';
        }
    } else if (!content) {
        if (msg.file_path) {
            content = msg.file_path;
        } else if (msg.file_name) {
            content = msg.file_name;
            fileName = msg.file_name;
        }
    }

    const isMe = String(msg.sender_id) === String(userInfo?.id);
    return {
        id: msg.id,
        sender_id: msg.sender_id,
        sender: isMe ? 'me' : 'other',
        sender_name: senderName,
        name: senderName,
        avatar: senderAvatar,
        content: content,
        fileName: fileName,
        time: msg.created_at || msg.time || '',
        created_at: msg.created_at || msg.time || '',
        type: msg.type || msg.message_type || 'text'
    };
}

async function loadMessages(contactId, contactType) {
    // 确保 contactId 是字符串类型，避免类型不匹配导致的消息显示错误
    // 使用 type+id 作为键，避免好友和群聊ID相同导致的消息重叠问题
    const stringContactId = `${contactType}_${String(contactId)}`;
    
    console.log(`%c[Chat] ===== 开始加载消息 =====`, 'color: #00a8ff; font-weight: bold');
    console.log(`[Chat] 联系人ID: ${contactId} (${typeof contactId})`);
    console.log(`[Chat] 字符串ID: "${stringContactId}"`);
    console.log(`[Chat] 联系人类型: "${contactType}"`);
    console.log(`[Chat] 当前 currentContact:`, currentContact);
    console.log(`[Chat] 当前 userInfo:`, userInfo);
    console.log(`[Chat] userInfo.id: ${userInfo?.id} (${typeof userInfo?.id})`);
    
    console.log(`[Chat] messages 对象的键数量: ${Object.keys(messages).length}`);
    console.log(`[Chat] messages 对象的所有键:`, Object.keys(messages));

    const localSorted = await getCachedMessages(stringContactId);
    const hasLocal = localSorted.length > 0;

    if (!hasLocal && messages[stringContactId]) {
        console.log(`[Chat] 无本地缓存，清空内存中的旧消息`);
        messages[stringContactId] = [];
    }

    let loadedMessages = [];

    if (!hasLocal) {
        let result;
        if (contactType === 'friend') {
            console.log(`[Chat] 无本地记录，全量请求 messages/history friend_id=${contactId}`);
            result = await fetchAPI('messages', 'history', { friend_id: contactId });
        } else {
            console.log(`[Chat] 无本地记录，全量请求 groups/messages group_id=${contactId}`);
            result = await fetchAPI('groups', 'messages', { group_id: contactId });
        }

        if (result.success && result.data) {
            console.log(`[Chat] 服务器返回消息数: ${result.data.length}`);
            if (result.data.length > 0) {
                console.log(`[Chat] 首条: id=${result.data[0]?.id}, 末条: id=${result.data[result.data.length - 1]?.id}`);
            }

            const filteredMessages = result.data.filter(msg => {
                if (contactType === 'friend') {
                    return msg.sender_id == userInfo?.id || msg.sender_id == contactId;
                }
                return true;
            });

            loadedMessages = filteredMessages.map(msg => {
                const message = buildMessageFromApiRow(msg, contactId, contactType);
                cacheMessage(message, stringContactId);
                if (msg.created_at) {
                    updateLastMessageTime(stringContactId, msg.created_at);
                }
                return message;
            });
        } else {
            console.error('加载消息失败:', result?.message || '未知错误');
            const fallback = await getCachedMessages(stringContactId);
            loadedMessages = fallback.map(ensureMessageShape);
        }
    } else {
        console.log(`[Chat] 使用本地缓存 ${localSorted.length} 条，并请求增量 messages/poll`);
        loadedMessages = localSorted.map(ensureMessageShape);
        const lastMsg = loadedMessages[loadedMessages.length - 1];
        const lastTimeRaw = lastMsg.created_at || lastMsg.time || '';
        const lastDt = new Date(lastTimeRaw);
        if (lastTimeRaw && !isNaN(lastDt.getTime())) {
            const pollRes = await fetchAPI('messages', 'poll', {
                last_time: lastTimeRaw,
                chat_type: contactType === 'group' ? 'group' : 'friend',
                chat_id: contactId
            });
            if (pollRes.success && pollRes.data && Array.isArray(pollRes.data.messages)) {
                const newRows = pollRes.data.messages;
                console.log(`[Chat] 增量新消息: ${newRows.length} 条`);
                const byId = new Map(loadedMessages.map(m => [String(m.id), m]));
                for (const row of newRows) {
                    const message = buildMessageFromApiRow(row, contactId, contactType);
                    cacheMessage(message, stringContactId);
                    if (row.created_at) {
                        updateLastMessageTime(stringContactId, row.created_at);
                    }
                    byId.set(String(message.id), message);
                }
                loadedMessages = Array.from(byId.values());
            } else if (!pollRes.success) {
                console.warn('[Chat] 增量拉取失败，仅显示本地:', pollRes?.message || pollRes);
            }
        } else {
            console.warn('[Chat] 本地最后一条无有效时间，跳过增量请求');
        }
    }
    
    // 对消息按时间正序排序（最新消息在最后）
    console.log(`[Chat] 排序前 - 消息数: ${loadedMessages.length}`);
    if (loadedMessages.length > 0) {
        console.log(`[Chat] 排序前 - 第一条消息: id=${loadedMessages[0]?.id}, time=${loadedMessages[0]?.created_at || loadedMessages[0]?.time}, content=${loadedMessages[0]?.content?.substring(0, 20)}...`);
        console.log(`[Chat] 排序前 - 最后一条消息: id=${loadedMessages[loadedMessages.length-1]?.id}, time=${loadedMessages[loadedMessages.length-1]?.created_at || loadedMessages[loadedMessages.length-1]?.time}, content=${loadedMessages[loadedMessages.length-1]?.content?.substring(0, 20)}...`);
    }
    
    // 增强排序逻辑：使用Date对象比较，如果失败则使用字符串比较
    loadedMessages.sort((a, b) => {
        const timeA = a.created_at || a.time || '';
        const timeB = b.created_at || b.time || '';
        
        // 尝试使用Date对象比较
        const dateA = new Date(timeA);
        const dateB = new Date(timeB);
        
        const timestampA = !isNaN(dateA.getTime()) ? dateA.getTime() : 0;
        const timestampB = !isNaN(dateB.getTime()) ? dateB.getTime() : 0;
        
        if (timestampA !== 0 && timestampB !== 0) {
            // 使用时间戳比较
            return timestampA - timestampB;
        } else {
            // 如果Date解析失败，使用字符串比较
            return timeA.localeCompare(timeB);
        }
    });
    
    console.log(`[Chat] 排序后 - 消息数: ${loadedMessages.length}`);
    if (loadedMessages.length > 0) {
        console.log(`[Chat] 排序后 - 第一条消息: id=${loadedMessages[0]?.id}, time=${loadedMessages[0]?.created_at || loadedMessages[0]?.time}, content=${loadedMessages[0]?.content?.substring(0, 20)}...`);
        console.log(`[Chat] 排序后 - 最后一条消息: id=${loadedMessages[loadedMessages.length-1]?.id}, time=${loadedMessages[loadedMessages.length-1]?.created_at || loadedMessages[loadedMessages.length-1]?.time}, content=${loadedMessages[loadedMessages.length-1]?.content?.substring(0, 20)}...`);
    }
    
    // 验证排序结果：确保时间是递增的
    let isSorted = true;
    for (let i = 1; i < loadedMessages.length; i++) {
        const prevTime = loadedMessages[i-1].created_at || loadedMessages[i-1].time || '';
        const currTime = loadedMessages[i].created_at || loadedMessages[i].time || '';
        const prevDate = new Date(prevTime);
        const currDate = new Date(currTime);
        const prevTimestamp = !isNaN(prevDate.getTime()) ? prevDate.getTime() : 0;
        const currTimestamp = !isNaN(currDate.getTime()) ? currDate.getTime() : 0;
        
        if (prevTimestamp > currTimestamp && prevTimestamp !== 0 && currTimestamp !== 0) {
            console.error(`[Chat] 排序验证失败！第${i-1}条消息时间(${prevTime}) > 第${i}条消息时间(${currTime})`);
            isSorted = false;
        }
    }
    console.log(`[Chat] 排序验证结果: ${isSorted ? '正确' : '错误'}`);
    
    // 必须赋值给 messages[stringContactId]（使用字符串ID避免类型不匹配）
    console.log(`[Chat] 存储消息到 messages 对象 - key: "${stringContactId}", 消息数: ${loadedMessages.length}`);
    messages[stringContactId] = loadedMessages;
    
    // 更新 messageCache 供 renderContacts 使用（使用字符串ID）
    messageCache[stringContactId] = loadedMessages;
    
    // 更新联系人的最后消息信息（使用字符串ID）
    updateContactLastMessage(stringContactId, loadedMessages);
    
    console.log(`[Chat] 调用 renderMessages - contact: {id: "${stringContactId}", type: "${contactType}"}`);
    renderMessages({ id: stringContactId, type: contactType });
    
    console.log(`[Chat] ===== 消息加载完成 =====`);
}

function updateContactLastMessage(contactId, loadedMessages) {
    if (!loadedMessages || loadedMessages.length === 0) return;
    
    const lastMsg = loadedMessages[loadedMessages.length - 1];
    const contact = getContactById(contactId);
    
    if (contact) {
        contact.lastSender = lastMsg.sender_id == userInfo?.id ? '我' : (lastMsg.sender_name || '');
        contact.lastMessage = formatLastMessage(lastMsg.content || '', lastMsg.type || 'text');
        contact.lastTime = lastMsg.created_at || '';
    }
}

async function sendMessageToContact(content, contactId, contactType) {
    // 使用字符串ID避免类型不匹配
    const stringContactId = String(contactId);
    
    let result;
    if (contactType === 'friend') {
        result = await fetchAPI('messages', 'send', {
            receiver_id: contactId,
            content
        });
    } else {
        result = await fetchAPI('groups', 'send_message', {
            group_id: contactId,
            content
        });
    }

    if (result.success) {
        // 使用字符串ID加载消息
        await loadMessages(stringContactId, contactType);
        // 发送成功后刷新会话信息
        await loadSessionsInfo();
        await renderContacts();
        // 播放提示音
        playNotificationSound();
        // 设置消息图标
        setMessageIcon();
    }
}

async function switchTab(tab) {
    currentTab = tab;

    document.querySelectorAll('.nav-bar .nav-item').forEach(item => {
        item.classList.remove('active');
    });

    const tabItem = document.querySelector(`.nav-item[data-tab="${tab}"]`);
    if (tabItem) {
        tabItem.classList.add('active');
    }

    const titles = {
        messages: '消息',
        friends: '好友',
        groups: '群聊'
    };
    document.getElementById('panelTitle').textContent = titles[tab] || '消息';

    await renderContacts();
}

async function renderContacts() {
    const contactsList = document.getElementById('contactsList');
    contactsList.innerHTML = '';

    let list = [];
    if (currentTab === 'messages') {
        list = [...contacts.friends, ...contacts.groups];
    } else if (currentTab === 'friends') {
        list = contacts.friends;
    } else if (currentTab === 'groups') {
        list = contacts.groups;
    }

    if (list.length === 0) {
        const emptyItem = document.createElement('div');
        emptyItem.style.padding = '20px';
        emptyItem.style.textAlign = 'center';
        emptyItem.style.color = '#888';
        emptyItem.textContent = '暂无联系人';
        contactsList.appendChild(emptyItem);
        return;
    }

    for (const contact of list) {
        const avatar = contact.avatar ? getAvatarUrl(contact.avatar) : getDefaultAvatarSVG(contact.name);
        const contactKey = `${contact.type}_${String(contact.id)}`;
        const isActive = currentContact && currentContact.id === contactKey;
        const unreadCount = contact.unreadCount || 0;
        
        let lastSender = contact.lastSender || '';
        let lastMessage = contact.lastMessage || '';
        let lastTime = contact.lastTime || '';
        const contactIdStr = contactKey;
        const cached = messageCache[contactIdStr];
        let skipLocalDb = false;
        if (cached && cached.length > 0) {
            const lastMsg = cached[cached.length - 1];
            const t = lastMsg.created_at || lastMsg.time || '';
            const apiMs = previewTimeMs(lastTime);
            const cacheMs = previewTimeMs(t);
            if (cacheMs >= apiMs && cacheMs > 0) {
                lastSender = lastMsg.sender_name || (String(lastMsg.sender_id) === String(userInfo?.id) ? '我' : '');
                lastMessage = formatLastMessage(lastMsg.content || '', lastMsg.type || 'text');
                lastTime = t;
                skipLocalDb = true;
            }
        }
        if (!skipLocalDb) {
            const localMessages = await getMessagesFromIndexedDB(contact.id);
            if (localMessages && localMessages.length > 0) {
                const lastMsg = localMessages[localMessages.length - 1];
                const t = lastMsg.created_at || lastMsg.time || '';
                const locMs = previewTimeMs(t);
                const curMs = previewTimeMs(lastTime);
                const preferLocal = (!lastMessage || !lastTime) ? (locMs > 0) : (locMs > curMs);
                if (preferLocal) {
                    lastSender = lastMsg.sender_name || (String(lastMsg.sender_id) === String(userInfo?.id) ? '我' : '');
                    lastMessage = formatLastMessage(lastMsg.content || '', lastMsg.type || 'text');
                    lastTime = t;
                }
            }
        }
        
        const displayMessage = lastSender ? `${lastSender}: ${lastMessage}` : (lastMessage || '暂无消息');
        const displayTime = formatTimeDisplay(lastTime);

        const contactItem = document.createElement('div');
        contactItem.className = `contact-item ${isActive ? 'active' : ''}`;
        contactItem.dataset.id = contact.id;
        contactItem.dataset.type = contact.type;
        contactItem.innerHTML = `
            <img src="${avatar}" alt="${escapeHtml(contact.name)}" class="contact-avatar" onerror="this.src='${getDefaultAvatarSVG(contact.name)}'">
            <div class="contact-info">
                <div class="contact-name-row">
                    <div class="contact-name">${escapeHtml(contact.name)}</div>
                    <div class="contact-time">${escapeHtml(displayTime)}</div>
                </div>
                <div class="contact-message">${escapeHtml(displayMessage)}</div>
            </div>
            ${unreadCount > 0 ? `<div class="unread-badge">${unreadCount > 99 ? '99+' : unreadCount}</div>` : ''}
        `;

        contactItem.addEventListener('click', () => selectContact(contact));
        contactsList.appendChild(contactItem);
    }
}

function previewTimeMs(timeStr) {
    if (!timeStr) return 0;
    const d = new Date(timeStr);
    const ms = d.getTime();
    return Number.isNaN(ms) ? 0 : ms;
}

// 格式化时间显示
function formatTimeDisplay(timeStr) {
    if (!timeStr) return '';
    
    const date = new Date(timeStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const messageDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    
    if (messageDate.getTime() === today.getTime()) {
        // 今天
        return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    } else if (messageDate.getTime() === yesterday.getTime()) {
        // 昨天
        return '昨天';
    } else {
        // 其他时间
        return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
    }
}

// 从IndexedDB获取消息（与 getCachedMessages 一致：按时间正序）
async function getMessagesFromIndexedDB(chatId) {
    return getCachedMessages(String(chatId));
}

async function selectContact(contact) {
    // 确保 contact 对象包含正确的 id 和 type
    if (!contact || !contact.id || !contact.type) {
        console.error('[Chat] selectContact: 无效的联系人对象', contact);
        return;
    }
    
    // 使用字符串ID避免类型不匹配
    // 使用 type+id 作为唯一键，避免好友和群聊ID相同导致的消息重叠问题
    const stringContactId = `${contact.type}_${String(contact.id)}`;
    const originalId = String(contact.id);
    
    // 创建标准化的 currentContact 对象
    currentContact = {
        id: stringContactId,
        originalId: originalId,
        type: contact.type,
        name: contact.name,
        avatar: contact.avatar
    };

    document.querySelectorAll('.contact-item').forEach(item => {
        item.classList.remove('active');
    });
    
    // 确保选中正确的联系人（同时匹配 ID 和类型）
    const contactItems = document.querySelectorAll('.contact-item');
    for (const item of contactItems) {
        // 使用字符串比较
        if (item.dataset.id === originalId && item.dataset.type === contact.type) {
            item.classList.add('active');
            // 滚动到选中的联系人
            item.scrollIntoView({ behavior: 'smooth', block: 'center' });
            break;
        }
    }

    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('chatContent').style.display = 'flex';
    
    // 切换聊天时停止当前音频播放
    stopAllAudioPlayback();

    renderChatHeader(currentContact);
    await loadMessages(originalId, currentContact.type);
    
    // 标记消息为已读
    await markMessagesAsRead(originalId, currentContact.type);
    
    // 更新会话列表的未读计数显示并重新渲染UI
    await loadSessionsInfo();
    await renderContacts();
    
    // 停止任务栏图标闪烁（用户已查看消息）
    stopMessageBlink();
    
    // 启动消息轮询
    startMessagePolling();
}

function renderChatHeader(contact) {
    const chatHeader = document.getElementById('chatHeader');
    const avatar = contact.avatar ? getAvatarUrl(contact.avatar) : getDefaultAvatarSVG(contact.name);
    const typeText = contact.type === 'group' ? '群聊' : '在线';

    chatHeader.innerHTML = `
        <img src="${avatar}" alt="${escapeHtml(contact.name)}" class="chat-header-avatar" onerror="this.src='${getDefaultAvatarSVG(contact.name)}'">
        <div class="chat-header-info">
            <h3>${escapeHtml(contact.name)}</h3>
            <p>${typeText}</p>
        </div>
        <button class="chat-header-btn" id="chatMenuBtn">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="1"/>
                <circle cx="12" cy="5" r="1"/>
                <circle cx="12" cy="19" r="1"/>
            </svg>
        </button>
    `;

    document.getElementById('chatMenuBtn').addEventListener('click', (e) => {
        window.showContactMenu(e, contact);
    });
}

// 音频格式列表
const AUDIO_EXTENSIONS = ['mp3', 'ogg', 'wav', 'flac', 'aac', 'm4a'];

// 视频格式列表
const VIDEO_EXTENSIONS = ['webm', 'mp4', 'mov', 'ts', 'avi', 'mkv'];

// 图片格式列表
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'];

// 检查消息内容是否是文件链接，并返回文件类型
function isMessageFile(content) {
    if (!content || typeof content !== 'string') {
        return { isFile: false, type: 'other' };
    }
    
    // 移除URL参数（?及其后面的内容）
    const cleanContent = content.split('?')[0];
    
    // 上传文件路径（一定是文件）
    const filePattern = /^uploads\/.*\.[^\.]+$/i;
    
    // 获取文件扩展名
    const extension = cleanContent.split('.').pop().toLowerCase();
    
    // 只有已知的文件扩展名才被认为是文件
    const allFileExtensions = [...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS, ...IMAGE_EXTENSIONS];
    
    // 条件：
    // 1. 如果是 uploads/ 开头的路径，必定是文件
    // 2. 如果是本服务器的HTTP/HTTPS URL，且扩展名是已知文件类型才认为是文件
    // 3. 外部视频链接（如 .mp4, .mov 等）也视为视频文件
    // 4. 其他情况（如普通网页链接）不是文件
    
    if (filePattern.test(cleanContent)) {
        // uploads/ 路径，必定是文件
        if (AUDIO_EXTENSIONS.includes(extension)) {
            return { isFile: true, type: 'audio' };
        } else if (VIDEO_EXTENSIONS.includes(extension)) {
            return { isFile: true, type: 'video' };
        } else if (IMAGE_EXTENSIONS.includes(extension)) {
            return { isFile: true, type: 'image' };
        } else {
            return { isFile: true, type: 'other' };
        }
    } else if (cleanContent.startsWith('http')) {
        // HTTP/HTTPS URL
        const domain = extractDomain(cleanContent);
        const isOwnServer = domain === 'chat.hyacine.com.cn';
        
        if (isOwnServer && allFileExtensions.includes(extension)) {
            // 本服务器的文件URL，且扩展名是已知文件类型
            if (AUDIO_EXTENSIONS.includes(extension)) {
                return { isFile: true, type: 'audio' };
            } else if (VIDEO_EXTENSIONS.includes(extension)) {
                return { isFile: true, type: 'video' };
            } else if (IMAGE_EXTENSIONS.includes(extension)) {
                return { isFile: true, type: 'image' };
            }
        } else if (VIDEO_EXTENSIONS.includes(extension)) {
            // 外部视频链接（如 .mp4, .mov 等）
            return { isFile: true, type: 'video' };
        } else if (AUDIO_EXTENSIONS.includes(extension)) {
            // 外部音频链接（如 .mp3, .ogg, .flac, .wav 等）
            return { isFile: true, type: 'audio' };
        }
    }
    
    // 默认不是文件（普通链接或文本）
    return { isFile: false, type: 'other' };
}

// 从URL中提取域名（去掉http/https和路径）
function extractDomain(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname;
    } catch {
        // 如果URL格式不正确，尝试手动提取
        const match = url.match(/^(?:https?:\/\/)?([^\/:\?]+)/i);
        return match ? match[1] : null;
    }
}

// 从URL中提取干净的文件名（移除查询参数和锚点）
function extractFileName(url) {
    if (!url) return '';
    
    let fileName = '';
    
    try {
        // 优先使用 URL 对象解析
        const urlObj = new URL(url);
        // 移除查询参数
        const pathname = urlObj.pathname;
        // 获取路径最后一部分
        const pathParts = pathname.split('/');
        fileName = pathParts[pathParts.length - 1] || '';
    } catch {
        // 如果URL解析失败，使用手动方法
        // 移除锚点
        let cleanUrl = url.split('#')[0];
        // 移除查询参数
        cleanUrl = cleanUrl.split('?')[0];
        // 获取路径最后一部分
        const pathParts = cleanUrl.split('/');
        fileName = pathParts[pathParts.length - 1] || '';
    }
    
    // 如果文件名是空的或只是目录名，尝试获取前一个部分
    if (!fileName || fileName === '.' || fileName === '..') {
        try {
            const urlObj = new URL(url);
            const pathParts = urlObj.pathname.split('/');
            fileName = pathParts[pathParts.length - 2] || '';
        } catch {
            const cleanUrl = url.split('?')[0].split('#')[0];
            const pathParts = cleanUrl.split('/');
            fileName = pathParts[pathParts.length - 2] || '';
        }
    }
    
    // 确保只保留文件名和扩展名，移除任何剩余的参数
    // 处理可能包含多个问号的情况
    fileName = fileName.split('?')[0].split('#')[0];
    
    return fileName;
}

// 检查URL是否是外部链接（非本域名）
function isExternalLink(url) {
    if (!url || !url.startsWith('http')) return false;
    
    const domain = extractDomain(url);
    if (!domain) return false;
    
    // 本应用的域名
    const allowedDomains = ['chat.hyacine.com.cn', 'localhost', '127.0.0.1'];
    return !allowedDomains.includes(domain.toLowerCase());
}

// 查询ICP备案信息
async function queryICP(domain) {
    try {
        const response = await fetch(`https://uapis.cn/api/v1/network/icp?domain=${encodeURIComponent(domain)}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        console.log('[安全检查] ICP API响应状态:', response.status);
        
        if (response.status === 200) {
            const result = await response.json();
            console.log('[安全检查] ICP API返回:', JSON.stringify(result));
            
            // 获取serviceLicence
            const serviceLicence = result.serviceLicence || result.icp || result.ICP || result.record || '';
            console.log('[安全检查] ICP备案信息(serviceLicence):', serviceLicence);
            
            // 只有当serviceLicence等于"查询失败"时才返回0，其他情况都返回1
            if (serviceLicence === '查询失败') {
                console.log('[安全检查] ICP查询失败，返回0');
                return 0;
            }
            console.log('[安全检查] ICP已备案，返回1');
            return 1;
        }
        console.log('[安全检查] ICP检查失败，返回0');
        return 0;
    } catch (error) {
        console.error('查询ICP失败:', error);
        return 0;
    }
}

// 查询域名安全状态
async function querySafety(domain) {
    try {
        const response = await fetch(`https://uapis.cn/api/v1/network/wxdomain?domain=${encodeURIComponent(domain)}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        console.log('[安全检查] 安全API响应状态:', response.status);
        
        if (response.status === 200) {
            const result = await response.json();
            console.log('[安全检查] 安全API返回:', JSON.stringify(result));
            
            // 获取type
            const type = result.type || result.status || result.result || '';
            console.log('[安全检查] 安全状态(type):', type);
            
            // 只有当type不等于"ok"时才返回0
            if (type !== 'ok') {
                console.log('[安全检查] 安全检查不通过(type !== ok)，返回0');
                return 0;
            }
            console.log('[安全检查] 安全检查通过(type === ok)，返回1');
            return 1;
        }
        console.log('[安全检查] 安全检查失败，返回0');
        return 0;
    } catch (error) {
        console.error('查询安全状态失败:', error);
        return 0;
    }
}

// 创建安全检查弹窗
function createSafetyModal(icp, safety, url) {
    // 移除已存在的弹窗
    const existingModal = document.getElementById('safetyModal');
    if (existingModal) {
        existingModal.remove();
    }
    
    let icon, title, message, buttons;
    
    if (icp === 0 && safety === 0) {
        // 不安全，禁止访问
        icon = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="15" y1="9" x2="9" y2="15"></line>
            <line x1="9" y1="9" x2="15" y2="15"></line>
        </svg>`;
        title = '安全警告';
        message = '该域名不安全！禁止访问！！！';
        buttons = `<button class="modal-btn danger" onclick="closeSafetyModal()">确定</button>`;
    } else if (icp === 0 && safety === 1) {
        // 未备案但安全检查通过
        icon = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="15" x2="12" y2="9"></line>
            <line x1="12" y1="15" x2="14" y2="12"></line>
            <line x1="12" y1="15" x2="10" y2="12"></line>
        </svg>`;
        title = '域名未备案';
        message = '该域名未备案！但是通过安全检查！为了您的安全，请仔细辨别后再确认访问！如因此链接导致的损失我们概不负责';
        buttons = `<button class="modal-btn primary" onclick="confirmExternalLink('${url}'); closeSafetyModal()">确认访问</button>
                   <button class="modal-btn" onclick="closeSafetyModal()">取消</button>`;
    } else if (icp === 1 && safety === 0) {
        // 已备案但不安全
        icon = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="15" x2="12" y2="9"></line>
            <line x1="12" y1="15" x2="14" y2="12"></line>
            <line x1="12" y1="15" x2="10" y2="12"></line>
        </svg>`;
        title = '安全警告';
        message = '该域名已备案，安全性检查为危险，为了您的安全我们不建议您访问该链接！如要继续访问您因为此链接导致的损失我们概不负责';
        buttons = `<button class="modal-btn primary" onclick="confirmExternalLink('${url}'); closeSafetyModal()">确认访问</button>
                   <button class="modal-btn" onclick="closeSafetyModal()">取消</button>`;
    } else {
        // 已备案且安全，直接访问
        confirmExternalLink(url);
        return;
    }
    
    const modal = document.createElement('div');
    modal.id = 'safetyModal';
    modal.className = 'safety-modal';
    modal.innerHTML = `
        <div class="safety-modal-overlay" onclick="closeSafetyModal()"></div>
        <div class="safety-modal-content">
            <div class="safety-icon">${icon}</div>
            <h3 class="safety-title">${title}</h3>
            <p class="safety-message">${message}</p>
            <div class="safety-buttons">${buttons}</div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // 添加样式
    const style = document.createElement('style');
    style.textContent = `
        .safety-modal {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .safety-modal-overlay {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.7);
            backdrop-filter: blur(5px);
        }
        .safety-modal-content {
            position: relative;
            background: linear-gradient(145deg, #ffffff 0%, #f0f2f5 100%);
            border-radius: 16px;
            padding: 32px;
            width: 90%;
            max-width: 450px;
            text-align: center;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(0, 0, 0, 0.1);
        }
        .safety-icon {
            margin-bottom: 20px;
        }
        .safety-title {
            font-size: 20px;
            font-weight: 600;
            color: #1a1a1a;
            margin-bottom: 12px;
        }
        .safety-message {
            font-size: 14px;
            color: #666;
            line-height: 1.6;
            margin-bottom: 24px;
        }
        .safety-buttons {
            display: flex;
            gap: 12px;
            justify-content: center;
        }
        .safety-buttons .modal-btn {
            padding: 10px 28px;
            border-radius: 8px;
            border: none;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s ease;
        }
        .safety-buttons .modal-btn.primary {
            background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
            color: white;
        }
        .safety-buttons .modal-btn.danger {
            background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
            color: white;
        }
        .safety-buttons .modal-btn:not(.primary):not(.danger) {
            background: #e5e7eb;
            color: #374151;
        }
        .safety-buttons .modal-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }
    `;
    document.head.appendChild(style);
}

// 关闭安全弹窗
function closeSafetyModal() {
    const modal = document.getElementById('safetyModal');
    if (modal) {
        modal.remove();
    }
}

// 检查是否是特殊协议链接（需要用系统浏览器打开）
function isSpecialProtocol(url) {
    if (!url) return false;
    try {
        const urlObj = new URL(url);
        const protocol = urlObj.protocol.toLowerCase();
        // 特殊协议列表
        const specialProtocols = [
            'steam:', 'discord:', 'minecraft:', 'spotify:', 'itunes:', 'slack:',
            'teamspeak:', 'zoom:', 'skype:', 'telegram:', 'whatsapp:', 'signal:',
            'viber:', 'wechat:', 'qq:', 'sms:', 'tel:', 'mailto:', 'mailto:',
            'weixin:', 'tg:', 't.me:', 'twitter:', 'fb:', 'facebook:',
            'instagram:', 'tiktok:', 'snapchat:', 'reddit:', 'youtube:',
            'thunder:', 'thunderlink:', 'magnet:', 'ed2k:', 'thunder:',
            'ftp:', 'sftp:', 'ssh:', 'telnet:', 'vnc:', 'rdp:',
            'app:', 'myapp:', 'custom:', 'file:',
            // 其他常见的自定义协议
        ];
        return specialProtocols.some(p => protocol === p);
    } catch (e) {
        // 如果不是标准URL格式，检查是否包含特殊协议前缀
        const protocolMatch = url.match(/^([a-zA-Z0-9]+):\/\//i);
        if (protocolMatch) {
            const protocol = protocolMatch[1].toLowerCase() + ':';
            return [
                'steam:', 'discord:', 'minecraft:', 'spotify:', 'itunes:', 'slack:',
                'teamspeak:', 'zoom:', 'skype:', 'telegram:', 'whatsapp:', 'signal:',
                'viber:', 'wechat:', 'qq:', 'sms:', 'tel:', 'mailto:', 'mailto:',
                'weixin:', 'tg:', 't.me:', 'twitter:', 'fb:', 'facebook:',
                'instagram:', 'tiktok:', 'snapchat:', 'reddit:', 'youtube:',
                'thunder:', 'thunderlink:', 'magnet:', 'ed2k:', 'thunder:',
                'ftp:', 'sftp:', 'ssh:', 'telnet:', 'vnc:', 'rdp:',
                'app:', 'myapp:', 'custom:', 'file:'
            ].some(p => protocol === p);
        }
        return false;
    }
}

// 使用系统浏览器打开特殊协议链接
function openWithSystemBrowser(url) {
    console.log('[链接处理] 打开特殊协议链接:', url);
    if (window.electronAPI && window.electronAPI.shell) {
        console.log('[链接处理] 使用 Electron shell.openExternal 打开链接');
        window.electronAPI.shell.openExternal(url);
    } else {
        console.log('[链接处理] 使用 window.open 打开链接');
        window.open(url, '_blank');
    }
}

// 确认访问外部链接
function confirmExternalLink(url) {
    // 检查是否是特殊协议链接
    if (isSpecialProtocol(url)) {
        console.log('[链接处理] 检测到特殊协议链接，使用系统浏览器打开');
        openWithSystemBrowser(url);
        return;
    }
    
    if (window.electronAPI && window.electronAPI.window && window.electronAPI.window.createWindow) {
        window.electronAPI.window.createWindow({
            width: 1200,
            height: 800,
            resizable: true,
            url: url
        });
    } else {
        window.open(url, '_blank');
    }
}

// 将文本中的链接转换为可点击的链接
function linkifyContent(text) {
    if (!text) return text;
    
    // 使用新的URL匹配逻辑：先匹配特殊协议链接，再匹配普通链接
    // URL匹配正则：匹配各种协议的链接
    const allUrlRegex = /[a-zA-Z0-9]+:\/\/[^\s"'<>]+|(?:https?:\/\/|www\.)[^\s"'<>]+/gi;
    
    // 使用数组收集结果
    const parts = [];
    let lastIndex = 0;
    let match;
    
    // 重置正则表达式的lastIndex
    allUrlRegex.lastIndex = 0;
    
    while ((match = allUrlRegex.exec(text)) !== null) {
        const url = match[0];
        const index = match.index;
        
        // 添加URL之前的普通文本
        if (index > lastIndex) {
            parts.push(escapeHtml(text.slice(lastIndex, index)));
        }
        
        // 处理URL
        let fullUrl = url;
        if (url.startsWith('www.')) {
            fullUrl = 'https://' + url;
        }
        
        // 检查是否是特殊协议链接
        if (isSpecialProtocol(fullUrl)) {
            console.log('[链接处理] 检测到特殊协议链接:', fullUrl);
            // 特殊协议链接直接显示为可点击的链接
            const escapedUrl = escapeHtml(url);
            const escapedFullUrl = escapeHtml(fullUrl);
            parts.push(`<a href="#" onclick="openWithSystemBrowser('${escapedFullUrl}'); return false;" class="message-link" style="display: inline-flex; align-items: center; gap: 4px;">${escapedUrl}<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: inherit; vertical-align: middle;">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
            </svg></a>`);
        } else {
            // 检查是否是文件链接
            const fileInfo = isMessageFile(fullUrl);
            if (fileInfo.isFile) {
                let fileUrl = fullUrl;
                if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://')) {
                    fileUrl = SERVER_BASE_URL + (fullUrl.startsWith('/') ? '' : '/') + fullUrl;
                }
                
                // 文件链接根据类型进行处理
                if (fileInfo.type === 'video') {
                    // 视频文件显示为视频播放器占位符
                    const displayName = extractFileName(url);
                    const videoId = 'video-placeholder-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
                    parts.push(`<div id="${videoId}" class="video-placeholder-container"></div>`);
                    
                    // 延迟初始化视频缩略图
                    setTimeout(() => {
                        const container = document.getElementById(videoId);
                        if (container) {
                            updateVideoPreview(container, fileUrl, displayName);
                        }
                    }, 0);
                } else if (fileInfo.type === 'audio') {
                    // 音频文件显示为音频播放器
                    const displayName = extractFileName(url);
                    const audioId = 'audio-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
                    parts.push(`<div class="audio-player" style="display: flex; align-items: center; gap: 12px; padding: 12px; background: #f5f5f5; border-radius: 8px; max-width: 400px;">
                        <button class="audio-play-btn" style="width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border: none; cursor: pointer; display: flex; align-items: center; justify-content: center;" onclick="toggleAudioPlay(this, '${audioId}')">
                            <svg class="play-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="white">
                                <polygon points="5 3 19 12 5 21 5 3"></polygon>
                            </svg>
                            <svg class="pause-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="white" style="display: none;">
                                <rect x="6" y="4" width="4" height="16"></rect>
                                <rect x="14" y="4" width="4" height="16"></rect>
                            </svg>
                        </button>
                        <div style="flex: 1; display: flex; align-items: center; gap: 12px;">
                            <span class="audio-time" style="font-size: 16px; font-weight: 600; color: #444; min-width: 55px;">0:00</span>
                            <div class="audio-progress-bar" style="flex: 1; height: 8px; background: #e0e0e0; border-radius: 4px; cursor: pointer;">
                                <div class="audio-progress-fill" style="height: 100%; background: linear-gradient(90deg, #6366f1 0%, #8b5cf6 100%); border-radius: 4px; width: 0%; transition: width 0.1s linear;"></div>
                            </div>
                            <span class="audio-duration" style="font-size: 16px; font-weight: 600; color: #444; min-width: 55px; text-align: right;">0:00</span>
                        </div>
                        <div style="font-size: 12px; color: #666; max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(displayName)}</div>
                        <audio id="${audioId}" preload="metadata" src="${escapeHtml(fileUrl)}"></audio>
                        <style>
                            @keyframes wave-animation { 0%, 100% { transform: scaleY(0.5); } 50% { transform: scaleY(1); } }
                            .audio-progress-bar:hover .audio-progress-thumb { opacity: 1; }
                        </style>
                    </div><script>initAudioPlayer('${audioId}');</script>`);
                } else {
                    // 其他文件类型直接显示链接
                    parts.push(escapeHtml(url));
                }
            } else {
                // 普通链接转换为可点击的链接（转义URL防止XSS）
                const escapedUrl = escapeHtml(url);
                const escapedFullUrl = escapeHtml(fullUrl);
                parts.push(`<a href="#" onclick="handleLinkClick('${escapedFullUrl}'); return false;" class="message-link" style="display: inline-flex; align-items: center; gap: 4px;">${escapedUrl}<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: inherit; vertical-align: middle;">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                    <polyline points="15 3 21 3 21 9"/>
                    <line x1="10" y1="14" x2="21" y2="3"/>
                </svg></a>`);
            }
        }
        
        lastIndex = index + url.length;
    }
    
    // 添加剩余的文本
    if (lastIndex < text.length) {
        parts.push(escapeHtml(text.slice(lastIndex)));
    }
    
    return parts.join('');
}

// 点击链接时的安全检查
async function handleLinkClick(url) {
    console.log('[安全检查] 开始检查链接:', url);
    
    // 检查是否是特殊协议链接
    if (isSpecialProtocol(url)) {
        console.log('[链接处理] 检测到特殊协议链接，使用系统浏览器打开');
        openWithSystemBrowser(url);
        return;
    }
    
    if (!isExternalLink(url)) {
        // 内部链接直接打开
        console.log('[安全检查] 内部链接，直接打开');
        confirmExternalLink(url);
        return;
    }
    
    // 显示加载状态
    const loadingModal = document.createElement('div');
    loadingModal.id = 'safetyLoadingModal';
    loadingModal.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 9998;">
            <div style="background: white; padding: 30px; border-radius: 12px; text-align: center;">
                <div style="width: 40px; height: 40px; border: 4px solid #6366f1; border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 15px;"></div>
                <div style="color: #666;">正在检查链接安全...</div>
            </div>
            <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
        </div>
    `;
    document.body.appendChild(loadingModal);
    
    try {
        const domain = extractDomain(url);
        console.log('[安全检查] 提取域名:', domain);
        
        // 并行请求ICP和安全检查
        const [icp, safety] = await Promise.all([
            queryICP(domain),
            querySafety(domain)
        ]);
        
        console.log('[安全检查] 最终结果 - ICP:', icp, 'Safety:', safety);
        
        // 创建安全弹窗
        createSafetyModal(icp, safety, url);
    } catch (error) {
        console.error('[安全检查] 链接检查失败:', error);
        alert('链接安全检查失败，请稍后重试');
    } finally {
        // 移除加载弹窗
        const modal = document.getElementById('safetyLoadingModal');
        if (modal) {
            modal.remove();
        }
    }
}

function canRecallMessage(msg) {
    if (!msg.created_at) return false;
    const msgTime = new Date(msg.created_at);
    const now = new Date();
    const diffMinutes = (now.getTime() - msgTime.getTime()) / (1000 * 60);
    return diffMinutes <= 5;
}

async function recallMessage(messageId, contactType, contactId) {
    const result = await fetchAPI('messages', 'recall', {
        message_id: messageId,
        chat_type: contactType,
        chat_id: contactId
    });
    return result;
}

let messageContextMenu = null;

function closeMessageContextMenu() {
    if (messageContextMenu) {
        document.body.removeChild(messageContextMenu);
        messageContextMenu = null;
    }
}

function showMessageContextMenu(e, msg, contactType, contactId) {
    e.preventDefault();
    
    closeMessageContextMenu();
    
    const isOwn = msg.sender === 'me' || String(msg.sender_id) === String(userInfo?.id);
    const canRecall = isOwn && canRecallMessage(msg);
    
    const menu = document.createElement('div');
    menu.className = 'message-context-menu';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    
    let menuContent = '';
    
    if (canRecall) {
        menuContent += `
            <div class="message-context-menu-item danger" data-action="recall">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                </svg>
                撤回消息
            </div>
        `;
    }
    
    if (!menuContent) {
        menuContent = `
            <div class="message-context-menu-item disabled">
                无法操作此消息
            </div>
        `;
    }
    
    menu.innerHTML = menuContent;
    
    menu.addEventListener('click', async (e) => {
        const action = e.target.closest('[data-action]')?.dataset.action;
        if (action === 'recall') {
            const result = await recallMessage(msg.id, contactType, contactId);
            if (result.success) {
                closeMessageContextMenu();
                if (currentContact && currentContact.originalId === contactId) {
                    await loadMessages(contactId, contactType);
                }
            } else {
                alert(result.message || '撤回失败');
            }
        }
    });
    
    document.body.appendChild(menu);
    messageContextMenu = menu;
}

document.addEventListener('click', closeMessageContextMenu);
document.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('.message-context-menu')) {
        closeMessageContextMenu();
    }
});

function renderMessages(contact) {
    // 使用字符串ID避免类型不匹配
    const stringContactId = String(contact.id);
    const chatMessages = document.getElementById('chatMessages');
    
    console.log(`%c[Chat] ===== 开始渲染消息 =====`, 'color: #ff6b6b; font-weight: bold');
    console.log(`[Chat] 渲染联系人ID: "${stringContactId}"`);
    console.log(`[Chat] 渲染联系人类型: "${contact.type}"`);
    console.log(`[Chat] 当前选中的 currentContact:`, currentContact);
    
    // 验证：确保要渲染的联系人与当前选中的联系人一致
    if (currentContact && String(currentContact.id) !== stringContactId) {
        console.error(`[Chat] ⚠️ 渲染不匹配！要渲染的联系人ID: "${stringContactId}", 当前选中的联系人ID: "${currentContact.id}"`);
        return; // 如果不匹配，不渲染
    }
    
    console.log(`[Chat] messages 对象中该联系人的消息数: ${messages[stringContactId] ? messages[stringContactId].length : 0}`);
    
    // 检查 messages 对象中所有键
    console.log(`[Chat] messages 对象的所有键:`, Object.keys(messages));
    
    const msgs = messages[stringContactId] || [];

    chatMessages.innerHTML = '';

    if (msgs.length === 0) {
        console.log(`[Chat] 该联系人没有消息`);
        chatMessages.innerHTML = '<div style="text-align: center; padding: 40px; color: #888;">暂无消息</div>';
        return;
    }

    console.log(`[Chat] 准备渲染的消息数: ${msgs.length}`);
    if (msgs.length > 0) {
        console.log(`[Chat] 第一条消息(渲染前): id=${msgs[0]?.id}, sender_id=${msgs[0]?.sender_id}, time=${msgs[0]?.created_at}, content=${msgs[0]?.content?.substring(0, 30)}...`);
        console.log(`[Chat] 最后一条消息(渲染前): id=${msgs[msgs.length-1]?.id}, sender_id=${msgs[msgs.length-1]?.sender_id}, time=${msgs[msgs.length-1]?.created_at}, content=${msgs[msgs.length-1]?.content?.substring(0, 30)}...`);
    }

    // 直接使用已排序的数组，不再重新排序（避免重复排序导致问题）
    const sortedMsgs = msgs;

    // 验证排序顺序
    let isSortedCorrectly = true;
    for (let i = 1; i < sortedMsgs.length; i++) {
        const prevTime = new Date(sortedMsgs[i-1].created_at || sortedMsgs[i-1].time);
        const currTime = new Date(sortedMsgs[i].created_at || sortedMsgs[i].time);
        if (!isNaN(prevTime.getTime()) && !isNaN(currTime.getTime()) && prevTime.getTime() > currTime.getTime()) {
            console.error(`[Chat] ⚠️ 排序错误！第${i-1}条消息时间 > 第${i}条消息时间`);
            isSortedCorrectly = false;
        }
    }
    console.log(`[Chat] 排序验证: ${isSortedCorrectly ? '✓ 正确' : '✗ 错误'}`);

    const originalId = contact.id.replace(/^(friend|group)_/, '');

    sortedMsgs.forEach((msg, index) => {
        // 优先使用预计算的 sender 字段，避免重复计算
        const isOwn = msg.sender === 'me' || String(msg.sender_id) === String(userInfo?.id);
        console.log(`[Chat] 渲染消息 #${index}: id=${msg.id}, sender=${msg.sender}, sender_id=${msg.sender_id}, user_id=${userInfo?.id}, isOwn=${isOwn}, time=${msg.created_at}, content=${msg.content?.substring(0, 30)}...`);
        
        const avatar = isOwn ? (userInfo ? getAvatarUrl(userInfo.avatar) || getDefaultAvatarSVG(userInfo.username) : getDefaultAvatarSVG('我')) : (msg.avatar || getDefaultAvatarSVG(msg.name || contact.name));

        const messageEl = document.createElement('div');
        messageEl.className = `message ${isOwn ? 'own' : ''}`;
        messageEl.dataset.msgId = msg.id;

        let content = '';
        if (!isOwn && contact.type === 'group' && msg.name) {
            content = `<div style="font-size: 12px; color: #888; margin-bottom: 4px;">${escapeHtml(msg.name)}</div>`;
        }

        const msgContent = msg.content || '';
        
        // 检查是否是文件：支持uploads/路径或本服务器的文件URL
        const fileInfo = isMessageFile(msgContent);
        console.log('[Chat] 消息内容:', msgContent, 'isFile:', fileInfo.isFile, 'type:', fileInfo.type);
        
        if (fileInfo.isFile) {
            content += renderFileMessage(msgContent, msg.fileName, msg.id, fileInfo.type);
        } else {
            // 将文本中的链接转换为可点击的链接（不需要提前转义，linkifyContent会处理）
            const linkedContent = linkifyContent(msgContent);
            console.log('[Chat] 链接转换结果:', linkedContent);
            content += `<div class="message-bubble">${linkedContent}</div>`;
        }

        messageEl.innerHTML = `
            <img src="${avatar}" alt="" class="message-avatar" onerror="this.src='${getDefaultAvatarSVG(msg.name || contact.name)}'">
            <div class="message-content">
                ${content}
                <div class="message-time">${escapeHtml(msg.time)}</div>
            </div>
        `;

        messageEl.addEventListener('contextmenu', (e) => {
            showMessageContextMenu(e, msg, contact.type, originalId);
        });

        chatMessages.appendChild(messageEl);
    });

    chatMessages.scrollTop = chatMessages.scrollHeight;
    loadFilePreview();
}

function getFileIcon(filename) {
    const extension = filename.split('.').pop().toLowerCase();
    
    if (['jpg', 'jpeg', 'png', 'gif'].includes(extension)) {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
        </svg>`;
    } else if (['mp4', 'avi', 'mov'].includes(extension)) {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>`;
    } else if (extension === 'pdf') {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
        </svg>`;
    } else if (['doc', 'docx'].includes(extension)) {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10 9 9 9 8 9"/>
        </svg>`;
    } else if (['xls', 'xlsx'].includes(extension)) {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <line x1="10" y1="9" x2="8" y2="9"/>
        </svg>`;
    } else if (['zip', 'rar'].includes(extension)) {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
            <line x1="12" y1="22.08" x2="12" y2="12"/>
        </svg>`;
    } else {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
        </svg>`;
    }
}

function renderFileMessage(filename, displayName, messageId, fileType = 'other') {
    const actualFileName = displayName || (filename.includes('/') ? filename.split('/').pop() : filename);
    
    // 根据文件类型显示不同的标签
    let fileLabel = '[文件]';
    if (fileType === 'audio') {
        fileLabel = '[语音]';
    } else if (fileType === 'video') {
        fileLabel = '[视频]';
    } else if (fileType === 'image') {
        fileLabel = '[图片]';
    }
    
    return `
        <div class="message-bubble">
            <div class="file-preview" data-filename="${escapeHtml(filename)}" data-displayname="${escapeHtml(displayName || '')}" data-messageid="${messageId || ''}" data-filetype="${fileType}">
                <div class="file-loading">${fileLabel} - ${escapeHtml(actualFileName)}</div>
            </div>
        </div>
    `;
}

function getFileNotFoundElement(messageId, filename) {
    return `
        <div class="file-not-found" onclick="retryLoadFile('${messageId}', '${filename}')" style="width: 300px; padding: 20px; background: #f5f5f5; border-radius: 4px; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #999; cursor: pointer; transition: all 0.2s ease;">
            <svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #ccc; margin-bottom: 10px;">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="15" y1="9" x2="9" y2="15"></line>
                <line x1="9" y1="9" x2="15" y2="15"></line>
            </svg>
            <div style="font-size: 16px; color: #999;">文件已被清理</div>
            <div style="font-size: 12px; color: #bbb; margin-top: 5px;">点击重新获取</div>
        </div>
    `;
}

async function checkAllUrlsFailed(filename) {
    if (!filename) return false;

    let urlsToCheck = [];

    if (filename.startsWith('http://') || filename.startsWith('https://')) {
        urlsToCheck.push(filename);
    }

    let actualFilename = filename;
    if (filename.includes('/')) {
        const parts = filename.split('/');
        actualFilename = parts[parts.length - 1];
    }

    urlsToCheck.push(`${SERVER_BASE_URL}/uploads/${actualFilename}`);
    urlsToCheck.push(`${SERVER_BASE_URL}/${actualFilename}`);

    for (const url of urlsToCheck) {
        // 优先检查本地缓存是否存在该文件
        const cachedFile = await getCachedFile(url);
        if (cachedFile) {
            console.log('[Chat] 本地缓存存在该文件，不会显示文件已清理:', url);
            return false;
        }

        const hasFailed = await isFileFailed(url);
        if (!hasFailed) {
            return false;
        }
    }

    return urlsToCheck.length > 0;
}

async function loadFilePreview() {
    const previews = document.querySelectorAll('.file-preview');

    for (const preview of previews) {
        if (preview.querySelector('.file-loading')) {
            const filename = preview.dataset.filename;
            const displayName = preview.dataset.displayname || extractFileName(filename);
            const messageId = preview.dataset.messageid || Date.now() + '-' + Math.random().toString(36).substr(2, 9);
            console.log('正在加载文件:', filename, '显示名称:', displayName, '消息ID:', messageId);

            const cleanFilename = filename.split('?')[0];
            const extension = cleanFilename.split('.').pop().toLowerCase();
            
            const isImage = IMAGE_EXTENSIONS.includes(extension);
            const isVideo = VIDEO_EXTENSIONS.includes(extension);
            const isAudio = AUDIO_EXTENSIONS.includes(extension);

            let urlsToCheck = [];
            if (filename.startsWith('http://') || filename.startsWith('https://')) {
                urlsToCheck.push(filename);
            }

            let actualFilename = filename;
            if (filename.includes('/')) {
                const parts = filename.split('/');
                actualFilename = parts[parts.length - 1];
            }

            urlsToCheck.push(`${SERVER_BASE_URL}/uploads/${actualFilename}`);
            urlsToCheck.push(`${SERVER_BASE_URL}/${actualFilename}`);

            let foundCachedFile = null;
            let validUrl = null;

            for (const url of urlsToCheck) {
                const cachedFile = await getCachedFile(url);
                if (cachedFile) {
                    console.log('[Chat] 发现本地缓存文件:', url);
                    foundCachedFile = cachedFile;
                    validUrl = url;
                    break;
                }
            }

            if (!foundCachedFile && !validUrl) {
                for (const url of urlsToCheck) {
                    const hasFailed = await isFileFailed(url);
                    if (!hasFailed) {
                        const result = await checkFileExists(url);
                        if (result.exists) {
                            validUrl = url;
                            break;
                        } else if (result.status === 404 || result.status === 403) {
                            console.log(`[Chat] 文件返回${result.status}，记录失败:`, url);
                            await recordFailedFile(url);
                        }
                    }
                }
            }

            if (foundCachedFile || validUrl) {
                console.log('[Chat] 文件加载成功，使用URL:', validUrl);

                if (isImage) {
                    if (foundCachedFile) {
                        preview.innerHTML = `<div style="position: relative; display: inline-block;">
                            <img src="${foundCachedFile.data}" alt="${escapeHtml(displayName)}" style="max-width: 300px; max-height: 300px; border-radius: 4px; cursor: pointer;" onclick="openImageViewer('${validUrl}', '${escapeHtml(displayName)}')">
                            <button class="download-btn" onclick="downloadFile('${validUrl}', '${escapeHtml(displayName)}')" style="position: absolute; top: 8px; right: 8px; display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; background: linear-gradient(135deg, #3498db 0%, #2980b9 100%); color: white; border: none; border-radius: 8px; cursor: pointer; transition: all 0.2s ease; box-shadow: 0 2px 4px rgba(52, 152, 219, 0.3);">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                    <polyline points="7 10 12 15 17 10"/>
                                    <line x1="12" y1="15" x2="12" y2="3"/>
                                </svg>
                            </button>
                        </div>`;
                    } else {
                        preview.innerHTML = `
                            <div style="width: 300px; padding: 20px; background: #f5f5f5; border-radius: 8px;">
                                <div style="text-align: center; color: #666; margin-bottom: 15px;">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#667eea" stroke-width="2">
                                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                        <circle cx="8.5" cy="8.5" r="1.5"/>
                                        <polyline points="21 15 16 10 5 21"/>
                                    </svg>
                                </div>
                                <div style="font-size: 14px; color: #666; text-align: center; margin-bottom: 10px;">正在下载图片...</div>
                                <div class="layui-progress layui-progress-big" lay-showpercent="true">
                                    <div class="layui-progress-bar layui-bg-blue" id="progress-${messageId}" style="width: 0%;"></div>
                                </div>
                            </div>
                        `;
                        
                        downloadAndCacheFile(validUrl, 'image', (progress) => {
                            const progressBar = document.getElementById(`progress-${messageId}`);
                            if (progressBar) {
                                progressBar.style.width = `${Math.round(progress * 100)}%`;
                                progressBar.textContent = `${Math.round(progress * 100)}%`;
                            }
                        }, (dataUrl) => {
                            preview.innerHTML = `<div style="position: relative; display: inline-block;">
                                <img src="${dataUrl}" alt="${escapeHtml(displayName)}" style="max-width: 300px; max-height: 300px; border-radius: 4px; cursor: pointer;" onclick="openImageViewer('${validUrl}', '${escapeHtml(displayName)}')">
                                <button class="download-btn" onclick="downloadFile('${validUrl}', '${escapeHtml(displayName)}')" style="position: absolute; top: 8px; right: 8px; display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; background: linear-gradient(135deg, #3498db 0%, #2980b9 100%); color: white; border: none; border-radius: 8px; cursor: pointer; transition: all 0.2s ease; box-shadow: 0 2px 4px rgba(52, 152, 219, 0.3);">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                        <polyline points="7 10 12 15 17 10"/>
                                        <line x1="12" y1="15" x2="12" y2="3"/>
                                    </svg>
                                </button>
                            </div>`;
                        });
                    }
                } else if (isVideo) {
                    updateVideoPreview(preview, validUrl, displayName);
                } else if (isAudio) {
                    const audioUrl = foundCachedFile ? foundCachedFile.data : validUrl;
                    
                    if (!foundCachedFile && validUrl) {
                        downloadAndCacheFile(validUrl, 'audio');
                    }
                    
                    const audioDisplayName = displayName || filename.split('/').pop();
                    preview.innerHTML = `<div class="audio-player" style="width: 400px; background: linear-gradient(145deg, #ffffff 0%, #f0f2f5 100%); border-radius: 20px; padding: 22px; display: flex; flex-direction: column; gap: 20px; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.1); border: 1px solid rgba(0, 0, 0, 0.08);">
                        <div style="display: flex; align-items: center; gap: 14px;">
                            <div class="audio-wave" style="display: flex; align-items: center; justify-content: center; width: 52px; height: 52px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 14px; color: white; box-shadow: 0 6px 20px rgba(99, 102, 241, 0.4); overflow: hidden; position: relative;">
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                                    <path d="M19 12v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-8"></path>
                                </svg>
                                <div class="wave-bars" style="position: absolute; bottom: 0; left: 0; right: 0; height: 100%; display: flex; align-items: flex-end; justify-content: center; gap: 2px; padding: 8px; opacity: 0.3;">
                                    <div style="width: 3px; background: white; border-radius: 2px; animation: wave 0.8s ease-in-out infinite; animation-delay: 0s; height: 30%;"></div>
                                    <div style="width: 3px; background: white; border-radius: 2px; animation: wave 0.8s ease-in-out infinite; animation-delay: 0.1s; height: 60%;"></div>
                                    <div style="width: 3px; background: white; border-radius: 2px; animation: wave 0.8s ease-in-out infinite; animation-delay: 0.2s; height: 40%;"></div>
                                    <div style="width: 3px; background: white; border-radius: 2px; animation: wave 0.8s ease-in-out infinite; animation-delay: 0.3s; height: 80%;"></div>
                                    <div style="width: 3px; background: white; border-radius: 2px; animation: wave 0.8s ease-in-out infinite; animation-delay: 0.4s; height: 50%;"></div>
                                </div>
                            </div>
                            <div style="flex: 1; min-width: 0;">
                                <div style="font-size: 14px; font-weight: 600; margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #1a1a1a;">${escapeHtml(audioDisplayName)}</div>
                                <div style="font-size: 12px; color: #8a8a8a;">语音消息</div>
                            </div>
                            <button class="download-btn" onclick="downloadFile('${validUrl}', '${escapeHtml(audioDisplayName)}')" style="display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; background: linear-gradient(135deg, #f0f2f5 0%, #e5e7eb 100%); color: #4a4a4a; border: none; border-radius: 10px; cursor: pointer; transition: all 0.25s ease; hover:background: #e5e7eb; hover:transform: scale(1.05); hover:box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                    <polyline points="7 10 12 15 17 10"/>
                                    <line x1="12" y1="15" x2="12" y2="3"/>
                                </svg>
                            </button>
                        </div>
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <button class="audio-play-btn" onclick="toggleAudioPlay(this, 'audio-${messageId}')" style="display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; border: none; border-radius: 10px; cursor: pointer; transition: all 0.25s ease; box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4); hover:transform: scale(1.08);">
                                <svg class="play-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                                </svg>
                                <svg class="pause-icon" style="display: none;" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                    <rect x="6" y="4" width="4" height="16"></rect>
                                    <rect x="14" y="4" width="4" height="16"></rect>
                                </svg>
                            </button>
                            <div style="flex: 1; display: flex; align-items: center; gap: 12px;">
                                <span class="audio-time" style="font-size: 16px; font-weight: 600; color: #444; min-width: 55px;">0:00</span>
                                <div class="audio-progress-bar" style="flex: 1; height: 8px; background: #e0e0e0; border-radius: 4px; cursor: pointer;">
                                    <div class="audio-progress-fill" style="height: 100%; background: linear-gradient(90deg, #6366f1 0%, #8b5cf6 100%); border-radius: 4px; width: 0%; transition: width 0.1s linear;"></div>
                                </div>
                                <span class="audio-duration" style="font-size: 16px; font-weight: 600; color: #444; min-width: 55px; text-align: right;">0:00</span>
                            </div>
                            <button class="audio-volume-btn" onclick="toggleVolumeControl('volume-${messageId}')" style="display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; background: transparent; color: #888; border: none; border-radius: 8px; cursor: pointer; transition: all 0.2s ease; hover:background: #e8e8e8; hover:color: #444;">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
                                </svg>
                            </button>
                            <div id="volume-${messageId}" class="audio-volume-control" style="display: none; position: absolute; right: 0; bottom: 50px; flex-direction: column; align-items: center; gap: 8px; padding: 12px; background: white; border-radius: 8px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15); z-index: 10;">
                                <input type="range" min="0" max="100" value="80" class="volume-slider" oninput="setAudioVolume('audio-${messageId}', this.value)" style="width: 80px; height: 6px; -webkit-appearance: none; appearance: none; background: #d1d5db; border-radius: 3px; cursor: pointer;">
                            </div>
                            <button class="audio-loop-btn" onclick="toggleAudioLoop('audio-${messageId}', this)" title="循环播放" style="display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; background: transparent; color: #888; border: none; border-radius: 8px; cursor: pointer; transition: all 0.2s ease; hover:background: #e8e8e8; hover:color: #444;">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="1 4 1 10 7 10"></polyline>
                                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
                                </svg>
                            </button>
                        </div>
                        <audio id="audio-${messageId}" src="${audioUrl}" preload="metadata" style="display: none;">
                        <style>
                            @keyframes wave {
                                0%, 100% { transform: scaleY(0.5); }
                                50% { transform: scaleY(1); }
                            }
                            .audio-progress-bar:hover .audio-progress-thumb { opacity: 1; }
                            .volume-slider::-webkit-slider-thumb {
                                -webkit-appearance: none;
                                width: 10px;
                                height: 10px;
                                background: #6366f1;
                                border-radius: 50%;
                                cursor: pointer;
                            }
                            .audio-play-btn.active {
                                background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%) !important;
                            }
                        </style>
                        </div>
                    </div>`;
                    
                    setTimeout(() => {
                        initAudioPlayer('audio-' + messageId);
                    }, 50);
                } else {
                    const fileIcon = getFileIcon(filename);
                    const displayName = filename.split('/').pop();
                    preview.innerHTML = `<div class="file-info" style="display: flex; align-items: center; gap: 12px; padding: 12px; background: #f5f5f5; border-radius: 8px;">
                        <div class="file-icon" style="display: flex; align-items: center; justify-content: center; width: 48px; height: 48px; background: #e8e8e8; border-radius: 4px;">
                            ${fileIcon}
                        </div>
                        <div style="flex: 1; min-width: 0;">
                            <div style="font-size: 14px; font-weight: 500; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(displayName)}</div>
                            <div style="font-size: 12px; color: #888;">点击下载</div>
                        </div>
                        <button class="download-btn" onclick="downloadFile('${validUrl}', '${escapeHtml(displayName)}')" style="display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; background: linear-gradient(135deg, #3498db 0%, #2980b9 100%); color: white; border: none; border-radius: 8px; cursor: pointer; transition: all 0.2s ease; box-shadow: 0 2px 4px rgba(52, 152, 219, 0.3);">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="7 10 12 15 17 10"/>
                                <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                        </button>
                    </div>`;
                }
            } else {
                await recordFailedUrls(urlsToCheck);
                preview.innerHTML = getFileNotFoundElement(messageId, filename);
            }
        }
    }
}

async function retryLoadFile(messageId, filename) {
    const maxRetries = 5;
    let currentRetry = 0;
    const previews = document.querySelectorAll('.file-preview');
    let previewElement = null;
    
    for (const preview of previews) {
        if (preview.dataset.messageid === messageId || preview.querySelector('.file-not-found')) {
            previewElement = preview;
            break;
        }
    }
    
    if (!previewElement) {
        console.error('[Chat] 未找到预览元素');
        return;
    }
    
    const retry = async () => {
        currentRetry++;
        console.log(`[Chat] 重试加载文件: ${filename}, 第 ${currentRetry}/${maxRetries} 次`);
        
        previewElement.innerHTML = `
            <div class="file-not-found" style="width: 300px; padding: 20px; background: #f5f5f5; border-radius: 4px; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #999;">
                <svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #3498db; margin-bottom: 10px; animation: spin 1s linear infinite;">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
                <div style="font-size: 16px; color: #666; margin-bottom: 5px;">正在重试...</div>
                <div style="font-size: 14px; color: #999;">重试次数: ${currentRetry}/${maxRetries}</div>
            </div>
            <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
        `;
        
        let urlsToCheck = [];
        if (filename.startsWith('http://') || filename.startsWith('https://')) {
            urlsToCheck.push(filename);
        }
        
        let actualFilename = filename;
        if (filename.includes('/')) {
            const parts = filename.split('/');
            actualFilename = parts[parts.length - 1];
        }
        
        urlsToCheck.push(`${SERVER_BASE_URL}/uploads/${actualFilename}`);
        urlsToCheck.push(`${SERVER_BASE_URL}/${actualFilename}`);
        
        let foundCachedFile = null;
        let validUrl = null;
        
        for (const url of urlsToCheck) {
            const cachedFile = await getCachedFile(url);
            if (cachedFile) {
                console.log('[Chat] 发现本地缓存文件:', url);
                foundCachedFile = cachedFile;
                validUrl = url;
                break;
            }
        }
        
        if (!foundCachedFile && !validUrl) {
            for (const url of urlsToCheck) {
                const result = await checkFileExists(url);
                if (result.exists) {
                    validUrl = url;
                    break;
                }
            }
        }
        
        if (foundCachedFile || validUrl) {
            console.log('[Chat] 文件重试加载成功，使用URL:', validUrl);
            await clearFailedUrls(urlsToCheck);
            
            const cleanFilename = filename.split('?')[0];
            const extension = cleanFilename.split('.').pop().toLowerCase();
            const displayName = filename.split('/').pop();
            const isImage = IMAGE_EXTENSIONS.includes(extension);
            const isVideo = VIDEO_EXTENSIONS.includes(extension);
            const isAudio = AUDIO_EXTENSIONS.includes(extension);
            
            if (isImage) {
                if (foundCachedFile) {
                    previewElement.innerHTML = `<div style="position: relative; display: inline-block;">
                        <img src="${foundCachedFile.data}" alt="${escapeHtml(displayName)}" style="max-width: 300px; max-height: 300px; border-radius: 4px; cursor: pointer;" onclick="openImageViewer('${validUrl}', '${escapeHtml(displayName)}')">
                        <button class="download-btn" onclick="downloadFile('${validUrl}', '${escapeHtml(displayName)}')" style="position: absolute; top: 8px; right: 8px; display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; background: linear-gradient(135deg, #3498db 0%, #2980b9 100%); color: white; border: none; border-radius: 8px; cursor: pointer; transition: all 0.2s ease; box-shadow: 0 2px 4px rgba(52, 152, 219, 0.3);">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="7 10 12 15 17 10"/>
                                <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                        </button>
                    </div>`;
                } else {
                    previewElement.innerHTML = `
                        <div style="width: 300px; padding: 20px; background: #f5f5f5; border-radius: 8px;">
                            <div style="text-align: center; color: #666; margin-bottom: 15px;">
                                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#667eea" stroke-width="2">
                                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                    <circle cx="8.5" cy="8.5" r="1.5"/>
                                    <polyline points="21 15 16 10 5 21"/>
                                </svg>
                            </div>
                            <div style="font-size: 14px; color: #666; text-align: center; margin-bottom: 10px;">正在下载图片...</div>
                            <div class="layui-progress layui-progress-big" lay-showpercent="true">
                                <div class="layui-progress-bar layui-bg-blue" id="progress-${messageId}" style="width: 0%;"></div>
                            </div>
                        </div>
                    `;
                    
                    downloadAndCacheFile(validUrl, 'image', (progress) => {
                        const progressBar = document.getElementById(`progress-${messageId}`);
                        if (progressBar) {
                            progressBar.style.width = `${Math.round(progress * 100)}%`;
                            progressBar.textContent = `${Math.round(progress * 100)}%`;
                        }
                    }, (dataUrl) => {
                        previewElement.innerHTML = `<div style="position: relative; display: inline-block;">
                            <img src="${dataUrl}" alt="${escapeHtml(displayName)}" style="max-width: 300px; max-height: 300px; border-radius: 4px; cursor: pointer;" onclick="openImageViewer('${validUrl}', '${escapeHtml(displayName)}')">
                            <button class="download-btn" onclick="downloadFile('${validUrl}', '${escapeHtml(displayName)}')" style="position: absolute; top: 8px; right: 8px; display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; background: linear-gradient(135deg, #3498db 0%, #2980b9 100%); color: white; border: none; border-radius: 8px; cursor: pointer; transition: all 0.2s ease; box-shadow: 0 2px 4px rgba(52, 152, 219, 0.3);">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                    <polyline points="7 10 12 15 17 10"/>
                                    <line x1="12" y1="15" x2="12" y2="3"/>
                                </svg>
                            </button>
                        </div>`;
                    });
                }
            } else if (isVideo) {
                updateVideoPreview(previewElement, validUrl, displayName);
            } else if (isAudio) {
                const audioUrl = foundCachedFile ? foundCachedFile.data : validUrl;
                previewElement.innerHTML = `<div class="audio-message" style="display: flex; flex-direction: column; gap: 10px; padding: 15px; background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border-radius: 12px; max-width: 350px;">
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <div style="display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 10px;">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
                                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
                                </svg>
                            </div>
                            <div style="flex: 1; min-width: 0;">
                                <div style="font-size: 14px; font-weight: 500; color: #333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(displayName)}</div>
                            </div>
                        </div>
                        <button class="download-btn" onclick="downloadFile('${validUrl}', '${escapeHtml(displayName)}')" style="display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; background: linear-gradient(135deg, #3498db 0%, #2980b9 100%); color: white; border: none; border-radius: 8px; cursor: pointer; transition: all 0.2s ease; box-shadow: 0 2px 4px rgba(52, 152, 219, 0.3);">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="7 10 12 15 17 10"/>
                                <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                        </button>
                    </div>
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <button class="audio-play-btn" onclick="toggleAudioPlay(this, 'audio-${messageId}')" style="display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; border: none; border-radius: 10px; cursor: pointer; transition: all 0.25s ease; box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4); hover:transform: scale(1.08);">
                            <svg class="play-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                <polygon points="5 3 19 12 5 21 5 3"></polygon>
                            </svg>
                            <svg class="pause-icon" style="display: none;" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                <rect x="6" y="4" width="4" height="16"></rect>
                                <rect x="14" y="4" width="4" height="16"></rect>
                            </svg>
                        </button>
                        <div style="flex: 1; display: flex; align-items: center; gap: 12px;">
                            <span class="audio-time" style="font-size: 16px; font-weight: 600; color: #444; min-width: 55px;">0:00</span>
                            <div class="audio-progress-bar" style="flex: 1; height: 8px; background: #e0e0e0; border-radius: 4px; cursor: pointer;">
                                <div class="audio-progress-fill" style="height: 100%; background: linear-gradient(90deg, #6366f1 0%, #8b5cf6 100%); border-radius: 4px; width: 0%; transition: width 0.1s linear;"></div>
                            </div>
                            <span class="audio-duration" style="font-size: 16px; font-weight: 600; color: #444; min-width: 55px; text-align: right;">0:00</span>
                        </div>
                        <button class="audio-volume-btn" onclick="toggleVolumeControl('volume-${messageId}')" style="display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; background: transparent; color: #888; border: none; border-radius: 8px; cursor: pointer; transition: all 0.2s ease; hover:background: #e8e8e8; hover:color: #444;">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                                <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                                <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
                            </svg>
                        </button>
                        <div id="volume-${messageId}" class="audio-volume-control" style="display: none; position: absolute; right: 0; bottom: 50px; flex-direction: column; align-items: center; gap: 8px; padding: 12px; background: white; border-radius: 8px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15); z-index: 10;">
                            <input type="range" min="0" max="100" value="80" class="volume-slider" oninput="setAudioVolume('audio-${messageId}', this.value)" style="width: 80px; height: 6px; -webkit-appearance: none; appearance: none; background: #d1d5db; border-radius: 3px; cursor: pointer;">
                        </div>
                        <button class="audio-loop-btn" onclick="toggleAudioLoop('audio-${messageId}', this)" title="循环播放" style="display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; background: transparent; color: #888; border: none; border-radius: 8px; cursor: pointer; transition: all 0.2s ease; hover:background: #e8e8e8; hover:color: #444;">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="1 4 1 10 7 10"></polyline>
                                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
                            </svg>
                        </button>
                    </div>
                    <audio id="audio-${messageId}" src="${audioUrl}" preload="metadata" style="display: none;">
                    <style>
                        @keyframes wave {
                            0%, 100% { transform: scaleY(0.5); }
                            50% { transform: scaleY(1); }
                        }
                        .audio-progress-bar:hover .audio-progress-thumb { opacity: 1; }
                        .volume-slider::-webkit-slider-thumb {
                            -webkit-appearance: none;
                            width: 10px;
                            height: 10px;
                            background: #6366f1;
                            border-radius: 50%;
                            cursor: pointer;
                        }
                        .audio-play-btn.active {
                            background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%) !important;
                        }
                    </style>
                    </div>
                </div>`;
                
                setTimeout(() => {
                    initAudioPlayer('audio-' + messageId);
                }, 50);
            } else {
                const fileIcon = getFileIcon(filename);
                previewElement.innerHTML = `<div class="file-info" style="display: flex; align-items: center; gap: 12px; padding: 12px; background: #f5f5f5; border-radius: 8px;">
                    <div class="file-icon" style="display: flex; align-items: center; justify-content: center; width: 48px; height: 48px; background: #e8e8e8; border-radius: 4px;">
                        ${fileIcon}
                    </div>
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-size: 14px; font-weight: 500; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(displayName)}</div>
                        <div style="font-size: 12px; color: #888;">点击下载</div>
                    </div>
                    <button class="download-btn" onclick="downloadFile('${validUrl}', '${escapeHtml(displayName)}')" style="display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; background: linear-gradient(135deg, #3498db 0%, #2980b9 100%); color: white; border: none; border-radius: 8px; cursor: pointer; transition: all 0.2s ease; box-shadow: 0 2px 4px rgba(52, 152, 219, 0.3);">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                    </button>
                </div>`;
            }
        } else if (currentRetry < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            await retry();
        } else {
            console.log(`[Chat] 文件重试 ${maxRetries} 次后仍无法获取:`, filename);
            previewElement.innerHTML = `
                <div class="file-not-found" style="width: 300px; padding: 20px; background: #f5f5f5; border-radius: 4px; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #999;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #ccc; margin-bottom: 10px;">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="15" y1="9" x2="9" y2="15"></line>
                        <line x1="9" y1="9" x2="15" y2="15"></line>
                    </svg>
                    <div style="font-size: 16px; color: #999; margin-bottom: 15px;">文件已被清理</div>
                    <div style="font-size: 12px; color: #bbb;">已重试 ${maxRetries} 次，无法获取</div>
                </div>
            `;
        }
    };
    
    await retry();
}

async function downloadFile(url, filename) {
    try {
        const fileName = filename.split('/').pop();
        
        const cachedFile = await getCachedFile(url);
        
        if (cachedFile) {
            console.log('[Chat] 从本地缓存下载:', url);
            const blob = await fetch(cachedFile.data).then(res => res.blob());
            await saveBlobToFile(blob, fileName);
        } else {
            console.log('[Chat] 缓存中不存在，从网络下载:', url);
            showDownloadProgress();
            const blob = await downloadWithProgress(url);
            hideDownloadProgress();
            await saveBlobToFile(blob, fileName);
        }
    } catch (error) {
        hideDownloadProgress();
        console.error('[Chat] 下载文件失败:', error);
        alert('下载文件失败: ' + error.message);
    }
}

function showDownloadProgress() {
    const progressHtml = `
        <div id="downloadProgressOverlay" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); z-index: 9999; display: flex; flex-direction: column; align-items: center; justify-content: center;">
            <h3 style="margin-bottom: 20px; color: #fff; font-size: 18px;">正在下载文件...</h3>
            <div style="width: 80%; max-width: 400px;">
                <div class="layui-progress layui-progress-big" lay-showPercent="yes">
                    <div class="layui-progress-bar layui-bg-blue" id="downloadProgressBar" style="width: 0%;"></div>
                </div>
            </div>
            <div id="downloadStatus" style="margin-top: 10px; color: #fff; font-size: 14px;">0%</div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', progressHtml);
    
    if (window.layui) {
        layui.use('element', function(){
            var element = layui.element;
            element.render('progress');
        });
    }
}

function hideDownloadProgress() {
    const overlay = document.getElementById('downloadProgressOverlay');
    if (overlay) {
        overlay.remove();
    }
}

function downloadWithProgress(url) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'blob';
        
        xhr.onprogress = (event) => {
            if (event.lengthComputable) {
                const percent = Math.round((event.loaded / event.total) * 100);
                const progressBar = document.getElementById('downloadProgressBar');
                const status = document.getElementById('downloadStatus');
                if (progressBar) {
                    progressBar.style.width = percent + '%';
                    if (window.layui) {
                        layui.use('element', function(){
                            var element = layui.element;
                            element.render('progress');
                        });
                    }
                }
                if (status) {
                    status.textContent = `${percent}%`;
                }
            }
        };
        
        xhr.onload = () => {
            if (xhr.status === 200) {
                resolve(xhr.response);
            } else {
                reject(new Error(`下载失败，状态码: ${xhr.status}`));
            }
        };
        
        xhr.onerror = () => {
            reject(new Error('下载失败，网络错误'));
        };
        
        xhr.send();
    });
}

async function saveBlobToFile(blob, filename) {
    if (window.electronAPI && window.electronAPI.fs && window.electronAPI.fs.saveFile) {
        const buffer = await blob.arrayBuffer();
        const result = await window.electronAPI.fs.saveFile(buffer, filename);
        if (result.success) {
            alert('文件已保存到: ' + result.path);
        } else {
            alert('保存失败: ' + result.message);
        }
    } else {
        const link = document.createElement('a');
        link.download = filename;
        link.href = URL.createObjectURL(blob);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    }
}

function openVideoPlayer(url, filename) {
    if (window.electronAPI && window.electronAPI.window && window.electronAPI.window.createWindow) {
        // 使用 Electron API 创建窗口
        const webDir = window.electronAPI.__dirname;
        window.electronAPI.window.createWindow({
            width: 1000,
            height: 600,
            resizable: true,
            scrollable: true,
            url: 'file://' + webDir + '/video-player.html?url=' + encodeURIComponent(url) + '&name=' + encodeURIComponent(filename)
        });
    } else {
        // 降级方案：使用普通的 window.open
        const width = 1000;
        const height = 600;
        const left = (window.screen.width - width) / 2;
        const top = (window.screen.height - height) / 2;
        const features = `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`;
        window.open(`video-player.html?url=${encodeURIComponent(url)}&name=${encodeURIComponent(filename)}`, '_blank', features);
    }
}

function openImageViewer(url, filename) {
    if (window.electronAPI && window.electronAPI.window && window.electronAPI.window.createWindow) {
        // 使用 Electron API 创建窗口
        const webDir = window.electronAPI.__dirname;
        window.electronAPI.window.createWindow({
            width: 800,
            height: 600,
            resizable: true,
            scrollable: true,
            url: 'file://' + webDir + '/image-viewer.html?url=' + encodeURIComponent(url) + '&name=' + encodeURIComponent(filename)
        });
    } else {
        // 降级方案：使用普通的 window.open
        const width = 800;
        const height = 600;
        const left = (window.screen.width - width) / 2;
        const top = (window.screen.height - height) / 2;
        const features = `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`;
        window.open(`image-viewer.html?url=${encodeURIComponent(url)}&name=${encodeURIComponent(filename)}`, '_blank', features);
    }
}

async function sendMessage() {
    const input = document.getElementById('messageInput');
    const content = input.value.trim();

    if (!currentContact) return;

    if (pendingImages.length > 0) {
        const fileList = await uploadImagesWithProgress();
        
        for (const fileInfo of fileList) {
            if (currentContact.type === 'friend') {
                await fetchAPI('messages', 'send_file', {
                    receiver_id: currentContact.originalId,
                    ...fileInfo
                });
            } else {
                await fetchAPI('groups', 'send_file', {
                    group_id: currentContact.originalId,
                    ...fileInfo
                });
            }
        }
        
        pendingImages = [];
        updateImagePreview();
    }

    if (content) {
        await sendMessageToContact(content, currentContact.originalId, currentContact.type);
        input.value = '';
        // 发送消息后设置任务栏消息图标
        setMessageIcon();
    }
    
    await loadMessages(currentContact.originalId, currentContact.type);
    await loadSessionsInfo();
    await renderContacts();
}

document.querySelectorAll('.nav-bar .nav-item[data-tab]').forEach(item => {
    item.addEventListener('click', async () => {
        await switchTab(item.dataset.tab);
    });
});

document.querySelectorAll('.nav-bar .nav-item[data-mode]').forEach((item) => {
    item.addEventListener('click', async (e) => {
        e.stopPropagation();
        const mode = item.dataset.mode;
        if (mode === 'search') {
            openSearchModal();
        } else if (mode === 'audit') {
            const gid = currentContact && currentContact.type === 'group' ? currentContact.originalId : null;
            await openAuditModal(gid);
        }
    });
});

document.getElementById('sendBtn').addEventListener('click', async () => {
    await sendMessage();
});
document.getElementById('messageInput').addEventListener('keydown', async function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        await sendMessage();
    }
});

// 录音按钮
document.getElementById('audioBtn').addEventListener('click', () => {
    startRecording();
});

// 截图按钮
document.getElementById('cameraBtn').addEventListener('click', () => {
    takeScreenshot();
});

// 文件上传按钮
document.getElementById('uploadBtn').addEventListener('click', () => {
    uploadFile();
});

// 本地快捷键 Ctrl+Alt+D 截图（当窗口有焦点时）
document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.altKey && event.key === 'd') {
        event.preventDefault();
        console.log('[Chat] 本地快捷键 Ctrl+Alt+D 触发截图');
        takeScreenshot();
    }
});

// 监听截图完成事件（通过 window.postMessage）
window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'screenshot-done') {
        console.log('[Chat] 收到截图完成消息');
        handleScreenshotComplete(event.data.dataUrl);
    }
});

// 定期检查 localStorage 中的截图数据（只处理一次）
setInterval(() => {
    const screenshotReady = localStorage.getItem('screenshot_ready');
    if (screenshotReady === 'true') {
        const dataUrl = localStorage.getItem('screenshot_data');
        // 检查是否有防止重复处理的标志
        const hasProcessed = localStorage.getItem('screenshot_processed');
        if (dataUrl && !hasProcessed) {
            console.log('[Chat] 从 localStorage 获取截图数据');
            // 先设置处理标志，防止重复处理
            localStorage.setItem('screenshot_processed', 'true');
            // 先清除ready标志，防止定时器再次触发
            localStorage.removeItem('screenshot_ready');
            
            handleScreenshotComplete(dataUrl);
            
            // 清理所有相关数据
            localStorage.removeItem('screenshot_data');
            localStorage.removeItem('screenshot_processed');
        }
    }
}, 500);

// 监听主进程发送的全局截图事件（保留旧的监听方式）
if (window.electronAPI && window.electronAPI.screenshot) {
    window.electronAPI.screenshot.onTrigger(() => {
        console.log('[Chat] 收到主进程的全局截图事件');
        takeScreenshot();
    });
}

// 等待 DOM 加载完成
window.addEventListener('DOMContentLoaded', async () => {
    // 初始化提示音播放器
    initNotificationAudio();
    console.log('[Chat] 提示音播放器初始化完成');
    
    // 初始化 IndexedDB
    try {
        await initIndexedDB();
        console.log('[Chat] IndexedDB 初始化完成');
    } catch (error) {
        console.error('[Chat] IndexedDB 初始化失败:', error);
    }
    
    // 加载最后消息时间记录
    loadLastMessageTimes();
    
    // 启动全局消息轮询（无论是否选择联系人都能接收消息）
    startMessagePolling();
    
    // 搜索输入事件
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', function(e) {
            const keyword = e.target.value.toLowerCase();
            document.querySelectorAll('.contact-item').forEach(item => {
                const name = item.querySelector('.contact-name').textContent.toLowerCase();
                item.style.display = name.includes(keyword) ? 'flex' : 'none';
            });
        });
    }
    
    // 退出登录按钮点击事件
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            const result = await fetchAPI('auth', 'logout');
            if (result.success) {
                // 清除本地存储的登录凭证
                localStorage.removeItem('loginCredentials');
                window.location.href = 'login.html';
            } else {
                alert('退出登录失败');
            }
        });
    }
    
    // 设置按钮点击事件
    const settingsBtn = document.getElementById('settingsBtn');
    console.log('[Chat] 设置按钮元素:', settingsBtn);
    
    if (settingsBtn) {
        settingsBtn.addEventListener('click', async () => {
            console.log('[Chat] 设置按钮被点击');
            
            try {
                // 打开设置窗口
                if (window.electronAPI && window.electronAPI.window && window.electronAPI.window.createWindow) {
                    console.log('[Chat] 使用 electronAPI 创建设置窗口');
                    const webDir = window.electronAPI.__dirname;
                    const url = 'file://' + webDir + '/setting.html';
                    console.log('[Chat] 设置页面 URL:', url);
                    
                    const windowId = await window.electronAPI.window.createWindow({
                        width: 800,
                        height: 600,
                        resizable: true,
                        url: url
                    });
                    console.log('[Chat] 设置窗口创建成功，ID:', windowId);
                } else {
                    console.log('[Chat] 使用 window.open 创建设置窗口');
                    const width = 800;
                    const height = 600;
                    const left = (window.screen.width - width) / 2;
                    const top = (window.screen.height - height) / 2;
                    const features = `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`;
                    const newWin = window.open('setting.html', 'settings', features);
                    if (newWin) {
                        console.log('[Chat] 设置窗口通过 window.open 创建成功');
                    } else {
                        console.error('[Chat] window.open 创建设置窗口失败');
                        alert('无法打开设置窗口，请检查浏览器弹窗设置');
                    }
                }
            } catch (error) {
                console.error('[Chat] 打开设置窗口失败:', error);
                alert('打开设置窗口失败: ' + error.message);
            }
        });
    } else {
        console.error('[Chat] 未找到设置按钮元素');
    }
});

function handleResize() {
    const chatContainer = document.querySelector('.chat-container');
    if (chatContainer) {
        chatContainer.style.height = `${window.innerHeight}px`;
        chatContainer.style.width = `${window.innerWidth}px`;
    }
}

// 录音功能
let mediaRecorder = null;
let audioChunks = [];
let audioContext = null;
let audioStream = null;

async function startRecording() {
    try {
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        const audioRecorder = new MediaRecorder(audioStream, {
            mimeType: 'audio/webm;codecs=opus'
        });
        
        mediaRecorder = audioRecorder;
        audioChunks = [];

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = async () => {
            try {
                audioStream.getTracks().forEach(track => track.stop());
                
                const webmBlob = new Blob(audioChunks, { type: 'audio/webm' });
                console.log('[Chat] 录音完成，webm blob大小:', webmBlob.size, 'bytes');
                
                const mp3Blob = await convertWebmToMp3(webmBlob);
                console.log('[Chat] MP3转换完成，大小:', mp3Blob.size, 'bytes');
                
                await sendAudioMessage(mp3Blob);
            } catch (error) {
                console.error('[Chat] 录音处理失败:', error);
                alert('录音处理失败: ' + error.message);
            } finally {
                if (audioContext) {
                    audioContext.close();
                }
                resetRecordingButton();
            }
        };

        mediaRecorder.start();
        alert('开始录音，再次点击停止');
        
        const audioBtn = document.getElementById('audioBtn');
        audioBtn.removeEventListener('click', startRecording);
        audioBtn.addEventListener('click', stopRecording);
        
    } catch (error) {
        console.error('录音失败:', error);
        alert('录音失败，请检查麦克风权限: ' + error.message);
        resetRecordingButton();
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
}

function resetRecordingButton() {
    const audioBtn = document.getElementById('audioBtn');
    audioBtn.removeEventListener('click', stopRecording);
    audioBtn.addEventListener('click', startRecording);
    mediaRecorder = null;
    audioChunks = [];
    audioContext = null;
    audioStream = null;
}

async function convertWebmToMp3(webmBlob) {
    return new Promise((resolve, reject) => {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const reader = new FileReader();
        
        reader.onload = async () => {
            try {
                const arrayBuffer = reader.result;
                const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                
                const sampleRate = audioBuffer.sampleRate;
                const channels = audioBuffer.numberOfChannels;
                const length = audioBuffer.length;
                
                const rawData = audioBuffer.getChannelData(0);
                const samples = new Float32Array(length);
                
                for (let i = 0; i < length; i++) {
                    samples[i] = rawData[i];
                }
                
                const mp3Data = encodeMp3(samples, sampleRate);
                const mp3Blob = new Blob([mp3Data], { type: 'audio/mp3' });
                
                audioContext.close();
                resolve(mp3Blob);
            } catch (error) {
                audioContext.close();
                reject(error);
            }
        };
        
        reader.onerror = () => {
            audioContext.close();
            reject(reader.error);
        };
        
        reader.readAsArrayBuffer(webmBlob);
    });
}

function encodeMp3(samples, sampleRate) {
    const buffer = [];
    const frameSize = 1152;
    const bitRate = 128;
    
    const mpegVersion = 1;
    const layer = 3;
    const sampleRateIndex = [44100, 48000, 32000].indexOf(sampleRate) !== -1 
        ? [44100, 48000, 32000].indexOf(sampleRate) 
        : 0;
    const bitRateIndex = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320].indexOf(bitRate);
    
    for (let i = 0; i < samples.length; i += frameSize) {
        const frameSamples = samples.slice(i, Math.min(i + frameSize, samples.length));
        const padding = frameSamples.length < frameSize ? 1 : 0;
        
        const frameHeader = new Uint8Array(4);
        frameHeader[0] = 0xFF;
        frameHeader[1] = 0xFB;
        frameHeader[2] = ((mpegVersion << 3) | (layer << 1) | 1);
        frameHeader[3] = ((bitRateIndex << 4) | (sampleRateIndex << 2) | padding);
        
        const frameData = new Uint8Array(frameSize * 2);
        for (let j = 0; j < frameSamples.length; j++) {
            const sample = Math.max(-1, Math.min(1, frameSamples[j]));
            const intSample = Math.round(sample * 32767);
            frameData[j * 2] = intSample & 0xFF;
            frameData[j * 2 + 1] = (intSample >> 8) & 0xFF;
        }
        
        buffer.push(...frameHeader);
        buffer.push(...frameData.slice(0, frameSamples.length * 2));
    }
    
    return new Uint8Array(buffer);
}

async function sendAudioMessage(blob) {
    if (!currentContact) {
        alert('请先选择一个聊天对象');
        return;
    }
    
    try {
        console.log('[Chat] 开始发送语音消息');
        console.log('[Chat] 当前联系人:', currentContact);
        
        const formData = new FormData();
        formData.append('resource', 'upload');
        formData.append('file', blob, 'voice.mp3');
        
        console.log('[Chat] 上传语音文件到:', getApiBaseUrl());
        const response = await fetch(getApiBaseUrl(), {
            method: 'POST',
            credentials: 'include',
            body: formData
        });
        
        console.log('[Chat] 响应状态:', response.status, response.statusText);
        
        const text = await response.text();
        console.log('[Chat] 响应内容:', text);
        
        let result;
        try {
            result = JSON.parse(text);
            console.log('[Chat] 解析后的响应:', result);
        } catch (parseError) {
            console.error('[Chat] 解析JSON失败:', parseError);
            alert('发送语音失败: 服务器返回无效的响应格式');
            return;
        }
        
        if (result.success && result.data && result.data.file_path) {
            console.log('[Chat] 文件上传成功，file_path:', result.data.file_path);
            
            const fileInfo = {
                file_path: result.data.file_path,
                file_name: 'voice.mp3',
                file_size: blob.size,
                file_type: 'audio/mp3'
            };
            
            if (currentContact.type === 'friend') {
                await fetchAPI('messages', 'send_file', {
                    receiver_id: currentContact.originalId,
                    ...fileInfo
                });
            } else {
                await fetchAPI('groups', 'send_file', {
                    group_id: currentContact.originalId,
                    ...fileInfo
                });
            }
            loadMessages(currentContact.originalId, currentContact.type);
            alert('语音发送成功');
        } else {
            console.error('[Chat] 发送语音失败:', result);
            alert('发送语音失败: ' + (result.message || '未知错误'));
        }
    } catch (error) {
        console.error('发送语音失败:', error);
        alert('发送语音失败: ' + error.message);
    }
}

// 设置音频音量
function setAudioVolume(audioId, volume) {
    const audio = document.getElementById(audioId);
    if (audio) {
        audio.volume = volume / 100;
    }
}

// 停止所有音频播放
function stopAllAudioPlayback() {
    const allAudios = document.querySelectorAll('audio');
    allAudios.forEach(audio => {
        if (!audio.paused) {
            audio.pause();
            audio.currentTime = 0;
        }
    });
    
    // 重置所有音频播放器按钮状态
    const allPlayButtons = document.querySelectorAll('.audio-play-btn');
    allPlayButtons.forEach(btn => {
        btn.classList.remove('active');
        const playIcon = btn.querySelector('.play-icon');
        const pauseIcon = btn.querySelector('.pause-icon');
        if (playIcon) playIcon.style.display = 'block';
        if (pauseIcon) pauseIcon.style.display = 'none';
    });
    
    // 重置所有进度条
    const allProgressFills = document.querySelectorAll('.audio-progress-fill');
    allProgressFills.forEach(fill => {
        fill.style.width = '0%';
    });
    
    // 重置所有时间显示
    const allTimeEls = document.querySelectorAll('.audio-time');
    allTimeEls.forEach(el => {
        el.textContent = '0:00';
    });
    
    // 更新任务栏图标为默认图标
    setAudioPlaybackStatus(false);
}

// 初始化音频播放器（加载元数据并显示时长）
function initAudioPlayer(audioId) {
    const audio = document.getElementById(audioId);
    if (!audio) return;
    
    const audioPlayer = audio.closest('.audio-player');
    if (!audioPlayer) return;
    
    const durationEl = audioPlayer.querySelector('.audio-duration');
    const progressBar = audioPlayer.querySelector('.audio-progress-bar');
    const progressFill = audioPlayer.querySelector('.audio-progress-fill');
    const timeEl = audioPlayer.querySelector('.audio-time');
    
    const updateDuration = () => {
        if (audio.duration > 0 && durationEl) {
            durationEl.textContent = formatTime(audio.duration);
        }
    };
    
    audio.onloadedmetadata = updateDuration;
    
    audio.ontimeupdate = () => {
        if (progressFill && audio.duration) {
            const percent = (audio.currentTime / audio.duration) * 100;
            progressFill.style.width = percent + '%';
            
            if (!audio.paused) {
                setAudioPlaybackStatus(true, audio.currentTime / audio.duration);
            }
        }
        if (timeEl) {
            timeEl.textContent = formatTime(audio.currentTime);
        }
    };
    
    audio.onended = () => {
        const btn = audioPlayer.querySelector('.audio-play-btn');
        const playIcon = btn?.querySelector('.play-icon');
        const pauseIcon = btn?.querySelector('.pause-icon');
        
        if (btn) btn.classList.remove('active');
        if (playIcon) playIcon.style.display = 'block';
        if (pauseIcon) pauseIcon.style.display = 'none';
        
        if (progressFill) progressFill.style.width = '0%';
        if (timeEl) timeEl.textContent = '0:00';
        
        setAudioPlaybackStatus(false);
    };
    
    if (progressBar) {
        progressBar.addEventListener('click', (e) => {
            if (!audio.duration) return;
            
            const rect = progressBar.getBoundingClientRect();
            const percent = (e.clientX - rect.left) / rect.width;
            const newTime = percent * audio.duration;
            
            audio.currentTime = newTime;
            
            if (progressFill) {
                progressFill.style.width = percent * 100 + '%';
            }
            if (timeEl) {
                timeEl.textContent = formatTime(newTime);
            }
        });
    }
    
    if (audio.readyState >= 2) {
        updateDuration();
    }
    
    audio.load();
}

// 存储已创建的 Blob URL，用于清理
const audioBlobUrls = new Map();

// 获取音频的 Blob URL（优先从缓存获取）
async function getAudioBlobUrl(audioElement, originalUrl) {
    if (!originalUrl) return null;
    
    try {
        const cachedBlob = await getCachedAudio(originalUrl);
        if (cachedBlob) {
            console.log(`[Audio] 使用缓存的音频: ${originalUrl}`);
            const blobUrl = URL.createObjectURL(cachedBlob);
            audioBlobUrls.set(originalUrl, blobUrl);
            return blobUrl;
        }
        
        console.log(`[Audio] 缓存不存在，下载音频: ${originalUrl}`);
        const response = await fetch(originalUrl);
        if (!response.ok) {
            console.error(`[Audio] 下载失败: ${response.status}`);
            return null;
        }
        
        const blob = await response.blob();
        
        await cacheAudio(originalUrl, blob);
        console.log(`[Audio] 音频已下载并缓存: ${originalUrl}`);
        
        const blobUrl = URL.createObjectURL(blob);
        audioBlobUrls.set(originalUrl, blobUrl);
        return blobUrl;
    } catch (error) {
        console.error(`[Audio] 获取音频失败: ${originalUrl}`, error);
        return null;
    }
}

// 释放音频的 Blob URL
function revokeAudioBlobUrl(url) {
    const blobUrl = audioBlobUrls.get(url);
    if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
        audioBlobUrls.delete(url);
        console.log(`[Audio] 已释放 Blob URL: ${url}`);
    }
}

// 音频循环播放控制
function toggleAudioLoop(audioId, btn) {
    const audio = document.getElementById(audioId);
    if (!audio) {
        console.error('音频元素不存在:', audioId);
        return;
    }
    
    audio.loop = !audio.loop;
    
    if (audio.loop) {
        btn.style.color = '#6366f1';
        btn.style.background = 'rgba(99, 102, 241, 0.1)';
    } else {
        btn.style.color = '#888';
        btn.style.background = 'transparent';
    }
}

// 音量控制显示/隐藏
function toggleVolumeControl(volumeId) {
    const volumeControl = document.getElementById(volumeId);
    if (!volumeControl) {
        console.error('音量控制元素不存在:', volumeId);
        return;
    }
    
    const isVisible = volumeControl.style.display !== 'none';
    
    // 先隐藏所有其他音量控制
    document.querySelectorAll('.audio-volume-control').forEach(el => {
        el.style.display = 'none';
    });
    
    // 显示/隐藏当前音量控制
    volumeControl.style.display = isVisible ? 'none' : 'flex';
    
    // 如果显示了音量控制，点击页面其他地方时隐藏
    if (!isVisible) {
        const handleClickOutside = (e) => {
            if (!volumeControl.contains(e.target) && !e.target.classList.contains('audio-volume-btn')) {
                volumeControl.style.display = 'none';
                document.removeEventListener('click', handleClickOutside);
            }
        };
        setTimeout(() => {
            document.addEventListener('click', handleClickOutside);
        }, 100);
    }
}

// 音频播放控制
async function toggleAudioPlay(btn, audioId) {
    const audio = document.getElementById(audioId);
    const playIcon = btn.querySelector('.play-icon');
    const pauseIcon = btn.querySelector('.pause-icon');
    
    if (!audio) {
        console.error('音频元素不存在:', audioId);
        showToast('音频元素不存在', 2000);
        return;
    }
    
    const originalSrc = audio.getAttribute('data-original-src') || audio.src;
    
    if (audio.paused) {
        if (!audio.src || audio.src.startsWith('blob:') || audio.readyState === 0) {
            const blobUrl = await getAudioBlobUrl(audio, originalSrc);
            if (blobUrl) {
                audio.src = blobUrl;
                audio.setAttribute('data-original-src', originalSrc);
            } else {
                console.error(`[Audio] 无法获取音频: ${originalSrc}`);
                showToast('无法加载音频文件', 3000);
                return;
            }
        }
        
        audio.play().then(() => {
            btn.classList.add('active');
            playIcon.style.display = 'none';
            pauseIcon.style.display = 'block';
            setAudioPlaybackStatus(true, audio.duration > 0 ? audio.currentTime / audio.duration : 0);
        }).catch(err => {
            console.error('播放失败:', err);
            showToast('音频播放失败', 3000);
            if (audio.error) {
                console.error('音频错误详情:', audio.error.code, audio.error.message);
            }
        });
    } else {
        audio.pause();
        btn.classList.remove('active');
        playIcon.style.display = 'block';
        pauseIcon.style.display = 'none';
        setAudioPlaybackStatus(false);
    }
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// 待发送的图片列表
let pendingImages = [];

// 截图功能
async function takeScreenshot() {
    if (pendingImages.length >= 5) {
        alert('最多只能添加5张图片');
        return;
    }
    
    try {
        console.log('[Chat] 开始截图...');
        let stream;
        
        // 优先使用 Electron 的 desktopCapturer API
        if (window.electronAPI && window.electronAPI.desktopCapturer) {
            console.log('[Chat] 使用 Electron desktopCapturer API');
            const sources = await window.electronAPI.desktopCapturer.getSources();
            console.log('[Chat] 获取到的屏幕源:', sources?.map(s => ({ id: s.id, name: s.name, type: s.type })));
            
            if (sources && sources.length > 0) {
                // 默认选择第一个屏幕
                const source = sources.find(s => s.type === 'screen') || sources[0];
                console.log('[Chat] 选择的屏幕源:', source.name);
                
                stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        mandatory: {
                            chromeMediaSource: 'desktop',
                            chromeMediaSourceId: source.id
                        }
                    },
                    audio: false
                });
            }
        }
        
        // 如果 Electron API 不可用或失败，回退到标准 API
        if (!stream) {
            console.log('[Chat] 使用标准 getDisplayMedia API');
            stream = await navigator.mediaDevices.getDisplayMedia({
                video: { displaySurface: 'screen' },
                audio: false
            });
        }
        
        console.log('[Chat] 获取到视频流，准备截图');
        
        const video = document.createElement('video');
        video.srcObject = stream;
        video.autoplay = true;
        video.playsInline = true;
        
        // 等待视频元数据加载
        await new Promise((resolve, reject) => {
            video.onloadedmetadata = resolve;
            video.onerror = reject;
            setTimeout(() => reject(new Error('视频加载超时')), 10000);
        });
        
        console.log('[Chat] 视频元数据已加载，尺寸:', video.videoWidth, 'x', video.videoHeight);
        
        // 播放视频
        await video.play();
        
        // 等待一帧渲染完成
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // 停止视频流
        stream.getTracks().forEach(track => track.stop());
        
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        
        console.log('[Chat] 截图完成，大小:', blob.size, 'bytes');
        
        addImageToInput(blob);
    } catch (error) {
        console.error('[Chat] 截图失败:', error);
        alert('截图失败，请确保已授予屏幕共享权限');
    }
}

function addImageToInput(blob) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const imageData = {
            id: Date.now(),
            blob: blob,
            dataUrl: e.target.result,
            filename: `screenshot_${Date.now()}.png`
        };
        
        pendingImages.push(imageData);
        updateImagePreview();
    };
    reader.readAsDataURL(blob);
}

function updateImagePreview() {
    let previewContainer = document.getElementById('imagePreviewContainer');
    const inputToolsTop = document.querySelector('.input-tools-top');
    
    if (pendingImages.length === 0) {
        if (previewContainer) {
            previewContainer.remove();
        }
        return;
    }
    
    if (!previewContainer) {
        previewContainer = document.createElement('div');
        previewContainer.id = 'imagePreviewContainer';
        previewContainer.style.display = 'flex';
        previewContainer.style.flexWrap = 'wrap';
        previewContainer.style.gap = '8px';
        previewContainer.style.marginTop = '8px';
        previewContainer.style.marginBottom = '8px';
        inputToolsTop.parentNode.insertBefore(previewContainer, inputToolsTop.nextSibling);
    }
    
    previewContainer.innerHTML = '';
    
    pendingImages.forEach((image, index) => {
        const imgEl = document.createElement('img');
        imgEl.src = image.dataUrl;
        imgEl.style.width = '60px';
        imgEl.style.height = '60px';
        imgEl.style.objectFit = 'cover';
        imgEl.style.borderRadius = '4px';
        imgEl.style.cursor = 'pointer';
        imgEl.style.border = '2px solid #e0e0e0';
        imgEl.dataset.index = index;
        
        imgEl.addEventListener('dblclick', () => {
            previewImage(image.dataUrl);
        });
        
        const removeBtn = document.createElement('span');
        removeBtn.innerHTML = '&times;';
        removeBtn.style.position = 'relative';
        removeBtn.style.left = '-16px';
        removeBtn.style.top = '-4px';
        removeBtn.style.background = '#ff4444';
        removeBtn.style.color = 'white';
        removeBtn.style.borderRadius = '50%';
        removeBtn.style.width = '20px';
        removeBtn.style.height = '20px';
        removeBtn.style.display = 'inline-flex';
        removeBtn.style.alignItems = 'center';
        removeBtn.style.justifyContent = 'center';
        removeBtn.style.fontSize = '14px';
        removeBtn.style.cursor = 'pointer';
        removeBtn.style.zIndex = '10';
        
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            pendingImages.splice(index, 1);
            updateImagePreview();
        });
        
        const wrapper = document.createElement('div');
        wrapper.style.position = 'relative';
        wrapper.appendChild(imgEl);
        wrapper.appendChild(removeBtn);
        
        previewContainer.appendChild(wrapper);
    });
}

function previewImage(dataUrl) {
    const modal = document.createElement('div');
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100%';
    modal.style.height = '100%';
    modal.style.background = 'rgba(0, 0, 0, 0.8)';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.zIndex = '1000';
    modal.style.cursor = 'pointer';
    
    const img = document.createElement('img');
    img.src = dataUrl;
    img.style.maxWidth = '90%';
    img.style.maxHeight = '90%';
    img.style.borderRadius = '8px';
    
    modal.appendChild(img);
    document.body.appendChild(modal);
    
    modal.addEventListener('click', () => {
        document.body.removeChild(modal);
    });
}

async function uploadImagesWithProgress() {
    if (pendingImages.length === 0) return [];
    
    const uploadResults = [];
    
    for (const image of pendingImages) {
        const result = await uploadImage(image);
        if (result.success && result.data && result.data.file_path) {
            uploadResults.push({
                file_path: result.data.file_path,
                file_name: image.filename,
                file_size: image.blob.size,
                file_type: image.blob.type
            });
        }
    }
    
    pendingImages = [];
    updateImagePreview();
    
    return uploadResults;
}

async function uploadImage(imageData) {
    return new Promise((resolve) => {
        const formData = new FormData();
        formData.append('resource', 'upload');
        formData.append('file', imageData.blob, imageData.filename);
        
        const xhr = new XMLHttpRequest();
        xhr.open('POST', getApiBaseUrl());
        xhr.withCredentials = true;
        
        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const percent = Math.round((e.loaded / e.total) * 100);
                updateUploadProgress(percent);
            }
        });
        
        xhr.onload = () => {
            try {
                const result = JSON.parse(xhr.responseText);
                resolve(result);
            } catch {
                resolve({ success: false, message: '解析响应失败' });
            }
        };
        
        xhr.onerror = () => {
            resolve({ success: false, message: '上传失败' });
        };
        
        xhr.send(formData);
    });
}

function updateUploadProgress(percent) {
    let progressBar = document.getElementById('uploadProgress');
    if (!progressBar) {
        progressBar = document.createElement('div');
        progressBar.id = 'uploadProgress';
        progressBar.style.position = 'fixed';
        progressBar.style.bottom = '20px';
        progressBar.style.left = '50%';
        progressBar.style.transform = 'translateX(-50%)';
        progressBar.style.width = '300px';
        progressBar.style.zIndex = '9999';
        document.body.appendChild(progressBar);
    }
    
    progressBar.innerHTML = `
        <div style="background: #fff; border-radius: 8px; padding: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.2);">
            <div style="font-size: 14px; color: #666; margin-bottom: 8px;">上传中...</div>
            <div style="width: 100%; height: 8px; background: #f0f0f0; border-radius: 4px; overflow: hidden;">
                <div style="height: 100%; background: linear-gradient(90deg, #4facfe, #00f2fe); border-radius: 4px; transition: width 0.3s;" 
                     style="width: ${percent}%;"></div>
            </div>
            <div style="font-size: 12px; color: #999; margin-top: 4px; text-align: center;">${percent}%</div>
        </div>
    `;
    
    if (percent >= 100) {
        setTimeout(() => {
            if (progressBar) {
                document.body.removeChild(progressBar);
            }
        }, 1000);
    }
}

async function sendImageMessage(blob) {
    if (!currentContact) return;
    
    try {
        const formData = new FormData();
        formData.append('resource', 'upload');
        formData.append('file', blob, 'screenshot.png');
        
        const response = await fetch(getApiBaseUrl(), {
            method: 'POST',
            credentials: 'include',
            body: formData
        });
        
        const result = await response.json();
        
        if (result.success && result.data && result.data.file_path) {
            const fileInfo = {
                file_path: result.data.file_path,
                file_name: 'screenshot.png',
                file_size: blob.size,
                file_type: 'image/png'
            };
            
            if (currentContact.type === 'friend') {
                await fetchAPI('messages', 'send_file', {
                    receiver_id: currentContact.originalId,
                    ...fileInfo
                });
            } else {
                await fetchAPI('groups', 'send_file', {
                    group_id: currentContact.originalId,
                    ...fileInfo
                });
            }
            await loadMessages(currentContact.originalId, currentContact.type);
            await loadSessionsInfo();
            await renderContacts();
        } else {
            alert('发送图片失败');
        }
    } catch (error) {
        console.error('发送图片失败:', error);
        alert('发送图片失败');
    }
}

// 截图完成处理函数
async function handleScreenshotComplete(dataUrl) {
    if (!currentContact || !currentContact.originalId) {
        alert('请先选择一个聊天对象');
        return;
    }
    
    const check = await checkUserAndIP();
    if (!check.success) {
        await handleBanError(check);
        return;
    }
    
    try {
        // 将 dataUrl 转换为 blob
        const response = await fetch(dataUrl);
        const blob = await response.blob();
        
        const formData = new FormData();
        formData.append('resource', 'upload');
        formData.append('file', blob, 'screenshot.png');
        
        const responseData = await fetch(getApiBaseUrl(), {
            method: 'POST',
            credentials: 'include',
            body: formData
        });
        
        const result = await responseData.json();
        
        if (result.success && result.data && result.data.file_path) {
            const fileInfo = {
                file_path: result.data.file_path,
                file_name: 'screenshot.png',
                file_size: blob.size,
                file_type: 'image/png'
            };
            
            if (currentContact.type === 'friend') {
                await fetchAPI('messages', 'send_file', {
                    receiver_id: currentContact.originalId,
                    ...fileInfo
                });
            } else {
                await fetchAPI('groups', 'send_file', {
                    group_id: currentContact.originalId,
                    ...fileInfo
                });
            }
            
            await loadMessages(currentContact.originalId, currentContact.type);
            if (typeof window.showToast === 'function') {
                window.showToast('截图发送成功');
            } else {
                alert('截图发送成功');
            }
            await loadSessionsInfo();
            await renderContacts();
        } else {
            alert('发送截图失败');
        }
    } catch (error) {
        console.error('发送截图失败:', error);
        alert('发送截图失败');
    }
}

// 监听剪贴板粘贴事件
document.addEventListener('paste', async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    
    for (const item of items) {
        if (item.type.startsWith('image/')) {
            e.preventDefault();
            
            if (!currentContact || !currentContact.id) {
                alert('请先选择一个聊天对象');
                return;
            }
            
            const blob = await item.getAsFile();
            if (!blob) return;
            
            try {
                const formData = new FormData();
                formData.append('resource', 'upload');
                formData.append('file', blob, 'clipboard_image.png');
                
                const response = await fetch(getApiBaseUrl(), {
                    method: 'POST',
                    credentials: 'include',
                    body: formData
                });
                
                const result = await response.json();
                
                if (result.success && result.data && result.data.file_path) {
                    const fileInfo = {
                        file_path: result.data.file_path,
                        file_name: 'clipboard_image.png',
                        file_size: blob.size,
                        file_type: blob.type
                    };
                    
                    if (currentContact.type === 'friend') {
                        await fetchAPI('messages', 'send_file', {
                            receiver_id: currentContact.id,
                            ...fileInfo
                        });
                    } else {
                        await fetchAPI('groups', 'send_file', {
                            group_id: currentContact.id,
                            ...fileInfo
                        });
                    }
                    
                    await loadMessages(currentContact.id, currentContact.type);
                    if (typeof window.showToast === 'function') {
                        window.showToast('图片发送成功');
                    } else {
                        alert('图片发送成功');
                    }
                    await loadSessionsInfo();
                    await renderContacts();
                } else {
                    alert('发送图片失败');
                }
            } catch (error) {
                console.error('粘贴图片失败:', error);
                alert('粘贴图片失败');
            }
            
            break;
        }
    }
});

// 文件上传功能
function uploadFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '*/*';
    input.style.display = 'none';
    
    input.addEventListener('change', async (event) => {
        const files = event.target.files;
        if (files.length === 0) return;
        
        const check = await checkUserAndIP();
        if (!check.success) {
            await handleBanError(check);
            return;
        }
        
        const imageExtensions = ['jpg', 'jpeg', 'png', 'gif'];
        const dangerousExtensions = ['php', 'php1', 'php2', 'php3', 'php4', 'php5', 'phtml', 'xml', 'html', 'htm', 'asp', 'aspx', 'jsp', 'jspx', 'cgi', 'exe', 'bat', 'sh', 'cmd'];
        
        for (const file of files) {
            const fileName = file.name;
            const lastDotIndex = fileName.lastIndexOf('.');
            let baseName = lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;
            let extension = lastDotIndex > 0 ? fileName.substring(lastDotIndex + 1).toLowerCase() : '';
            
            if (dangerousExtensions.includes(extension)) {
                const newFileName = baseName + '.1';
                const newFile = new File([file], newFileName, { type: file.type });
                
                if (!currentContact) continue;
                
                try {
                    const formData = new FormData();
                    formData.append('resource', 'upload');
                    formData.append('file', newFile, newFileName);
                    
                    const response = await fetch(getApiBaseUrl(), {
                        method: 'POST',
                        credentials: 'include',
                        body: formData
                    });
                    
                    const result = await response.json();
                    
                    if (result.success && result.data && result.data.file_path) {
                        const fileInfo = {
                            file_path: result.data.file_path,
                            file_name: newFileName,
                            file_size: newFile.size,
                            file_type: newFile.type
                        };
                        
                        if (currentContact.type === 'friend') {
                            await fetchAPI('messages', 'send_file', {
                                receiver_id: currentContact.id,
                                ...fileInfo
                            });
                        } else {
                            await fetchAPI('groups', 'send_file', {
                                group_id: currentContact.id,
                                ...fileInfo
                            });
                        }
                        await loadMessages(currentContact.id, currentContact.type);
                        await loadSessionsInfo();
                        await renderContacts();
                    } else {
                        alert(`上传文件 ${fileName} 失败: ${result.message || '未知错误'}`);
                    }
                } catch (error) {
                    console.error('上传文件失败:', error);
                    alert(`上传文件 ${fileName} 失败`);
                }
            } else if (imageExtensions.includes(extension)) {
                if (pendingImages.length >= 5) {
                    alert('最多只能添加5张图片');
                    break;
                }
                
                const reader = new FileReader();
                reader.onload = (e) => {
                    const imageData = {
                        id: Date.now(),
                        blob: file,
                        dataUrl: e.target.result,
                        filename: file.name
                    };
                    
                    pendingImages.push(imageData);
                    updateImagePreview();
                };
                reader.readAsDataURL(file);
            } else {
                const invalidPattern = /[<>:"|?*\\/\x00-\x1f]/;
                if (invalidPattern.test(baseName) || invalidPattern.test(extension)) {
                    alert(`非法文件，无法上传: ${fileName}`);
                    continue;
                }
                
                if (!currentContact) continue;
                
                try {
                    const formData = new FormData();
                    formData.append('resource', 'upload');
                    formData.append('file', file, file.name);
                    
                    const response = await fetch(getApiBaseUrl(), {
                        method: 'POST',
                        credentials: 'include',
                        body: formData
                    });
                    
                    const result = await response.json();
                    
                    if (result.success && result.data && result.data.file_path) {
                        const fileInfo = {
                            file_path: result.data.file_path,
                            file_name: file.name,
                            file_size: file.size,
                            file_type: file.type
                        };
                        
                        if (currentContact.type === 'friend') {
                            await fetchAPI('messages', 'send_file', {
                                receiver_id: currentContact.id,
                                ...fileInfo
                            });
                        } else {
                            await fetchAPI('groups', 'send_file', {
                                group_id: currentContact.id,
                                ...fileInfo
                            });
                        }
                        await loadMessages(currentContact.id, currentContact.type);
                        await loadSessionsInfo();
                        await renderContacts();
                    } else {
                        alert(`上传文件 ${file.name} 失败: ${result.message || '未知错误'}`);
                    }
                } catch (error) {
                    console.error('上传文件失败:', error);
                    alert(`上传文件 ${file.name} 失败`);
                }
            }
        }
    });
    
    document.body.appendChild(input);
    input.click();
    document.body.removeChild(input);
}

window.showContactMenu = function(event, contact) {
    event.stopPropagation();

    window.closeContactMenu();

    const menu = document.createElement('div');
    menu.className = 'contact-menu';
    menu.id = 'contactMenu';

    if (contact.type === 'friend') {
        menu.innerHTML = `
            <div class="menu-item" data-action="removeFriend" data-id="${contact.id}">删除好友</div>
        `;
    } else if (contact.type === 'group') {
        menu.innerHTML = `
            <div class="menu-item" data-action="showGroupAudit" data-id="${contact.id}">入群审核</div>
            <div class="menu-item" data-action="dissolveGroup" data-id="${contact.id}">解散群聊</div>
            <div class="menu-item" data-action="transferGroup" data-id="${contact.id}">转让群聊</div>
            <div class="menu-item" data-action="showGroupDetails" data-id="${contact.id}">群聊详情</div>
            <div class="menu-item" data-action="leaveGroup" data-id="${contact.id}">退出群聊</div>
        `;
    }

    const btn = event.currentTarget;
    const rect = btn.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = `${rect.bottom + 5}px`;
    menu.style.left = `${rect.left - 100}px`;
    menu.style.zIndex = '1000';

    menu.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', () => {
            const action = item.dataset.action;
            const id = item.dataset.id;
            if (action === 'removeFriend') window.removeFriend(id);
            else if (action === 'showGroupAudit') window.showGroupAudit(id);
            else if (action === 'dissolveGroup') window.dissolveGroup(id);
            else if (action === 'transferGroup') window.transferGroup(id);
            else if (action === 'showGroupDetails') window.showGroupDetails(id);
            else if (action === 'leaveGroup') window.leaveGroup(id);
        });
    });

    document.body.appendChild(menu);

    setTimeout(() => {
        document.addEventListener('click', window.closeContactMenu);
    }, 100);
};

window.closeContactMenu = function() {
    const menu = document.getElementById('contactMenu');
    if (menu) {
        menu.remove();
    }
    document.removeEventListener('click', window.closeContactMenu);
};

window.removeFriend = async function(friendId) {
    window.closeContactMenu();
    if (confirm('确定要删除这个好友吗？')) {
        const realFriendId = friendId.replace(/^(friend|group)_/, '');
        const result = await fetchAPI('friends', 'delete', { friend_id: realFriendId });
        if (result.success) {
            alert('删除成功');
            await loadFriends();
            await renderContacts();
        } else {
            alert('删除失败: ' + result.message);
        }
    }
};

window.showGroupAudit = function(groupId) {
    window.closeContactMenu();
    const realGroupId = groupId.replace(/^(friend|group)_/, '');
    openAuditModal(realGroupId);
};

window.dissolveGroup = async function(groupId) {
    window.closeContactMenu();
    if (confirm('确定要解散这个群聊吗？')) {
        const realGroupId = groupId.replace(/^(friend|group)_/, '');
        const result = await fetchAPI('groups', 'delete', { group_id: realGroupId });
        if (result.success) {
            alert('解散成功');
            await loadGroups();
            await renderContacts();
        } else {
            alert('解散失败: ' + result.message);
        }
    }
};

function closeAppModal() {
    const el = document.getElementById('app-modal-overlay');
    if (el) el.remove();
}

function adminGroupsForAudit() {
    if (!userInfo || !contacts.groups) return [];
    return contacts.groups.filter((g) => {
        const owner = String(g.owner_id) === String(userInfo.id);
        const adm = g.is_admin === true || g.is_admin === 1 || g.is_admin === '1';
        return owner || adm;
    });
}

async function openSearchModal() {
    closeAppModal();
    let searchTab = 'user';
    const overlay = document.createElement('div');
    overlay.className = 'app-modal-overlay';
    overlay.id = 'app-modal-overlay';
    overlay.innerHTML = `
        <div class="app-modal">
            <div class="app-modal-header">
                <span>搜索用户与群聊</span>
                <button type="button" class="app-modal-close" data-close="1">&times;</button>
            </div>
            <div class="app-modal-body">
                <div class="app-modal-tabs">
                    <button type="button" class="app-modal-tab active" data-stab="user">用户</button>
                    <button type="button" class="app-modal-tab" data-stab="group">群聊</button>
                </div>
                <input type="text" class="app-modal-input" id="globalSearchInput" placeholder="输入关键词后回车或点搜索">
                <button type="button" class="app-modal-btn" id="globalSearchBtn" style="width:100%;margin-bottom:10px;">搜索</button>
                <div class="app-modal-list" id="globalSearchResults"></div>
            </div>
        </div>`;
    const runSearch = async () => {
        const q = (document.getElementById('globalSearchInput')?.value || '').trim();
        const box = document.getElementById('globalSearchResults');
        if (!q) {
            box.innerHTML = '<div class="app-modal-row">请输入关键词</div>';
            return;
        }
        box.innerHTML = '<div class="app-modal-row">搜索中…</div>';
        if (searchTab === 'user') {
            const res = await fetchAPI('user', 'search', { q });
            if (res.success && Array.isArray(res.data)) {
                if (res.data.length === 0) {
                    box.innerHTML = '<div class="app-modal-row">无结果</div>';
                    return;
                }
                box.innerHTML = '';
                res.data.forEach((u) => {
                    const row = document.createElement('div');
                    row.className = 'app-modal-row';
                    row.innerHTML = `<span>${escapeHtml(u.username || '')} <small style="color:#888;">ID ${u.id}</small></span>`;
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'app-modal-btn secondary';
                    btn.textContent = '加好友';
                    btn.onclick = async () => {
                        const r2 = await fetchAPI('friends', 'send_request', { friend_id: u.id });
                        if (r2.success) {
                            alert('好友请求已发送');
                        } else {
                            alert(r2.message || '发送失败');
                        }
                    };
                    row.appendChild(btn);
                    box.appendChild(row);
                });
            } else {
                box.innerHTML = `<div class="app-modal-row">${escapeHtml(res.message || '搜索失败')}</div>`;
            }
        } else {
            const res = await fetchAPI('groups', 'search', { q });
            if (res.success && Array.isArray(res.data)) {
                if (res.data.length === 0) {
                    box.innerHTML = '<div class="app-modal-row">无结果</div>';
                    return;
                }
                box.innerHTML = '';
                res.data.forEach((g) => {
                    const row = document.createElement('div');
                    row.className = 'app-modal-row';
                    row.innerHTML = `<span>${escapeHtml(g.name || '')} <small style="color:#888;">ID ${g.id}</small></span>`;
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'app-modal-btn secondary';
                    
                    const isJoined = contacts.groups.some((x) => String(x.id) === String(g.id));
                    
                    if (isJoined) {
                        btn.textContent = '打开';
                        btn.onclick = async () => {
                            closeAppModal();
                            const cg = contacts.groups.find((x) => String(x.id) === String(g.id));
                            if (cg) {
                                await selectContact({ id: String(g.id), type: 'group', name: cg.name || g.name, avatar: cg.avatar || null });
                            } else {
                                alert('未在群列表中找到该群');
                            }
                        };
                    } else {
                        btn.textContent = '加入';
                        btn.onclick = async () => {
                            const r2 = await fetchAPI('groups', 'join', { group_id: g.id });
                            if (r2.success) {
                                alert('入群请求已发送，请等待管理员审核');
                                btn.textContent = '已申请';
                                btn.disabled = true;
                            } else {
                                alert(r2.message || '发送入群请求失败');
                            }
                        };
                    }
                    row.appendChild(btn);
                    box.appendChild(row);
                });
            } else {
                box.innerHTML = `<div class="app-modal-row">${escapeHtml(res.message || '搜索失败')}</div>`;
            }
        }
    };
    document.body.appendChild(overlay);
    
    overlay.querySelectorAll('.app-modal-tab').forEach((t) => {
        t.addEventListener('click', () => {
            overlay.querySelectorAll('.app-modal-tab').forEach((x) => x.classList.remove('active'));
            t.classList.add('active');
            searchTab = t.dataset.stab;
            document.getElementById('globalSearchResults').innerHTML = '';
        });
    });
    
    const closeBtn = overlay.querySelector('[data-close]');
    if (closeBtn) {
        closeBtn.onclick = () => closeAppModal();
    }
    
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeAppModal(); });
    
    const searchBtn = document.getElementById('globalSearchBtn');
    if (searchBtn) {
        searchBtn.onclick = runSearch;
    }
    
    const searchInput = document.getElementById('globalSearchInput');
    if (searchInput) {
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') runSearch();
        });
    }
}

async function renderJoinRequestRows(groupId, container) {
    const res = await fetchAPI('groups', 'join_requests', { group_id: groupId });
    if (!res.success || !Array.isArray(res.data)) {
        container.innerHTML = `<div class="app-modal-row">${escapeHtml(res.message || '无法加载入群申请')}</div>`;
        return;
    }
    if (res.data.length === 0) {
        container.innerHTML = '<div class="app-modal-row">暂无待审核入群申请</div>';
        return;
    }
    container.innerHTML = '';
    res.data.forEach((row) => {
        const el = document.createElement('div');
        el.className = 'app-modal-row';
        el.innerHTML = `<span>${escapeHtml(row.username || '')} <small style="color:#888;">申请 #${row.id}</small></span>`;
        const approve = document.createElement('button');
        approve.type = 'button';
        approve.className = 'app-modal-btn';
        approve.style.marginLeft = '6px';
        approve.textContent = '同意';
        approve.onclick = async () => {
            const r = await fetchAPI('groups', 'approve_join_request', { group_id: groupId, request_id: row.id });
            if (r.success) {
                await renderJoinRequestRows(groupId, container);
                await loadGroups();
                await loadSessionsInfo();
                await renderContacts();
            } else {
                alert(r.message || '操作失败');
            }
        };
        const reject = document.createElement('button');
        reject.type = 'button';
        reject.className = 'app-modal-btn secondary';
        reject.style.marginLeft = '6px';
        reject.textContent = '拒绝';
        reject.onclick = async () => {
            const r = await fetchAPI('groups', 'reject_join_request', { group_id: groupId, request_id: row.id });
            if (r.success) {
                await renderJoinRequestRows(groupId, container);
            } else {
                alert(r.message || '操作失败');
            }
        };
        el.appendChild(approve);
        el.appendChild(reject);
        container.appendChild(el);
    });
}

async function openAuditModal(preselectGroupId) {
    closeAppModal();
    const ag = adminGroupsForAudit();
    const overlay = document.createElement('div');
    overlay.className = 'app-modal-overlay';
    overlay.id = 'app-modal-overlay';
    const groupOptions = ag.map((g) => `<option value="${g.id}" ${String(preselectGroupId) === String(g.id) ? 'selected' : ''}>${escapeHtml(g.name || '')} (ID ${g.id})</option>`).join('');
    overlay.innerHTML = `
        <div class="app-modal" style="max-width:520px;">
            <div class="app-modal-header">
                <span>审核中心</span>
                <button type="button" class="app-modal-close" data-close="1">&times;</button>
            </div>
            <div class="app-modal-body">
                <div class="app-modal-tabs">
                    <button type="button" class="app-modal-tab active" data-atab="friend">好友请求</button>
                    <button type="button" class="app-modal-tab" data-atab="group">入群审核</button>
                </div>
                <div id="audit-friend-panel">
                    <div class="app-modal-list" id="auditFriendList"></div>
                </div>
                <div id="audit-group-panel" style="display:none;">
                    <div style="margin-bottom:12px;">
                        <label style="font-size:13px;color:#666;font-weight:500;">选择要管理的群</label>
                        <div style="margin-top:8px;">
                            <select id="auditGroupSelect" class="app-modal-select">
                                ${groupOptions || '<option value="">暂无管理权限的群</option>'}
                            </select>
                        </div>
                    </div>
                    <div class="app-modal-list" id="auditJoinList"></div>
                </div>
            </div>
        </div>`;
    
    document.body.appendChild(overlay);
    
    const friendList = document.getElementById('auditFriendList');
    const loadFriendsAudit = async () => {
        if (!friendList) {
            console.error('[Audit] friendList element not found');
            return;
        }
        
        const res = await fetchAPI('friends', 'get_requests', {});
        if (!res.success || !Array.isArray(res.data)) {
            friendList.innerHTML = `<div class="app-modal-row">${escapeHtml(res.message || '加载失败')}</div>`;
            return;
        }
        if (res.data.length === 0) {
            friendList.innerHTML = '<div class="app-modal-row">暂无好友请求</div>';
            return;
        }
        friendList.innerHTML = '';
        res.data.forEach((row) => {
            const rid = row.request_id;
            const el = document.createElement('div');
            el.className = 'app-modal-row';
            el.innerHTML = `<span>${escapeHtml(row.username || '')} <small style="color:#888;">请求 #${rid}</small></span>`;
            const ok = document.createElement('button');
            ok.type = 'button';
            ok.className = 'app-modal-btn';
            ok.textContent = '接受';
            ok.onclick = async () => {
                const r = await fetchAPI('friends', 'accept_request', { request_id: rid });
                if (r.success) {
                    await loadFriendsAudit();
                    await loadFriends();
                    await loadSessionsInfo();
                    await renderContacts();
                } else {
                    alert(r.message || '失败');
                }
            };
            const no = document.createElement('button');
            no.type = 'button';
            no.className = 'app-modal-btn secondary';
            no.textContent = '拒绝';
            no.onclick = async () => {
                const r = await fetchAPI('friends', 'reject_request', { request_id: rid });
                if (r.success) await loadFriendsAudit();
                else alert(r.message || '失败');
            };
            el.appendChild(ok);
            el.appendChild(no);
            friendList.appendChild(el);
        });
    };
    overlay.querySelectorAll('.app-modal-tab').forEach((t) => {
        t.addEventListener('click', () => {
            overlay.querySelectorAll('.app-modal-tab').forEach((x) => x.classList.remove('active'));
            t.classList.add('active');
            const tab = t.dataset.atab;
            document.getElementById('audit-friend-panel').style.display = tab === 'friend' ? 'block' : 'none';
            document.getElementById('audit-group-panel').style.display = tab === 'group' ? 'block' : 'none';
        });
    });
    const sel = document.getElementById('auditGroupSelect');
    const joinBox = document.getElementById('auditJoinList');
    if (sel && ag.length) {
        sel.addEventListener('change', () => {
            const gid = sel.value;
            if (gid) renderJoinRequestRows(gid, joinBox);
        });
        const initial = sel.value || (preselectGroupId ? String(preselectGroupId) : '');
        if (initial) renderJoinRequestRows(initial, joinBox);
    }
    
    const closeBtn = overlay.querySelector('[data-close]');
    if (closeBtn) {
        closeBtn.onclick = () => closeAppModal();
    }
    
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeAppModal(); });
    await loadFriendsAudit();
}

window.transferGroup = async function(groupId) {
    window.closeContactMenu();
    const realGroupId = groupId.replace(/^(friend|group)_/, '');
    const res = await fetchAPI('groups', 'members', { group_id: realGroupId });
    if (!res.success || !Array.isArray(res.data)) {
        alert(res.message || '无法加载群成员');
        return;
    }
    const members = res.data.filter((m) => String(m.id) !== String(userInfo?.id));
    if (members.length === 0) {
        alert('没有可转让的成员');
        return;
    }
    const lines = members.map((m, i) => `${i + 1}. ${escapeHtml(m.username || m.name || ('用户' + m.id))} (ID: ${m.id})`).join('\n');
    const input = prompt(`请输入新群主的用户数字 ID：\n\n群成员：\n${lines}`);
    if (!input) return;
    const newOwnerId = parseInt(input.trim(), 10);
    if (!newOwnerId || isNaN(newOwnerId)) {
        alert('无效的用户 ID');
        return;
    }
    if (!confirm(`确认将群主转让给用户 ID ${newOwnerId}？`)) return;
    const tr = await fetchAPI('groups', 'transfer', { group_id: realGroupId, new_owner_id: newOwnerId });
    if (tr.success) {
        alert('群主已转让');
        await loadGroups();
        await loadSessionsInfo();
        await renderContacts();
    } else {
        alert(tr.message || '转让失败');
    }
};

window.showGroupDetails = async function(groupId) {
    window.closeContactMenu();
    // 从 groupId 中提取纯数字 ID（移除 friend_ 或 group_ 前缀）
    const realGroupId = groupId.replace(/^(friend|group)_/, '');
    const infoRes = await fetchAPI('groups', 'info', { group_id: realGroupId });
    const memRes = await fetchAPI('groups', 'members', { group_id: realGroupId });
    if (!infoRes.success || !infoRes.data) {
        alert(infoRes.message || '无法加载群信息');
        return;
    }
    const g = infoRes.data;
    const members = memRes.success && Array.isArray(memRes.data) ? memRes.data : [];
    
    let openDropdown = null;
    const currentUserIsOwner = String(g.owner_id) === String(userInfo.id);
    const currentUserIsAdmin = members.some(m => String(m.id) === String(userInfo.id) && (m.role === 'admin' || m.role === 'owner'));
    
    function renderMembers(filterText = '') {
        const filteredMembers = members.filter(m => {
            if (!filterText) return true;
            const searchText = filterText.toLowerCase();
            const username = (m.username || m.name || '').toLowerCase();
            return username.includes(searchText);
        });
        
        return filteredMembers.map(m => {
            const uid = m.id;
            const un = m.username || m.name || uid;
            const role = m.role || 'member';
            const isOwner = role === 'owner' || String(uid) === String(g.owner_id);
            const isAdmin = role === 'admin' || isOwner;
            const isSelf = String(uid) === String(userInfo.id);
            
            let roleClass = 'member';
            let roleText = '成员';
            if (isOwner) {
                roleClass = 'owner';
                roleText = '群主';
            } else if (isAdmin) {
                roleClass = 'admin';
                roleText = '管理员';
            }
            
            const avatarLetter = (un.charAt(0) || '?').toUpperCase();
            const avatarHTML = m.avatar 
                ? `<img src="${escapeHtml(getAvatarUrl(m.avatar))}" alt="">` 
                : avatarLetter;
            
            let menuItems = '';
            
            if (!isSelf) {
                menuItems += `
                    <div class="group-detail-member-dropdown-item" data-action="add-friend" data-id="${uid}" data-name="${escapeHtml(un)}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                            <circle cx="8.5" cy="7" r="4"/>
                            <line x1="20" y1="8" x2="20" y2="14"/>
                            <line x1="23" y1="11" x2="17" y2="11"/>
                        </svg>
                        添加好友
                    </div>
                `;
            }
            
            if (currentUserIsOwner && !isOwner && !isSelf) {
                if (!isAdmin) {
                    menuItems += `
                        <div class="group-detail-member-dropdown-item" data-action="set-admin" data-id="${uid}" data-name="${escapeHtml(un)}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                            </svg>
                            设为管理员
                        </div>
                    `;
                } else {
                    menuItems += `
                        <div class="group-detail-member-dropdown-item" data-action="remove-admin" data-id="${uid}" data-name="${escapeHtml(un)}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"/>
                                <line x1="15" y1="9" x2="9" y2="15"/>
                                <line x1="9" y1="9" x2="15" y2="15"/>
                            </svg>
                            取消管理员
                        </div>
                    `;
                }
            }
            
            if ((currentUserIsOwner || currentUserIsAdmin) && !isOwner && !isSelf) {
                menuItems += `
                    <div class="group-detail-member-dropdown-item danger" data-action="kick" data-id="${uid}" data-name="${escapeHtml(un)}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                        踢出群聊
                    </div>
                `;
            }
            
            return `
                <div class="group-detail-member">
                    <div class="group-detail-member-avatar">${avatarHTML}</div>
                    <div class="group-detail-member-info">
                        <div class="group-detail-member-name">${escapeHtml(un)}</div>
                        <div class="group-detail-member-role">
                            <span class="role-badge ${roleClass}">${roleText}</span>
                        </div>
                    </div>
                    ${menuItems ? `
                        <div style="position: relative;">
                            <button class="group-detail-member-more" data-member-id="${uid}">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <circle cx="12" cy="12" r="1"/>
                                    <circle cx="19" cy="12" r="1"/>
                                    <circle cx="5" cy="12" r="1"/>
                                </svg>
                            </button>
                            <div class="group-detail-member-dropdown" style="display: none;">
                                ${menuItems}
                            </div>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
    }
    
    closeAppModal();
    const overlay = document.createElement('div');
    overlay.className = 'app-modal-overlay';
    overlay.id = 'app-modal-overlay';
    overlay.innerHTML = `
        <div class="app-modal" style="max-width:520px;">
            <div class="app-modal-header">
                <span>群聊详情</span>
                <button type="button" class="app-modal-close" data-close="1">&times;</button>
            </div>
            <div class="app-modal-body">
                <p><strong>名称：</strong>${escapeHtml(g.name || '')}</p>
                <p><strong>群 ID：</strong>${escapeHtml(String(g.id || realGroupId))}</p>
                <p><strong>成员数：</strong>${members.length}</p>
                <p style="margin-top:12px; font-weight:600;">成员列表</p>
                <div class="group-detail-search">
                    <input type="text" id="group-member-search" placeholder="搜索群成员...">
                </div>
                <div class="app-modal-list" id="group-member-list" style="max-height:300px; border:none; background:transparent;"></div>
            </div>
        </div>`;
    
    document.body.appendChild(overlay);
    
    const memberList = document.getElementById('group-member-list');
    memberList.innerHTML = renderMembers();
    
    const searchInput = document.getElementById('group-member-search');
    searchInput.addEventListener('input', (e) => {
        memberList.innerHTML = renderMembers(e.target.value);
    });
    
    function closeOpenDropdown() {
        if (openDropdown) {
            openDropdown.style.display = 'none';
            openDropdown = null;
        }
    }
    
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            closeAppModal();
            return;
        }
        
        const moreBtn = e.target.closest('.group-detail-member-more');
        if (moreBtn) {
            const container = moreBtn.closest('.group-detail-member');
            const dropdown = container.querySelector('.group-detail-member-dropdown');
            
            if (openDropdown === dropdown) {
                dropdown.style.display = 'none';
                openDropdown = null;
            } else {
                closeOpenDropdown();
                dropdown.style.display = 'block';
                openDropdown = dropdown;
            }
            return;
        }
        
        const menuItem = e.target.closest('.group-detail-member-dropdown-item');
        if (menuItem) {
            const action = menuItem.dataset.action;
            const userId = menuItem.dataset.id;
            const userName = menuItem.dataset.name;
            
            closeOpenDropdown();
            
            if (action === 'add-friend') {
                fetchAPI('friends', 'send_request', { friend_id: userId }).then(r => {
                    alert(r.success ? '好友请求已发送' : (r.message || '发送失败'));
                });
            } else if (action === 'set-admin') {
                if (confirm(`确定将 ${userName} 设为管理员吗？`)) {
                    fetchAPI('groups', 'set_admin', { group_id: realGroupId, user_id: userId, is_admin: 1 }).then(r => {
                        if (r.success) {
                            alert(r.message || '已设置为管理员');
                            window.showGroupDetails(realGroupId);
                        } else {
                            alert(r.message || '操作失败');
                        }
                    });
                }
            } else if (action === 'remove-admin') {
                if (confirm(`确定取消 ${userName} 的管理员身份吗？`)) {
                    fetchAPI('groups', 'set_admin', { group_id: realGroupId, user_id: userId, is_admin: 0 }).then(r => {
                        if (r.success) {
                            alert(r.message || '已取消管理员');
                            window.showGroupDetails(realGroupId);
                        } else {
                            alert(r.message || '操作失败');
                        }
                    });
                }
            } else if (action === 'kick') {
                if (confirm(`确定将 ${userName} 踢出群聊吗？`)) {
                    fetchAPI('groups', 'remove_member', { group_id: realGroupId, user_id: userId }).then(r => {
                        if (r.success) {
                            alert(r.message || '已踢出群聊');
                            window.showGroupDetails(realGroupId);
                        } else {
                            alert(r.message || '操作失败');
                        }
                    });
                }
            }
            return;
        }
        
        closeOpenDropdown();
    });
    
    overlay.querySelector('[data-close]').onclick = () => closeAppModal();
};

window.leaveGroup = async function(groupId) {
    window.closeContactMenu();
    if (confirm('确定要退出这个群聊吗？')) {
        const realGroupId = groupId.replace(/^(friend|group)_/, '');
        const result = await fetchAPI('groups', 'leave', { group_id: realGroupId });
        if (result.success) {
            alert('退出成功');
            await loadGroups();
            await renderContacts();
        } else {
            alert('退出失败: ' + result.message);
        }
    }
};

function compareVersions(v1, v2) {
    const parts1 = v1.replace(/^V/i, '').split('.').map(Number);
    const parts2 = v2.replace(/^V/i, '').split('.').map(Number);
    
    const length = Math.max(parts1.length, parts2.length);
    
    for (let i = 0; i < length; i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;
        
        if (p1 > p2) return 1;
        if (p1 < p2) return -1;
    }
    
    return 0;
}

// 检查更新
async function checkForUpdates() {
    try {
        console.log('[Update] 正在检查更新，当前版本:', CURRENT_VERSION);
        const response = await fetch(OFFICIAL_VERSION_URL);
        
        if (!response.ok) {
            console.error('[Update] 服务器返回错误:', response.status);
            return;
        }
        
        const data = await response.json();
        
        if (!data.version) {
            console.warn('[Update] 服务器未返回版本信息');
            return;
        }
        
        console.log('[Update] 服务器版本:', data.version);
        
        const compareResult = compareVersions(data.version, CURRENT_VERSION);
        
        if (compareResult > 0) {
            console.log('[Update] 发现新版本，显示更新弹窗');
            showUpdateModal(data);
        } else if (compareResult === 0) {
            console.log('[Update] 当前已是最新版本');
        } else {
            console.log('[Update] 当前版本高于服务器版本');
        }
    } catch (error) {
        console.error('[Update] 检查更新失败:', error);
    }
}

// 显示更新弹窗
function showUpdateModal(updateData) {
    document.getElementById('currentVersion').textContent = CURRENT_VERSION;
    document.getElementById('updateVersion').textContent = updateData.version;
    document.getElementById('updateMessage').textContent = updateData.update_message || '暂无更新内容';
    
    // 根据是否强制更新决定是否显示跳过按钮
    if (updateData.update_must) {
        document.getElementById('skipBtn').style.display = 'none';
    } else {
        document.getElementById('skipBtn').style.display = 'block';
    }
    
    document.getElementById('updateModal').style.display = 'flex';
    
    // 添加事件监听
    document.getElementById('updateBtn').onclick = () => downloadUpdate(updateData.downloadUrl);
    document.getElementById('skipBtn').onclick = hideUpdateModal;
}

// 隐藏更新弹窗
function hideUpdateModal() {
    document.getElementById('updateModal').style.display = 'none';
}

// 下载更新
async function downloadUpdate(downloadUrl) {
    if (!downloadUrl) {
        alert('更新包下载地址不可用');
        return;
    }
    
    // 显示进度条
    document.getElementById('updateProgress').style.display = 'block';
    document.getElementById('updateBtn').style.display = 'none';
    document.getElementById('skipBtn').style.display = 'none';
    
    try {
        const response = await fetch(downloadUrl);
        const totalSize = parseInt(response.headers.get('Content-Length')) || 0;
        const blob = await response.blob();
        
        // 计算进度
        const progress = totalSize > 0 ? ((blob.size / totalSize) * 100).toFixed(0) : 100;
        document.getElementById('progressFill').style.width = progress + '%';
        document.getElementById('progressText').textContent = `下载完成`;
        
        // 使用 Electron API 保存文件到缓存目录并启动更新
        if (window.electronAPI && window.electronAPI.downloadUpdate) {
            await window.electronAPI.downloadUpdate(blob, downloadUrl.split('/').pop());
        }
    } catch (error) {
        console.error('下载更新失败:', error);
        alert('下载更新失败，请稍后重试');
        document.getElementById('updateProgress').style.display = 'none';
        document.getElementById('updateBtn').style.display = 'block';
        if (document.getElementById('skipBtn').dataset.must !== 'true') {
            document.getElementById('skipBtn').style.display = 'block';
        }
    }
}

async function init() {
    await checkForUpdates();
    
    await loadUserData();
    await loadFriends();
    await loadGroups();
    await loadSessionsInfo();
    renderContacts();

    handleResize();
    window.addEventListener('resize', handleResize);
}

// 初始化 IndexedDB 后再执行初始化
initIndexedDB().then(() => {
    console.log('IndexedDB 初始化成功，开始加载数据');
    init();
}).catch(error => {
    console.error('IndexedDB 初始化失败，继续加载但不使用缓存:', error);
    // 即使 IndexedDB 初始化失败，也要继续加载
    init();
});
