# NoteBot 插件开发指南

本指南将详细介绍如何为 NoteBot 开发自定义插件。

## 📖 插件系统概述

NoteBot 的插件系统基于事件驱动架构，提供了丰富的 API 和生命周期管理。每个插件都是一个独立的模块，可以：

- 处理消息和事件
- 注册命令和定时任务
- 存储和管理数据
- 提供 HTTP API 接口
- 与其他插件通信

## 🏗️ 插件结构

### 基本目录结构

```
plugins/
└── your-plugin/
    ├── index.js          # 插件主文件
    ├── plugin.json       # 插件配置文件
    ├── README.md         # 插件说明文档
    ├── config/           # 配置文件目录
    │   └── default.json
    ├── data/             # 数据文件目录
    ├── assets/           # 静态资源目录
    │   ├── images/
    │   └── styles/
    └── lib/              # 库文件目录
        └── utils.js
```

### 插件配置文件 (plugin.json)

```json
{
  "name": "your-plugin",
  "version": "1.0.0",
  "description": "插件描述",
  "author": "Your Name",
  "license": "MIT",
  "main": "index.js",
  "keywords": ["notebot", "plugin"],
  "repository": {
    "type": "git",
    "url": "https://github.com/your-username/your-plugin"
  },
  "notebot": {
    "apiVersion": "1.0.0",
    "minVersion": "1.0.0",
    "permissions": [
      "message.send",
      "message.receive",
      "data.read",
      "data.write",
      "api.call",
      "http.server"
    ],
    "dependencies": {
      "other-plugin": "^1.0.0"
    },
    "config": {
      "schema": {
        "type": "object",
        "properties": {
          "apiKey": {
            "type": "string",
            "description": "API 密钥",
            "default": ""
          },
          "enabled": {
            "type": "boolean",
            "description": "是否启用",
            "default": true
          },
          "interval": {
            "type": "number",
            "description": "间隔时间（秒）",
            "default": 60,
            "minimum": 1
          }
        },
        "required": ["apiKey"]
      },
      "ui": {
        "form": [
          {
            "key": "apiKey",
            "type": "password",
            "title": "API 密钥",
            "placeholder": "请输入 API 密钥"
          },
          {
            "key": "enabled",
            "type": "checkbox",
            "title": "启用插件"
          },
          {
            "key": "interval",
            "type": "number",
            "title": "检查间隔",
            "description": "自动检查的时间间隔（秒）"
          }
        ]
      }
    },
    "commands": [
      {
        "name": "hello",
        "description": "打招呼命令",
        "usage": "/hello [name]",
        "aliases": ["hi", "hey"],
        "permission": "user"
      }
    ],
    "events": [
      "message.private",
      "message.group",
      "notice.friend_add",
      "request.friend"
    ],
    "routes": [
      {
        "method": "GET",
        "path": "/stats",
        "description": "获取统计信息"
      },
      {
        "method": "POST",
        "path": "/send",
        "description": "发送消息"
      }
    ],
    "tasks": [
      {
        "name": "daily-check",
        "cron": "0 0 * * *",
        "description": "每日检查任务"
      }
    ]
  }
}
```

## 🔧 插件开发

### 基础插件类

