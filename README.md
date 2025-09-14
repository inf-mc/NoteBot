# NoteBot - 现代化 QQ 机器人框架

![NoteBot Logo](https://img.shields.io/badge/NoteBot-v1.0.0-blue.svg)
![Node.js](https://img.shields.io/badge/Node.js-16%2B-green.svg)
![License](https://img.shields.io/badge/License-MIT-yellow.svg)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey.svg)

NoteBot 是一个基于 Node.js 的现代化 QQ 机器人框架，支持 OneBot 11 协议，具有完整的插件系统、Web 管理界面、定时任务调度和系统监控功能。

## ✨ 主要特性

### 🤖 OneBot 11 协议支持
- 完整的 OneBot 11 标准实现
- 支持多种连接方式：正向 WebSocket、反向 WebSocket、HTTP POST、HTTP API
- 消息、事件、API 调用的完整支持
- 自动重连和错误恢复机制
- 连接状态实时监控

### 🔌 强大的插件系统
- 热插拔插件加载/卸载
- 插件生命周期管理
- 插件间通信机制
- 权限和依赖管理
- 沙箱化执行环境
- 丰富的插件 API

### 🌐 Web 管理界面
- 现代化的响应式 Web UI
- 实时系统状态监控
- 插件管理和配置
- OneBot 连接管理
- 日志查看和分析
- 用户权限管理

### ⏰ 定时任务调度
- 基于 Cron 表达式的任务调度
- 任务执行状态监控
- 失败重试机制
- 任务历史记录
- 并发控制

### 📊 系统监控
- 实时性能监控
- 资源使用统计
- 错误日志分析
- 健康状态检查
- 指标数据持久化

### 💾 数据存储
- Redis 数据库集成
- 数据持久化
- 缓存管理
- 连接池优化
- 故障转移支持

## 🚀 快速开始

### 环境要求

- **Node.js**: 16.0.0 或更高版本
- **Redis**: 6.0 或更高版本
- **内存**: 至少 512MB RAM
- **存储**: 至少 1GB 可用空间

### 安装步骤

#### 1. 克隆项目

```bash
git clone https://github.com/inf-mc/NoteBot.git
cd NoteBot
```

#### 2. 安装依赖

```bash
npm install
```

#### 3. 配置环境

编辑 `config/config.json`：

```json
{
  "server": {
    "port": 3000,
    "host": "0.0.0.0",
    "env": "development"
  },
  "redis": {
    "host": "localhost",
    "port": 6379,
    "password": "",
    "db": 0
  },
  "onebot": {
    "mode": "forward_ws",
    "connections": {
      "forward_ws": {
        "enabled": true,
        "url": "ws://your-onebot-server:port",
        "accessToken": "your_access_token"
      }
    }
  }
}
```

#### 4. 启动服务

```bash
# 开发模式
npm run dev

# 生产模式
npm start
```





#### 5. 访问管理界面

打开浏览器访问：`http://localhost:3000`

## 📁 项目结构

```
NoteBot/
├── config/                 # 配置文件
│   └── config.json         # 主配置文件
├── data/                   # 数据目录
├── docs/                   # 文档
│   ├── GETTING_STARTED.md  # 快速开始指南
│   └── PLUGIN_DEVELOPMENT.md # 插件开发指南
├── plugins/                # 插件目录
│   └── example/            # 示例插件
├── src/                    # 源代码
│   ├── app.js              # 应用入口
│   ├── index.js            # 主入口文件
│   ├── core/               # 核心模块
│   │   ├── onebot/         # OneBot协议实现
│   │   ├── redis/          # Redis数据库模块
│   │   └── websocket/      # WebSocket模块
│   ├── monitor/            # 监控模块
│   │   ├── index.js
│   │   ├── profiler.js     # 性能分析

│   ├── plugins/            # 插件系统
│   │   ├── base/           # 基础插件类
│   │   ├── communication/  # 插件通信
│   │   ├── loader/         # 插件加载器
│   │   └── manager/        # 插件管理器
│   ├── scheduler/          # 任务调度
│   │   ├── index.js
│   │   └── taskManager.js
│   ├── utils/              # 工具模块
│   │   ├── config.js       # 配置管理
│   │   └── logger.js       # 日志系统
│   └── web/                # Web界面
│       ├── auth/           # 认证模块
│       ├── public/         # 静态资源
│       ├── routes/         # 路由
│       └── server.js       # Web服务器
├── uploads/                # 上传文件目录
├── package.json            # 项目配置
└── README.md              # 项目说明
```

## 🔧 配置说明

### 服务器配置

```json
{
  "server": {
    "port": 3000,
    "host": "0.0.0.0",
    "env": "development"
  }
}
```

### OneBot 连接配置

```json
{
  "onebot": {
    "mode": "forward_ws",
    "connections": {
      "reverse_ws": {
        "enabled": false,
        "port": 8080,
        "path": "/onebot/v11/ws",
        "accessToken": "",
        "heartbeatInterval": 30000
      },
      "forward_ws": {
        "enabled": true,
        "url": "ws://your-server:port",
        "accessToken": "your_token",
        "heartbeatInterval": 30000,
        "reconnectInterval": 3000
      },
      "http_post": {
        "enabled": false,
        "url": "http://127.0.0.1:5700",
        "accessToken": "",
        "timeout": 5000
      },
      "http_api": {
        "enabled": false,
        "host": "127.0.0.1",
        "port": 5700,
        "accessToken": ""
      }
    }
  }
}
```

### Redis 配置

```json
{
  "redis": {
    "host": "localhost",
    "port": 6379,
    "password": "",
    "db": 0,
    "keyPrefix": "notebot:",
    "retryDelayOnFailover": 100,
    "maxRetriesPerRequest": 3
  }
}
```

### 插件系统配置

```json
{
  "plugins": {
    "dir": "plugins",
    "autoLoad": true,
    "hotReload": true,
    "maxLoadTime": 30000,
    "sandboxed": false
  }
}
```

### 任务调度配置

```json
{
  "scheduler": {
    "enabled": true,
    "timezone": "Asia/Shanghai",
    "maxConcurrent": 10,
    "defaultTimeout": 300000
  }
}
```

### 日志配置

```json
{
  "logging": {
    "level": "info",
    "dir": "logs",
    "maxSize": "10m",
    "maxFiles": 5,
    "datePattern": "YYYY-MM-DD"
  }
}
```

### 安全配置

```json
{
  "security": {
    "jwtSecret": "your-jwt-secret",
    "jwtExpiration": "24h",
    "bcryptRounds": 10,
    "rateLimitWindow": 900000,
    "rateLimitMax": 1000
  }
}
```

## 🔌 插件开发

### 创建插件

1. 在 `plugins/` 目录下创建插件文件夹
2. 创建 `/src/index.js` 主文件
3. 创建 `config.json` 插件配置文件
4. 创建 `/web/index.html` 插件管理后台自定义管理页（可以，插件配置项内控制是否启用，不使用则使用webui通用插件管理页。可自定义编写js）

### 插件示例

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

### OneBot 连接管理

```http
# 获取连接状态
GET /api/onebot/status

# 切换连接模式
POST /api/onebot/switch

# 重连
POST /api/onebot/reconnect
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

### 配置管理

```http
# 获取配置
GET /api/config

# 更新配置项
POST /api/config/item

# 重载配置
POST /api/config/reload
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
npm install

# 启动开发模式
npm run dev

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
    script: 'src/index.js',
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

## 🔍 故障排除

### 常见问题

#### 1. OneBot 连接失败

**症状**：日志显示 WebSocket 连接失败

**解决方案**：
- 检查 OneBot 服务是否正常运行
- 验证配置文件中的地址和端口
- 确认访问令牌正确
- 检查网络连接和防火墙设置

#### 2. Redis 连接失败

**症状**：应用启动时报 Redis 连接错误

**解决方案**：
- 确认 Redis 服务正在运行
- 检查 Redis 配置信息
- 验证网络连接和防火墙设置
- 检查 Redis 密码和数据库配置

#### 3. 插件加载失败

**症状**：插件在管理界面显示加载失败

**解决方案**：
- 检查插件文件语法错误
- 验证 `plugin.json` 格式
- 查看详细错误日志
- 检查插件依赖是否满足

#### 4. Web 界面无法访问

**症状**：浏览器无法打开管理界面

**解决方案**：
- 检查端口是否被占用
- 验证防火墙设置
- 确认服务正常启动
- 检查服务器配置

### 日志分析

查看不同级别的日志：

```bash
# 查看错误日志
grep "ERROR" logs/notebot-*.log

# 查看警告日志
grep "WARN" logs/notebot-*.log

# 实时监控日志
tail -f logs/notebot-*.log
```

## 📈 性能优化

### 系统优化

1. **内存管理**：定期清理无用数据，避免内存泄漏
2. **数据库优化**：合理设置 Redis 过期时间和连接池
3. **日志管理**：定期清理旧日志文件
4. **插件优化**：避免插件中的阻塞操作
5. **连接优化**：合理配置 OneBot 连接参数

### 监控指标

- CPU 使用率
- 内存使用量
- 网络连接数
- 消息处理速度
- 错误率统计
- Redis 连接状态
- OneBot 连接状态

## 🤝 社区支持

- **GitHub Issues**：[提交问题](https://github.com/inf-mc/NoteBot/issues)
- **讨论区**：[GitHub Discussions](https://github.com/inf-mc/NoteBot/discussions)
- **文档网站**：[https://notebot.infinf.info](https://notebot.infinf.info)

## 📄 许可证

本项目采用 [MIT 许可证](LICENSE)。

## 🙏 致谢

感谢以下开源项目的支持：

- [OneBot](https://github.com/howmanybots/onebot) - 聊天机器人应用接口标准
- [Node.js](https://nodejs.org/) - JavaScript 运行时
- [Redis](https://redis.io/) - 内存数据库
- [Express.js](https://expressjs.com/) - Web 应用框架
- [Socket.IO](https://socket.io/) - 实时通信库
- [Winston](https://github.com/winstonjs/winston) - 日志库
- [node-cron](https://github.com/node-cron/node-cron) - 任务调度

## 📊 项目统计

![GitHub stars](https://img.shields.io/github/stars/inf-mc/notebot?style=social)
![GitHub forks](https://img.shields.io/github/forks/inf-mc/notebot?style=social)
![GitHub issues](https://img.shields.io/github/issues/inf-mc/notebot)
![GitHub pull requests](https://img.shields.io/github/issues-pr/inf-mc/notebot)

---

**NoteBot** - 让 QQ 机器人开发变得简单而强大！ 🚀