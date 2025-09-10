const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const EventEmitter = require('events');
const logger = require('../utils/logger').module('WebServer');
const config = require('../utils/config');

/**
 * Web 管理后台服务器
 */
class WebServer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.app = express();
    this.server = null;
    
    this.config = {
      port: config.get('web.port', 3000),
      host: config.get('web.host', '0.0.0.0'),
      staticPath: config.get('web.staticPath', path.join(__dirname, 'public')),
      apiPrefix: config.get('web.apiPrefix', '/api'),
      jwtSecret: config.get('web.jwtSecret', 'your-secret-key'),
      jwtExpiry: config.get('web.jwtExpiry', '24h'),
      adminUser: config.get('web.adminUser', 'admin'),
      adminPassword: config.get('web.adminPassword', 'admin123'),
      corsOrigins: config.get('web.corsOrigins', ['http://localhost:3000']),
      rateLimit: {
        windowMs: config.get('web.rateLimit.windowMs', 15 * 60 * 1000), // 15分钟
        max: config.get('web.rateLimit.max', 100) // 最多100个请求
      }
    };
    
    // 注入的服务
    this.redisManager = options.redisManager;
    this.onebotCore = options.onebotCore;
    this.pluginManager = options.pluginManager;
    this.taskScheduler = options.taskScheduler;
    this.taskManager = options.taskManager;
    
    this.init();
  }

  /**
   * 初始化服务器
   */
  init() {
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  /**
   * 设置中间件
   */
  setupMiddleware() {
    // 安全中间件
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", "ws:", "wss:"]
        }
      }
    }));
    
    // 压缩
    this.app.use(compression());
    
    // CORS
    this.app.use(cors({
      origin: this.config.corsOrigins,
      credentials: true
    }));
    
    // 请求限制
    const limiter = rateLimit({
      windowMs: this.config.rateLimit.windowMs,
      max: this.config.rateLimit.max,
      message: {
        error: 'Too many requests',
        message: '请求过于频繁，请稍后再试'
      }
    });
    this.app.use(limiter);
    
    // 解析请求体
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    
    // 静态文件
    this.app.use(express.static(this.config.staticPath));
    
    // 请求日志
    this.app.use((req, res, next) => {
      logger.debug(`${req.method} ${req.url}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      next();
    });
  }

  /**
   * 设置路由
   */
  setupRoutes() {
    // 健康检查
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: Date.now(),
        uptime: process.uptime(),
        version: config.get('version', '1.0.0')
      });
    });
    
    // 认证路由
    this.setupAuthRoutes();
    
    // API 路由
    this.setupApiRoutes();
    
    // 前端路由 (SPA)
    this.app.get('*', (req, res) => {
      res.sendFile(path.join(this.config.staticPath, 'index.html'));
    });
  }

  /**
   * 设置认证路由
   */
  setupAuthRoutes() {
    // 登录
    this.app.post(`${this.config.apiPrefix}/auth/login`, async (req, res) => {
      try {
        const { username, password } = req.body;
        
        if (!username || !password) {
          return res.status(400).json({
            error: 'Missing credentials',
            message: '用户名和密码不能为空'
          });
        }
        
        // 验证用户名密码
        if (username !== this.config.adminUser) {
          return res.status(401).json({
            error: 'Invalid credentials',
            message: '用户名或密码错误'
          });
        }
        
        // 检查密码
        const isValidPassword = await this.verifyPassword(password);
        if (!isValidPassword) {
          return res.status(401).json({
            error: 'Invalid credentials',
            message: '用户名或密码错误'
          });
        }
        
        // 生成 JWT
        const token = jwt.sign(
          { username, role: 'admin' },
          this.config.jwtSecret,
          { expiresIn: this.config.jwtExpiry }
        );
        
        // 记录登录
        await this.redisManager.set(
          `auth:session:${username}`,
          { token, loginTime: Date.now() },
          24 * 60 * 60 // 24小时
        );
        
        logger.info(`用户登录成功: ${username}`, { ip: req.ip });
        
        res.json({
          success: true,
          token,
          user: {
            username,
            role: 'admin'
          }
        });
        
      } catch (error) {
        logger.error('登录失败:', error);
        res.status(500).json({
          error: 'Login failed',
          message: '登录失败，请稍后重试'
        });
      }
    });
    
    // 登出
    this.app.post(`${this.config.apiPrefix}/auth/logout`, this.authenticateToken, async (req, res) => {
      try {
        const { username } = req.user;
        
        // 删除会话
        await this.redisManager.del(`auth:session:${username}`);
        
        logger.info(`用户登出: ${username}`, { ip: req.ip });
        
        res.json({
          success: true,
          message: '登出成功'
        });
        
      } catch (error) {
        logger.error('登出失败:', error);
        res.status(500).json({
          error: 'Logout failed',
          message: '登出失败'
        });
      }
    });
    
    // 验证令牌
    this.app.get(`${this.config.apiPrefix}/auth/verify`, this.authenticateToken, (req, res) => {
      res.json({
        success: true,
        user: req.user
      });
    });
  }

  /**
   * 设置 API 路由
   */
  setupApiRoutes() {
    const apiRouter = express.Router();
    
    // 应用认证中间件到所有 API 路由
    apiRouter.use(this.authenticateToken);
    
    // 系统信息
    apiRouter.get('/system/info', async (req, res) => {
      try {
        const info = {
          version: config.get('version', '1.0.0'),
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          cpu: process.cpuUsage(),
          env: process.env.NODE_ENV || 'development'
        };
        
        res.json({ success: true, data: info });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // 系统状态
    apiRouter.get('/system/status', async (req, res) => {
      try {
        const status = {
          redis: await this.getRedisStatus(),
          onebot: await this.getOnebotStatus(),
          plugins: await this.getPluginsStatus(),
          scheduler: await this.getSchedulerStatus()
        };
        
        res.json({ success: true, data: status });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // 插件管理路由
    this.setupPluginRoutes(apiRouter);
    
    // 任务管理路由
    this.setupTaskRoutes(apiRouter);
    
    // Onebot 管理路由
    this.setupOnebotRoutes(apiRouter);
    
    // 配置管理路由
    this.setupConfigRoutes(apiRouter);
    
    // 日志管理路由
    this.setupLogRoutes(apiRouter);
    
    this.app.use(this.config.apiPrefix, apiRouter);
  }

  /**
   * 设置插件管理路由
   */
  setupPluginRoutes(router) {
    // 获取插件列表
    router.get('/plugins', async (req, res) => {
      try {
        const plugins = this.pluginManager.getPluginList();
        res.json({ success: true, data: plugins });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // 获取插件详情
    router.get('/plugins/:name', async (req, res) => {
      try {
        const plugin = this.pluginManager.getPluginInfo(req.params.name);
        if (!plugin) {
          return res.status(404).json({ error: '插件不存在' });
        }
        res.json({ success: true, data: plugin });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // 启用插件
    router.post('/plugins/:name/enable', async (req, res) => {
      try {
        await this.pluginManager.enablePlugin(req.params.name);
        res.json({ success: true, message: '插件启用成功' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // 禁用插件
    router.post('/plugins/:name/disable', async (req, res) => {
      try {
        await this.pluginManager.disablePlugin(req.params.name);
        res.json({ success: true, message: '插件禁用成功' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // 重新加载插件
    router.post('/plugins/:name/reload', async (req, res) => {
      try {
        await this.pluginManager.reloadPlugin(req.params.name);
        res.json({ success: true, message: '插件重新加载成功' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // 获取插件配置
    router.get('/plugins/:name/config', async (req, res) => {
      try {
        const config = await this.pluginManager.getPluginConfig(req.params.name);
        res.json({ success: true, data: config });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // 更新插件配置
    router.put('/plugins/:name/config', async (req, res) => {
      try {
        await this.pluginManager.updatePluginConfig(req.params.name, req.body);
        res.json({ success: true, message: '配置更新成功' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
  }

  /**
   * 设置任务管理路由
   */
  setupTaskRoutes(router) {
    // 获取任务列表
    router.get('/tasks', async (req, res) => {
      try {
        const tasks = this.taskScheduler.getTaskList();
        res.json({ success: true, data: tasks });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // 获取任务详情
    router.get('/tasks/:id', async (req, res) => {
      try {
        const task = this.taskScheduler.getTaskDetails(req.params.id);
        if (!task) {
          return res.status(404).json({ error: '任务不存在' });
        }
        res.json({ success: true, data: task });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // 启用任务
    router.post('/tasks/:id/enable', async (req, res) => {
      try {
        await this.taskScheduler.enableTask(req.params.id);
        res.json({ success: true, message: '任务启用成功' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // 禁用任务
    router.post('/tasks/:id/disable', async (req, res) => {
      try {
        await this.taskScheduler.disableTask(req.params.id);
        res.json({ success: true, message: '任务禁用成功' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // 手动执行任务
    router.post('/tasks/:id/run', async (req, res) => {
      try {
        await this.taskScheduler.runTask(req.params.id);
        res.json({ success: true, message: '任务执行成功' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // 获取任务统计
    router.get('/tasks/stats', async (req, res) => {
      try {
        const stats = this.taskManager.getTaskStats();
        res.json({ success: true, data: stats });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // 搜索任务
    router.get('/tasks/search', async (req, res) => {
      try {
        const { q } = req.query;
        if (!q) {
          return res.status(400).json({ error: '搜索关键词不能为空' });
        }
        
        const tasks = this.taskManager.searchTasks(q);
        res.json({ success: true, data: tasks });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
  }

  /**
   * 设置 Onebot 管理路由
   */
  setupOnebotRoutes(router) {
    // 获取连接状态
    router.get('/onebot/status', async (req, res) => {
      try {
        const status = await this.getOnebotStatus();
        res.json({ success: true, data: status });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // 获取连接列表
    router.get('/onebot/connections', async (req, res) => {
      try {
        const connections = this.onebotCore.getConnections();
        res.json({ success: true, data: connections });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // 发送消息
    router.post('/onebot/send', async (req, res) => {
      try {
        const result = await this.onebotCore.sendMessage(req.body);
        res.json({ success: true, data: result });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
  }

  /**
   * 设置配置管理路由
   */
  setupConfigRoutes(router) {
    // 获取配置
    router.get('/config', async (req, res) => {
      try {
        const configData = config.getAll();
        res.json({ success: true, data: configData });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // 更新配置
    router.put('/config', async (req, res) => {
      try {
        for (const [key, value] of Object.entries(req.body)) {
          config.set(key, value);
        }
        await config.save();
        res.json({ success: true, message: '配置更新成功' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
  }

  /**
   * 设置日志管理路由
   */
  setupLogRoutes(router) {
    // 获取日志
    router.get('/logs', async (req, res) => {
      try {
        const { level = 'info', limit = 100, offset = 0 } = req.query;
        
        // 这里需要实现日志查询逻辑
        const logs = await this.getLogs(level, parseInt(limit), parseInt(offset));
        
        res.json({ success: true, data: logs });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
  }

  /**
   * JWT 认证中间件
   */
  authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({
        error: 'Access token required',
        message: '需要访问令牌'
      });
    }
    
    jwt.verify(token, this.config.jwtSecret, (err, user) => {
      if (err) {
        return res.status(403).json({
          error: 'Invalid token',
          message: '无效的访问令牌'
        });
      }
      
      req.user = user;
      next();
    });
  };

  /**
   * 验证密码
   */
  async verifyPassword(password) {
    try {
      // 如果配置的密码是明文，直接比较
      if (this.config.adminPassword === password) {
        return true;
      }
      
      // 如果是 bcrypt 哈希，使用 bcrypt 验证
      if (this.config.adminPassword.startsWith('$2b$')) {
        return await bcrypt.compare(password, this.config.adminPassword);
      }
      
      return false;
    } catch (error) {
      logger.error('密码验证失败:', error);
      return false;
    }
  }

  /**
   * 获取 Redis 状态
   */
  async getRedisStatus() {
    try {
      await this.redisManager.ping();
      return {
        status: 'connected',
        info: await this.redisManager.info()
      };
    } catch (error) {
      return {
        status: 'disconnected',
        error: error.message
      };
    }
  }

  /**
   * 获取 Onebot 状态
   */
  async getOnebotStatus() {
    try {
      return {
        status: this.onebotCore.isConnected() ? 'connected' : 'disconnected',
        connections: this.onebotCore.getConnectionCount(),
        uptime: this.onebotCore.getUptime()
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message
      };
    }
  }

  /**
   * 获取插件状态
   */
  async getPluginsStatus() {
    try {
      const plugins = this.pluginManager.getPluginList();
      return {
        total: plugins.length,
        enabled: plugins.filter(p => p.enabled).length,
        disabled: plugins.filter(p => !p.enabled).length,
        loaded: plugins.filter(p => p.status === 'loaded').length
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message
      };
    }
  }

  /**
   * 获取调度器状态
   */
  async getSchedulerStatus() {
    try {
      const stats = this.taskScheduler.getStats();
      return {
        ...stats,
        status: 'running'
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message
      };
    }
  }

  /**
   * 获取日志
   */
  async getLogs(level, limit, offset) {
    // 这里需要根据实际的日志存储实现
    // 可以从文件、数据库或 Redis 中读取日志
    return {
      logs: [],
      total: 0,
      level,
      limit,
      offset
    };
  }

  /**
   * 设置错误处理
   */
  setupErrorHandling() {
    // 404 处理
    this.app.use((req, res) => {
      res.status(404).json({
        error: 'Not Found',
        message: '请求的资源不存在'
      });
    });
    
    // 全局错误处理
    this.app.use((err, req, res, next) => {
      logger.error('服务器错误:', err);
      
      res.status(err.status || 500).json({
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'development' ? err.message : '服务器内部错误'
      });
    });
  }

  /**
   * 启动服务器
   */
  async start() {
    return new Promise((resolve, reject) => {
      try {
        this.server = http.createServer(this.app);
        
        this.server.listen(this.config.port, this.config.host, () => {
          logger.info(`Web 服务器启动成功: http://${this.config.host}:${this.config.port}`);
          resolve();
        });
        
        this.server.on('error', (error) => {
          logger.error('Web 服务器启动失败:', error);
          reject(error);
        });
        
      } catch (error) {
        logger.error('Web 服务器初始化失败:', error);
        reject(error);
      }
    });
  }

  /**
   * 停止服务器
   */
  async stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.info('Web 服务器已停止');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * 获取服务器信息
   */
  getServerInfo() {
    return {
      host: this.config.host,
      port: this.config.port,
      running: !!this.server && this.server.listening
    };
  }
}

module.exports = WebServer;