```javascript
// index.js
const BasePlugin = require('../../src/plugins/base');
const logger = require('../../src/utils/logger');

class YourPlugin extends BasePlugin {
    constructor() {
        super({
            name: 'your-plugin',
            version: '1.0.0',
            description: '您的插件描述',
            author: 'Your Name'
        });
        
        // 插件私有属性
        this.stats = {
            messageCount: 0,
            commandCount: 0,
            lastActivity: null
        };
    }

    /**
     * 插件初始化
     * 在插件加载时调用
     */
    async initialize() {
        await super.initialize();
        
        logger.info(`[${this.name}] 插件初始化开始`);
        
        try {
            // 注册消息处理器
            this.registerMessageHandler('private', this.handlePrivateMessage.bind(this));
            this.registerMessageHandler('group', this.handleGroupMessage.bind(this));
            
            // 注册事件处理器
            this.registerEventHandler('notice.friend_add', this.handleFriendAdd.bind(this));
            this.registerEventHandler('request.friend', this.handleFriendRequest.bind(this));
            
            // 注册命令
            this.registerCommand('hello', this.handleHelloCommand.bind(this));
            this.registerCommand('stats', this.handleStatsCommand.bind(this));
            
            // 注册定时任务
            this.registerScheduledTask('daily-check', '0 0 * * *', this.dailyCheck.bind(this));
            this.registerScheduledTask('hourly-stats', '0 * * * *', this.updateStats.bind(this));
            
            // 注册 HTTP 路由
            this.registerRoute('GET', '/stats', this.getStats.bind(this));
            this.registerRoute('POST', '/send', this.sendMessage.bind(this));
            
            // 加载配置
            await this.loadConfig();
            
            // 初始化数据
            await this.initializeData();
            
            logger.info(`[${this.name}] 插件初始化完成`);
        } catch (error) {
            logger.error(`[${this.name}] 插件初始化失败:`, error);
            throw error;
        }
    }

    /**
     * 加载插件配置
     */
    async loadConfig() {
        const defaultConfig = {
            apiKey: '',
            enabled: true,
            interval: 60,
            maxRetries: 3
        };
        
        this.config = await this.getConfig(defaultConfig);
        
        // 验证必需配置
        if (!this.config.apiKey) {
            throw new Error('API 密钥未配置');
        }
    }

    /**
     * 初始化数据
     */
    async initializeData() {
        // 从数据库加载统计数据
        const savedStats = await this.getData('stats');
        if (savedStats) {
            this.stats = { ...this.stats, ...savedStats };
        }
        
        // 创建必要的数据结构
        await this.setData('initialized', true);
    }

    /**
     * 处理私聊消息
     */
    async handlePrivateMessage(message) {
        this.stats.messageCount++;
        this.stats.lastActivity = new Date();
        
        logger.debug(`[${this.name}] 收到私聊消息:`, message.raw_message);
        
        // 检查是否为命令
        if (message.raw_message.startsWith('/')) {
            return; // 命令由命令处理器处理
        }
        
        // 处理普通消息
        if (message.raw_message.includes('你好')) {
            await this.sendPrivateMessage(message.user_id, '你好！我是 NoteBot 插件。');
        }
    }

    /**
     * 处理群聊消息
     */
    async handleGroupMessage(message) {
        this.stats.messageCount++;
        this.stats.lastActivity = new Date();
        
        logger.debug(`[${this.name}] 收到群聊消息:`, message.raw_message);
        
        // 检查是否 @ 机器人
        if (message.raw_message.includes(`[CQ:at,qq=${this.bot.qq}]`)) {
            const cleanMessage = message.raw_message.replace(/\[CQ:at,qq=\d+\]/g, '').trim();
            
            if (cleanMessage.includes('帮助')) {
                await this.sendGroupMessage(message.group_id, '我是一个示例插件，可以使用 /hello 命令与我交互。');
            }
        }
    }

    /**
     * 处理好友添加事件
     */
    async handleFriendAdd(event) {
        logger.info(`[${this.name}] 新好友添加:`, event.user_id);
        
        // 发送欢迎消息
        setTimeout(async () => {
            await this.sendPrivateMessage(event.user_id, '欢迎使用 NoteBot！输入 /help 查看可用命令。');
        }, 2000);
    }

    /**
     * 处理好友请求事件
     */
    async handleFriendRequest(event) {
        logger.info(`[${this.name}] 收到好友请求:`, event.user_id);
        
        // 自动同意好友请求
        if (this.config.autoAcceptFriend) {
            await this.setFriendAddRequest(event.flag, true);
        }
    }

    /**
     * 处理 hello 命令
     */
    async handleHelloCommand(message, args) {
        this.stats.commandCount++;
        
        const name = args.length > 0 ? args.join(' ') : '朋友';
        const response = `你好，${name}！我是 ${this.name} 插件。`;
        
        if (message.message_type === 'private') {
            await this.sendPrivateMessage(message.user_id, response);
        } else if (message.message_type === 'group') {
            await this.sendGroupMessage(message.group_id, response);
        }
    }

    /**
     * 处理统计命令
     */
    async handleStatsCommand(message, args) {
        const stats = {
            ...this.stats,
            uptime: this.getUptime(),
            version: this.version
        };
        
        const response = `📊 插件统计信息\n` +
            `消息处理: ${stats.messageCount}\n` +
            `命令执行: ${stats.commandCount}\n` +
            `运行时间: ${stats.uptime}\n` +
            `最后活动: ${stats.lastActivity ? stats.lastActivity.toLocaleString() : '无'}`;
        
        if (message.message_type === 'private') {
            await this.sendPrivateMessage(message.user_id, response);
        } else if (message.message_type === 'group') {
            await this.sendGroupMessage(message.group_id, response);
        }
    }

    /**
     * 每日检查任务
     */
    async dailyCheck() {
        logger.info(`[${this.name}] 执行每日检查任务`);
        
        try {
            // 清理过期数据
            await this.cleanupExpiredData();
            
            // 生成日报
            await this.generateDailyReport();
            
            // 重置每日统计
            this.stats.dailyMessageCount = 0;
            this.stats.dailyCommandCount = 0;
            
        } catch (error) {
            logger.error(`[${this.name}] 每日检查任务失败:`, error);
        }
    }

    /**
     * 更新统计信息
     */
    async updateStats() {
        try {
            // 保存统计数据到数据库
            await this.setData('stats', this.stats);
            
            logger.debug(`[${this.name}] 统计信息已更新`);
        } catch (error) {
            logger.error(`[${this.name}] 更新统计信息失败:`, error);
        }
    }

    /**
     * HTTP 路由：获取统计信息
     */
    async getStats(req, res) {
        try {
            const stats = {
                ...this.stats,
                uptime: this.getUptime(),
                version: this.version,
                config: {
                    enabled: this.config.enabled,
                    interval: this.config.interval
                }
            };
            
            res.json({
                success: true,
                data: stats
            });
        } catch (error) {
            logger.error(`[${this.name}] 获取统计信息失败:`, error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * HTTP 路由：发送消息
     */
    async sendMessage(req, res) {
        try {
            const { type, target, message } = req.body;
            
            if (!type || !target || !message) {
                return res.status(400).json({
                    success: false,
                    error: '缺少必需参数'
                });
            }
            
            let result;
            if (type === 'private') {
                result = await this.sendPrivateMessage(target, message);
            } else if (type === 'group') {
                result = await this.sendGroupMessage(target, message);
            } else {
                return res.status(400).json({
                    success: false,
                    error: '无效的消息类型'
                });
            }
            
            res.json({
                success: true,
                data: result
            });
        } catch (error) {
            logger.error(`[${this.name}] 发送消息失败:`, error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * 清理过期数据
     */
    async cleanupExpiredData() {
        const expiredKeys = await this.getExpiredDataKeys();
        for (const key of expiredKeys) {
            await this.deleteData(key);
        }
        logger.info(`[${this.name}] 清理了 ${expiredKeys.length} 个过期数据`);
    }

    /**
     * 生成日报
     */
    async generateDailyReport() {
        const report = {
            date: new Date().toDateString(),
            messageCount: this.stats.messageCount,
            commandCount: this.stats.commandCount,
            uptime: this.getUptime()
        };
        
        // 发送给管理员
        for (const adminId of this.bot.admin) {
            const message = `📊 ${this.name} 日报\n` +
                `日期: ${report.date}\n` +
                `消息处理: ${report.messageCount}\n` +
                `命令执行: ${report.commandCount}\n` +
                `运行时间: ${report.uptime}`;
            
            await this.sendPrivateMessage(adminId, message);
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
     * 获取过期数据键
     */
    async getExpiredDataKeys() {
        // 实现获取过期数据键的逻辑
        const allKeys = await this.getAllDataKeys();
        const expiredKeys = [];
        
        for (const key of allKeys) {
            if (key.startsWith('temp_') && await this.isDataExpired(key)) {
                expiredKeys.push(key);
            }
        }
        
        return expiredKeys;
    }

    /**
     * 插件销毁
     * 在插件卸载时调用
     */
    async destroy() {
        logger.info(`[${this.name}] 插件销毁开始`);
        
        try {
            // 保存最终统计数据
            await this.setData('stats', this.stats);
            
            // 清理资源
            await this.cleanup();
            
            // 调用父类销毁方法
            await super.destroy();
            
            logger.info(`[${this.name}] 插件销毁完成`);
        } catch (error) {
            logger.error(`[${this.name}] 插件销毁失败:`, error);
            throw error;
        }
    }

    /**
     * 清理资源
     */
    async cleanup() {
        // 清理临时文件
        // 关闭数据库连接
        // 取消定时器等
    }
}

module.exports = YourPlugin;
```

