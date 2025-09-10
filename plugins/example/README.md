# 示例插件 (Example Plugin)

这是一个 NoteBot 示例插件，展示了插件系统的基本功能和最佳实践。通过学习这个插件，您可以了解如何开发自己的 NoteBot 插件。

## 功能特性

### 🤖 消息处理
- **私聊消息处理**：响应用户的私聊消息
- **群聊消息处理**：处理群组中的消息和 @ 提及
- **关键词回复**：基于关键词的自动回复功能
- **命令系统**：支持多种实用命令

### 📊 统计功能
- **消息统计**：记录私聊、群聊消息数量
- **命令统计**：跟踪命令执行次数
- **运行时间**：显示插件运行时长
- **定时报告**：定期生成统计报告

### ✅ 签到系统
- **每日签到**：用户可以进行每日签到
- **签到统计**：记录用户签到次数和历史
- **防重复签到**：同一天只能签到一次

### 🔧 管理功能
- **用户管理**：支持用户黑名单功能
- **群组管理**：可配置允许使用的群组
- **权限控制**：基于用户权限的功能访问
- **配置管理**：灵活的配置选项

### 🌐 Web API
- **统计接口**：通过 HTTP API 获取统计信息
- **消息发送**：通过 API 发送消息
- **RESTful 设计**：标准的 REST API 接口

## 安装方法

### 1. 自动安装（推荐）

通过 NoteBot 管理后台安装：

1. 打开 NoteBot Web 管理界面
2. 进入「插件管理」页面
3. 点击「安装插件」
4. 选择示例插件并安装

### 2. 手动安装

1. 将插件文件复制到 `plugins/example/` 目录
2. 重启 NoteBot 或通过管理界面重载插件

```bash
# 复制插件文件
cp -r example/ /path/to/notebot/plugins/

# 重启 NoteBot
npm run restart
```

## 配置选项

插件支持以下配置选项，可通过 Web 管理界面或配置文件进行设置：

### 基础配置

```json
{
  "welcomeMessage": "欢迎使用示例插件！",
  "enableStats": true,
  "maxMessageLength": 1000,
  "allowedGroups": [],
  "bannedUsers": []
}
```

### 自动回复配置

```json
{
  "autoReply": {
    "enabled": true,
    "keywords": {
      "你好": "你好！我是示例插件",
      "hello": "Hello! I'm the example plugin",
      "时间": "当前时间：{time}",
      "帮助": "发送 /help 查看可用命令"
    }
  }
}
```

### 签到系统配置

```json
{
  "checkIn": {
    "enabled": true,
    "rewards": {
      "points": 10,
      "bonus": {
        "consecutive": 7,
        "points": 50
      }
    }
  }
}
```

### 频率限制配置

```json
{
  "rateLimiting": {
    "enabled": true,
    "maxRequests": 10,
    "windowMs": 60000
  }
}
```

## 使用方法

### 命令列表

| 命令 | 描述 | 用法 | 别名 |
|------|------|------|------|
| `/help` | 显示帮助信息 | `/help` | `/h`, `/帮助` |
| `/ping` | 测试响应时间 | `/ping` | `/p` |
| `/stats` | 显示统计信息 | `/stats` | `/统计`, `/stat` |
| `/echo` | 回显消息 | `/echo <消息>` | `/回显` |
| `/time` | 显示当前时间 | `/time` | `/时间`, `/t` |

### 关键词回复

发送以下关键词可触发自动回复：

- **你好** / **hello** - 获得欢迎消息
- **时间** - 获取当前时间
- **统计** - 查看插件统计信息
- **签到** - 进行每日签到（仅群聊）
- **帮助** - 显示帮助信息

### 群聊功能

在群聊中，您可以：

1. **@ 机器人**：直接 @ 机器人进行对话
2. **签到功能**：发送「签到」进行每日签到
3. **命令使用**：使用所有支持的命令
4. **关键词回复**：触发自动回复功能

### 私聊功能

在私聊中，您可以：

1. **直接对话**：发送消息与机器人对话
2. **命令使用**：使用所有支持的命令
3. **获取统计**：查看详细的使用统计
4. **配置查询**：查看当前配置信息

## API 接口

### 获取统计信息

```http
GET /api/plugins/example/stats
```

**响应示例：**

```json
{
  "success": true,
  "data": {
    "totalMessages": 1234,
    "privateMessages": 567,
    "groupMessages": 667,
    "commandsExecuted": 89,
    "uptime": "2小时34分钟12秒",
    "currentMessages": 45
  }
}
```

### 发送消息

```http
POST /api/plugins/example/send
Content-Type: application/json
Authorization: Bearer <token>

{
  "type": "private",
  "target": "123456789",
  "message": "Hello from API!"
}
```

**参数说明：**

- `type`: 消息类型，`private` 或 `group`
- `target`: 目标用户ID或群组ID
- `message`: 要发送的消息内容

## 开发指南

### 插件结构

```
example/
├── index.js          # 主插件文件
├── plugin.json       # 插件配置文件
├── README.md         # 说明文档
└── package.json      # 依赖配置（可选）
```

### 核心概念

#### 1. 插件基类

所有插件都应继承自 `BasePlugin` 类：

