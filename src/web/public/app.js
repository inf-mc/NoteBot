// 全局变量
let currentPage = 'dashboard';
let authToken = localStorage.getItem('authToken');
let wsConnection = null;
let refreshInterval = null;

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

// 初始化应用
function initializeApp() {
    // 检查登录状态
    if (!authToken) {
        showLoginModal();
        return;
    }
    
    // 隐藏登录模态框
    hideLoginModal();
    
    // 初始化事件监听器
    initializeEventListeners();
    
    // 建立WebSocket连接
    connectWebSocket();
    
    // 加载初始数据
    loadDashboardData();
    
    // 设置定时刷新
    startRefreshInterval();
}

// 初始化事件监听器
function initializeEventListeners() {
    // 侧边栏切换
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const sidebar = document.getElementById('sidebar');
    
    sidebarToggle.addEventListener('click', function() {
        sidebar.classList.toggle('-translate-x-full');
    });
    
    // 点击外部关闭侧边栏（移动端）
    document.addEventListener('click', function(e) {
        if (window.innerWidth < 1024) {
            if (!sidebar.contains(e.target) && !sidebarToggle.contains(e.target)) {
                sidebar.classList.add('-translate-x-full');
            }
        }
    });
    
    // 导航项点击事件
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            // 移除所有活跃状态
            document.querySelectorAll('.nav-item').forEach(nav => {
                nav.classList.remove('bg-blue-50', 'text-blue-600');
            });
            // 添加当前活跃状态
            this.classList.add('bg-blue-50', 'text-blue-600');
        });
    });
}

// 显示登录模态框
function showLoginModal() {
    document.getElementById('login-modal').classList.remove('hidden');
}

// 隐藏登录模态框
function hideLoginModal() {
    document.getElementById('login-modal').classList.add('hidden');
}

// 登录处理
async function login(event) {
    event.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorDiv = document.getElementById('login-error');
    
    try {
        showLoading();
        
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            authToken = data.token;
            localStorage.setItem('authToken', authToken);
            hideLoginModal();
            initializeApp();
        } else {
            errorDiv.textContent = data.message || '登录失败';
            errorDiv.classList.remove('hidden');
        }
    } catch (error) {
        errorDiv.textContent = '网络错误，请重试';
        errorDiv.classList.remove('hidden');
    } finally {
        hideLoading();
    }
}

// 退出登录
function logout() {
    localStorage.removeItem('authToken');
    authToken = null;
    
    // 断开WebSocket连接
    if (wsConnection) {
        wsConnection.close();
        wsConnection = null;
    }
    
    // 清除定时器
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
    
    // 显示登录模态框
    showLoginModal();
}

// 显示加载指示器
function showLoading() {
    document.getElementById('loading').classList.remove('hidden');
}

// 隐藏加载指示器
function hideLoading() {
    document.getElementById('loading').classList.add('hidden');
}

// 页面切换
function showPage(pageName) {
    // 隐藏所有页面
    document.querySelectorAll('.page-content').forEach(page => {
        page.classList.add('hidden');
    });
    
    // 显示目标页面
    const targetPage = document.getElementById(pageName + '-page');
    if (targetPage) {
        targetPage.classList.remove('hidden');
        targetPage.classList.add('fade-in');
    }
    
    // 更新页面标题
    const titles = {
        'dashboard': '仪表板',
        'plugins': '插件管理',
        'tasks': '定时任务',
        'onebot': 'Onebot 连接',
        'config': '系统配置',
        'logs': '系统日志'
    };
    
    document.getElementById('page-title').textContent = titles[pageName] || '未知页面';
    currentPage = pageName;
    
    // 加载页面数据
    loadPageData(pageName);
    
    // 移动端自动关闭侧边栏
    if (window.innerWidth < 1024) {
        document.getElementById('sidebar').classList.add('-translate-x-full');
    }
}

// 加载页面数据
function loadPageData(pageName) {
    switch (pageName) {
        case 'dashboard':
            loadDashboardData();
            break;
        case 'plugins':
            loadPluginsData();
            break;
        case 'tasks':
            loadTasksData();
            break;
        case 'onebot':
            loadOnebotData();
            break;
        case 'config':
            loadConfigData();
            break;
        case 'logs':
            loadLogsData();
            break;
    }
}

