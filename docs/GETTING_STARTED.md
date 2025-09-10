# NoteBot 快速上手指南

本指南将帮助您快速搭建和运行 NoteBot 机器人框架。

## 📋 前置要求

### 系统要求
- **操作系统**: Windows 10/11, Ubuntu 18.04+, macOS 10.15+
- **Node.js**: 14.0.0 或更高版本
- **内存**: 至少 512MB 可用内存
- **存储**: 至少 1GB 可用磁盘空间

### 必需服务
- **Redis**: 6.0 或更高版本
- **OneBot 实现**: 如 go-cqhttp, Mirai 等

## 🚀 安装步骤

### 第一步：安装 Node.js

#### Windows
1. 访问 [Node.js 官网](https://nodejs.org/)
2. 下载 LTS 版本
3. 运行安装程序，按默认设置安装

#### Linux (Ubuntu/Debian)
```bash
# 使用 NodeSource 仓库
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs

# 验证安装
node --version
npm --version
```

#### macOS
```bash
# 使用 Homebrew
brew install node

# 验证安装
node --version
npm --version
```

### 第二步：安装 Redis

#### Windows
1. 下载 [Redis for Windows](https://github.com/microsoftarchive/redis/releases)
2. 解压并运行 `redis-server.exe`
3. 或使用 Docker：
```bash
docker run -d -p 6379:6379 --name redis redis:latest
```

#### Linux (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install redis-server

# 启动 Redis
sudo systemctl start redis-server
sudo systemctl enable redis-server

# 验证安装
redis-cli ping
```

#### macOS
```bash
# 使用 Homebrew
brew install redis

# 启动 Redis
brew services start redis

# 验证安装
redis-cli ping
```

### 第三步：设置 OneBot 实现

#### 使用 go-cqhttp (推荐)

1. **下载 go-cqhttp**
   - 访问 [go-cqhttp Releases](https://github.com/Mrs4s/go-cqhttp/releases)
   - 下载适合您系统的版本

2. **配置 go-cqhttp**
   ```yaml
   # config.yml
   account:
     uin: 你的机器人QQ号
     password: '你的QQ密码'
     encrypt: false
     status: 0
     relogin:
       delay: 3
       count: 3
       interval: 3
   
   heartbeat:
     interval: 5
   
   message:
     post-format: string
     ignore-invalid-cqcode: false
     force-fragment: false
     fix-url: false
     proxy-rewrite: ''
     report-self-message: false
     remove-reply-at: false
     extra-reply-data: false
     skip-mime-scan: false
   
   output:
     log-level: warn
     log-aging: 15
     log-force-new: true
     log-colorful: true
     debug: false
   
   default-middlewares: &default
     access-token: 'your_access_token_here'
     filter: ''
     rate-limit:
       enabled: false
       frequency: 1
       bucket: 1
   
   database:
     leveldb:
       enable: true
   
   servers:
     - ws-reverse:
         universal: ws://127.0.0.1:8080/onebot/v11/ws
         reconnect-interval: 3000
         middlewares:
           <<: *default
   ```

3. **启动 go-cqhttp**
   ```bash
   ./go-cqhttp
   ```

### 第四步：安装 NoteBot

1. **克隆项目**
   ```bash
   git clone https://github.com/your-username/notebot.git
   cd notebot
   ```

2. **安装依赖**
   ```bash
   npm install
   ```

3. **配置 NoteBot**
   ```bash
   # 复制配置模板
   cp config/config.example.json config/config.json
   ```

   编辑 `config/config.json`：
   ```json
   {
     "bot": {
       "qq": "你的机器人QQ号",
       "name": "NoteBot",
       "admin": ["你的QQ号"]
     },
     "onebot": {
       "host": "127.0.0.1",
       "port": 8080,
       "accessToken": "your_access_token_here",
       "secret": ""
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
       "secret": "your_jwt_secret_here"
     }
   }
   ```

4. **启动 NoteBot**
   ```bash
   npm start
   ```

## 🎯 验证安装

### 检查服务状态

1. **检查 Redis 连接**
   ```bash
   redis-cli ping
   # 应该返回: PONG
   ```

2. **检查 NoteBot 日志**
   ```bash
   tail -f logs/notebot.log
   ```
   
   正常启动应该看到类似输出：
   ```
   [INFO] Redis connected successfully
   [INFO] OneBot WebSocket connected
   [INFO] Plugin system initialized
   [INFO] Web server started on port 3000
   [INFO] NoteBot started successfully
   ```

3. **访问 Web 管理界面**
   - 打开浏览器访问：`http://localhost:3000`
   - 使用默认账号登录：
     - 用户名：`admin`
     - 密码：`admin123`

### 测试机器人功能

1. **发送测试消息**
   - 向机器人QQ发送私聊消息：`/ping`
   - 机器人应该回复：`pong`

2. **检查插件状态**
   - 在 Web 界面中查看插件管理页面
   - 确认示例插件已加载并启用

## 🔧 常见问题解决

### 问题 1：Redis 连接失败

**错误信息**：`Redis connection failed`

**解决方案**：
1. 确认 Redis 服务正在运行：
   ```bash
   # Linux/macOS
   sudo systemctl status redis
   
   # Windows
   # 检查任务管理器中是否有 redis-server.exe
   ```

2. 检查 Redis 配置：
   ```bash
   redis-cli ping
   ```

3. 检查防火墙设置

### 问题 2：OneBot 连接失败

**错误信息**：`OneBot WebSocket connection failed`

**解决方案**：
1. 确认 go-cqhttp 正在运行
2. 检查配置文件中的端口和访问令牌
3. 查看 go-cqhttp 日志是否有错误

### 问题 3：Web 界面无法访问

**错误信息**：浏览器显示连接超时

**解决方案**：
1. 检查端口是否被占用：
   ```bash
   # Windows
   netstat -ano | findstr :3000
   
   # Linux/macOS
   lsof -i :3000
   ```

2. 检查防火墙设置
3. 尝试使用 `127.0.0.1:3000` 而不是 `localhost:3000`

### 问题 4：插件加载失败

**错误信息**：`Plugin load failed`

**解决方案**：
1. 检查插件文件语法：
   ```bash
   node -c plugins/example/index.js
   ```

2. 验证 `plugin.json` 格式：
   ```bash
   cat plugins/example/plugin.json | jq .
   ```

3. 查看详细错误日志

## 📚 下一步

恭喜！您已经成功安装并运行了 NoteBot。接下来您可以：

1. **[开发自定义插件](PLUGIN_DEVELOPMENT.md)** - 学习如何创建自己的插件
2. **[配置高级功能](ADVANCED_CONFIG.md)** - 了解更多配置选项
3. **[部署到生产环境](DEPLOYMENT.md)** - 学习如何部署到服务器
4. **[API 参考文档](API_REFERENCE.md)** - 查看完整的 API 文档

## 🆘 获取帮助

如果您遇到问题，可以通过以下方式获取帮助：

- **GitHub Issues**: [提交问题](https://github.com/your-username/notebot/issues)
- **讨论区**: [GitHub Discussions](https://github.com/your-username/notebot/discussions)
- **QQ 群**: 123456789
- **文档网站**: [https://notebot.example.com](https://notebot.example.com)

---

**提示**: 建议在开发环境中先熟悉 NoteBot 的功能，然后再部署到生产环境。