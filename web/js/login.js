window.OFFICIAL_SERVER = 'https://chat.hyacine.com.cn/chat/api-pc.php';
const CURRENT_VERSION = 'V0.0.3';
const OFFICIAL_VERSION_URL = 'https://chat.hyacine.com.cn/version-app-pc.json';

function getApiBaseUrl() {
    const customServer = localStorage.getItem('custom_server');
    return customServer || window.OFFICIAL_SERVER;
}

async function fetchAPI(resource, action, data = {}) {
    try {
        const response = await fetch(getApiBaseUrl(), {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                resource,
                action,
                ...data
            })
        });
        
        const result = await response.json();
        return result;
    } catch (error) {
        console.error('API请求失败:', error);
        return { success: false, message: '网络错误' };
    }
}

// 保存登录凭证到本地存储
function saveLoginCredentials(email, password) {
    const expiryTime = new Date();
    expiryTime.setDate(expiryTime.getDate() + 7); // 7天过期
    
    const credentials = {
        email,
        password,
        expiry: expiryTime.getTime()
    };
    
    localStorage.setItem('loginCredentials', JSON.stringify(credentials));
}

// 获取本地存储的登录凭证
function getLoginCredentials() {
    const stored = localStorage.getItem('loginCredentials');
    if (!stored) return null;
    
    try {
        const credentials = JSON.parse(stored);
        const currentTime = new Date().getTime();
        
        if (currentTime > credentials.expiry) {
            // 凭证已过期
            localStorage.removeItem('loginCredentials');
            return null;
        }
        
        return credentials;
    } catch (error) {
        console.error('解析登录凭证失败:', error);
        localStorage.removeItem('loginCredentials');
        return null;
    }
}

// 自动登录
async function autoLogin() {
    const credentials = getLoginCredentials();
    if (!credentials) return;
    
    const result = await fetchAPI('auth', 'login', {
        email: credentials.email,
        password: credentials.password
    });
    
    if (result.success) {
        // 保存 access_key
        if (result.access_key) {
            localStorage.setItem('access_key', result.access_key);
        }
        window.location.href = 'chat.html';
    } else {
        // 自动登录失败，清除凭证
        localStorage.removeItem('loginCredentials');
    }
}

document.getElementById('loginForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    
    const result = await fetchAPI('auth', 'login', {
        email,
        password
    });
    
    if (result.success) {
        // 保存登录凭证
        saveLoginCredentials(email, password);
        // 保存 access_key
        if (result.access_key) {
            localStorage.setItem('access_key', result.access_key);
        }
        alert('登录成功！');
        window.location.href = 'chat.html';
    } else {
        alert('登录失败：' + result.message);
    }
});

// ==================== 协议弹窗功能 ====================

// 检查是否已经同意协议
function hasAgreedToAgreements() {
    return localStorage.getItem('agreements_accepted') === 'true';
}

// 标记已同意协议
function markAgreementsAccepted() {
    localStorage.setItem('agreements_accepted', 'true');
    localStorage.setItem('agreements_accepted_time', new Date().toISOString());
}