// 加载仪表板数据
async function loadDashboardData() {
    try {
        const response = await apiRequest('/api/system/status');
        
        if (response.success) {
            const data = response.data;
            
            // 更新状态卡片
            document.getElementById('system-status').textContent = data.status || '正常';
            document.getElementById('plugin-count').textContent = data.pluginCount || 0;
            document.getElementById('task-count').textContent = data.taskCount || 0;
            document.getElementById('connection-count').textContent = data.connectionCount || 0;
            
            // 更新系统信息
            document.getElementById('system-version').textContent = data.version || '1.0.0';
            document.getElementById('system-uptime').textContent = formatUptime(data.uptime || 0);
            document.getElementById('memory-usage').textContent = formatMemory(data.memoryUsage || 0);
            document.getElementById('node-version').textContent = data.nodeVersion || process.version;
            
            // 更新连接状态
            updateConnectionStatus(data.status === '正常');
        }
    } catch (error) {
        console.error('加载仪表板数据失败:', error);
    }
}

// 加载插件数据
async function loadPluginsData() {
    try {
        const response = await apiRequest('/api/plugins');
        
        if (response.success) {
            renderPluginsList(response.data);
        }
    } catch (error) {
        console.error('加载插件数据失败:', error);
    }
}

// 渲染插件列表
function renderPluginsList(plugins) {
    const container = document.getElementById('plugins-list');
    
    if (!plugins || plugins.length === 0) {
        container.innerHTML = '<div class="text-center text-gray-500 py-8">暂无插件</div>';
        return;
    }
    
    container.innerHTML = plugins.map(plugin => `
        <div class="border border-gray-200 rounded-lg p-4">
            <div class="flex items-center justify-between">
                <div class="flex items-center">
                    <div class="p-2 rounded-lg ${plugin.enabled ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-600'}">
                        <i class="fas fa-puzzle-piece"></i>
                    </div>
                    <div class="ml-4">
                        <h4 class="text-lg font-medium text-gray-900">${plugin.name}</h4>
                        <p class="text-sm text-gray-500">${plugin.description || '无描述'}</p>
                        <div class="flex items-center mt-1">
                            <span class="status-dot ${plugin.enabled ? 'status-online' : 'status-offline'}"></span>
                            <span class="text-xs text-gray-500">${plugin.enabled ? '已启用' : '已禁用'}</span>
                            <span class="mx-2 text-gray-300">|</span>
                            <span class="text-xs text-gray-500">版本 ${plugin.version || '1.0.0'}</span>
                        </div>
                    </div>
                </div>
                <div class="flex items-center space-x-2">
                    <button onclick="togglePlugin('${plugin.id}', ${!plugin.enabled})" 
                            class="px-3 py-1 text-sm rounded ${plugin.enabled ? 'bg-red-100 text-red-600 hover:bg-red-200' : 'bg-green-100 text-green-600 hover:bg-green-200'}">
                        ${plugin.enabled ? '禁用' : '启用'}
                    </button>
                    <button onclick="configurePlugin('${plugin.id}')" 
                            class="px-3 py-1 text-sm bg-blue-100 text-blue-600 rounded hover:bg-blue-200">
                        配置
                    </button>
                    <button onclick="reloadPlugin('${plugin.id}')" 
                            class="px-3 py-1 text-sm bg-gray-100 text-gray-600 rounded hover:bg-gray-200">
                        重载
                    </button>
                </div>
            </div>
        </div>
    `).join('');
}

// 加载任务数据
async function loadTasksData() {
    try {
        const response = await apiRequest('/api/tasks');
        
        if (response.success) {
            renderTasksList(response.data);
        }
    } catch (error) {
        console.error('加载任务数据失败:', error);
    }
}

