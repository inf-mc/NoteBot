const EventEmitter = require('events');
const logger = require('./utils/logger');
const config = require('./utils/config');
const redisClient = require('./core/redis');
const onebotCore = require('./core/onebot');
const pluginManager = require('./plugins/manager');
const taskScheduler = require('./scheduler');
const webServer = require('./web/server');
const systemMonitor = require('./monitor');
const profiler = require('./monitor/profiler');
const logAnalyzer = require('./monitor/logAnalyzer');

/**
 * 主应用程序类
 * 负责协调和管理所有系统组件
 */
class Application extends EventEmitter {
    constructor() {
        super();
        this.isRunning = false;
        this.components = new Map();
        this.startupTime = null;
        this.shutdownInProgress = false;
        
        // 设置全局引用
        global.app = this;
        global.logger = logger;
        global.config = config;
        
        this.setupEventHandlers();
    }

    /**
     * 设置事件处理器
     */
    setupEventHandlers() {
        // 处理未捕获的异常
        process.on('uncaughtException', (error) => {
            logger.error('NoteBot 未捕获异常:', error);
            this.handleCriticalError(error);
        });

        process.on('unhandledRejection', (reason, promise) => {
            logger.error('NoteBot 未处理拒绝:', promise, '原因:', reason);
            this.handleCriticalError(reason);
        });

        // 处理进程信号
        process.on('SIGINT', () => {
            logger.info('NoteBot 收到 SIGINT 信号，正在关闭...');
            this.shutdown();
        });

        process.on('SIGTERM', () => {
            logger.info('NoteBot 收到 SIGTERM 信号，正在关闭...');
            this.shutdown();
        });

        // Windows 特定信号
        if (process.platform === 'win32') {
            process.on('SIGBREAK', () => {
                logger.info('NoteBot 收到 SIGBREAK 信号，正在关闭...');
                this.shutdown();
            });
        }
    }

    /**
     * 启动应用程序
     */
    async start() {
        if (this.isRunning) {
            logger.warn('NoteBot 已在运行');
            return;
        }

        try {
            this.startupTime = Date.now();
            logger.info('NoteBot 正在启动...');
            // 加载配置
            await this.startComponent('config', this.initializeConfig.bind(this));
            // 初始化 Redis
            await this.startComponent('redis', this.initializeRedis.bind(this));
            // 初始化监控
            await this.startComponent('monitor', this.initializeMonitoring.bind(this));
            await this.startComponent('onebot', this.initializeOnebot.bind(this));
            await this.startComponent('plugins', this.initializePlugins.bind(this));
            await this.startComponent('scheduler', this.initializeScheduler.bind(this));
            await this.startComponent('web', this.initializeWebServer.bind(this));
            
            this.isRunning = true;
            
            const startupDuration = Date.now() - this.startupTime;
            logger.info(`NoteBot 启动成功，耗时 ${startupDuration}ms`);
            
            this.emit('started', {
                startupTime: this.startupTime,
                duration: startupDuration,
                components: Array.from(this.components.keys())
            });
            
            // 启动后的健康检查
            setTimeout(() => {
                this.performHealthCheck();
            }, 5000);
            
        } catch (error) {
            logger.error('NoteBot 启动失败:', error);
            await this.shutdown();
            throw error;
        }
    }

    /**
     * 启动单个组件
     */
    async startComponent(name, initFunction) {
        try {
            logger.info(`NoteBot 正在启动组件: ${name}`);
            const startTime = Date.now();
            
            const component = await initFunction();
            
            const duration = Date.now() - startTime;
            this.components.set(name, {
                instance: component,
                startTime,
                duration,
                status: 'running'
            });
            
            logger.info(`NoteBot 组件 ${name} 启动成功，耗时 ${duration}ms`);
            this.emit('componentStarted', { name, duration });
            
            return component;
        } catch (error) {
            logger.error(`NoteBot 组件 ${name} 启动失败:`, error);
            this.components.set(name, {
                instance: null,
                startTime: Date.now(),
                duration: 0,
                status: 'failed',
                error: error.message
            });
            throw error;
        }
    }