// 简单Markdown渲染
function renderMarkdown(text) {
    if (!text) return '';
    
    let html = text;
    
    // 先处理标题（从高优先级到低优先级）
    html = html.replace(/^#### (.*$)/gim, '<h4 style="margin: 14px 0 6px; color: #1a1a1a; font-size: 15px; font-weight: 600;">$1</h4>');
    html = html.replace(/^### (.*$)/gim, '<h3 style="margin: 16px 0 8px; color: #1a1a1a; font-size: 16px; font-weight: 600;">$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2 style="margin: 20px 0 10px; color: #1a1a1a; font-size: 18px; font-weight: 600;">$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1 style="margin: 24px 0 12px; color: #1a1a1a; font-size: 22px; font-weight: 700;">$1</h1>');
    
    // 粗体
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong style="font-weight: 600;">$1</strong>');
    
    // 无序列表（处理嵌套）
    // 先移除多余的列表符号
    html = html.replace(/^•\s*/gm, '');
    // 处理标准列表格式
    html = html.replace(/^- (.*$)/gm, '<li style="margin-left: 24px; margin-bottom: 4px; color: #444;">$1</li>');
    
    // 水平线
    html = html.replace(/^---$/gm, '<hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">');
    
    // 段落（在标题和列表之后处理）
    html = html.replace(/^(?!<h|<li|<ul|<ol|<hr)(.+)$/gm, '<p style="margin: 8px 0; line-height: 1.6; color: #444;">$1</p>');
    
    // 将连续的 li 标签包装在 ul 中
    html = html.replace(/(<li[^>]*>[\s\S]*?<\/li>)(\s*<li[^>]*>[\s\S]*?<\/li>)+/g, '<ul style="margin: 8px 0; padding-left: 0;">$&</ul>');
    
    // 表格
    html = html.replace(/\|(.+)\|\n\|[-|]+\|\n((?:\|.+\|\n?)+)/g, function(match, header, body) {
        const headerCells = header.split('|').filter(cell => cell.trim());
        const bodyRows = body.trim().split('\n');
        
        let table = '<table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">';
        table += '<thead><tr>';
        headerCells.forEach(cell => {
            table += `<th style="border: 1px solid #ddd; padding: 8px; text-align: left; background: #f8f9fa;">${cell.trim()}</th>`;
        });
        table += '</tr></thead><tbody>';
        
        bodyRows.forEach(row => {
            const cells = row.split('|').filter(cell => cell.trim());
            table += '<tr>';
            cells.forEach(cell => {
                table += `<td style="border: 1px solid #ddd; padding: 8px;">${cell.trim()}</td>`;
            });
            table += '</tr>';
        });
        
        table += '</tbody></table>';
        return table;
    });
    
    // 移除多余的空段落和标签
    html = html.replace(/<p>\s*<\/p>/g, '');
    html = html.replace(/<ul>\s*<\/ul>/g, '');
    html = html.replace(/\n/g, '');
    
    return html;
}

// 加载协议内容
async function loadAgreements() {
    try {
        // 获取资源目录路径
        let resourcesPath = '../resources';
        if (window.electronAPI && window.electronAPI.getResourcesPath) {
            try {
                resourcesPath = await window.electronAPI.getResourcesPath();
            } catch (e) {
                console.warn('获取资源路径失败，使用默认路径:', e);
            }
        }
        
        // 确保路径格式正确（file:// 或 http 格式）
        const privacyUrl = resourcesPath.startsWith('file://') 
            ? `${resourcesPath}/privacy_policy.md`
            : `file://${resourcesPath}/privacy_policy.md`;
        const termsUrl = resourcesPath.startsWith('file://') 
            ? `${resourcesPath}/terms_of_service.md`
            : `file://${resourcesPath}/terms_of_service.md`;
        
        const privacyResponse = await fetch(privacyUrl);
        const termsResponse = await fetch(termsUrl);
        
        return {
            privacy: await privacyResponse.text(),
            terms: await termsResponse.text()
        };
    } catch (error) {
        console.error('加载协议文件失败:', error);
        return {
            privacy: '无法加载隐私政策',
            terms: '无法加载用户协议'
        };
    }
}

// 显示协议弹窗

async function showAgreementModal() {
    const agreements = await loadAgreements();
    
    const content = `
        <div style="margin-bottom: 24px;">
            <h2 style="color: #6366f1; border-bottom: 2px solid #6366f1; padding-bottom: 8px; margin-bottom: 16px;">📋 用户协议</h2>
            ${renderMarkdown(agreements.terms)}
        </div>
        <div>
            <h2 style="color: #6366f1; border-bottom: 2px solid #6366f1; padding-bottom: 8px; margin-bottom: 16px;">🔒 隐私政策</h2>
            ${renderMarkdown(agreements.privacy)}
        </div>
    `;
    
    document.getElementById('agreementContent').innerHTML = content;
    document.getElementById('agreementModal').style.display = 'flex';
    
    // 开始倒计时（必须滚动到底部才能开始倒计时）
    setupAgreementCountdown();
}

// 设置协议倒计时
function setupAgreementCountdown() {
    const contentDiv = document.getElementById('agreementContent');
    const checkbox = document.getElementById('agreeCheckbox');
    const agreeBtn = document.getElementById('agreeBtn');
    const countdownSpan = document.getElementById('agreeCountdown');
    const agreeLabel = document.getElementById('agreeLabel');
    
    let countdown = 20;
    let countdownInterval = null;
    
    // 自动开始倒计时（无需滚动到底部）
    function startCountdown() {
        if (countdownInterval) return;
        
        countdownInterval = setInterval(function() {
            countdown--;
            countdownSpan.textContent = countdown;
            
            if (countdown <= 0) {
                clearInterval(countdownInterval);
                checkbox.disabled = false;
                checkbox.checked = true; // 自动勾选
                agreeBtn.disabled = false;
                agreeBtn.style.opacity = '1';
                agreeBtn.style.cursor = 'pointer';
                agreeBtn.innerHTML = '同意';
                agreeBtn.style.background = '#409eff';
                agreeBtn.style.color = '#fff';
                agreeBtn.style.border = 'none';
                agreeLabel.style.color = '#333';
            }
        }, 1000);
    }
    
    // 立即开始倒计时
    startCountdown();
    
    // 同意按钮点击事件
    agreeBtn.onclick = function() {
        if (checkbox.checked) {
            markAgreementsAccepted();
            closeAgreementModal();
            // 同意后检查更新
            checkForUpdates();
        }
    };
}

// 关闭协议弹窗
function closeAgreementModal() {
    document.getElementById('agreementModal').style.display = 'none';
}

// ==================== 更新弹窗功能 ====================

// 检查是否忽略了当前版本更新
function hasIgnoredUpdate(version) {
    const ignoredVersion = localStorage.getItem('ignored_version');
    return ignoredVersion === version;
}

// 标记忽略更新
function ignoreUpdate() {
    const latestVersion = document.getElementById('latestVersion').textContent;
    localStorage.setItem('ignored_version', latestVersion);
    document.getElementById('updateModal').style.display = 'none';
    // 开始自动登录
    autoLogin();
}

// 显示下载进度
function showDownloadProgress() {
    document.getElementById('downloadButtons').style.display = 'none';
    document.getElementById('downloadProgressContainer').style.display = 'block';
}

// 更新下载进度
function updateDownloadProgress(data) {
    document.getElementById('downloadProgressText').textContent = data.percent + '%';
    document.getElementById('downloadProgressBar').style.width = data.percent + '%';
    document.getElementById('downloadSpeed').textContent = '速度: ' + data.speed + '/s';
    document.getElementById('downloadSize').textContent = data.downloaded + ' / ' + data.total;
    document.getElementById('downloadETA').textContent = '剩余时间: ' + data.eta;
    
    if (data.completed) {
        alert('下载完成！文件已保存到下载目录');
    }
}

// 普通下载
async function normalDownload() {
    const downloadUrl = document.getElementById('updateModal').dataset.downloadUrl;
    if (!downloadUrl) return;
    
    try {
        showDownloadProgress();
        
        if (window.electronAPI && window.electronAPI.normalDownload) {
            // 使用 Electron API 下载（带进度）
            window.electronAPI.normalDownload(downloadUrl)
                .then(result => {
                    console.log('下载完成:', result);
                })
                .catch(error => {
                    console.error('下载失败:', error);
                    alert('下载失败: ' + error.message);
                    document.getElementById('downloadButtons').style.display = 'flex';
                    document.getElementById('downloadProgressContainer').style.display = 'none';
                });
        } else {
            // 降级方案：使用浏览器下载
            const response = await fetch(downloadUrl);
            const blob = await response.blob();
            
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `modern-chat-setup.exe`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            alert('下载已开始');
        }
    } catch (error) {
        console.error('下载失败:', error);
        alert('下载失败: ' + error.message);
    }
}

// 极速下载（使用 aria2c）
async function speedDownload() {
    const downloadUrl = document.getElementById('updateModal').dataset.downloadUrl;
    if (!downloadUrl) return;
    
    try {
        showDownloadProgress();
        
        if (window.electronAPI && window.electronAPI.speedDownload) {
            // 使用 Electron API 调用 aria2c
            window.electronAPI.speedDownload(downloadUrl)
                .then(result => {
                    console.log('极速下载完成:', result);
                })
                .catch(error => {
                    console.error('极速下载失败:', error);
                    // 降级到普通下载
                    alert('极速下载失败，将使用普通下载: ' + error.message);
                    normalDownload();
                });
        } else {
            // 降级方案：使用普通下载
            alert('极速下载需要 Electron 环境，将使用普通下载');
            normalDownload();
        }
    } catch (error) {
        console.error('极速下载失败:', error);
        alert('极速下载失败: ' + error.message);
    }
}

// 监听下载进度
function setupDownloadProgressListener() {
    if (window.electronAPI && window.electronAPI.onDownloadProgress) {
        window.electronAPI.onDownloadProgress((data) => {
            updateDownloadProgress(data);
        });
        console.log('[login] Download progress listener setup via electronAPI');
    } else if (window.ipcRenderer) {
        window.ipcRenderer.on('download-progress', (event, data) => {
            updateDownloadProgress(data);
        });
        console.log('[login] Download progress listener setup via ipcRenderer');
    } else {
        console.log('[login] No download progress listener available');
    }
}

// 页面加载时设置监听
window.addEventListener('DOMContentLoaded', () => {
    setupDownloadProgressListener();
});

// 检查更新
async function checkForUpdates() {
    const ignoredVersion = localStorage.getItem('ignored_version');
    
    try {
        const response = await fetch(OFFICIAL_VERSION_URL);
        const data = await response.json();
        
        if (data.version && data.version !== CURRENT_VERSION && data.version !== ignoredVersion) {
            // 显示更新弹窗
            document.getElementById('currentVersion').textContent = CURRENT_VERSION;
            document.getElementById('latestVersion').textContent = data.version;
            document.getElementById('updateMessage').textContent = data.update_message || '暂无更新说明';
            document.getElementById('updateModal').dataset.downloadUrl = data.downloadUrl;
            document.getElementById('updateModal').style.display = 'flex';
        } else {
            // 无需更新，开始自动登录
            autoLogin();
        }
    } catch (error) {
        console.error('检查更新失败:', error);
        // 更新检查失败，继续自动登录
        autoLogin();
    }
}

// 页面加载完成后执行
window.addEventListener('DOMContentLoaded', async function() {
    if (!hasAgreedToAgreements()) {
        // 首次进入，显示协议弹窗
        await showAgreementModal();
    } else {
        // 已同意协议，检查更新
        checkForUpdates();
    }
});