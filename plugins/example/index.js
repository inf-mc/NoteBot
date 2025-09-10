const BasePlugin = require('../../src/plugins/base');
const logger = require('../../src/utils/logger');

/**
 * 示例插件
 * 演示插件系统的基本功能和使用方法
 */
class ExamplePlugin extends BasePlugin {
    constructor() {
        super({
            name: 'example',
            version: '1.0.0',
            description: '示例插件，演示基本功能',
            author: 'NoteBot Team',
            dependencies: [],
            permissions: ['message.send', 'data.read', 'data.write']
        });
        
        this.messageCount = 0;
        this.startTime = Date.now();
    }

    /**
     * 插件初始化
     */
    async initialize() {
        await super.initialize();
        
        logger.info(`Example plugin initialized at ${new Date().toISOString()}`);
        
        // 注册消息处理器
        this.registerMessageHandler('private', this.handlePrivateMessage.bind(this));
        this.registerMessageHandler('group', this.handleGroupMessage.bind(this));
        
        // 注册事件处理器
        this.registerEventHandler('friend_add', this.handleFriendAdd.bind(this));
        this.registerEventHandler('group_increase', this.handleGroupIncrease.bind(this));
        
        // 注册定时任务
        this.registerScheduledTask('example-stats', '0 */10 * * * *', this.reportStats.bind(this));
        
        // 注册路由
        this.registerRoute('GET', '/example/stats', this.getStats.bind(this));
        this.registerRoute('POST', '/example/send', this.sendMessage.bind(this));
        
        // 初始化数据
        await this.initializeData();
        
        this.emit('initialized');
    }

    /**
     * 初始化数据
     */
    async initializeData() {
        // 设置默认配置
        const defaultConfig = {
            welcomeMessage: '欢迎使用示例插件！',
            enableStats: true,
            maxMessageLength: 1000,
            allowedGroups: [],
            bannedUsers: []
        };
        
        // 加载或创建配置
        const config = await this.getData('config') || defaultConfig;
        await this.setData('config', { ...defaultConfig, ...config });
        
        // 初始化统计数据
        const stats = await this.getData('stats') || {
            totalMessages: 0,
            privateMessages: 0,
            groupMessages: 0,
            commandsExecuted: 0,
            lastReset: Date.now()
        };
        await this.setData('stats', stats);
        
        logger.info('Example plugin data initialized');
    }

    /**
     * 处理私聊消息
     */
    async handlePrivateMessage(message) {
        try {
            this.messageCount++;
            
            // 更新统计
            await this.updateStats('privateMessages');
            
            const { user_id, raw_message } = message;
            
            logger.info(`Received private message from ${user_id}: ${raw_message}`);
            
            // 检查用户是否被禁用
            const config = await this.getData('config');
            if (config.bannedUsers.includes(user_id)) {
                logger.warn(`Ignored message from banned user: ${user_id}`);
                return;
            }
            
            // 处理命令
            if (raw_message.startsWith('/')) {
                await this.handleCommand(message);
                return;
            }
            
            // 简单的回复逻辑
            if (raw_message.includes('你好') || raw_message.includes('hello')) {
                await this.sendPrivateMessage(user_id, config.welcomeMessage);
            } else if (raw_message.includes('时间')) {
                const now = new Date().toLocaleString('zh-CN');
                await this.sendPrivateMessage(user_id, `当前时间：${now}`);
            } else if (raw_message.includes('统计')) {
                const stats = await this.getStats();
                const statsMessage = `插件统计信息：\n` +
                    `总消息数：${stats.totalMessages}\n` +
                    `私聊消息：${stats.privateMessages}\n` +
                    `群聊消息：${stats.groupMessages}\n` +
                    `运行时间：${this.getUptime()}`;
                await this.sendPrivateMessage(user_id, statsMessage);
            }
            
        } catch (error) {
            logger.error('Error handling private message:', error);
        }
    }

    /**
     * 处理群聊消息
     */
    async handleGroupMessage(message) {
        try {
            this.messageCount++;
            
            // 更新统计
            await this.updateStats('groupMessages');
            
            const { group_id, user_id, raw_message } = message;
            
            logger.debug(`Received group message from ${user_id} in ${group_id}: ${raw_message}`);
            
            // 检查群组是否允许
            const config = await this.getData('config');
            if (config.allowedGroups.length > 0 && !config.allowedGroups.includes(group_id)) {
                return;
            }
            
            // 检查用户是否被禁用
            if (config.bannedUsers.includes(user_id)) {
                return;
            }
            
            // 处理 @ 消息
            if (raw_message.includes('[CQ:at,qq=') && raw_message.includes(this.botId)) {
                await this.handleAtMessage(message);
                return;
            }
            
            // 处理命令
            if (raw_message.startsWith('/')) {
                await this.handleCommand(message);
                return;
            }
            
            // 关键词回复
            if (raw_message.includes('签到')) {
                await this.handleCheckIn(message);
            }
            
        } catch (error) {
            logger.error('Error handling group message:', error);
        }
    }