```javascript
const BasePlugin = require('../../src/plugins/base');

class ExamplePlugin extends BasePlugin {
    constructor() {
        super({
            name: 'example',
            version: '1.0.0',
            description: '示例插件',
            // ... 其他配置
        });
    }
}
```

#### 2. 生命周期方法

```javascript
// 插件初始化
async initialize() {
    await super.initialize();
    // 自定义初始化逻辑
}

// 插件销毁
async destroy() {
    // 清理资源
    await super.destroy();
}
```

#### 3. 消息处理

```javascript
// 注册消息处理器
this.registerMessageHandler('private', this.handlePrivateMessage.bind(this));
this.registerMessageHandler('group', this.handleGroupMessage.bind(this));

// 处理消息
async handlePrivateMessage(message) {
    const { user_id, raw_message } = message;
    // 处理逻辑
}
```

#### 4. 事件处理

```javascript
// 注册事件处理器
this.registerEventHandler('friend_add', this.handleFriendAdd.bind(this));

// 处理事件
async handleFriendAdd(event) {
    const { user_id } = event;
    // 处理逻辑
}
```

#### 5. 定时任务

```javascript
// 注册定时任务
this.registerScheduledTask('stats-report', '0 */10 * * * *', this.reportStats.bind(this));

// 任务处理
async reportStats() {
    // 定时任务逻辑
}
```

#### 6. HTTP 路由

```javascript
// 注册路由
this.registerRoute('GET', '/stats', this.getStats.bind(this));
this.registerRoute('POST', '/send', this.sendMessage.bind(this));

// 路由处理
async getStats(req, res) {
    res.json({ success: true, data: stats });
}
```

#### 7. 数据存储

```javascript
// 存储数据
await this.setData('key', value);

// 读取数据
const value = await this.getData('key');

// 删除数据
await this.deleteData('key');
```

### 最佳实践

#### 1. 错误处理

```javascript
try {
    // 业务逻辑
} catch (error) {
    logger.error('Error in plugin:', error);
    // 错误处理
}
```

#### 2. 日志记录

```javascript
const logger = require('../../src/utils/logger');

logger.info('Plugin initialized');
logger.warn('Warning message');
logger.error('Error occurred:', error);
logger.debug('Debug information');
```

#### 3. 配置管理

```javascript
// 获取配置
const config = await this.getData('config');

// 使用默认配置
const defaultConfig = { /* 默认值 */ };
const config = await this.getData('config') || defaultConfig;
```

#### 4. 权限检查

```javascript
// 检查用户权限
if (!this.hasPermission(user_id, 'admin')) {
    return;
}

// 检查群组权限
if (!this.isGroupAllowed(group_id)) {
    return;
}
```

## 故障排除

### 常见问题

#### 1. 插件无法加载

**问题**：插件在管理界面显示为「加载失败」

**解决方案**：
- 检查 `plugin.json` 文件格式是否正确
- 确认 `index.js` 文件语法无误
- 查看日志文件中的错误信息

#### 2. 消息无响应

**问题**：发送消息后插件无响应

**解决方案**：
- 确认插件已启用
- 检查用户是否在黑名单中
- 验证群组是否在允许列表中
- 查看插件日志

#### 3. 命令不工作

**问题**：发送命令后无反应

**解决方案**：
- 确认命令格式正确（以 `/` 开头）
- 检查命令是否已注册
- 验证用户权限

#### 4. 定时任务不执行

**问题**：定时任务没有按预期执行

**解决方案**：
- 检查 cron 表达式格式
- 确认插件已启用
- 查看调度器日志

### 调试技巧

#### 1. 启用调试日志

在配置文件中设置日志级别为 `debug`：

```json
{
  "logger": {
    "level": "debug"
  }
}
```

#### 2. 使用控制台输出

在开发过程中可以使用 `console.log` 进行调试：

```javascript
console.log('Debug info:', data);
```

#### 3. 查看插件状态

通过管理界面查看插件的运行状态和统计信息。

## 扩展开发

### 添加新功能

1. **新增命令**：在 `handleCommand` 方法中添加新的命令处理逻辑
2. **新增事件**：注册新的事件处理器
3. **新增API**：添加新的 HTTP 路由
4. **新增定时任务**：注册新的定时任务

### 自定义配置

在 `plugin.json` 中添加新的配置选项：

```json
{
  "notebot": {
    "config": {
      "schema": {
        "properties": {
          "newOption": {
            "type": "string",
            "default": "default value",
            "description": "新配置选项"
          }
        }
      }
    }
  }
}
```

### 数据库集成

如果需要更复杂的数据存储，可以集成数据库：

```javascript
// 使用 Redis
const redis = require('../../src/database/redis');
const value = await redis.get('key');

// 使用其他数据库
const db = require('./database');
const result = await db.query('SELECT * FROM table');
```

## 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

## 贡献

欢迎提交 Issue 和 Pull Request！

## 支持

如果您在使用过程中遇到问题，可以：

1. 查看本文档的故障排除部分
2. 在 GitHub 上提交 Issue
3. 加入官方交流群获取帮助

---

**注意**：这是一个示例插件，主要用于学习和参考。在生产环境中使用前，请根据实际需求进行适当的修改和测试。