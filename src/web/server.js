const express = require('express');
const path = require('path');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { EventEmitter } = require('events');

class WebServer extends EventEmitter {
    constructor(config = {}) {
        super();
        this.config = {
            port: config.port || 3000,
            host: config.host || 'localhost',
            ...config
        };
        this.app = express();
        this.server = null;
        this.pluginManager = config.pluginManager;
        this.setupMiddleware();
        this.setupPluginRoutes();
        this.setupRoutes();
    }

    setupMiddleware() {
        // CORS配置
        this.app.use(cors({
            origin: true,
            credentials: true
        }));

        // 请求体解析
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

        // 速率限制
        const limiter = rateLimit({
            windowMs: 15 * 60 * 1000, // 15分钟
            max: 100, // 限制每个IP 15分钟内最多100个请求
            message: {
                error: 'Too many requests, please try again later.'
            }
        });
        this.app.use('/api/', limiter);

        // 静态文件服务
        this.app.use(express.static(path.join(__dirname, 'public')));
        
        // 路由重定向
        this.app.get('/', (req, res) => {
            res.redirect('/login.html');
        });
        
        this.app.get('/webui', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        });
        
        this.app.get('/config', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        });
                this.app.get('/plugins', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        });
    }

    setupRoutes() {
        // API路由
        const apiRoutes = require('./routes/api');
        this.app.use('/api', apiRoutes);

        // 404处理
        this.app.use('*', (req, res) => {
            res.status(404).json({
                success: false,
                error: 'Route not found'
            });
        });

        // 错误处理中间件
        this.app.use((error, req, res, next) => {
            logger.error('Web server error:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error'
            });
        });
    }

    async start() {
        return new Promise((resolve, reject) => {
            try {
                this.server = this.app.listen(this.config.port, this.config.host, () => {
                    logger.info(`web服务器已启动： http://${this.config.host}:${this.config.port}`);
                    logger.info(`webui地址： http://localhost:${this.config.port}/webui`);
                    this.emit('started', {
                        host: this.config.host,
                        port: this.config.port
                    });
                    resolve();
                });

                this.server.on('error', (error) => {
                    logger.error('Web server error:', error);
                    this.emit('error', error);
                    reject(error);
                });
            } catch (error) {
                logger.error('Failed to start web server:', error);
                this.emit('error', error);
                reject(error);
            }
        });
    }

    async stop() {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    logger.info('Web server stopped');
                    this.emit('stopped');
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    getApp() {
        return this.app;
    }

    isRunning() {
        return this.server && this.server.listening;
    }

    setupPluginRoutes() {
        if (this.pluginManager) {
            // 监听插件路由注册事件
            this.pluginManager.on('register_route', (data) => {
                const { method, path, handler } = data;
                this.app[method.toLowerCase()](path, handler);
                logger.info(`注册插件路由: ${method.toUpperCase()} ${path}`);
            });

            // 监听插件静态文件注册事件
            this.pluginManager.on('register_static', (data) => {
                const { urlPath, localPath } = data;
                this.app.use(urlPath, express.static(localPath));
                logger.info(`注册插件静态路径: ${urlPath} -> ${localPath}`);
            });
            
            // 注册已加载的插件路由
            this.registerExistingPluginRoutes();
        }
    }

    // 注册已加载插件的路由
    registerExistingPluginRoutes() {
        if (this.pluginManager && this.pluginManager.plugins) {
            for (const [pluginName, pluginData] of this.pluginManager.plugins) {
                if (pluginData.instance) {
                    // 注册API路由
                    if (pluginData.instance.routes) {
                        // routes是一个Map对象，需要遍历其值
                        for (const [routeKey, route] of pluginData.instance.routes) {
                            const { method, path, handler } = route;
                            if (method && path && handler) {
                                // 路径已经在插件管理器中添加了前缀，直接使用
                                this.app[method.toLowerCase()](path, handler);
                                //logger.info(`注册已存在插件路由: ${method.toUpperCase()} ${path}`);
                            }
                        }
                    }
                    
                    // 注册静态文件路由
                    if (pluginData.instance.webPath) {
                        const staticUrlPath = `/plugins/${pluginName}/config`;
                        this.app.use(staticUrlPath, express.static(pluginData.instance.webPath));
                        //logger.info(`注册已存在插件静态路径: ${staticUrlPath} -> ${pluginData.instance.webPath}`);
                    }
                }
            }
        }
    }
}

module.exports = WebServer;