    /**
     * 初始化配置
     */
    async initializeConfig() {
        // 配置已经在模块加载时初始化
        logger.info('NoteBot 配置加载成功:', {
            environment: config.getEnvironment(),
            nodeEnv: process.env.NODE_ENV || 'development'
        });
        
        return config;
    }

    /**
     * 初始化 Redis
     */
    async initializeRedis() {
        // 创建 Redis 实例
        const RedisManager = redisClient;
        const redisInstance = new RedisManager(config.get('redis'));
        
        // 初始化连接
        await redisInstance.init();
        
        // 设置全局引用
        global.redisClient = redisInstance;
        
        // 监听 Redis 事件
        redisInstance.on('error', (error) => {
            logger.error('NoteBot Redis 连接错误:', error);
            this.emit('componentError', { name: 'redis', error });
        });
        
        redisInstance.on('connect', () => {
            logger.info('NoteBot Redis 连接成功');
        });
        
        redisInstance.on('disconnect', () => {
            logger.warn('NoteBot Redis 断开连接');
        });
        
        return redisInstance;
    }

    /**
     * 初始化监控系统
     */
    async initializeMonitoring() {
        // 启动系统监控
        systemMonitor.start();
        global.systemMonitor = systemMonitor;
        
        // 启动性能分析器
        if (config.get('profiler.enabled', false)) {
            profiler.start();
            global.profiler = profiler;
        }
        
        // 启动日志分析器
        if (config.get('logAnalyzer.enabled', true)) {
            logAnalyzer.start();
            global.logAnalyzer = logAnalyzer;
        }
        
        // 监听监控事件
        systemMonitor.on('alert', (alert) => {
            logger.warn('NoteBot 系统警告:', alert);
            this.emit('systemAlert', alert);
        });
        
        logAnalyzer.on('alert', (alert) => {
            logger.warn('NoteBot 日志分析器警告:', alert);
            this.emit('logAlert', alert);
        });
        
        return {
            systemMonitor,
            profiler,
            logAnalyzer
        };
    }

    /**
     * 初始化 Onebot 核心
     */
    async initializeOnebot() {
        // 创建 Onebot 实例
        const OnebotCore = onebotCore;
        const onebotInstance = new OnebotCore(config.get('onebot'));
        
        // 设置全局引用
        global.onebotCore = onebotInstance;
        
        // 监听 Onebot 事件
        onebotInstance.on('connected', () => {
            logger.info('NoteBot Onebot 连接成功');
            this.emit('onebotConnected');
        });
        
        onebotInstance.on('disconnected', () => {
            logger.warn('NoteBot Onebot 断开连接');
            this.emit('onebotDisconnected');
        });
        
        onebotInstance.on('error', (error) => {
            logger.error('NoteBot Onebot 连接错误:', error);
            this.emit('componentError', { name: 'onebot', error });
        });
        
        return onebotInstance;
    }

    /**
     * 初始化插件系统
     */
    async initializePlugins() {
        // 创建插件管理器实例
        const PluginManager = pluginManager;
        const pluginInstance = new PluginManager(
            config.get('plugins'),
            global.redisClient,
            global.onebotCore,
            global.taskScheduler
        );
        
        // 设置全局引用
        global.pluginManager = pluginInstance;
        
        // 监听插件事件
        pluginInstance.on('pluginLoaded', (plugin) => {
            logger.info(`NoteBot 插件加载成功: ${plugin.name}`);
        });
        
        pluginInstance.on('pluginUnloaded', (plugin) => {
            logger.info(`NoteBot 插件卸载成功: ${plugin.name}`);
        });
        
        pluginInstance.on('error', (error) => {
            logger.error('NoteBot 插件管理器错误:', error);
            this.emit('componentError', { name: 'plugins', error });
        });
        
        return pluginInstance;
    }

