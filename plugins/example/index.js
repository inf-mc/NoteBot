const BasePlugin = require('../../src/plugins/base');
const path = require('path');
const fs = require('fs').promises;
const cron = require('node-cron');

/**
 * 示例插件类
 * 展示NoteBot插件开发的基本功能和最佳实践
 */
class ExamplePlugin extends BasePlugin {
    constructor(options = {}) {
        super(options);
        
        // 插件基本信息
        this.name = 'example';
        this.version = '1.0.0';
        this.description = 'NoteBot示例插件，展示插件开发的基本功能';
        
        // 插件状态
        this.isInitialized = false;
        this.messageCount = 0;
        this.lastActivity = null;
        
        // 资源路径
        this.resourcesPath = path.join(__dirname, 'resources');
        this.webPath = path.join(__dirname, 'web');
    }

    /**
     * 插件初始化
     */
    async onInit() {
        try {
            this.logger.info('示例插件开始初始化...');
            
            // 注册命令
            this.registerCommands();
            
            // 注册事件处理器
            this.registerEventHandlers();
            
            // 注册Web路由和静态文件
            this.registerWebRoutes();
            
            // 初始化资源
            await this.initializeResources();
            
            // 验证配置
            this.validateConfig();
            
            this.isInitialized = true;
            this.logger.info('示例插件初始化完成');
            
        } catch (error) {
            this.logger.error('示例插件初始化失败:', error);
            throw error;
        }
    }

    /**
     * 注册命令
     */
    registerCommands() {
        // 基础命令
        this.registerCommand({
            name: 'hello',
            description: '发送问候消息',
            usage: '#hello [名字]',
            handler: this.handleHelloCommand.bind(this)
        });

        // 配置命令
        this.registerCommand({
            name: 'config',
            description: '查看或设置插件配置',
            usage: '#config [参数] [值]',
            handler: this.handleConfigCommand.bind(this)
        });

        // 状态命令
        this.registerCommand({
            name: 'status',
            description: '查看插件状态',
            usage: '#status',
            handler: this.handleStatusCommand.bind(this)
        });

        // 示例API命令
        this.registerCommand({
            name: 'api',
            description: '调用示例API',
            usage: '#api [endpoint]',
            handler: this.handleApiCommand.bind(this)
        });

        // 资源命令
        this.registerCommand({
            name: 'resource',
            description: '读取示例资源',
            usage: '#resource [文件名]',
            handler: this.handleResourceCommand.bind(this)
        });

        // 生图命令 - 使用Puppeteer模块
        this.registerCommand({
            name: 'screenshot',
            description: '网页截图命令',
            usage: '#screenshot <url> [width] [height]',
            permission: 'user',
            handler: this.handleScreenshotCommand.bind(this)
        });

        // 定时任务管理命令
        this.registerCommand({
            name: 'schedule',
            description: '定时任务管理命令',
            usage: '#schedule <list|add|remove|status> [name] [cron] [message]',
            permission: 'admin',
            handler: this.handleScheduleCommand.bind(this)
        });
    }

    /**
     * 注册事件处理器
     */
    registerEventHandlers() {
        // 消息事件
        this.on('message', this.onMessageReceived.bind(this));
        
        // 用户加入事件
        this.on('user.join', this.onUserJoin.bind(this));
        
        // 用户离开事件
        this.on('user.leave', this.onUserLeave.bind(this));
        
        // 配置更新事件
        this.on('config.update', this.onConfigUpdate.bind(this));
    }

    /**
     * 注册Web路由和静态文件
     */
    registerWebRoutes() {
        try {
            // 注册静态文件路径，将web目录映射到 /plugins/example/config
            this.registerStaticPath('/config', this.webPath);
            
            // 注册API路由
            this.registerRoute('GET', '/api/config', this.handleGetConfig.bind(this));
            this.registerRoute('POST', '/api/config', this.handleUpdateConfig.bind(this));
            this.registerRoute('PUT', '/api/config', this.handleUpdateConfig.bind(this));
            this.registerRoute('GET', '/api/config/defaults', this.handleGetDefaults.bind(this));
            this.registerRoute('GET', '/api/status', this.handleGetStatus.bind(this));
            this.registerRoute('POST', '/api/toggle', this.handleTogglePlugin.bind(this));
            
            this.logger.info('Web路由注册完成');
        } catch (error) {
            this.logger.error('Web路由注册失败:', error);
        }
    }

