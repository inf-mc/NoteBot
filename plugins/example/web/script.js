/**
 * 示例插件管理界面交互脚本
 * 实现配置管理、状态监控和API通信功能
 */

class ExamplePluginManager {
    constructor() {
        this.config = {};
        this.status = {};
        this.isLoading = false;
        this.autoRefreshInterval = null;
        
        // API端点配置
        this.apiBase = '/plugins/example/api';
        this.endpoints = {
            config: `${this.apiBase}/config`,
            status: `${this.apiBase}/status`,
            toggle: `${this.apiBase}/toggle`,
            test: `${this.apiBase}/test`,
            reload: `${this.apiBase}/reload`
        };
        
        this.init();
    }

    /**
     * 初始化管理器
     */
    async init() {
        try {
            this.bindEvents();
            await this.loadConfig();
            await this.loadStatus();
            this.startAutoRefresh();
            this.showToast('管理界面加载完成', 'success');
        } catch (error) {
            console.error('初始化失败:', error);
            this.showToast('初始化失败: ' + error.message, 'error');
        }
    }

    /**
     * 绑定事件监听器
     */
    bindEvents() {
        // 插件开关
        document.getElementById('toggle-plugin').addEventListener('click', () => {
            this.togglePlugin();
        });

        // 重新加载配置
        document.getElementById('reload-config').addEventListener('click', () => {
            this.reloadConfig();
        });

        // 测试插件
        document.getElementById('test-plugin').addEventListener('click', () => {
            this.testPlugin();
        });

        // 导出配置
        document.getElementById('export-config').addEventListener('click', () => {
            this.exportConfig();
        });

        // 保存配置
        document.getElementById('save-config').addEventListener('click', () => {
            this.saveConfig();
        });

        // 重置配置
        document.getElementById('reset-config').addEventListener('click', () => {
            this.resetConfig();
        });

        // 加载默认值
        document.getElementById('load-defaults').addEventListener('click', () => {
            this.loadDefaults();
        });

        // 高级选项切换
        document.getElementById('toggle-advanced').addEventListener('click', () => {
            this.toggleAdvancedOptions();
        });

        // 表单输入监听
        this.bindFormEvents();

        // 模态框事件
        this.bindModalEvents();

        // Toast关闭事件
        document.querySelector('.toast-close').addEventListener('click', () => {
            this.hideToast();
        });
    }

    /**
     * 绑定表单事件
     */
    bindFormEvents() {
        // 监听所有输入字段的变化
        const inputs = document.querySelectorAll('input, textarea, select');
        inputs.forEach(input => {
            input.addEventListener('input', () => {
                this.validateField(input);
            });
            
            input.addEventListener('blur', () => {
                this.validateField(input);
            });
        });

        // 实时保存开关
        const switches = document.querySelectorAll('input[type="checkbox"]');
        switches.forEach(switchEl => {
            switchEl.addEventListener('change', () => {
                if (document.getElementById('auto-save')?.checked) {
                    this.saveConfig();
                }
            });
        });
    }