    /**
     * 初始化任务调度器
     */
    async initializeScheduler() {
        // 创建任务调度器实例
        const TaskScheduler = taskScheduler;
        const schedulerInstance = new TaskScheduler(global.redisClient);
        
        // 设置全局引用
        global.taskScheduler = schedulerInstance;
        
        // 监听调度器事件
        schedulerInstance.on('taskStarted', (task) => {
            logger.debug(`NoteBot 定时任务开始: ${task.name}`);
        });
        
        schedulerInstance.on('taskCompleted', (task) => {
            logger.debug(`NoteBot 定时任务完成: ${task.name}`);
        });
        
        schedulerInstance.on('taskFailed', (task, error) => {
            logger.error(`NoteBot 定时任务失败: ${task.name}`, error);
        });
        
        schedulerInstance.on('error', (error) => {
            logger.error('NoteBot 定时任务调度器错误:', error);
            this.emit('componentError', { name: 'scheduler', error });
        });
        
        return schedulerInstance;
    }

    /**
     * 初始化 Web 服务器
     */
    async initializeWebServer() {
        // 创建Web服务器实例
        const WebServer = webServer;
        const webInstance = new WebServer({
            redisManager: global.redisClient,
            onebotCore: global.onebotCore,
            pluginManager: global.pluginManager,
            taskScheduler: global.taskScheduler,
            taskManager: global.taskManager
        });
        
        // 启动Web服务器
        await webInstance.start();
        
        // 设置全局引用
        global.webServer = webInstance;
        
        // 监听 Web 服务器事件
        webInstance.on('started', (info) => {
            logger.info(`NoteBot Web 服务器启动成功，端口 ${info.port}`);
        });
        
        webInstance.on('error', (error) => {
            logger.error('NoteBot Web 服务器错误:', error);
            this.emit('componentError', { name: 'web', error });
        });
        
        return webInstance;
    }

    /**
     * 执行健康检查
     */
    async performHealthCheck() {
        try {
            const health = {
                timestamp: Date.now(),
                uptime: Date.now() - this.startupTime,
                components: {},
                overall: 'healthy'
            };
            
            // 检查各组件状态
            for (const [name, component] of this.components) {
                try {
                    let status = 'unknown';
                    
                    switch (name) {
                        case 'redis':
                            status = redisClient.status === 'ready' ? 'healthy' : 'unhealthy';
                            break;
                        case 'onebot':
                            status = onebotCore.isConnected() ? 'healthy' : 'unhealthy';
                            break;
                        case 'web':
                            status = webServer.isRunning() ? 'healthy' : 'unhealthy';
                            break;
                        case 'plugins':
                            status = pluginManager.isInitialized() ? 'healthy' : 'unhealthy';
                            break;
                        case 'scheduler':
                            status = taskScheduler.isRunning() ? 'healthy' : 'unhealthy';
                            break;
                        case 'monitor':
                            status = systemMonitor.isRunning ? 'healthy' : 'unhealthy';
                            break;
                        default:
                            status = component.status === 'running' ? 'healthy' : 'unhealthy';
                    }
                    
                    health.components[name] = {
                        status,
                        uptime: Date.now() - component.startTime,
                        startDuration: component.duration
                    };
                    
                    if (status === 'unhealthy') {
                        health.overall = 'degraded';
                    }
                    
                } catch (error) {
                    health.components[name] = {
                        status: 'error',
                        error: error.message
                    };
                    health.overall = 'degraded';
                }
            }
            
            this.emit('healthCheck', health);
            
            if (health.overall !== 'healthy') {
                logger.warn('运行状况检查检测到问题:', health);
            } else {
                logger.debug('运行状况检查通过');
            }
            
            return health;
            
        } catch (error) {
            logger.error('运行状况检查失败:', error);
            return {
                timestamp: Date.now(),
                overall: 'error',
                error: error.message
            };
        }
    }