    /**
     * 初始化资源
     */
    async initializeResources() {
        try {
            // 检查资源目录
            await fs.access(this.resourcesPath);
            this.logger.info('资源目录验证成功');
        } catch (error) {
            this.logger.warn('资源目录不存在，将创建默认资源');
            await this.createDefaultResources();
        }
    }

    /**
     * 创建默认资源
     */
    async createDefaultResources() {
        try {
            await fs.mkdir(this.resourcesPath, { recursive: true });
            
            const exampleContent = `这是一个示例资源文件\n创建时间: ${new Date().toLocaleString('zh-CN')}\n\n这个文件展示了插件如何管理静态资源。\n你可以在这里存储:\n- 配置模板\n- 静态文件\n- 数据文件\n- 其他资源`;
            
            await fs.writeFile(
                path.join(this.resourcesPath, 'example.txt'),
                exampleContent,
                'utf8'
            );
            
            this.logger.info('默认资源创建成功');
        } catch (error) {
            this.logger.error('创建默认资源失败:', error);
        }
    }

    /**
     * 验证配置
     */
    validateConfig() {
        const config = this.getConfig();
        
        // 检查必需参数
        const requiredParams = ['param1', 'param2', 'required_param'];
        const missingParams = requiredParams.filter(param => !config[param]);
        
        if (missingParams.length > 0) {
            this.logger.warn('缺少必需配置参数:', missingParams);
        }
        
        // 验证参数类型
        if (config.param1 && typeof config.param1 !== 'string') {
            this.logger.warn('param1应该是字符串类型');
        }
        
        if (config.param2 && typeof config.param2 !== 'number') {
            this.logger.warn('param2应该是数字类型');
        }
    }

    /**
     * Hello命令处理器
     */
    async handleHelloCommand(context) {
        const { message, args } = context;
        const name = args.length > 0 ? args.join(' ') : '朋友';
        
        const config = this.getConfig();
        const greeting = config.greeting || '你好';
        
        const responseText = `${greeting}, ${name}! 欢迎使用示例插件！`;
        
        // 根据消息类型发送回复
        if (message.message_type === 'group') {
            await this.api.sendGroupMessage(message.group_id, responseText);
        } else if (message.message_type === 'private') {
            await this.api.sendPrivateMessage(message.user_id, responseText);
        }
    }

    /**
     * 配置命令处理器
     */
    async handleConfigCommand(context) {
        const { message, args } = context;
        let responseText = '';
        
        if (args.length === 0) {
            // 显示当前配置
            const config = this.getConfig();
            const configText = JSON.stringify(config, null, 2);
            responseText = `当前配置:\n\`\`\`json\n${configText}\n\`\`\``;
        } else if (args.length === 1) {
            // 显示特定配置项
            const param = args[0];
            const config = this.getConfig();
            const value = config[param];
            
            if (value !== undefined) {
                responseText = `${param}: ${JSON.stringify(value)}`;
            } else {
                responseText = `配置参数 '${param}' 不存在`;
            }
        } else {
            // 设置配置项
            const param = args[0];
            const value = args.slice(1).join(' ');
            
            try {
                // 尝试解析JSON值
                const parsedValue = JSON.parse(value);
                this.setConfig(param, parsedValue);
                responseText = `配置已更新: ${param} = ${JSON.stringify(parsedValue)}`;
            } catch (error) {
                // 作为字符串处理
                this.setConfig(param, value);
                responseText = `配置已更新: ${param} = "${value}"`;
            }
        }
        
        // 根据消息类型发送回复
        if (message.message_type === 'group') {
            await this.api.sendGroupMessage(message.group_id, responseText);
        } else if (message.message_type === 'private') {
            await this.api.sendPrivateMessage(message.user_id, responseText);
        }
    }

