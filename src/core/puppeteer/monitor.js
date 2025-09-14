const logger = require('../../utils/logger');
const EventEmitter = require('events');

/**
 * Puppeteer性能监控器
 */
class PuppeteerMonitor extends EventEmitter {
    constructor(manager, options = {}) {
        super();
        
        this.manager = manager;
        this.options = {
            enabled: options.enabled !== false,
            interval: options.interval || 60000, // 1分钟
            memoryWarningThreshold: options.memoryWarningThreshold || 500, // 500MB
            memoryErrorThreshold: options.memoryErrorThreshold || 1000, // 1GB
            ...options
        };
        
        this.metrics = {
            startTime: Date.now(),
            totalOperations: 0,
            successfulOperations: 0,
            failedOperations: 0,
            averageOperationTime: 0,
            peakMemoryUsage: 0,
            currentMemoryUsage: 0,
            browserCreations: 0,
            pageCreations: 0,
            errors: new Map()
        };
        
        this.operationTimes = [];
        this.monitorInterval = null;
        
        if (this.options.enabled) {
            this.start();
        }
    }
    
    /**
     * 开始监控
     */
    start() {
        if (this.monitorInterval) {
            return;
        }
        
        logger.info('[PuppeteerMonitor]: 开始性能监控');
        
        this.monitorInterval = setInterval(() => {
            this.collectMetrics();
        }, this.options.interval);
        
        // 监听管理器事件
        this.manager.on('browserCreated', () => {
            this.metrics.browserCreations++;
        });
        
        this.manager.on('pageCreated', () => {
            this.metrics.pageCreations++;
        });
        
        this.manager.on('operationStart', (data) => {
            this.recordOperationStart(data);
        });
        
        this.manager.on('operationEnd', (data) => {
            this.recordOperationEnd(data);
        });
        
        this.manager.on('error', (error) => {
            this.recordError(error);
        });
    }
    