    /**
     * 处理命令
     */
    async handleCommand(message) {
        const { user_id, group_id, raw_message } = message;
        const command = raw_message.split(' ')[0].substring(1); // 移除 '/'
        const args = raw_message.split(' ').slice(1);
        
        await this.updateStats('commandsExecuted');
        
        logger.info(`Executing command: ${command} with args:`, args);
        
        switch (command) {
            case 'help':
                await this.sendHelpMessage(message);
                break;
                
            case 'ping':
                const responseTime = Date.now() - message.time * 1000;
                const reply = `Pong! 响应时间: ${responseTime}ms`;
                if (group_id) {
                    await this.sendGroupMessage(group_id, reply);
                } else {
                    await this.sendPrivateMessage(user_id, reply);
                }
                break;
                
            case 'stats':
                const stats = await this.getStats();
                const statsMessage = this.formatStats(stats);
                if (group_id) {
                    await this.sendGroupMessage(group_id, statsMessage);
                } else {
                    await this.sendPrivateMessage(user_id, statsMessage);
                }
                break;
                
            case 'echo':
                const echoMessage = args.join(' ') || '请提供要回显的内容';
                if (group_id) {
                    await this.sendGroupMessage(group_id, echoMessage);
                } else {
                    await this.sendPrivateMessage(user_id, echoMessage);
                }
                break;
                
            case 'time':
                const now = new Date().toLocaleString('zh-CN');
                const timeMessage = `当前时间：${now}`;
                if (group_id) {
                    await this.sendGroupMessage(group_id, timeMessage);
                } else {
                    await this.sendPrivateMessage(user_id, timeMessage);
                }
                break;
                
            default:
                const unknownMessage = `未知命令: ${command}。使用 /help 查看可用命令。`;
                if (group_id) {
                    await this.sendGroupMessage(group_id, unknownMessage);
                } else {
                    await this.sendPrivateMessage(user_id, unknownMessage);
                }
        }
    }

    /**
     * 发送帮助消息
     */
    async sendHelpMessage(message) {
        const { user_id, group_id } = message;
        
        const helpText = `示例插件帮助：\n` +
            `/help - 显示此帮助信息\n` +
            `/ping - 测试响应时间\n` +
            `/stats - 显示插件统计信息\n` +
            `/echo <消息> - 回显消息\n` +
            `/time - 显示当前时间\n` +
            `\n其他功能：\n` +
            `- 发送"你好"或"hello"获得欢迎消息\n` +
            `- 发送"时间"获取当前时间\n` +
            `- 发送"统计"查看统计信息\n` +
            `- 在群聊中发送"签到"进行签到`;
        
        if (group_id) {
            await this.sendGroupMessage(group_id, helpText);
        } else {
            await this.sendPrivateMessage(user_id, helpText);
        }
    }

    /**
     * 处理 @ 消息
     */
    async handleAtMessage(message) {
        const { group_id, user_id, raw_message } = message;
        
        // 移除 @ 标签，获取纯文本
        const cleanMessage = raw_message.replace(/\[CQ:at,qq=\d+\]/g, '').trim();
        
        if (cleanMessage.includes('你好') || cleanMessage.includes('hello')) {
            await this.sendGroupMessage(group_id, `[CQ:at,qq=${user_id}] 你好！我是示例插件，很高兴为您服务！`);
        } else if (cleanMessage.includes('帮助') || cleanMessage.includes('help')) {
            await this.sendHelpMessage(message);
        } else {
            await this.sendGroupMessage(group_id, `[CQ:at,qq=${user_id}] 我收到了您的消息，但不太理解。请使用 /help 查看可用命令。`);
        }
    }

    /**
     * 处理签到
     */
    async handleCheckIn(message) {
        const { group_id, user_id } = message;
        const today = new Date().toDateString();
        const checkInKey = `checkin:${group_id}:${user_id}:${today}`;
        
        // 检查今天是否已经签到
        const hasCheckedIn = await this.getData(checkInKey);
        if (hasCheckedIn) {
            await this.sendGroupMessage(group_id, `[CQ:at,qq=${user_id}] 您今天已经签到过了！`);
            return;
        }
        
        // 记录签到
        await this.setData(checkInKey, true);
        
        // 更新用户签到统计
        const userStatsKey = `user_stats:${user_id}`;
        const userStats = await this.getData(userStatsKey) || { totalCheckIns: 0, lastCheckIn: null };
        userStats.totalCheckIns++;
        userStats.lastCheckIn = Date.now();
        await this.setData(userStatsKey, userStats);
        
        const replyMessage = `[CQ:at,qq=${user_id}] 签到成功！这是您第 ${userStats.totalCheckIns} 次签到。`;
        await this.sendGroupMessage(group_id, replyMessage);
    }