// 渲染任务列表
function renderTasksList(tasks) {
    const container = document.getElementById('tasks-list');
    
    if (!tasks || tasks.length === 0) {
        container.innerHTML = '<div class="text-center text-gray-500 py-8">暂无任务</div>';
        return;
    }
    
    container.innerHTML = tasks.map(task => `
        <div class="border border-gray-200 rounded-lg p-4">
            <div class="flex items-center justify-between">
                <div class="flex items-center">
                    <div class="p-2 rounded-lg ${task.enabled ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600'}">
                        <i class="fas fa-clock"></i>
                    </div>
                    <div class="ml-4">
                        <h4 class="text-lg font-medium text-gray-900">${task.name}</h4>
                        <p class="text-sm text-gray-500">${task.description || '无描述'}</p>
                        <div class="flex items-center mt-1">
                            <span class="status-dot ${task.enabled ? 'status-online' : 'status-offline'}"></span>
                            <span class="text-xs text-gray-500">${task.enabled ? '运行中' : '已停止'}</span>
                            <span class="mx-2 text-gray-300">|</span>
                            <span class="text-xs text-gray-500">Cron: ${task.cron}</span>
                            <span class="mx-2 text-gray-300">|</span>
                            <span class="text-xs text-gray-500">下次执行: ${formatNextRun(task.nextRun)}</span>
                        </div>
                    </div>
                </div>
                <div class="flex items-center space-x-2">
                    <button onclick="toggleTask('${task.id}', ${!task.enabled})" 
                            class="px-3 py-1 text-sm rounded ${task.enabled ? 'bg-red-100 text-red-600 hover:bg-red-200' : 'bg-green-100 text-green-600 hover:bg-green-200'}">
                        ${task.enabled ? '停止' : '启动'}
                    </button>
                    <button onclick="runTaskNow('${task.id}')" 
                            class="px-3 py-1 text-sm bg-blue-100 text-blue-600 rounded hover:bg-blue-200">
                        立即执行
                    </button>
                </div>
            </div>
        </div>
    `).join('');
}

// 加载Onebot数据
async function loadOnebotData() {
    try {
        const response = await apiRequest('/api/onebot/status');
        
        if (response.success) {
            renderOnebotStatus(response.data);
        }
    } catch (error) {
        console.error('加载Onebot数据失败:', error);
    }
}

