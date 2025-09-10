const EventEmitter = require('events');
const os = require('os');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const config = require('../utils/config');

/**
 * 系统监控类
 * 负责监控系统性能、资源使用情况和健康状态
 */
class SystemMonitor extends EventEmitter {
    constructor() {
        super();
        this.isRunning = false;
        this.monitorInterval = null;
        this.metrics = {
            system: {
                cpu: { usage: 0, cores: os.cpus().length },
                memory: { used: 0, total: os.totalmem(), free: 0, usage: 0 },
                disk: { used: 0, total: 0, free: 0, usage: 0 },
                uptime: 0,
                loadAverage: [0, 0, 0]
            },
            process: {
                pid: process.pid,
                memory: { rss: 0, heapUsed: 0, heapTotal: 0, external: 0 },
                cpu: { user: 0, system: 0 },
                uptime: 0,
                version: process.version
            },
            application: {
                plugins: { total: 0, active: 0, inactive: 0 },
                tasks: { total: 0, running: 0, completed: 0, failed: 0 },
                connections: { onebot: false, redis: false, websocket: 0 },
                requests: { total: 0, success: 0, error: 0 },
                errors: { total: 0, recent: [] }
            }
        };
        this.history = {
            cpu: [],
            memory: [],
            disk: [],
            requests: [],
            errors: []
        };
        this.alerts = new Map();
        this.thresholds = {
            cpu: 80,
            memory: 85,
            disk: 90,
            errorRate: 10
        };
        
        this.setupEventListeners();
    }

    /**
     * 设置事件监听器
     */
    setupEventListeners() {
        // 监听应用程序事件
        process.on('uncaughtException', (error) => {
            this.recordError('uncaughtException', error);
        });

        process.on('unhandledRejection', (reason, promise) => {
            this.recordError('unhandledRejection', reason);
        });

        // 监听进程退出
        process.on('SIGINT', () => {
            this.stop();
        });

        process.on('SIGTERM', () => {
            this.stop();
        });
    }

    /**
     * 启动监控
     */
    start() {
        if (this.isRunning) {
            logger.warn('System monitor is already running');
            return;
        }

        this.isRunning = true;
        const interval = config.get('monitor.interval', 5000);
        
        this.monitorInterval = setInterval(() => {
            this.collectMetrics();
        }, interval);

        // 立即收集一次指标
        this.collectMetrics();
        
        logger.info('System monitor started');
        this.emit('started');
    }

    /**
     * 停止监控
     */
    stop() {
        if (!this.isRunning) {
            return;
        }

        this.isRunning = false;
        
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
        }