    /**
     * 处理好友添加事件
     */
    async handleFriendAdd(event) {
        const { user_id } = event;
        
        logger.info(`New friend added: ${user_id}`);
        
        // 发送欢迎消息
        const config = await this.getData('config');
        const welcomeMessage = `${config.welcomeMessage}\n\n` +
            `我是示例插件，可以为您提供以下服务：\n` +
            `- 发送 /help 查看所有命令\n` +
            `- 发送"你好"获得问候\n` +
            `- 发送"时间"获取当前时间\n` +
            `- 发送"统计"查看插件统计信息`;
        
        // 延迟发送，避免过于突兀
        setTimeout(async () => {
            await this.sendPrivateMessage(user_id, welcomeMessage);
        }, 2000);
    }

    /**
     * 处理群成员增加事件
     */
    async handleGroupIncrease(event) {
        const { group_id, user_id } = event;
        
        logger.info(`New member joined group ${group_id}: ${user_id}`);
        
        // 发送欢迎消息
        const welcomeMessage = `[CQ:at,qq=${user_id}] 欢迎加入群聊！\n` +
            `我是示例插件，发送 /help 可以查看我的功能。`;
        
        // 延迟发送
        setTimeout(async () => {
            await this.sendGroupMessage(group_id, welcomeMessage);
        }, 3000);
    }

    /**
     * 更新统计数据
     */
    async updateStats(type) {
        const stats = await this.getData('stats');
        stats.totalMessages++;
        if (type) {
            stats[type]++;
        }
        await this.setData('stats', stats);
    }

    /**
     * 获取统计信息
     */
    async getStats() {
        const stats = await this.getData('stats');
        return {
            ...stats,
            uptime: this.getUptime(),
            currentMessages: this.messageCount
        };
    }

    /**
     * 格式化统计信息
     */
    formatStats(stats) {
        return `📊 示例插件统计信息\n` +
            `━━━━━━━━━━━━━━━━\n` +
            `📨 总消息数：${stats.totalMessages}\n` +
            `👤 私聊消息：${stats.privateMessages}\n` +
            `👥 群聊消息：${stats.groupMessages}\n` +
            `⚡ 命令执行：${stats.commandsExecuted}\n` +
            `⏰ 运行时间：${stats.uptime}\n` +
            `🔄 当前会话消息：${stats.currentMessages}`;
    }

    /**
     * 获取运行时间
     */
    getUptime() {
        const uptime = Date.now() - this.startTime;
        const hours = Math.floor(uptime / (1000 * 60 * 60));
        const minutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((uptime % (1000 * 60)) / 1000);
        
        return `${hours}小时${minutes}分钟${seconds}秒`;
    }

    /**
     * 定时报告统计信息
     */
    async reportStats() {
        if (!this.isEnabled()) {
            return;
        }
        
        const config = await this.getData('config');
        if (!config.enableStats) {
            return;
        }
        
        const stats = await this.getStats();
        
        logger.info('Example plugin stats:', {
            totalMessages: stats.totalMessages,
            privateMessages: stats.privateMessages,
            groupMessages: stats.groupMessages,
            commandsExecuted: stats.commandsExecuted,
            uptime: stats.uptime
        });
        
        // 可以选择发送到管理员或特定群组
        // await this.sendPrivateMessage(adminUserId, this.formatStats(stats));
    }

    /**
     * HTTP 路由：获取统计信息
     */
    async getStatsRoute(req, res) {
        try {
            const stats = await this.getStats();
            res.json({
                success: true,
                data: stats
            });
        } catch (error) {
            logger.error('Error in stats route:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * HTTP 路由：发送消息
     */
    async sendMessageRoute(req, res) {
        try {
            const { type, target, message } = req.body;
            
            if (!type || !target || !message) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required parameters: type, target, message'
                });
            }
            
            if (type === 'private') {
                await this.sendPrivateMessage(target, message);
            } else if (type === 'group') {
                await this.sendGroupMessage(target, message);
            } else {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid message type. Use "private" or "group"'
                });
            }
            
            res.json({
                success: true,
                message: 'Message sent successfully'
            });
            
        } catch (error) {
            logger.error('Error in send message route:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 插件销毁
     */
    async destroy() {
        logger.info('Example plugin is being destroyed');
        
        // 保存最终统计数据
        const finalStats = await this.getStats();
        logger.info('Final example plugin stats:', finalStats);
        
        await super.destroy();
        
        this.emit('destroyed');
    }

    /**
     * 获取插件信息
     */
    getInfo() {
        return {
            ...super.getInfo(),
            messageCount: this.messageCount,
            uptime: this.getUptime(),
            startTime: this.startTime
        };
    }
}

module.exports = ExamplePlugin;