    /**
     * 处理关键错误
     */
    async handleCriticalError(error) {
        logger.error('NoteBot 检测到关键错误，正在紧急关闭:', error);
        
        this.emit('criticalError', error);
        
        // 给组件一些时间来清理
        setTimeout(() => {
            process.exit(1);
        }, 5000);
        
        await this.shutdown();
    }

    /**
     * 优雅关闭应用程序
     */
    async shutdown() {
        if (this.shutdownInProgress) {
            logger.warn('NoteBot 关闭已在进行中');
            return;
        }
        
        this.shutdownInProgress = true;
        this.isRunning = false;
        
        logger.info('NoteBot 正在关闭...');
        
        try {
            // 按相反顺序关闭组件
            const shutdownOrder = [
                'web',
                'scheduler', 
                'plugins',
                'onebot',
                'monitor',
                'redis'
            ];
            
            for (const componentName of shutdownOrder) {
                await this.shutdownComponent(componentName);
            }
            
            logger.info('NoteBot 关闭完成');
            this.emit('shutdown');
            
            // 等待日志写入完成后再关闭
            await new Promise(resolve => {
                if (logger.end) {
                    logger.end(() => {
                        resolve();
                    });
                } else {
                    setTimeout(resolve, 500);
                }
            });
            
        } catch (error) {
            logger.error('NoteBot 关闭过程中出错:', error);
        } finally {
            // 强制退出
            setTimeout(() => {
                process.exit(0);
            }, 2000);
        }
    }

    /**
     * 关闭单个组件
     */
    async shutdownComponent(name) {
        const component = this.components.get(name);
        if (!component || component.status !== 'running') {
            return;
        }
        
        try {
            logger.info(`NoteBot 正在关闭组件: ${name}`);
            
            switch (name) {
                case 'web':
                    await webServer.stop();
                    break;
                case 'scheduler':
                    await taskScheduler.stop();
                    break;
                case 'plugins':
                    await pluginManager.shutdown();
                    break;
                case 'onebot':
                    await onebotCore.disconnect();
                    break;
                case 'monitor':
                    systemMonitor.stop();
                    profiler.stop();
                    logAnalyzer.stop();
                    break;
                case 'redis':
                    await redisClient.disconnect();
                    break;
            }
            
            component.status = 'stopped';
            logger.info(`NoteBot 组件 ${name} 关闭成功`);
            
        } catch (error) {
            logger.error(`NoteBot 关闭组件 ${name} 时出错:`, error);
            component.status = 'error';
        }
    }

    /**
     * 重启应用程序
     */
    async restart() {
        logger.info('NoteBot 正在重启...');
        
        await this.shutdown();
        
        // 等待一段时间确保清理完成
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        await this.start();
    }

    /**
     * 获取应用程序状态
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            startupTime: this.startupTime,
            uptime: this.startupTime ? Date.now() - this.startupTime : 0,
            components: Object.fromEntries(
                Array.from(this.components.entries()).map(([name, comp]) => [
                    name,
                    {
                        status: comp.status,
                        uptime: Date.now() - comp.startTime,
                        startDuration: comp.duration,
                        error: comp.error
                    }
                ])
            ),
            environment: config.getEnvironment(),
            version: require('../package.json').version || '1.0.0'
        };
    }

    /**
     * 获取组件实例
     */
    getComponent(name) {
        const component = this.components.get(name);
        return component ? component.instance : null;
    }

    /**
     * 检查组件是否运行
     */
    isComponentRunning(name) {
        const component = this.components.get(name);
        return component && component.status === 'running';
    }
}

// 创建应用程序实例
const app = new Application();

// 如果直接运行此文件，启动应用程序
if (require.main === module) {
    app.start().catch((error) => {
        logger.error('NoteBot 启动失败:', error);
        process.exit(1);
    });
}

module.exports = app;