## 📚 API 参考

### 基础方法

#### 消息发送

```javascript
// 发送私聊消息
await this.sendPrivateMessage(userId, message);

// 发送群聊消息
await this.sendGroupMessage(groupId, message);

// 发送临时会话消息
await this.sendTempMessage(groupId, userId, message);
```

#### 数据存储

```javascript
// 存储数据
await this.setData(key, value);

// 获取数据
const value = await this.getData(key, defaultValue);

// 删除数据
await this.deleteData(key);

// 检查数据是否存在
const exists = await this.hasData(key);

// 获取所有键
const keys = await this.getAllDataKeys();
```

#### 配置管理

```javascript
// 获取配置
const config = await this.getConfig(defaultConfig);

// 更新配置
await this.updateConfig(newConfig);

// 重置配置
await this.resetConfig();
```

#### 事件注册

```javascript
// 注册消息处理器
this.registerMessageHandler('private', handler);
this.registerMessageHandler('group', handler);

// 注册事件处理器
this.registerEventHandler('notice.friend_add', handler);
this.registerEventHandler('request.friend', handler);

// 注册命令
this.registerCommand('commandName', handler);

// 注册定时任务
this.registerScheduledTask('taskName', 'cronExpression', handler);

// 注册 HTTP 路由
this.registerRoute('GET', '/path', handler);
```