    /**
     * 停止监控
     */
    stop() {
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
            logger.info('[PuppeteerMonitor]: 停止性能监控');
        }
    }
    
    /**
     * 收集性能指标
     */
    async collectMetrics() {
        try {
            // 收集内存使用情况
            const memoryUsage = process.memoryUsage();
            this.metrics.currentMemoryUsage = Math.round(memoryUsage.heapUsed / 1024 / 1024); // MB
            
            if (this.metrics.currentMemoryUsage > this.metrics.peakMemoryUsage) {
                this.metrics.peakMemoryUsage = this.metrics.currentMemoryUsage;
            }
            
            // 检查内存使用警告
            if (this.metrics.currentMemoryUsage > this.options.memoryErrorThreshold) {
                this.emit('memoryError', {
                    current: this.metrics.currentMemoryUsage,
                    threshold: this.options.memoryErrorThreshold
                });
                logger.error(`[PuppeteerMonitor]: 内存使用过高: ${this.metrics.currentMemoryUsage}MB`);
            } else if (this.metrics.currentMemoryUsage > this.options.memoryWarningThreshold) {
                this.emit('memoryWarning', {
                    current: this.metrics.currentMemoryUsage,
                    threshold: this.options.memoryWarningThreshold
                });
                logger.warn(`[PuppeteerMonitor]: 内存使用警告: ${this.metrics.currentMemoryUsage}MB`);
            }
            
            // 计算平均操作时间
            if (this.operationTimes.length > 0) {
                const sum = this.operationTimes.reduce((a, b) => a + b, 0);
                this.metrics.averageOperationTime = Math.round(sum / this.operationTimes.length);
                
                // 保持最近100次操作的时间记录
                if (this.operationTimes.length > 100) {
                    this.operationTimes = this.operationTimes.slice(-100);
                }
            }
            
            // 获取管理器状态
            const managerStatus = this.manager.getStatus();
            
            // 发出监控事件
            this.emit('metricsCollected', {
                ...this.metrics,
                managerStatus,
                uptime: Date.now() - this.metrics.startTime
            });
            
            // 记录详细日志（每10分钟一次）
            if (Date.now() % (10 * 60 * 1000) < this.options.interval) {
                this.logDetailedMetrics(managerStatus);
            }
            
        } catch (error) {
            logger.error('[PuppeteerMonitor]: 收集性能指标时发生错误:', error);
        }
    }
    
    /**
     * 记录操作开始
     */
    recordOperationStart(data) {
        this.metrics.totalOperations++;
        data.startTime = Date.now();
    }
    
    /**
     * 记录操作结束
     */
    recordOperationEnd(data) {
        if (data.startTime) {
            const duration = Date.now() - data.startTime;
            this.operationTimes.push(duration);
            
            if (data.success) {
                this.metrics.successfulOperations++;
            } else {
                this.metrics.failedOperations++;
            }
        }
    }
    
    /**
     * 记录错误
     */
    recordError(error) {
        const errorType = error.name || 'UnknownError';
        const count = this.metrics.errors.get(errorType) || 0;
        this.metrics.errors.set(errorType, count + 1);
        
        this.emit('errorRecorded', {
            type: errorType,
            count: count + 1,
            error
        });
    }
    
    /**
     * 记录详细性能指标
     */
    logDetailedMetrics(managerStatus) {
        const uptime = Date.now() - this.metrics.startTime;
        const uptimeHours = Math.round(uptime / (1000 * 60 * 60) * 100) / 100;
        
        const successRate = this.metrics.totalOperations > 0 
            ? Math.round((this.metrics.successfulOperations / this.metrics.totalOperations) * 100)
            : 0;
        
        logger.info('[PuppeteerMonitor]: 性能统计报告', {
            uptime: `${uptimeHours}小时`,
            memory: {
                current: `${this.metrics.currentMemoryUsage}MB`,
                peak: `${this.metrics.peakMemoryUsage}MB`
            },
            operations: {
                total: this.metrics.totalOperations,
                successful: this.metrics.successfulOperations,
                failed: this.metrics.failedOperations,
                successRate: `${successRate}%`,
                averageTime: `${this.metrics.averageOperationTime}ms`
            },
            resources: {
                browsers: `${managerStatus.browsers.count}/${managerStatus.browsers.max}`,
                pages: `${managerStatus.pages.total}/${managerStatus.pages.max}`,
                pagesInUse: managerStatus.pages.inUse,
                pagesIdle: managerStatus.pages.idle
            },
            errors: Object.fromEntries(this.metrics.errors)
        });
    }
    
    /**
     * 获取性能报告
     */
    getReport() {
        const uptime = Date.now() - this.metrics.startTime;
        
        return {
            uptime,
            metrics: { ...this.metrics },
            performance: {
                successRate: this.metrics.totalOperations > 0 
                    ? (this.metrics.successfulOperations / this.metrics.totalOperations) * 100
                    : 0,
                averageOperationTime: this.metrics.averageOperationTime,
                operationsPerMinute: this.metrics.totalOperations / (uptime / 60000)
            },
            health: {
                memoryStatus: this.getMemoryStatus(),
                errorRate: this.getErrorRate()
            }
        };
    }
    
    /**
     * 获取内存状态
     */
    getMemoryStatus() {
        if (this.metrics.currentMemoryUsage > this.options.memoryErrorThreshold) {
            return 'critical';
        } else if (this.metrics.currentMemoryUsage > this.options.memoryWarningThreshold) {
            return 'warning';
        } else {
            return 'normal';
        }
    }
    
    /**
     * 获取错误率
     */
    getErrorRate() {
        if (this.metrics.totalOperations === 0) {
            return 0;
        }
        
        return (this.metrics.failedOperations / this.metrics.totalOperations) * 100;
    }
    
    /**
     * 重置统计数据
     */
    reset() {
        this.metrics = {
            startTime: Date.now(),
            totalOperations: 0,
            successfulOperations: 0,
            failedOperations: 0,
            averageOperationTime: 0,
            peakMemoryUsage: 0,
            currentMemoryUsage: 0,
            browserCreations: 0,
            pageCreations: 0,
            errors: new Map()
        };
        
        this.operationTimes = [];
        
        logger.info('[PuppeteerMonitor]: 统计数据已重置');
    }
    
    /**
     * 获取当前状态
     */
    getStatus() {
        return {
            enabled: this.options.enabled,
            running: this.monitorInterval !== null,
            uptime: Date.now() - this.metrics.startTime,
            metrics: this.metrics
        };
    }
}

module.exports = PuppeteerMonitor;