// 渲染Onebot状态
function renderOnebotStatus(status) {
    const container = document.getElementById('onebot-status');
    
    container.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="border border-gray-200 rounded-lg p-4">
                <h4 class="text-lg font-medium text-gray-900 mb-4">WebSocket 服务</h4>
                <div class="space-y-2">
                    <div class="flex justify-between">
                        <span class="text-sm text-gray-500">状态</span>
                        <span class="flex items-center text-sm">
                            <span class="status-dot ${status.wsServer?.running ? 'status-online' : 'status-offline'}"></span>
                            ${status.wsServer?.running ? '运行中' : '已停止'}
                        </span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-sm text-gray-500">端口</span>
                        <span class="text-sm text-gray-900">${status.wsServer?.port || '-'}</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-sm text-gray-500">连接数</span>
                        <span class="text-sm text-gray-900">${status.wsServer?.connections || 0}</span>
                    </div>
                </div>
            </div>
            
            <div class="border border-gray-200 rounded-lg p-4">
                <h4 class="text-lg font-medium text-gray-900 mb-4">HTTP 服务</h4>
                <div class="space-y-2">
                    <div class="flex justify-between">
                        <span class="text-sm text-gray-500">状态</span>
                        <span class="flex items-center text-sm">
                            <span class="status-dot ${status.httpServer?.running ? 'status-online' : 'status-offline'}"></span>
                            ${status.httpServer?.running ? '运行中' : '已停止'}
                        </span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-sm text-gray-500">端口</span>
                        <span class="text-sm text-gray-900">${status.httpServer?.port || '-'}</span>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="mt-6">
            <h4 class="text-lg font-medium text-gray-900 mb-4">连接列表</h4>
            <div class="space-y-2">
                ${status.connections && status.connections.length > 0 ? 
                    status.connections.map(conn => `
                        <div class="flex items-center justify-between p-3 border border-gray-200 rounded">
                            <div class="flex items-center">
                                <span class="status-dot status-online"></span>
                                <span class="text-sm text-gray-900">${conn.id}</span>
                            </div>
                            <div class="text-sm text-gray-500">
                                连接时间: ${formatTime(conn.connectedAt)}
                            </div>
                        </div>
                    `).join('') : 
                    '<div class="text-center text-gray-500 py-4">暂无连接</div>'
                }
            </div>
        </div>
    `;
}

// 加载配置数据
async function loadConfigData() {
    try {
        const response = await apiRequest('/api/config');
        
        if (response.success) {
            renderConfigForm(response.data);
        }
    } catch (error) {
        console.error('加载配置数据失败:', error);
    }
}

// 渲染配置表单
function renderConfigForm(config) {
    const container = document.getElementById('config-form');
    
    container.innerHTML = `
        <form onsubmit="saveConfig(event)">
            <div class="space-y-6">
                <div>
                    <h4 class="text-lg font-medium text-gray-900 mb-4">服务器配置</h4>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">HTTP 端口</label>
                            <input type="number" name="server.port" value="${config.server?.port || 3000}" 
                                   class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">WebSocket 端口</label>
                            <input type="number" name="server.wsPort" value="${config.server?.wsPort || 8080}" 
                                   class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                        </div>
                    </div>
                </div>
                
                <div>
                    <h4 class="text-lg font-medium text-gray-900 mb-4">Redis 配置</h4>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">主机</label>
                            <input type="text" name="redis.host" value="${config.redis?.host || 'localhost'}" 
                                   class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">端口</label>
                            <input type="number" name="redis.port" value="${config.redis?.port || 6379}" 
                                   class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                        </div>
                    </div>
                </div>
                
                <div>
                    <h4 class="text-lg font-medium text-gray-900 mb-4">Onebot 配置</h4>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">访问令牌</label>
                            <input type="text" name="onebot.accessToken" value="${config.onebot?.accessToken || ''}" 
                                   class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">心跳间隔 (秒)</label>
                            <input type="number" name="onebot.heartbeatInterval" value="${config.onebot?.heartbeatInterval || 30}" 
                                   class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="mt-8 flex justify-end">
                <button type="submit" class="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                    保存配置
                </button>
            </div>
        </form>
    `;
}

// 加载日志数据
async function loadLogsData() {
    try {
        const level = document.getElementById('log-level')?.value || 'info';
        const response = await apiRequest(`/api/logs?level=${level}&limit=100`);
        
        if (response.success) {
            renderLogs(response.data);
        }
    } catch (error) {
        console.error('加载日志数据失败:', error);
    }
}

// 渲染日志
function renderLogs(logs) {
    const container = document.getElementById('logs-container');
    
    if (!logs || logs.length === 0) {
        container.innerHTML = '<div class="text-center text-gray-400 py-8">暂无日志</div>';
        return;
    }
    
    container.innerHTML = logs.map(log => {
        const levelColors = {
            error: 'text-red-400',
            warn: 'text-yellow-400',
            info: 'text-green-400',
            debug: 'text-blue-400'
        };
        
        return `
            <div class="mb-1">
                <span class="text-gray-500">[${formatTime(log.timestamp)}]</span>
                <span class="${levelColors[log.level] || 'text-green-400'} font-bold">[${log.level.toUpperCase()}]</span>
                <span class="text-gray-300">${log.message}</span>
            </div>
        `;
    }).join('');
    
    // 滚动到底部
    container.scrollTop = container.scrollHeight;
}

// API 请求封装
async function apiRequest(url, options = {}) {
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
        }
    };
    
    const response = await fetch(url, { ...defaultOptions, ...options });
    
    if (response.status === 401) {
        // 未授权，重新登录
        logout();
        throw new Error('未授权');
    }
    
    return await response.json();
}

// 建立WebSocket连接
function connectWebSocket() {
    if (!authToken) return;
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?token=${authToken}`;
    
    wsConnection = new WebSocket(wsUrl);
    
    wsConnection.onopen = function() {
        console.log('WebSocket 连接已建立');
        updateConnectionStatus(true);
    };
    
    wsConnection.onmessage = function(event) {
        try {
            const data = JSON.parse(event.data);
            handleWebSocketMessage(data);
        } catch (error) {
            console.error('解析WebSocket消息失败:', error);
        }
    };
    
    wsConnection.onclose = function() {
        console.log('WebSocket 连接已关闭');
        updateConnectionStatus(false);
        
        // 5秒后尝试重连
        setTimeout(() => {
            if (authToken) {
                connectWebSocket();
            }
        }, 5000);
    };
    
    wsConnection.onerror = function(error) {
        console.error('WebSocket 错误:', error);
        updateConnectionStatus(false);
    };
}

// 处理WebSocket消息
function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'system_status':
            if (currentPage === 'dashboard') {
                loadDashboardData();
            }
            break;
        case 'plugin_status':
            if (currentPage === 'plugins') {
                loadPluginsData();
            }
            break;
        case 'task_status':
            if (currentPage === 'tasks') {
                loadTasksData();
            }
            break;
        case 'log':
            if (currentPage === 'logs') {
                appendLog(data.data);
            }
            break;
    }
}

// 更新连接状态
function updateConnectionStatus(connected) {
    const statusElement = document.getElementById('connection-status');
    const statusDot = statusElement.previousElementSibling;
    
    if (connected) {
        statusElement.textContent = '系统正常';
        statusDot.className = 'status-dot status-online';
    } else {
        statusElement.textContent = '连接断开';
        statusDot.className = 'status-dot status-offline';
    }
}

