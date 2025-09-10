# NoteBot - Minecraft X NTQQ机器人框架

![NoteBot Logo](https://img.shields.io/badge/NoteBot-v1.0.0-blue.svg)
![Node.js](https://img.shields.io/badge/Node.js-14%2B-green.svg)
![License](https://img.shields.io/badge/License-MIT-yellow.svg)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey.svg)

NoteBot 是一个基于 Node.js 的现代化 QQ 机器人框架，支持 OneBot 11 协议，具有完整的插件系统、Web 管理界面、定时任务调度和系统监控功能。

## ✨ 主要特性

### 🤖 OneBot 11 协议支持
- 完整的 OneBot 11 标准实现
- 支持正向和反向 WebSocket 连接
- 消息、事件、API 调用的完整支持
- 自动重连和错误恢复机制

### 🔌 强大的插件系统
- 热插拔插件加载/卸载
- 插件生命周期管理
- 插件间通信机制
- 权限和依赖管理
- 丰富的插件 API

### 🌐 Web 管理界面
- 现代化的响应式 Web UI
- 实时系统状态监控
- 插件管理和配置
- 日志查看和分析
- 用户权限管理

### ⏰ 定时任务调度
- 基于 Cron 表达式的任务调度
- 任务执行状态监控
- 失败重试机制
- 任务历史记录

### 📊 系统监控
- 实时性能监控
- 资源使用统计
- 错误日志分析
- 健康状态检查

### 💾 数据存储
- Redis 数据库集成
- 数据持久化
- 缓存管理
- 数据备份和恢复

## 🚀 快速开始

### 环境要求

- **Node.js**: 14.0.0 或更高版本
- **Redis**: 6.0 或更高版本
- **内存**: 至少 512MB RAM
- **存储**: 至少 1GB 可用空间

### 安装步骤

#### 1. 克隆项目

```bash
git clone https://github.com/inf-mc/NoteBot.git
cd notebot
```

#### 2. 安装依赖

```bash
npm install
```

#### 3. 配置环境

复制配置模板并编辑：

```bash
cp config/config.example.json config/config.json
```

编辑 `config/config.json`：

```json
{
  "bot": {
    "qq": "你的机器人QQ号",
    "name": "NoteBot",
    "admin": ["管理员QQ号"]
  },
  "onebot": {
    "host": "127.0.0.1",
    "port": 8080,
    "accessToken": "your_access_token",
    "secret": "your_secret"
  },
  "redis": {
    "host": "127.0.0.1",
    "port": 6379,
    "password": "",
    "db": 0
  },
  "web": {
    "port": 3000,
    "host": "0.0.0.0",
    "secret": "your_jwt_secret"
  }
}
```

#### 4. 启动服务

```bash
# 开发模式
npm run dev

# 生产模式
npm start

# 后台运行
npm run start:daemon
```

#### 5. 访问管理界面

打开浏览器访问：`http://localhost:3000`

默认登录信息：
- 用户名：`admin`
- 密码：`admin123`

## 📁 项目结构

```
NoteBot/
├── config/                 # 配置文件
│   ├── config.json         # 主配置文件
│   └── config.example.json # 配置模板
├── logs/                   # 日志文件
├── plugins/                # 插件目录
│   └── example/            # 示例插件
├── src/                    # 源代码
│   ├── app.js              # 应用入口
│   ├── database/           # 数据库模块
│   │   └── redis.js
│   ├── monitor/            # 监控模块
│   │   ├── index.js
│   │   ├── profiler.js
│   │   └── logAnalyzer.js
│   ├── onebot/             # OneBot协议模块
│   │   ├── index.js
│   │   ├── api.js
│   │   ├── events.js
│   │   └── websocket.js
│   ├── plugins/            # 插件系统
│   │   ├── index.js
│   │   ├── base.js
│   │   └── loader.js
│   ├── scheduler/          # 任务调度
│   │   ├── index.js
│   │   └── taskManager.js
│   ├── utils/              # 工具模块
│   │   ├── logger.js
│   │   └── config.js
│   └── web/                # Web界面
│       ├── server.js
│       ├── public/
│       └── routes/
├── package.json            # 项目配置
├── package-lock.json       # 依赖锁定
└── README.md              # 项目说明
```

## 🔧 配置说明

### 基础配置

```json
{
  "bot": {
    "qq": "机器人QQ号",
    "name": "机器人昵称",
    "admin": ["管理员QQ号列表"],
    "debug": false
  }
}
```

### OneBot 配置

```json
{
  "onebot": {
    "host": "OneBot服务地址",
    "port": 8080,
    "accessToken": "访问令牌",
    "secret": "签名密钥",
    "reconnectInterval": 5000,
    "heartbeatInterval": 30000
  }
}
```

### Redis 配置

```json
{
  "redis": {
    "host": "Redis服务器地址",
    "port": 6379,
    "password": "Redis密码",
    "db": 0,
    "keyPrefix": "notebot:",
    "retryDelayOnFailover": 100
  }
}
```

### Web 服务配置

```json
{
  "web": {
    "port": 3000,
    "host": "0.0.0.0",
    "secret": "JWT密钥",
    "sessionTimeout": 86400,
    "rateLimit": {
      "windowMs": 900000,
      "max": 100
    }
  }
}
```

### 日志配置

```json
{
  "logger": {
    "level": "info",
    "file": {
      "enabled": true,
      "filename": "logs/notebot.log",
      "maxSize": "10m",
      "maxFiles": "7d"
    },
    "console": {
      "enabled": true,
      "colorize": true
    }
  }
}
```

## 🔌 插件开发

### 创建插件

1. 在 `plugins/` 目录下创建插件文件夹
2. 创建 `index.js` 主文件
3. 创建 `plugin.json` 配置文件

### 插件示例

```javascript
const BasePlugin = require('../../src/plugins/base');

class MyPlugin extends BasePlugin {
    constructor() {
        super({
            name: 'my-plugin',
            version: '1.0.0',
            description: '我的插件',
            author: 'Your Name'
        });
    }

    async initialize() {
        await super.initialize();
        
        // 注册消息处理器
        this.registerMessageHandler('private', this.handleMessage.bind(this));
        
        // 注册命令
        this.registerCommand('hello', this.handleHello.bind(this));
        
        // 注册定时任务
        this.registerScheduledTask('daily-task', '0 0 * * *', this.dailyTask.bind(this));
    }

    async handleMessage(message) {
        // 处理消息
    }

    async handleHello(message, args) {
        await this.sendMessage(message.user_id, 'Hello World!');
    }

    async dailyTask() {
        // 每日任务
    }
}

module.exports = MyPlugin;
```

### 插件配置

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "我的插件",
  "author": "Your Name",
  "main": "index.js",
  "notebot": {
    "apiVersion": "1.0.0",
    "permissions": [
      "message.send",
      "data.read",
      "data.write"
    ],
    "commands": [
      {
        "name": "hello",
        "description": "打招呼",
        "usage": "/hello"
      }
    ]
  }
}
```

## 📊 API 文档

### 认证

所有 API 请求都需要在 Header 中包含 JWT Token：

```
Authorization: Bearer <your_jwt_token>
```

### 系统状态

```http
GET /api/system/status
```

### 插件管理

```http
# 获取插件列表
GET /api/plugins

# 启用插件
POST /api/plugins/:name/enable

# 禁用插件
POST /api/plugins/:name/disable

# 重载插件
POST /api/plugins/:name/reload
```

### 任务管理

```http
# 获取任务列表
GET /api/tasks

# 执行任务
POST /api/tasks/:name/execute

# 启用/禁用任务
POST /api/tasks/:name/toggle
```

### 日志查询

```http
# 获取日志
GET /api/logs?level=info&limit=100&offset=0
```

## 🛠️ 开发指南

### 开发环境设置

```bash
# 安装开发依赖
npm install --dev

# 启动开发模式
npm run dev

# 运行测试
npm test

# 代码格式化
npm run format

# 代码检查
npm run lint
```

### 调试技巧

1. **启用调试日志**：设置环境变量 `DEBUG=notebot:*`
2. **使用开发者工具**：在浏览器中打开开发者工具查看网络请求
3. **查看日志文件**：实时监控 `logs/` 目录下的日志文件
4. **使用 VS Code 调试**：配置 `.vscode/launch.json` 进行断点调试

### 贡献代码

1. Fork 项目
2. 创建功能分支：`git checkout -b feature/new-feature`
3. 提交更改：`git commit -am 'Add new feature'`
4. 推送分支：`git push origin feature/new-feature`
5. 创建 Pull Request

## 🚀 部署指南

### Docker 部署

```dockerfile
# Dockerfile
FROM node:16-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
EXPOSE 3000

CMD ["npm", "start"]
```

```bash
# 构建镜像
docker build -t notebot .

# 运行容器
docker run -d -p 3000:3000 --name notebot notebot
```

### PM2 部署

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'notebot',
    script: 'src/app.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    }
  }]
};
```

```bash
# 启动应用
pm2 start ecosystem.config.js

# 查看状态
pm2 status

# 查看日志
pm2 logs notebot
```

### Nginx 反向代理

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 🔍 故障排除

### 常见问题

#### 1. 连接 OneBot 失败

**症状**：日志显示 WebSocket 连接失败

**解决方案**：
- 检查 OneBot 服务是否正常运行
- 验证配置文件中的地址和端口
- 确认访问令牌和密钥正确

#### 2. Redis 连接失败

**症状**：应用启动时报 Redis 连接错误

**解决方案**：
- 确认 Redis 服务正在运行
- 检查 Redis 配置信息
- 验证网络连接和防火墙设置

#### 3. 插件加载失败

**症状**：插件在管理界面显示加载失败

**解决方案**：
- 检查插件文件语法错误
- 验证 `plugin.json` 格式
- 查看详细错误日志

#### 4. Web 界面无法访问

**症状**：浏览器无法打开管理界面

**解决方案**：
- 检查端口是否被占用
- 验证防火墙设置
- 确认服务正常启动

### 日志分析

查看不同级别的日志：

```bash
# 查看错误日志
grep "ERROR" logs/notebot.log

# 查看警告日志
grep "WARN" logs/notebot.log

# 实时监控日志
tail -f logs/notebot.log
```

## 📈 性能优化

### 系统优化

1. **内存管理**：定期清理无用数据，避免内存泄漏
2. **数据库优化**：合理设置 Redis 过期时间
3. **日志管理**：定期清理旧日志文件
4. **插件优化**：避免插件中的阻塞操作

### 监控指标

- CPU 使用率
- 内存使用量
- 网络连接数
- 消息处理速度
- 错误率统计

## 🤝 社区支持

- **GitHub Issues**：[提交问题](https://github.com/your-username/notebot/issues)
- **讨论区**：[GitHub Discussions](https://github.com/your-username/notebot/discussions)
- **QQ 群**：123456789
- **文档网站**：[https://notebot.example.com](https://notebot.example.com)

## 📄 许可证

本项目采用 [MIT 许可证](LICENSE)。

## 🙏 致谢

感谢以下开源项目的支持：

- [OneBot](https://github.com/howmanybots/onebot) - 聊天机器人应用接口标准
- [Node.js](https://nodejs.org/) - JavaScript 运行时
- [Redis](https://redis.io/) - 内存数据库
- [Express.js](https://expressjs.com/) - Web 应用框架
- [Socket.IO](https://socket.io/) - 实时通信库

## 📊 项目统计

![GitHub stars](https://img.shields.io/github/stars/your-username/notebot?style=social)
![GitHub forks](https://img.shields.io/github/forks/your-username/notebot?style=social)
![GitHub issues](https://img.shields.io/github/issues/your-username/notebot)
![GitHub pull requests](https://img.shields.io/github/issues-pr/your-username/notebot)

---

**NoteBot** - 让 QQ 机器人开发变得简单而强大！ 🚀