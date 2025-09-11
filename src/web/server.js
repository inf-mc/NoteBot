const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
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
    
    // 解析Cookie
    this.app.use(cookieParser());
    
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
   * 统一认证中间件 - 处理所有页面访问的认证逻辑
   */
  requirePageAuth = (req, res, next) => {
    // 获取token的优先级：Cookie > Header > localStorage模拟header
    let token = req.cookies?.authToken;
    
    if (!token && req.headers['x-auth-token']) {
      token = req.headers['x-auth-token'];
    }
    
    if (!token && req.headers['authorization']) {
      const authHeader = req.headers['authorization'];
      token = authHeader && authHeader.split(' ')[1];
    }
    
    // 如果没有token，清除可能存在的无效cookie并重定向
    if (!token) {
      res.clearCookie('authToken');
      // 重定向到登录页面，不保留任何URL参数
      return res.redirect('/login.html');
    }
    
    // 验证token
    jwt.verify(token, this.config.jwtSecret, async (err, user) => {
      if (err) {
        // Token无效，清除cookie并重定向
        res.clearCookie('authToken');
        
        // 如果是Redis会话，也清除Redis中的会话
        if (user && user.username) {
          try {
            await this.redisManager.del(`auth:session:${user.username}`);
          } catch (redisErr) {
            logger.warn('清除Redis会话失败:', redisErr);
          }
        }
        
        // 重定向到登录页面，不保留任何URL参数
        return res.redirect('/login.html');
      }
      
      // 验证Redis中的会话（如果启用）
      try {
        const sessionData = await this.redisManager.get(`auth:session:${user.username}`);
        if (!sessionData || sessionData.token !== token) {
          // 会话不存在或token不匹配
          res.clearCookie('authToken');
          return res.redirect('/login.html');
        }
      } catch (redisErr) {
        // Redis连接失败时，仅依赖JWT验证
        logger.warn('Redis会话验证失败，使用JWT验证:', redisErr);
      }
      
      req.user = user;
      next();
    });
  };

  /**
   * API认证中间件 - 用于API接口的认证
   */
  requireApiAuth = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Access token required',
        message: '需要访问令牌'
      });
    }
    
    jwt.verify(token, this.config.jwtSecret, async (err, user) => {
      if (err) {
        return res.status(403).json({
          success: false,
          error: 'Invalid token',
          message: '无效的访问令牌'
        });
      }
      
      // 验证Redis中的会话
      try {
        const sessionData = await this.redisManager.get(`auth:session:${user.username}`);
        if (!sessionData || sessionData.token !== token) {
          return res.status(403).json({
            success: false,
            error: 'Session expired',
            message: '会话已过期'
          });
        }
      } catch (redisErr) {
        logger.warn('Redis会话验证失败，使用JWT验证:', redisErr);
      }
      
      req.user = user;
      next();
    });
  };

  /**
   * 设置路由
   */
  setupRoutes() {
    // 健康检查（无需认证）
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: Date.now(),
        uptime: process.uptime(),
        version: config.get('version', '1.0.0')
      });
    });
    
    // 认证相关路由（无需认证）
    this.setupAuthRoutes();
    
    // 登录页面路由（无需认证，但需要检查是否已登录）
    this.app.get('/login.html', (req, res) => {
      // 如果已经登录，重定向到主页
      this.checkAlreadyLoggedIn(req, res, () => {
        // 设置防缓存头部
        res.set({
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        });
        res.sendFile(path.join(this.config.staticPath, 'login.html'));
      });
    });
    
    this.app.get('/login', (req, res) => {
      // 如果已经登录，重定向到主页
      this.checkAlreadyLoggedIn(req, res, () => {
        // 设置防缓存头部
        res.set({
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        });
        res.sendFile(path.join(this.config.staticPath, 'login.html'));
      });
    });
    
    // 登出路由
    this.app.get('/logout', async (req, res) => {
      try {
        // 获取token以清除会话
        let token = req.cookies?.authToken;
        if (!token && req.headers['x-auth-token']) {
          token = req.headers['x-auth-token'];
        }
        
        if (token) {
          // 解析token获取用户信息
          try {
            const decoded = jwt.verify(token, this.config.jwtSecret);
            // 清除Redis会话
            await this.redisManager.del(`auth:session:${decoded.username}`);
          } catch (err) {
            // Token无效也继续清除cookie
          }
        }
        
        // 清除cookie
        res.clearCookie('authToken');
        
        // 重定向到登录页
        res.redirect('/login.html');
      } catch (error) {
        logger.error('登出失败:', error);
        res.clearCookie('authToken');
        res.redirect('/login.html');
      }
    });
    
    // API 路由（需要API认证）
    this.setupApiRoutes();
    
    // 根路径 - 需要认证
    this.app.get('/', this.requirePageAuth, (req, res) => {
      res.sendFile(path.join(this.config.staticPath, 'index.html'));
    });
    
    // 主页面路由 - 需要认证
    this.app.get('/index.html', this.requirePageAuth, (req, res) => {
      res.sendFile(path.join(this.config.staticPath, 'index.html'));
    });
    
    // 静态资源路由 - 部分需要认证
    this.setupStaticRoutes();
    
    // SPA路由处理 - 需要认证
    this.app.get('*', (req, res, next) => {
      // 如果请求的是文件（有扩展名），返回404
      if (path.extname(req.path)) {
        return res.status(404).json({ 
          error: 'Not Found', 
          message: '请求的资源不存在' 
        });
      }
      
      // 对于SPA路由，需要认证
      this.requirePageAuth(req, res, () => {
        res.sendFile(path.join(this.config.staticPath, 'index.html'));
      });
    });
  }

  /**
   * 检查是否已登录（用于登录页面）
   */
  checkAlreadyLoggedIn = async (req, res, next) => {
    try {
      let token = req.cookies?.authToken;
      if (!token && req.headers['x-auth-token']) {
        token = req.headers['x-auth-token'];
      }
      
      if (!token) {
        return next();
      }
      
      // 验证token
      const decoded = jwt.verify(token, this.config.jwtSecret);
      const { username } = decoded;
      
      // 检查Redis会话
      const sessionData = await this.redisManager.get(`auth:session:${username}`);
      if (sessionData && sessionData.token === token) {
        // 已登录，重定向到主页
        return res.redirect('/');
      }
      
      // token无效，清除cookie并继续
      res.clearCookie('authToken');
      next();
      
    } catch (error) {
      // token验证失败，清除cookie并继续
      res.clearCookie('authToken');
      next();
    }
  };

  /**
   * 设置静态资源路由
   */
  setupStaticRoutes() {
    // 公共静态资源路径（无需认证）
    const publicPaths = ['/css', '/js', '/images', '/fonts', '/favicon.ico'];
    
    // 设置公共资源路由
    publicPaths.forEach(publicPath => {
      this.app.use(publicPath, express.static(path.join(this.config.staticPath, publicPath.substring(1))));
    });
    
    // 对HTML文件进行访问控制
    this.app.get('*.html', (req, res, next) => {
      const requestPath = req.path;
      
      // 检查是否为登录页面
      if (requestPath.endsWith('/login.html')) {
        return next(); // 登录页面无需认证
      }
      
      // 其他HTML文件需要认证
      this.requirePageAuth(req, res, next);
    });
    
    // 设置静态文件服务
    this.app.use(express.static(this.config.staticPath, {
      setHeaders: (res, filePath) => {
        // 设置缓存策略
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        } else if (filePath.match(/\.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$/)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000'); // 1年缓存
        } else {
          res.setHeader('Cache-Control', 'public, max-age=86400'); // 1天缓存
        }
      },
      index: false, // 禁用目录索引
      dotfiles: 'deny' // 拒绝访问隐藏文件
    }));
  }

  /**
   * 设置认证路由
   */
  setupAuthRoutes() {
    // 登录API
    this.app.post(`${this.config.apiPrefix}/auth/login`, async (req, res) => {
      try {
        const { username, password, rememberMe } = req.body;
        
        if (!username || !password) {
          return res.status(400).json({
            success: false,
            error: 'Missing credentials',
            message: '用户名和密码不能为空'
          });
        }
        
        // 验证用户名密码
        if (username !== this.config.adminUser) {
          logger.warn(`登录失败 - 用户名错误: ${username}`, { ip: req.ip });
          return res.status(401).json({
            success: false,
            error: 'Invalid credentials',
            message: '用户名或密码错误'
          });
        }
        
        // 检查密码
        const isValidPassword = await this.verifyPassword(password);
        if (!isValidPassword) {
          logger.warn(`登录失败 - 密码错误: ${username}`, { ip: req.ip });
          return res.status(401).json({
            success: false,
            error: 'Invalid credentials',
            message: '用户名或密码错误'
          });
        }
        
        // 生成 JWT
        const tokenExpiry = rememberMe ? '7d' : this.config.jwtExpiry; // 记住我7天，否则默认24小时
        const token = jwt.sign(
          { 
            username, 
            role: 'admin',
            loginTime: Date.now(),
            rememberMe: !!rememberMe
          },
          this.config.jwtSecret,
          { expiresIn: tokenExpiry }
        );
        
        // 记录会话到Redis
        const sessionData = {
          token,
          loginTime: Date.now(),
          ip: req.ip,
          userAgent: req.get('User-Agent'),
          rememberMe: !!rememberMe
        };
        
        const sessionExpiry = rememberMe ? 7 * 24 * 60 * 60 : 24 * 60 * 60; // 秒
        await this.redisManager.set(
          `auth:session:${username}`,
          sessionData,
          sessionExpiry
        );
        
        // 设置HTTP-only Cookie
        const cookieOptions = {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production', // 生产环境使用HTTPS
          sameSite: 'strict',
          maxAge: sessionExpiry * 1000 // 毫秒
        };
        
        res.cookie('authToken', token, cookieOptions);
        
        logger.info(`用户登录成功: ${username}`, { 
          ip: req.ip, 
          rememberMe: !!rememberMe,
          userAgent: req.get('User-Agent')
        });
        
        res.json({
          success: true,
          token,
          user: {
            username,
            role: 'admin',
            loginTime: Date.now()
          },
          message: '登录成功'
        });
        
      } catch (error) {
        logger.error('登录处理失败:', error);
        res.status(500).json({
          success: false,
          error: 'Login failed',
          message: '登录失败，请稍后重试'
        });
      }
    });
    
    // 登出API
    this.app.post(`${this.config.apiPrefix}/auth/logout`, this.requireApiAuth, async (req, res) => {
      try {
        const { username } = req.user;
        
        // 删除Redis会话
        await this.redisManager.del(`auth:session:${username}`);
        
        // 清除Cookie
        res.clearCookie('authToken');
        
        logger.info(`用户登出: ${username}`, { ip: req.ip });
        
        res.json({
          success: true,
          message: '登出成功'
        });
        
      } catch (error) {
        logger.error('登出处理失败:', error);
        res.status(500).json({
          success: false,
          error: 'Logout failed',
          message: '登出失败'
        });
      }
    });
    

    // 验证令牌API
    this.app.get(`${this.config.apiPrefix}/auth/verify`, this.requireApiAuth, async (req, res) => {
      try {
        const { username } = req.user;
        
        // 获取会话信息
        const sessionData = await this.redisManager.get(`auth:session:${username}`);
        
        res.json({
          success: true,
          user: {
            ...req.user,
            sessionInfo: sessionData ? {
              loginTime: sessionData.loginTime,
              ip: sessionData.ip,
              rememberMe: sessionData.rememberMe
            } : null
          }
        });
      } catch (error) {
        logger.error('验证令牌失败:', error);
        res.status(500).json({
          success: false,
          error: 'Verification failed',
          message: '验证失败'
        });
      }
    });
    
    // 刷新令牌API
    this.app.post(`${this.config.apiPrefix}/auth/refresh`, this.requireApiAuth, async (req, res) => {
      try {
        const { username } = req.user;
        
        // 获取当前会话
        const sessionData = await this.redisManager.get(`auth:session:${username}`);
        if (!sessionData) {
          return res.status(401).json({
            success: false,
            error: 'Session not found',
            message: '会话不存在'
          });
        }
        
        // 生成新token
        const tokenExpiry = sessionData.rememberMe ? '7d' : this.config.jwtExpiry;
        const newToken = jwt.sign(
          { 
            username, 
            role: 'admin',
            loginTime: sessionData.loginTime,
            rememberMe: sessionData.rememberMe
          },
          this.config.jwtSecret,
          { expiresIn: tokenExpiry }
        );
        
        // 更新会话
        const updatedSessionData = {
          ...sessionData,
          token: newToken,
          refreshTime: Date.now()
        };
        
        const sessionExpiry = sessionData.rememberMe ? 7 * 24 * 60 * 60 : 24 * 60 * 60;
        await this.redisManager.set(
          `auth:session:${username}`,
          updatedSessionData,
          sessionExpiry
        );
        
        // 更新Cookie
        const cookieOptions = {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          maxAge: sessionExpiry * 1000
        };
        
        res.cookie('authToken', newToken, cookieOptions);
        
        res.json({
          success: true,
          token: newToken,
          message: '令牌刷新成功'
        });
        
      } catch (error) {
        logger.error('刷新令牌失败:', error);
        res.status(500).json({
          success: false,
          error: 'Refresh failed',
          message: '刷新失败'
        });
      }
    });
  }

  /**
   * 设置 API 路由
   */
  setupApiRoutes() {
    const apiRouter = express.Router();
    
    // 无需认证的API路由（必须在认证中间件之前）
    apiRouter.get('/auth/check', async (req, res) => {
      try {
        const token = req.cookies.authToken;
        
        if (!token) {
          return res.json({
            success: true,
            authenticated: false,
            message: '未登录'
          });
        }
        
        // 验证JWT
        const decoded = jwt.verify(token, this.config.jwtSecret);
        const { username } = decoded;
        
        // 检查Redis会话
        const sessionData = await this.redisManager.get(`auth:session:${username}`);
        
        if (!sessionData || sessionData.token !== token) {
          // 会话无效，清除Cookie
          res.clearCookie('authToken');
          return res.json({
            success: true,
            authenticated: false,
            message: '会话已过期'
          });
        }
        
        res.json({
          success: true,
          authenticated: true,
          user: {
            username,
            role: decoded.role,
            loginTime: decoded.loginTime
          },
          message: '已登录'
        });
        
      } catch (error) {
        // JWT验证失败或其他错误
        res.clearCookie('authToken');
        res.json({
          success: true,
          authenticated: false,
          message: '认证失败'
        });
      }
    });
    
    // 应用认证中间件到所有其他 API 路由
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