    /**
     * 状态命令处理器
     */
    async handleStatusCommand(context) {
        const { message } = context;
        
        const status = {
            name: this.name,
            version: this.version,
            initialized: this.isInitialized,
            messageCount: this.messageCount,
            lastActivity: this.lastActivity ? new Date(this.lastActivity).toLocaleString('zh-CN') : '无',
            uptime: Math.floor((Date.now() - this.startTime) / 1000) + '秒',
            memoryUsage: process.memoryUsage()
        };
        
        const statusText = JSON.stringify(status, null, 2);
        const responseText = `插件状态:\n\`\`\`json\n${statusText}\n\`\`\``;
        
        // 根据消息类型发送回复
        if (message.message_type === 'group') {
            await this.api.sendGroupMessage(message.group_id, responseText);
        } else if (message.message_type === 'private') {
            await this.api.sendPrivateMessage(message.user_id, responseText);
        }
    }

    /**
     * API命令处理器
     */
    async handleApiCommand(context) {
        const { message, args } = context;
        let responseText = '';
        
        if (args.length === 0) {
            responseText = '请指定API端点，例如: #api /test';
        } else {
            const endpoint = args[0];
            const config = this.getConfig();
            const baseUrl = config.api_base_url || 'https://jsonplaceholder.typicode.com';
            
            try {
                const response = await axios.get(`${baseUrl}${endpoint}`, {
                    timeout: 5000
                });
                
                const data = (typeof response.data === 'object' && response.data !== null) ? 
                    JSON.stringify(response.data, null, 2) : 
                    response.data;
                
                responseText = `API响应:\n\`\`\`json\n${data}\n\`\`\``;
                
            } catch (error) {
                responseText = `API调用失败: ${error.message}`;
                this.logger.error('API调用错误:', error);
            }
        }
        
        // 根据消息类型发送回复
        if (message.message_type === 'group') {
            await this.api.sendGroupMessage(message.group_id, responseText);
        } else if (message.message_type === 'private') {
            await this.api.sendPrivateMessage(message.user_id, responseText);
        }
    }

    /**
     * 资源命令处理器
     */
    async handleResourceCommand(context) {
        const { message, args } = context;
        
        const filename = args.length > 0 ? args[0] : 'example.txt';
        const filePath = path.join(this.resourcesPath, filename);
        let responseText = '';
        
        try {
            const content = await fs.readFile(filePath, 'utf8');
            responseText = `资源文件内容 (${filename}):\n\`\`\`\n${content}\n\`\`\``;
        } catch (error) {
            responseText = `读取资源文件失败: ${error.message}`;
            this.logger.error('读取资源文件错误:', error);
        }
        
        // 根据消息类型发送回复
        if (message.message_type === 'group') {
            await this.api.sendGroupMessage(message.group_id, responseText);
        } else if (message.message_type === 'private') {
            await this.api.sendPrivateMessage(message.user_id, responseText);
        }
    }

    /**
     * 消息接收事件处理器
     */
    async onMessageReceived(message) {
        this.messageCount++;
        this.lastActivity = new Date();
        
        // 记录消息统计
        this.logger.debug(`收到消息 #${this.messageCount}:`, {
            userId: message.user_id,
            messageType: message.message_type,
            timestamp: new Date().toLocaleString('zh-CN')
        });
    }

    /**
     * 用户加入事件处理器
     */
    async onUserJoin(event) {
        const config = this.getConfig();
        
        if (config.welcome_enabled) {
            const welcomeMessage = config.welcome_message || '欢迎新用户！';
            // 这里可以发送欢迎消息
            this.logger.info(`用户加入: ${event.user_id}`);
        }
    }

    /**
     * 用户离开事件处理器
     */
    async onUserLeave(event) {
        this.logger.info(`用户离开: ${event.user_id}`);
    }

    /**
     * 配置更新事件处理器
     */
    async onConfigUpdate(config) {
        this.logger.info('配置已更新，重新验证配置');
        this.validateConfig();
        
        // 触发配置相关的重新初始化
        this.emit('plugin.config.updated', {
            plugin: this.name,
            config: config
        });
    }