// 启动定时刷新
function startRefreshInterval() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
    }
    
    refreshInterval = setInterval(() => {
        if (currentPage === 'dashboard') {
            loadDashboardData();
        }
    }, 30000); // 30秒刷新一次
}

// 插件操作函数
async function togglePlugin(pluginId, enable) {
    try {
        showLoading();
        const action = enable ? 'enable' : 'disable';
        await apiRequest(`/api/plugins/${pluginId}/${action}`, { method: 'POST' });
        loadPluginsData();
    } catch (error) {
        console.error('切换插件状态失败:', error);
    } finally {
        hideLoading();
    }
}

async function configurePlugin(pluginId) {
    // TODO: 实现插件配置界面
    alert('插件配置功能开发中...');
}

async function reloadPlugin(pluginId) {
    try {
        showLoading();
        await apiRequest(`/api/plugins/${pluginId}/reload`, { method: 'POST' });
        loadPluginsData();
    } catch (error) {
        console.error('重载插件失败:', error);
    } finally {
        hideLoading();
    }
}

// 任务操作函数
async function toggleTask(taskId, enable) {
    try {
        showLoading();
        const action = enable ? 'start' : 'stop';
        await apiRequest(`/api/tasks/${taskId}/${action}`, { method: 'POST' });
        loadTasksData();
    } catch (error) {
        console.error('切换任务状态失败:', error);
    } finally {
        hideLoading();
    }
}

async function runTaskNow(taskId) {
    try {
        showLoading();
        await apiRequest(`/api/tasks/${taskId}/run`, { method: 'POST' });
        alert('任务已触发执行');
    } catch (error) {
        console.error('执行任务失败:', error);
    } finally {
        hideLoading();
    }
}

// 配置保存
async function saveConfig(event) {
    event.preventDefault();
    
    try {
        showLoading();
        
        const formData = new FormData(event.target);
        const config = {};
        
        for (const [key, value] of formData.entries()) {
            const keys = key.split('.');
            let current = config;
            
            for (let i = 0; i < keys.length - 1; i++) {
                if (!current[keys[i]]) {
                    current[keys[i]] = {};
                }
                current = current[keys[i]];
            }
            
            current[keys[keys.length - 1]] = isNaN(value) ? value : Number(value);
        }
        
        await apiRequest('/api/config', {
            method: 'POST',
            body: JSON.stringify(config)
        });
        
        alert('配置保存成功');
    } catch (error) {
        console.error('保存配置失败:', error);
        alert('保存配置失败');
    } finally {
        hideLoading();
    }
}

// 刷新函数
function refreshPlugins() {
    loadPluginsData();
}

function refreshTasks() {
    loadTasksData();
}

function refreshLogs() {
    loadLogsData();
}

// 工具函数
function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) {
        return `${days}天 ${hours}小时 ${minutes}分钟`;
    } else if (hours > 0) {
        return `${hours}小时 ${minutes}分钟`;
    } else {
        return `${minutes}分钟`;
    }
}

function formatMemory(bytes) {
    const mb = bytes / 1024 / 1024;
    return `${mb.toFixed(2)} MB`;
}

function formatTime(timestamp) {
    return new Date(timestamp).toLocaleString('zh-CN');
}

function formatNextRun(timestamp) {
    if (!timestamp) return '未知';
    return new Date(timestamp).toLocaleString('zh-CN');
}

function appendLog(log) {
    const container = document.getElementById('logs-container');
    const levelColors = {
        error: 'text-red-400',
        warn: 'text-yellow-400',
        info: 'text-green-400',
        debug: 'text-blue-400'
    };
    
    const logElement = document.createElement('div');
    logElement.className = 'mb-1';
    logElement.innerHTML = `
        <span class="text-gray-500">[${formatTime(log.timestamp)}]</span>
        <span class="${levelColors[log.level] || 'text-green-400'} font-bold">[${log.level.toUpperCase()}]</span>
        <span class="text-gray-300">${log.message}</span>
    `;
    
    container.appendChild(logElement);
    container.scrollTop = container.scrollHeight;
    
    // 限制日志数量，避免内存泄漏
    const logs = container.children;
    if (logs.length > 1000) {
        container.removeChild(logs[0]);
    }
}