    /**
     * 绑定模态框事件
     */
    bindModalEvents() {
        const modal = document.getElementById('confirm-dialog');
        const closeBtn = modal.querySelector('.modal-close');
        const cancelBtn = document.getElementById('confirm-cancel');
        const okBtn = document.getElementById('confirm-ok');

        closeBtn.addEventListener('click', () => {
            this.hideModal();
        });

        cancelBtn.addEventListener('click', () => {
            this.hideModal();
        });

        // 点击背景关闭模态框
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.hideModal();
            }
        });
    }

    /**
     * 加载插件配置
     */
    async loadConfig() {
        try {
            this.setLoading(true);
            const response = await this.apiCall('GET', this.endpoints.config);
            
            if (response.success) {
                this.config = response.data;
                this.populateForm(this.config);
                this.updatePluginStatus();
            } else {
                throw new Error(response.message || '加载配置失败');
            }
        } catch (error) {
            console.error('加载配置失败:', error);
            this.showToast('加载配置失败: ' + error.message, 'error');
        } finally {
            this.setLoading(false);
        }
    }

    /**
     * 加载插件状态
     */
    async loadStatus() {
        try {
            const response = await this.apiCall('GET', this.endpoints.status);
            
            if (response.success) {
                this.status = response.data;
                this.updateStatusDisplay();
            } else {
                throw new Error(response.message || '加载状态失败');
            }
        } catch (error) {
            console.error('加载状态失败:', error);
            this.showToast('加载状态失败: ' + error.message, 'error');
        }
    }

    /**
     * 填充表单数据
     */
    populateForm(config) {
        const settings = config.settings || {};
        
        // 基础字段
        this.setFieldValue('param1', settings.param1);
        this.setFieldValue('param2', settings.param2);
        this.setFieldValue('required_param', settings.required_param);
        this.setFieldValue('greeting', settings.greeting);
        this.setFieldValue('timeout', settings.timeout);
        this.setFieldValue('api_base_url', settings.api_base_url);
        this.setFieldValue('max_retries', settings.max_retries);
        this.setFieldValue('welcome_message', settings.welcome_message);
        
        // 开关字段
        this.setFieldValue('welcome_enabled', settings.welcome_enabled);
        this.setFieldValue('debug_mode', settings.debug_mode);
        this.setFieldValue('auto_reply', settings.features?.auto_reply);
        this.setFieldValue('command_logging', settings.features?.command_logging);
        
        // 嵌套字段
        this.setFieldValue('rate_limit', settings.limits?.rate_limit);
    }

    /**
     * 设置字段值
     */
    setFieldValue(fieldName, value) {
        const field = document.getElementById(fieldName);
        if (!field) return;
        
        if (field.type === 'checkbox') {
            field.checked = Boolean(value);
        } else {
            field.value = value || '';
        }
    }

    /**
     * 获取表单数据
     */
    getFormData() {
        const formData = {
            settings: {
                param1: document.getElementById('param1').value,
                param2: parseInt(document.getElementById('param2').value) || 0,
                required_param: document.getElementById('required_param').value,
                greeting: document.getElementById('greeting').value,
                timeout: parseInt(document.getElementById('timeout').value) || 30000,
                api_base_url: document.getElementById('api_base_url').value,
                max_retries: parseInt(document.getElementById('max_retries').value) || 3,
                welcome_message: document.getElementById('welcome_message').value,
                welcome_enabled: document.getElementById('welcome_enabled').checked,
                debug_mode: document.getElementById('debug_mode').checked,
                features: {
                    auto_reply: document.getElementById('auto_reply').checked,
                    command_logging: document.getElementById('command_logging').checked
                },
                limits: {
                    rate_limit: parseInt(document.getElementById('rate_limit').value) || 10
                }
            }
        };
        
        return formData;
    }

    /**
     * 验证字段
     */
    validateField(field) {
        const value = field.value.trim();
        let isValid = true;
        let errorMessage = '';
        
        // 移除之前的错误状态
        field.classList.remove('error', 'success');
        const existingError = field.parentNode.querySelector('.error-message');
        if (existingError) {
            existingError.remove();
        }
        
        // 验证必填字段
        if (field.hasAttribute('required') && !value) {
            isValid = false;
            errorMessage = '此字段为必填项';
        }
        
        // 验证特定字段
        switch (field.id) {
            case 'param2':
            case 'timeout':
            case 'max_retries':
            case 'rate_limit':
                if (value && (isNaN(value) || parseInt(value) < 0)) {
                    isValid = false;
                    errorMessage = '请输入有效的正整数';
                }
                break;
                
            case 'api_base_url':
                if (value && !this.isValidUrl(value)) {
                    isValid = false;
                    errorMessage = '请输入有效的URL';
                }
                break;
        }
        
        // 应用验证结果
        if (!isValid) {
            field.classList.add('error');
            const errorEl = document.createElement('span');
            errorEl.className = 'error-message';
            errorEl.textContent = errorMessage;
            field.parentNode.appendChild(errorEl);
        } else if (value) {
            field.classList.add('success');
        }
        
        return isValid;
    }

    /**
     * 验证URL格式
     */
    isValidUrl(string) {
        try {
            new URL(string);
            return true;
        } catch (_) {
            return false;
        }
    }

    /**
     * 验证整个表单
     */
    validateForm() {
        const inputs = document.querySelectorAll('input[required], input[type="number"], input[type="url"]');
        let isValid = true;
        
        inputs.forEach(input => {
            if (!this.validateField(input)) {
                isValid = false;
            }
        });
        
        return isValid;
    }

    /**
     * 保存配置
     */
    async saveConfig() {
        try {
            if (!this.validateForm()) {
                this.showToast('请修正表单中的错误', 'error');
                return;
            }
            
            this.setLoading(true);
            const formData = this.getFormData();
            
            const response = await this.apiCall('PUT', this.endpoints.config, formData);
            
            if (response.success) {
                this.config = { ...this.config, ...formData };
                this.showToast('配置保存成功', 'success');
                await this.loadStatus(); // 重新加载状态
            } else {
                throw new Error(response.message || '保存配置失败');
            }
        } catch (error) {
            console.error('保存配置失败:', error);
            this.showToast('保存配置失败: ' + error.message, 'error');
        } finally {
            this.setLoading(false);
        }
    }

    /**
     * 重置配置
     */
    async resetConfig() {
        const confirmed = await this.showConfirm(
            '重置配置',
            '确定要重置所有配置到当前保存的状态吗？未保存的更改将丢失。'
        );
        
        if (confirmed) {
            this.populateForm(this.config);
            this.showToast('配置已重置', 'info');
        }
    }

    /**
     * 加载默认配置
     */
    async loadDefaults() {
        const confirmed = await this.showConfirm(
            '加载默认配置',
            '确定要加载默认配置吗？当前的配置将被覆盖。'
        );
        
        if (confirmed) {
            try {
                this.setLoading(true);
                const response = await this.apiCall('GET', `${this.endpoints.config}/defaults`);
                
                if (response.success) {
                    this.populateForm(response.data);
                    this.showToast('默认配置已加载', 'success');
                } else {
                    throw new Error(response.message || '加载默认配置失败');
                }
            } catch (error) {
                console.error('加载默认配置失败:', error);
                this.showToast('加载默认配置失败: ' + error.message, 'error');
            } finally {
                this.setLoading(false);
            }
        }
    }

    /**
     * 切换插件状态
     */
    async togglePlugin() {
        try {
            this.setLoading(true);
            const response = await this.apiCall('POST', this.endpoints.toggle);
            
            if (response.success) {
                await this.loadStatus();
                const newStatus = response.data.enabled ? '已启用' : '已禁用';
                this.showToast(`插件${newStatus}`, 'success');
            } else {
                throw new Error(response.message || '切换插件状态失败');
            }
        } catch (error) {
            console.error('切换插件状态失败:', error);
            this.showToast('切换插件状态失败: ' + error.message, 'error');
        } finally {
            this.setLoading(false);
        }
    }

    /**
     * 重新加载配置
     */
    async reloadConfig() {
        try {
            this.setLoading(true);
            const response = await this.apiCall('POST', this.endpoints.reload);
            
            if (response.success) {
                await this.loadConfig();
                await this.loadStatus();
                this.showToast('配置重新加载成功', 'success');
            } else {
                throw new Error(response.message || '重新加载配置失败');
            }
        } catch (error) {
            console.error('重新加载配置失败:', error);
            this.showToast('重新加载配置失败: ' + error.message, 'error');
        } finally {
            this.setLoading(false);
        }
    }

    /**
     * 测试插件
     */
    async testPlugin() {
        try {
            this.setLoading(true);
            const response = await this.apiCall('POST', this.endpoints.test);
            
            if (response.success) {
                this.showToast('插件测试通过', 'success');
            } else {
                throw new Error(response.message || '插件测试失败');
            }
        } catch (error) {
            console.error('插件测试失败:', error);
            this.showToast('插件测试失败: ' + error.message, 'error');
        } finally {
            this.setLoading(false);
        }
    }

    /**
     * 导出配置
     */
    exportConfig() {
        try {
            const configJson = JSON.stringify(this.config, null, 2);
            const blob = new Blob([configJson], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = `example-plugin-config-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            this.showToast('配置导出成功', 'success');
        } catch (error) {
            console.error('导出配置失败:', error);
            this.showToast('导出配置失败: ' + error.message, 'error');
        }
    }

    /**
     * 切换高级选项
     */
    toggleAdvancedOptions() {
        const advancedConfig = document.getElementById('advanced-config');
        const toggleBtn = document.getElementById('toggle-advanced');
        const icon = toggleBtn.querySelector('i');
        
        if (advancedConfig.classList.contains('show')) {
            advancedConfig.classList.remove('show');
            icon.className = 'fas fa-chevron-down';
            toggleBtn.innerHTML = '<i class="fas fa-chevron-down"></i> 显示高级选项';
        } else {
            advancedConfig.classList.add('show');
            icon.className = 'fas fa-chevron-up';
            toggleBtn.innerHTML = '<i class="fas fa-chevron-up"></i> 隐藏高级选项';
        }
    }

    /**
     * 更新插件状态显示
     */
    updatePluginStatus() {
        const statusEl = document.getElementById('plugin-status');
        const toggleBtn = document.getElementById('toggle-plugin');
        const toggleText = document.getElementById('toggle-text');
        
        // 从status数据中获取启用状态，而不是config
        const enabled = this.status && this.status.enabled !== false;
        
        if (enabled) {
            statusEl.className = 'status-badge status-enabled';
            statusEl.innerHTML = '<i class="fas fa-check-circle"></i> 已启用';
            toggleText.textContent = '禁用插件';
        } else {
            statusEl.className = 'status-badge status-disabled';
            statusEl.innerHTML = '<i class="fas fa-times-circle"></i> 已禁用';
            toggleText.textContent = '启用插件';
        }
        
        toggleBtn.disabled = false;
    }

    /**
     * 更新状态显示
     */
    updateStatusDisplay() {
        if (!this.status) return;
        
        // 更新统计信息
        document.getElementById('message-count').textContent = this.status.messageCount || '-';
        document.getElementById('last-activity').textContent = this.status.lastActivity || '-';
        document.getElementById('uptime').textContent = this.status.uptime || '-';
        
        // 更新资源使用
        if (this.status.memoryUsage) {
            const memoryMB = Math.round(this.status.memoryUsage.heapUsed / 1024 / 1024);
            document.getElementById('memory-usage').textContent = `${memoryMB} MB`;
        }
        
        // 模拟CPU使用率（实际项目中应该从API获取）
        document.getElementById('cpu-usage').textContent = Math.floor(Math.random() * 20 + 5) + '%';
    }

    /**
     * 开始自动刷新
     */
    startAutoRefresh() {
        this.autoRefreshInterval = setInterval(() => {
            this.loadStatus();
        }, 30000); // 每30秒刷新一次状态
    }

    /**
     * 停止自动刷新
     */
    stopAutoRefresh() {
        if (this.autoRefreshInterval) {
            clearInterval(this.autoRefreshInterval);
            this.autoRefreshInterval = null;
        }
    }

    /**
     * API调用
     */
    async apiCall(method, url, data = null) {
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            }
        };
        
        if (data) {
            options.body = JSON.stringify(data);
        }
        
        const response = await fetch(url, options);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        return await response.json();
    }

    /**
     * 设置加载状态
     */
    setLoading(loading) {
        this.isLoading = loading;
        const container = document.querySelector('.container');
        
        if (loading) {
            container.classList.add('loading');
        } else {
            container.classList.remove('loading');
        }
    }

    /**
     * 显示Toast消息
     */
    showToast(message, type = 'info') {
        const toast = document.getElementById('message-toast');
        const icon = toast.querySelector('.toast-icon');
        const text = toast.querySelector('.toast-text');
        
        // 设置图标
        const icons = {
            success: 'fas fa-check-circle',
            error: 'fas fa-exclamation-circle',
            warning: 'fas fa-exclamation-triangle',
            info: 'fas fa-info-circle'
        };
        
        icon.className = `toast-icon ${icons[type] || icons.info}`;
        text.textContent = message;
        
        // 设置样式
        toast.className = `toast ${type} show`;
        
        // 自动隐藏
        setTimeout(() => {
            this.hideToast();
        }, 5000);
    }

    /**
     * 隐藏Toast消息
     */
    hideToast() {
        const toast = document.getElementById('message-toast');
        toast.classList.remove('show');
    }

    /**
     * 显示确认对话框
     */
    showConfirm(title, message) {
        return new Promise((resolve) => {
            const modal = document.getElementById('confirm-dialog');
            const titleEl = document.getElementById('confirm-title');
            const messageEl = document.getElementById('confirm-message');
            const okBtn = document.getElementById('confirm-ok');
            
            titleEl.textContent = title;
            messageEl.textContent = message;
            
            modal.classList.add('show');
            
            const handleOk = () => {
                modal.classList.remove('show');
                okBtn.removeEventListener('click', handleOk);
                resolve(true);
            };
            
            const handleCancel = () => {
                modal.classList.remove('show');
                okBtn.removeEventListener('click', handleOk);
                resolve(false);
            };
            
            okBtn.addEventListener('click', handleOk);
            
            // 重新绑定取消事件
            const cancelBtn = document.getElementById('confirm-cancel');
            const closeBtn = modal.querySelector('.modal-close');
            
            cancelBtn.onclick = handleCancel;
            closeBtn.onclick = handleCancel;
        });
    }

    /**
     * 隐藏模态框
     */
    hideModal() {
        const modal = document.getElementById('confirm-dialog');
        modal.classList.remove('show');
    }

    /**
     * 销毁管理器
     */
    destroy() {
        this.stopAutoRefresh();
        // 清理事件监听器等
    }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    window.pluginManager = new ExamplePluginManager();
});

// 页面卸载时清理
window.addEventListener('beforeunload', () => {
    if (window.pluginManager) {
        window.pluginManager.destroy();
    }
});