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
        this.setupMiddleware();
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
            res.sendFile(path.join(__dirname, 'public', 'admin.html'));
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
}

module.exports = WebServer;