### OneBot API 调用

```javascript
// 获取登录信息
const loginInfo = await this.callApi('get_login_info');

// 获取好友列表
const friendList = await this.callApi('get_friend_list');

// 获取群列表
const groupList = await this.callApi('get_group_list');

// 获取群成员信息
const memberInfo = await this.callApi('get_group_member_info', {
    group_id: groupId,
    user_id: userId
});

// 设置好友添加请求
await this.callApi('set_friend_add_request', {
    flag: requestFlag,
    approve: true
});
```

### 插件间通信

```javascript
// 发送事件给其他插件
this.emit('custom.event', data);

// 监听其他插件的事件
this.on('other.plugin.event', handler);

// 调用其他插件的方法
const result = await this.callPlugin('other-plugin', 'methodName', args);

// 获取其他插件实例
const otherPlugin = this.getPlugin('other-plugin');
```

## 🧪 测试插件

### 单元测试

```javascript
// test/your-plugin.test.js
const YourPlugin = require('../plugins/your-plugin');
const { expect } = require('chai');

describe('YourPlugin', () => {
    let plugin;
    
    beforeEach(async () => {
        plugin = new YourPlugin();
        await plugin.initialize();
    });
    
    afterEach(async () => {
        await plugin.destroy();
    });
    
    describe('handleHelloCommand', () => {
        it('should respond with greeting', async () => {
            const message = {
                message_type: 'private',
                user_id: 123456,
                raw_message: '/hello World'
            };
            
            const args = ['World'];
            await plugin.handleHelloCommand(message, args);
            
            // 验证响应
            expect(plugin.stats.commandCount).to.equal(1);
        });
    });
    
    describe('data storage', () => {
        it('should store and retrieve data', async () => {
            await plugin.setData('test', 'value');
            const value = await plugin.getData('test');
            expect(value).to.equal('value');
        });
    });
});
```

### 集成测试

```javascript
// test/integration.test.js
const request = require('supertest');
const app = require('../src/web/server');

describe('Plugin HTTP API', () => {
    it('should return plugin stats', async () => {
        const response = await request(app)
            .get('/api/plugins/your-plugin/stats')
            .expect(200);
            
        expect(response.body.success).to.be.true;
        expect(response.body.data).to.have.property('messageCount');
    });
    
    it('should send message via API', async () => {
        const response = await request(app)
            .post('/api/plugins/your-plugin/send')
            .send({
                type: 'private',
                target: 123456,
                message: 'Test message'
            })
            .expect(200);
            
        expect(response.body.success).to.be.true;
    });
});
```

## 📦 插件打包和发布

### 打包插件

```bash
# 创建插件包
cd plugins/your-plugin
npm pack

# 或使用 tar
tar -czf your-plugin-1.0.0.tgz .
```

### 发布到 npm

```bash
# 登录 npm
npm login

# 发布插件
npm publish
```

### 插件安装

```bash
# 从 npm 安装
npm install notebot-plugin-your-plugin

# 从本地文件安装
npm install ./your-plugin-1.0.0.tgz

# 从 Git 仓库安装
npm install git+https://github.com/your-username/your-plugin.git
```