    /**
     * 处理获取配置API请求
     */
    async handleGetConfig(req, res) {
        try {
            const config = await this.getConfig();
            res.json({
                success: true,
                data: config
            });
        } catch (error) {
            this.logger.error('获取配置失败:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理更新配置API请求
     */
    async handleUpdateConfig(req, res) {
        try {
            const newConfig = req.body;
            await this.updateConfig(newConfig);
            res.json({
                success: true,
                message: '配置更新成功'
            });
        } catch (error) {
            this.logger.error('更新配置失败:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理获取状态API请求
     */
    async handleGetStatus(req, res) {
        try {
            // 从插件管理器获取插件详情，包含启用状态
            const pluginManager = this.context?.pluginManager;
            const pluginDetails = pluginManager ? pluginManager.getPluginDetails(this.name) : null;
            const enabled = pluginDetails ? pluginDetails.config.enabled !== false : true;
            
            const status = {
                name: this.name,
                version: this.version,
                description: this.description,
                enabled: enabled,
                isInitialized: this.isInitialized,
                messageCount: this.messageCount,
                lastActivity: this.lastActivity,
                uptime: this.getUptime()
            };
            res.json({
                success: true,
                data: status
            });
        } catch (error) {
            this.logger.error('获取状态失败:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 处理切换插件状态API请求
     */
    async handleTogglePlugin(req, res) {
        console.log('handleTogglePlugin method called - console log');
        this.logger.info('handleTogglePlugin method called - logger');
        this.logger.info('this object type:', typeof this);
        this.logger.info('this.name:', this.name);
        try {
            // 通过插件上下文获取插件管理器
            this.logger.info('this.context:', !!this.context);
            this.logger.info('this.context keys:', this.context ? Object.keys(this.context) : 'N/A');
            const pluginManager = this.context?.pluginManager;
            this.logger.info('pluginManager from context:', !!pluginManager);
            this.logger.info('pluginManager type:', typeof pluginManager);
            
            if (!pluginManager) {
                throw new Error('插件管理器未初始化');
            }
            
            if (typeof pluginManager.disablePlugin !== 'function') {
                throw new Error('插件管理器缺少disablePlugin方法');
            }
            
            // 获取当前插件状态
            const pluginDetails = pluginManager.getPluginDetails(this.name);
            const currentEnabled = pluginDetails ? pluginDetails.config.enabled !== false : true;
            
            // 切换状态
            if (currentEnabled) {
                await pluginManager.disablePlugin(this.name);
            } else {
                await pluginManager.enablePlugin(this.name);
            }
            
            // 获取新状态
            const newPluginDetails = pluginManager.getPluginDetails(this.name);
            const newEnabled = newPluginDetails ? newPluginDetails.config.enabled !== false : true;
            
            res.json({
                success: true,
                data: {
                    enabled: newEnabled,
                    message: newEnabled ? '插件已启用' : '插件已禁用'
                }
            });
            
            this.logger.info(`插件状态已切换: ${newEnabled ? '启用' : '禁用'}`);
            
        } catch (error) {
            this.logger.error('切换插件状态失败:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 获取运行时间
     */
    getUptime() {
        const uptime = process.uptime();
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = Math.floor(uptime % 60);
        return `${hours}小时${minutes}分钟${seconds}秒`;
    }

    /**
     * 插件销毁
     */
    async onDestroy() {
        try {
            this.logger.info('示例插件开始销毁...');
            
            // 清理资源
            this.isInitialized = false;
            this.messageCount = 0;
            this.lastActivity = null;
            
            // 移除事件监听器
            this.removeAllListeners();
            
            this.logger.info('示例插件销毁完成');
            
        } catch (error) {
            this.logger.error('示例插件销毁失败:', error);
            throw error;
        }
    }

    /**
     * 获取插件信息
     */
    getInfo() {
        return {
            name: this.name,
            version: this.version,
            description: this.description,
            author: 'NoteBot Team',
            website: 'https://github.com/notebot/example-plugin',
            initialized: this.isInitialized,
            messageCount: this.messageCount,
            lastActivity: this.lastActivity,
            commands: this.getCommands().map(cmd => ({
                name: cmd.name,
                description: cmd.description,
                usage: cmd.usage
            }))
        };
    }

    /**
     * 处理获取默认配置API请求
     */
    async handleGetDefaults(req, res) {
        try {
            // 返回默认配置
            const defaultConfig = {
                settings: {
                    param1: '默认参数1',
                    param2: 42,
                    required_param: '默认必需参数',
                    greeting: '你好',
                    timeout: 5000,
                    api_base_url: 'https://jsonplaceholder.typicode.com',
                    max_retries: 3,
                    welcome_message: '欢迎加入我们的群组！',
                    welcome_enabled: true,
                    debug_mode: false,
                    features: {
                        auto_reply: false,
                        command_logging: true
                    },
                    limits: {
                        rate_limit: 10
                    },
                    ui: {
                        theme: 'light',
                        language: 'zh-CN',
                        show_advanced: false,
                        auto_save: true
                    }
                },
                commands: [
                    {
                        name: 'hello',
                        description: '发送问候消息',
                        usage: '#hello [用户名]',
                        enabled: true,
                        permission_required: false
                    },
                    {
                        name: 'config',
                        description: '配置管理命令',
                        usage: '#config [参数] [值]',
                        enabled: true,
                        permission_required: true
                    },
                    {
                        name: 'status',
                        description: '查看插件状态',
                        usage: '#status',
                        enabled: true,
                        permission_required: false
                    },
                    {
                        name: 'resource',
                        description: '获取插件资源',
                        usage: '#resource [文件名]',
                        enabled: true,
                        permission_required: false
                    }
                ]
            };
            
            res.json({
                success: true,
                data: defaultConfig
            });
        } catch (error) {
            this.logger.error('获取默认配置失败:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 生图命令处理器 - 使用Puppeteer模块
     */
    async handleScreenshotCommand(context) {
        const { message, args } = context;
        
        if (args.length === 0) {
            const usage = '用法: #screenshot <url> [width] [height]\n示例: #screenshot https://www.baidu.com 1920 1080';
            return await this.sendReply(message, usage);
        }
        
        const url = args[0];
        const width = parseInt(args[1]) || 1920;
        const height = parseInt(args[2]) || 1080;
        
        // 检查Puppeteer是否可用
        if (!this.isPuppeteerAvailable()) {
            return await this.sendReply(message, '❌ Puppeteer模块不可用，无法执行截图操作');
        }
        
        // 验证URL格式
        if (!this.isValidUrl(url)) {
            return await this.sendReply(message, '❌ 无效的URL格式，请提供有效的网址');
        }
        
        try {
            await this.sendReply(message, `🔄 正在截图: ${url}...`);
            
            // 执行截图操作
            const screenshotBuffer = await this.puppeteer.screenshot(url, {
                viewport: { width, height },
                fullPage: false,
                type: 'png',
                timeout: 30000
            });
            
            if (screenshotBuffer) {
                // 将截图保存到资源目录
                const timestamp = Date.now();
                const filename = `screenshot_${timestamp}.png`;
                const filePath = path.join(this.resourcesPath, filename);
                
                await fs.writeFile(filePath, screenshotBuffer);
                
                // 发送截图 - 分别发送文本和图片
                await this.sendReply(message, `✅ 截图完成: ${url}`);
                
                // 发送图片 - 使用base64格式
                const imageBase64 = screenshotBuffer.toString('base64');
                const imageMessage = `[CQ:image,file=base64://${imageBase64}]`;
                await this.sendReply(message, imageMessage);
                
                this.logger.info(`截图成功: ${url} -> ${filename}`);
            } else {
                await this.sendReply(message, `❌ 截图失败: 未获取到截图数据`);
            }
            
        } catch (error) {
            this.logger.error('截图操作失败:', error);
            await this.sendReply(message, `❌ 截图操作异常: ${error.message}`);
        }
    }
    
    /**
     * 定时任务管理命令处理器
     */
    async handleScheduleCommand(context) {
        const { message, args } = context;
        
        if (args.length === 0) {
            const usage = '用法:\n' +
                '#schedule list - 查看定时任务列表\n' +
                '#schedule add <name> <cron> <message> - 添加定时任务\n' +
                '#schedule remove <name> - 删除定时任务\n' +
                '#schedule status <name> - 查看任务状态\n\n' +
                'Cron表达式示例:\n' +
                '"0 9 * * *" - 每天9点\n' +
                '"*/30 * * * *" - 每30分钟\n' +
                '"0 0 * * 1" - 每周一0点';
            return await this.sendReply(message, usage);
        }
        
        const action = args[0].toLowerCase();
        
        try {
            switch (action) {
                case 'list':
                    await this.handleScheduleList(message);
                    break;
                    
                case 'add':
                    if (args.length < 4) {
                        return await this.sendReply(message, '❌ 参数不足，用法: #schedule add <name> <cron> <message>');
                    }
                    await this.handleScheduleAdd(message, args[1], args[2], args.slice(3).join(' '));
                    break;
                    
                case 'remove':
                    if (args.length < 2) {
                        return await this.sendReply(message, '❌ 参数不足，用法: #schedule remove <name>');
                    }
                    await this.handleScheduleRemove(message, args[1]);
                    break;
                    
                case 'status':
                    if (args.length < 2) {
                        return await this.sendReply(message, '❌ 参数不足，用法: #schedule status <name>');
                    }
                    await this.handleScheduleStatus(message, args[1]);
                    break;
                    
                default:
                    await this.sendReply(message, '❌ 未知操作，支持的操作: list, add, remove, status');
            }
        } catch (error) {
            this.logger.error('定时任务操作失败:', error);
            await this.sendReply(message, `❌ 操作失败: ${error.message}`);
        }
    }
    
    /**
     * 查看定时任务列表
     */
    async handleScheduleList(message) {
        const tasks = await this.getData('scheduled_tasks', {});
        const taskNames = Object.keys(tasks);
        
        if (taskNames.length === 0) {
            return await this.sendReply(message, '📋 当前没有定时任务');
        }
        
        let listMessage = '📋 定时任务列表:\n\n';
        for (const name of taskNames) {
            const task = tasks[name];
            listMessage += `🔹 ${name}\n`;
            listMessage += `   Cron: ${task.cron}\n`;
            listMessage += `   消息: ${task.message}\n`;
            listMessage += `   状态: ${task.enabled ? '✅ 启用' : '❌ 禁用'}\n`;
            listMessage += `   创建时间: ${new Date(task.createdAt).toLocaleString('zh-CN')}\n\n`;
        }
        
        await this.sendReply(message, listMessage);
    }
    
    /**
     * 添加定时任务
     */
    async handleScheduleAdd(message, name, cronExpression, taskMessage) {
        // 验证cron表达式
        const cron = require('node-cron');
        if (!cron.validate(cronExpression)) {
            return await this.sendReply(message, '❌ 无效的Cron表达式');
        }
        
        const tasks = await this.getData('scheduled_tasks', {});
        
        if (tasks[name]) {
            return await this.sendReply(message, `❌ 任务 "${name}" 已存在`);
        }
        
        // 创建任务处理器
        const taskHandler = async () => {
            try {
                // 发送定时消息到当前群组或私聊
                if (message.message_type === 'group') {
                    await this.api.sendGroupMessage(message.group_id, `⏰ 定时任务 "${name}": ${taskMessage}`);
                } else {
                    await this.api.sendPrivateMessage(message.user_id, `⏰ 定时任务 "${name}": ${taskMessage}`);
                }
                
                this.logger.info(`定时任务执行: ${name}`);
            } catch (error) {
                this.logger.error(`定时任务执行失败 [${name}]:`, error);
            }
        };
        
        // 注册到调度器
        const taskId = `${this.name}_${name}`;
        await global.taskScheduler.register(taskId, cronExpression, taskHandler, {
            name: `${this.name}:${name}`,
            description: `范例插件定时任务: ${name}`,
            plugin: this.name
        });
        
        // 保存任务信息
        tasks[name] = {
            id: taskId,
            cron: cronExpression,
            message: taskMessage,
            enabled: true,
            createdAt: Date.now(),
            groupId: message.group_id,
            userId: message.user_id,
            messageType: message.message_type
        };
        
        await this.setData('scheduled_tasks', tasks);
        
        await this.sendReply(message, `✅ 定时任务 "${name}" 添加成功\nCron: ${cronExpression}\n消息: ${taskMessage}`);
        this.logger.info(`添加定时任务: ${name} (${cronExpression})`);
    }
    
    /**
     * 删除定时任务
     */
    async handleScheduleRemove(message, name) {
        const tasks = await this.getData('scheduled_tasks', {});
        
        if (!tasks[name]) {
            return await this.sendReply(message, `❌ 任务 "${name}" 不存在`);
        }
        
        const task = tasks[name];
        
        // 从调度器中注销任务
        try {
            await global.taskScheduler.unregister(task.id);
        } catch (error) {
            this.logger.warn(`注销定时任务失败 [${name}]:`, error);
        }
        
        // 删除任务信息
        delete tasks[name];
        await this.setData('scheduled_tasks', tasks);
        
        await this.sendReply(message, `✅ 定时任务 "${name}" 已删除`);
        this.logger.info(`删除定时任务: ${name}`);
    }
    
    /**
     * 查看任务状态
     */
    async handleScheduleStatus(message, name) {
        const tasks = await this.getData('scheduled_tasks', {});
        
        if (!tasks[name]) {
            return await this.sendReply(message, `❌ 任务 "${name}" 不存在`);
        }
        
        const task = tasks[name];
        
        // 获取调度器中的任务状态
        let schedulerStatus = null;
        try {
            schedulerStatus = await global.taskScheduler.getTaskStatus(task.id);
        } catch (error) {
            this.logger.warn(`获取任务状态失败 [${name}]:`, error);
        }
        
        let statusMessage = `📊 任务状态: ${name}\n\n`;
        statusMessage += `🔹 Cron表达式: ${task.cron}\n`;
        statusMessage += `🔹 消息内容: ${task.message}\n`;
        statusMessage += `🔹 本地状态: ${task.enabled ? '✅ 启用' : '❌ 禁用'}\n`;
        statusMessage += `🔹 创建时间: ${new Date(task.createdAt).toLocaleString('zh-CN')}\n`;
        
        if (schedulerStatus) {
            statusMessage += `🔹 调度器状态: ${schedulerStatus.enabled ? '✅ 运行中' : '❌ 已停止'}\n`;
            statusMessage += `🔹 执行次数: ${schedulerStatus.runCount || 0}\n`;
            statusMessage += `🔹 成功次数: ${schedulerStatus.successCount || 0}\n`;
            statusMessage += `🔹 失败次数: ${schedulerStatus.failureCount || 0}\n`;
            if (schedulerStatus.lastRun) {
                statusMessage += `🔹 上次执行: ${new Date(schedulerStatus.lastRun).toLocaleString('zh-CN')}\n`;
            }
            if (schedulerStatus.nextRun) {
                statusMessage += `🔹 下次执行: ${new Date(schedulerStatus.nextRun).toLocaleString('zh-CN')}\n`;
            }
        } else {
            statusMessage += `🔹 调度器状态: ❓ 无法获取\n`;
        }
        
        await this.sendReply(message, statusMessage);
    }
    
    /**
     * 发送回复消息的辅助方法
     */
    async sendReply(message, content) {
        try {
            if (message.message_type === 'group') {
                await this.api.sendGroupMessage(message.group_id, content);
            } else if (message.message_type === 'private') {
                await this.api.sendPrivateMessage(message.user_id, content);
            }
        } catch (error) {
            this.logger.error('发送消息失败:', error);
            throw new Error(`API 调用失败: ${error.message}`);
        }
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
}

module.exports = ExamplePlugin;