        logger.info('System monitor stopped');
        this.emit('stopped');
    }

    /**
     * 收集系统指标
     */
    async collectMetrics() {
        try {
            await this.collectSystemMetrics();
            await this.collectProcessMetrics();
            await this.collectApplicationMetrics();
            
            this.updateHistory();
            this.checkThresholds();
            
            this.emit('metricsCollected', this.metrics);
        } catch (error) {
            logger.error('Failed to collect metrics:', error);
            this.recordError('metricsCollection', error);
        }
    }

    /**
     * 收集系统指标
     */
    async collectSystemMetrics() {
        // CPU 使用率
        const cpus = os.cpus();
        let totalIdle = 0;
        let totalTick = 0;
        
        cpus.forEach(cpu => {
            for (const type in cpu.times) {
                totalTick += cpu.times[type];
            }
            totalIdle += cpu.times.idle;
        });
        
        this.metrics.system.cpu.usage = Math.round((1 - totalIdle / totalTick) * 100);
        
        // 内存使用情况
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        
        this.metrics.system.memory = {
            used: usedMem,
            total: totalMem,
            free: freeMem,
            usage: Math.round((usedMem / totalMem) * 100)
        };
        
        // 系统运行时间
        this.metrics.system.uptime = os.uptime();
        
        // 负载平均值
        this.metrics.system.loadAverage = os.loadavg();
        
        // 磁盘使用情况
        await this.collectDiskMetrics();
    }

    /**
     * 收集磁盘指标
     */
    async collectDiskMetrics() {
        try {
            const stats = await fs.promises.stat(process.cwd());
            // 简化的磁盘使用情况检查
            // 在实际应用中可能需要使用第三方库获取更准确的磁盘信息
            this.metrics.system.disk = {
                used: 0,
                total: 0,
                free: 0,
                usage: 0
            };
        } catch (error) {
            logger.warn('Failed to collect disk metrics:', error.message);
        }
    }

    /**
     * 收集进程指标
     */
    collectProcessMetrics() {
        // 进程内存使用情况
        const memUsage = process.memoryUsage();
        this.metrics.process.memory = {
            rss: memUsage.rss,
            heapUsed: memUsage.heapUsed,
            heapTotal: memUsage.heapTotal,
            external: memUsage.external
        };
        
        // 进程 CPU 使用情况
        const cpuUsage = process.cpuUsage();
        this.metrics.process.cpu = {
            user: cpuUsage.user,
            system: cpuUsage.system
        };
        
        // 进程运行时间
        this.metrics.process.uptime = process.uptime();
    }

    /**
     * 收集应用程序指标
     */
    async collectApplicationMetrics() {
        // 这里需要与其他模块集成来获取应用程序特定的指标
        // 插件状态、任务状态、连接状态等
        
        // 示例：从全局状态获取指标
        if (global.pluginManager) {
            const pluginStats = global.pluginManager.getStats();
            this.metrics.application.plugins = pluginStats;
        }
        
        if (global.taskScheduler) {
            const taskStats = global.taskScheduler.getStats();
            this.metrics.application.tasks = taskStats;
        }
        
        if (global.onebotCore) {
            this.metrics.application.connections.onebot = global.onebotCore.getConnectionStatus();
        }
        
        if (global.redisClient) {
            this.metrics.application.connections.redis = global.redisClient.status === 'ready';
        }
        
        if (global.webSocketManager) {
            this.metrics.application.connections.websocket = global.webSocketManager.getClientCount();
        }
    }

    /**
     * 更新历史数据
     */
    updateHistory() {
        const timestamp = Date.now();
        const maxHistoryLength = config.get('monitor.historyLength', 100);
        
        // 添加新数据点
        this.history.cpu.push({
            timestamp,
            value: this.metrics.system.cpu.usage
        });
        
        this.history.memory.push({
            timestamp,
            value: this.metrics.system.memory.usage
        });
        
        this.history.disk.push({
            timestamp,
            value: this.metrics.system.disk.usage
        });
        
        // 限制历史数据长度
        Object.keys(this.history).forEach(key => {
            if (this.history[key].length > maxHistoryLength) {
                this.history[key] = this.history[key].slice(-maxHistoryLength);
            }
        });
    }

    /**
     * 检查阈值并发送警报
     */
    checkThresholds() {
        const checks = [
            {
                name: 'cpu',
                value: this.metrics.system.cpu.usage,
                threshold: this.thresholds.cpu,
                message: `CPU usage is ${this.metrics.system.cpu.usage}%`
            },
            {
                name: 'memory',
                value: this.metrics.system.memory.usage,
                threshold: this.thresholds.memory,
                message: `Memory usage is ${this.metrics.system.memory.usage}%`
            },
            {
                name: 'disk',
                value: this.metrics.system.disk.usage,
                threshold: this.thresholds.disk,
                message: `Disk usage is ${this.metrics.system.disk.usage}%`
            }
        ];
        
        checks.forEach(check => {
            if (check.value > check.threshold) {
                this.triggerAlert(check.name, 'high', check.message);
            } else {
                this.clearAlert(check.name);
            }
        });
    }

    /**
     * 触发警报
     */
    triggerAlert(type, level, message) {
        const alertKey = `${type}_${level}`;
        const existingAlert = this.alerts.get(alertKey);
        
        if (!existingAlert || Date.now() - existingAlert.lastTriggered > 300000) { // 5分钟冷却
            const alert = {
                type,
                level,
                message,
                timestamp: Date.now(),
                lastTriggered: Date.now()
            };
            
            this.alerts.set(alertKey, alert);
            
            logger.warn(`System alert [${level.toUpperCase()}]: ${message}`);
            this.emit('alert', alert);
        }
    }

    /**
     * 清除警报
     */
    clearAlert(type) {
        const alertKeys = Array.from(this.alerts.keys()).filter(key => key.startsWith(type));
        alertKeys.forEach(key => {
            this.alerts.delete(key);
        });
    }

    /**
     * 记录错误
     */
    recordError(type, error) {
        const errorRecord = {
            type,
            message: error.message || String(error),
            stack: error.stack,
            timestamp: Date.now()
        };
        
        this.metrics.application.errors.total++;
        this.metrics.application.errors.recent.push(errorRecord);
        
        // 只保留最近的错误记录
        if (this.metrics.application.errors.recent.length > 50) {
            this.metrics.application.errors.recent = this.metrics.application.errors.recent.slice(-50);
        }
        
        this.emit('error', errorRecord);
    }

    /**
     * 记录请求
     */
    recordRequest(success = true) {
        this.metrics.application.requests.total++;
        if (success) {
            this.metrics.application.requests.success++;
        } else {
            this.metrics.application.requests.error++;
        }
        
        // 检查错误率
        const errorRate = (this.metrics.application.requests.error / this.metrics.application.requests.total) * 100;
        if (errorRate > this.thresholds.errorRate) {
            this.triggerAlert('errorRate', 'high', `Error rate is ${errorRate.toFixed(2)}%`);
        }
    }

    /**
     * 获取当前指标
     */
    getMetrics() {
        return {
            ...this.metrics,
            timestamp: Date.now()
        };
    }

    /**
     * 获取历史数据
     */
    getHistory(type = null, limit = null) {
        if (type && this.history[type]) {
            const data = this.history[type];
            return limit ? data.slice(-limit) : data;
        }
        
        const result = {};
        Object.keys(this.history).forEach(key => {
            const data = this.history[key];
            result[key] = limit ? data.slice(-limit) : data;
        });
        
        return result;
    }

    /**
     * 获取活动警报
     */
    getActiveAlerts() {
        return Array.from(this.alerts.values());
    }

    /**
     * 获取系统健康状态
     */
    getHealthStatus() {
        const alerts = this.getActiveAlerts();
        const hasHighAlerts = alerts.some(alert => alert.level === 'high');
        const hasMediumAlerts = alerts.some(alert => alert.level === 'medium');
        
        let status = 'healthy';
        if (hasHighAlerts) {
            status = 'critical';
        } else if (hasMediumAlerts) {
            status = 'warning';
        }
        
        return {
            status,
            alerts: alerts.length,
            uptime: this.metrics.process.uptime,
            connections: this.metrics.application.connections,
            lastCheck: Date.now()
        };
    }

    /**
     * 设置阈值
     */
    setThresholds(thresholds) {
        this.thresholds = { ...this.thresholds, ...thresholds };
        logger.info('Monitor thresholds updated:', this.thresholds);
    }

    /**
     * 生成监控报告
     */
    generateReport() {
        const metrics = this.getMetrics();
        const health = this.getHealthStatus();
        const alerts = this.getActiveAlerts();
        
        return {
            timestamp: Date.now(),
            health,
            metrics,
            alerts,
            summary: {
                cpuUsage: metrics.system.cpu.usage,
                memoryUsage: metrics.system.memory.usage,
                diskUsage: metrics.system.disk.usage,
                activePlugins: metrics.application.plugins.active,
                runningTasks: metrics.application.tasks.running,
                totalErrors: metrics.application.errors.total,
                uptime: metrics.process.uptime
            }
        };
    }
}

// 创建单例实例
const systemMonitor = new SystemMonitor();

module.exports = systemMonitor;