## 🔍 调试技巧

### 启用调试日志

```javascript
// 在插件中添加调试日志
const debug = require('debug')('notebot:plugin:your-plugin');

debug('Debug message');
```

```bash
# 启动时启用调试
DEBUG=notebot:plugin:* npm start
```

### 使用 VS Code 调试

```json
// .vscode/launch.json
{
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Debug Plugin",
            "type": "node",
            "request": "launch",
            "program": "${workspaceFolder}/src/app.js",
            "env": {
                "DEBUG": "notebot:plugin:your-plugin",
                "NODE_ENV": "development"
            },
            "console": "integratedTerminal",
            "skipFiles": [
                "<node_internals>/**"
            ]
        }
    ]
}
```

### 性能分析

```javascript
// 使用性能计时器
const start = process.hrtime.bigint();
// 执行代码
const end = process.hrtime.bigint();
const duration = Number(end - start) / 1000000; // 转换为毫秒
logger.debug(`操作耗时: ${duration}ms`);
```

## 📋 最佳实践

### 1. 错误处理

```javascript
// 总是使用 try-catch 包装异步操作
try {
    await this.someAsyncOperation();
} catch (error) {
    logger.error(`[${this.name}] 操作失败:`, error);
    // 适当的错误恢复逻辑
}
```

### 2. 资源管理

```javascript
// 及时清理资源
async destroy() {
    // 清理定时器
    if (this.timer) {
        clearInterval(this.timer);
    }
    
    // 关闭数据库连接
    if (this.db) {
        await this.db.close();
    }
    
    await super.destroy();
}
```

### 3. 配置验证

```javascript
// 验证配置
validateConfig(config) {
    const schema = {
        apiKey: { type: 'string', required: true },
        timeout: { type: 'number', min: 1000, max: 60000 }
    };
    
    return this.validateSchema(config, schema);
}
```

### 4. 异步操作

```javascript
// 避免阻塞事件循环
async processLargeData(data) {
    const chunks = this.chunkArray(data, 100);
    
    for (const chunk of chunks) {
        await this.processChunk(chunk);
        // 让出控制权
        await new Promise(resolve => setImmediate(resolve));
    }
}
```

### 5. 内存管理

```javascript
// 定期清理缓存
setInterval(() => {
    this.cleanupCache();
}, 60000); // 每分钟清理一次

cleanupCache() {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
        if (now - item.timestamp > this.cacheTimeout) {
            this.cache.delete(key);
        }
    }
}
```

## 🚀 高级功能

### 插件热重载

```javascript
// 监听文件变化
const chokidar = require('chokidar');

if (process.env.NODE_ENV === 'development') {
    const watcher = chokidar.watch('./plugins/your-plugin/');
    watcher.on('change', async (path) => {
        logger.info(`插件文件变化: ${path}`);
        await this.reload();
    });
}
```

### 插件依赖管理

```javascript
// 检查依赖
async checkDependencies() {
    const dependencies = this.manifest.notebot.dependencies || {};
    
    for (const [name, version] of Object.entries(dependencies)) {
        const plugin = this.getPlugin(name);
        if (!plugin) {
            throw new Error(`缺少依赖插件: ${name}`);
        }
        
        if (!this.satisfiesVersion(plugin.version, version)) {
            throw new Error(`插件版本不兼容: ${name}@${plugin.version}, 需要: ${version}`);
        }
    }
}
```

### 插件权限系统

```javascript
// 检查权限
checkPermission(permission) {
    const permissions = this.manifest.notebot.permissions || [];
    if (!permissions.includes(permission)) {
        throw new Error(`缺少权限: ${permission}`);
    }
}

// 在需要权限的操作前检查
async sendMessage(userId, message) {
    this.checkPermission('message.send');
    return await super.sendMessage(userId, message);
}
```

## 📖 示例插件

查看 `plugins/example/` 目录中的完整示例插件，了解如何实现各种功能。

## 🆘 获取帮助

- **API 文档**: [API_REFERENCE.md](API_REFERENCE.md)
- **GitHub Issues**: [提交问题](https://github.com/your-username/notebot/issues)
- **讨论区**: [GitHub Discussions](https://github.com/your-username/notebot/discussions)
- **QQ 群**: 123456789

---

**提示**: 开发插件时建议先从简单功能开始，逐步添加复杂特性。记得编写测试和文档！