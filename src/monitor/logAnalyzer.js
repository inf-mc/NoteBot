const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const logger = require('../utils/logger');
const config = require('../utils/config');

/**
 * 日志分析器类
 * 负责日志收集、分析、统计和告警
 */
class LogAnalyzer extends EventEmitter {
    constructor() {
        super();
        this.isRunning = false;
        this.logFiles = new Map();
        this.watchers = new Map();
        this.statistics = {
            total: 0,
            byLevel: {
                error: 0,
                warn: 0,
                info: 0,
                debug: 0
            },
            bySource: new Map(),
            byHour: new Map(),
            patterns: new Map(),
            errors: []
        };
        this.patterns = {
            error: [
                /error/i,
                /exception/i,
                /failed/i,
                /timeout/i,
                /connection.*lost/i,
                /unable.*to.*connect/i
            ],
            warning: [
                /warn/i,
                /deprecated/i,
                /slow.*query/i,
                /retry/i,
                /fallback/i
            ],
            performance: [
                /slow/i,
                /timeout/i,
                /high.*cpu/i,
                /memory.*usage/i,
                /gc.*pause/i
            ],
            security: [
                /unauthorized/i,
                /forbidden/i,
                /authentication.*failed/i,
                /invalid.*token/i,
                /suspicious.*activity/i
            ]
        };
        this.alerts = {
            errorThreshold: config.get('logAnalyzer.errorThreshold', 50), // 每分钟错误数阈值
            warningThreshold: config.get('logAnalyzer.warningThreshold', 100), // 每分钟警告数阈值
            timeWindow: config.get('logAnalyzer.timeWindow', 60000), // 1分钟时间窗口
            recentErrors: [],
            recentWarnings: []
        };
        this.analysisInterval = null;
    }

    /**
     * 启动日志分析
     */
    start() {
        if (this.isRunning) {
            logger.warn('Log analyzer is already running');
            return;
        }

        this.isRunning = true;
        
        // 设置日志文件监控
        this.setupLogFileWatching();
        
        // 启动定期分析
        this.startPeriodicAnalysis();
        
        logger.info('Log analyzer started');
        this.emit('started');
    }

    /**
     * 停止日志分析
     */
    stop() {
        if (!this.isRunning) {
            return;
        }

        this.isRunning = false;
        
        // 停止文件监控
        this.stopLogFileWatching();
        
        // 停止定期分析
        this.stopPeriodicAnalysis();
        
        logger.info('Log analyzer stopped');
        this.emit('stopped');
    }

    /**
     * 设置日志文件监控
     */
    setupLogFileWatching() {
        const logDir = config.get('logging.directory', './logs');
        const logFiles = config.get('logAnalyzer.files', [
            'app.log',
            'error.log',
            'access.log',
            'performance.log'
        ]);
        
        logFiles.forEach(filename => {
            const filepath = path.join(logDir, filename);
            this.watchLogFile(filepath);
        });
    }

    /**
     * 监控单个日志文件
     */
    watchLogFile(filepath) {
        if (!fs.existsSync(filepath)) {
            logger.debug(`Log file does not exist: ${filepath}`);
            return;
        }
        
        try {
            const watcher = fs.watch(filepath, (eventType) => {
                if (eventType === 'change') {
                    this.processLogFile(filepath);
                }
            });
            
            this.watchers.set(filepath, watcher);
            
            // 初始处理现有日志
            this.processLogFile(filepath);
            
            logger.debug(`Started watching log file: ${filepath}`);
        } catch (error) {
            logger.error(`Failed to watch log file ${filepath}:`, error);
        }
    }

    /**
     * 停止日志文件监控
     */
    stopLogFileWatching() {
        for (const [filepath, watcher] of this.watchers) {
            try {
                watcher.close();
                logger.debug(`Stopped watching log file: ${filepath}`);
            } catch (error) {
                logger.error(`Failed to stop watching ${filepath}:`, error);
            }
        }
        
        this.watchers.clear();
    }

    /**
     * 处理日志文件
     */
    async processLogFile(filepath) {
        try {
            const fileInfo = this.logFiles.get(filepath) || {
                lastPosition: 0,
                lastModified: 0
            };
            
            const stats = await fs.promises.stat(filepath);
            
            // 检查文件是否有新内容
            if (stats.mtime.getTime() <= fileInfo.lastModified) {
                return;
            }
            
            // 读取新内容
            const newLines = await this.readNewLines(filepath, fileInfo.lastPosition);
            
            // 分析新日志行
            for (const line of newLines) {
                this.analyzeLine(line, filepath);
            }
            
            // 更新文件信息
            this.logFiles.set(filepath, {
                lastPosition: stats.size,
                lastModified: stats.mtime.getTime()
            });
            
        } catch (error) {
            logger.error(`Failed to process log file ${filepath}:`, error);
        }
    }

    /**
     * 读取文件的新行
     */
    async readNewLines(filepath, startPosition) {
        return new Promise((resolve, reject) => {
            const lines = [];
            const stream = fs.createReadStream(filepath, {
                start: startPosition,
                encoding: 'utf8'
            });
            
            const rl = readline.createInterface({
                input: stream,
                crlfDelay: Infinity
            });
            
            rl.on('line', (line) => {
                if (line.trim()) {
                    lines.push(line);
                }
            });
            
            rl.on('close', () => {
                resolve(lines);
            });
            
            rl.on('error', reject);
        });
    }

    /**
     * 分析单行日志
     */
    analyzeLine(line, source) {
        const timestamp = Date.now();
        const hour = new Date().getHours();
        
        // 过滤掉日志分析器自己产生的警告信息，避免循环
        if (line.includes('Log analyzer alert') || line.includes('日志分析器警告')) {
            return;
        }
        
        // 更新统计信息
        this.statistics.total++;
        
        // 按来源统计
        const sourceCount = this.statistics.bySource.get(source) || 0;
        this.statistics.bySource.set(source, sourceCount + 1);
        
        // 按小时统计
        const hourCount = this.statistics.byHour.get(hour) || 0;
        this.statistics.byHour.set(hour, hourCount + 1);
        
        // 解析日志级别
        const level = this.parseLogLevel(line);
        if (level && this.statistics.byLevel[level] !== undefined) {
            this.statistics.byLevel[level]++;
        }
        
        // 模式匹配分析
        this.analyzePatterns(line, timestamp, source);
        
        // 错误和警告检测
        this.checkForAlertsConditions(line, level, timestamp);
        
        this.emit('lineAnalyzed', {
            line,
            source,
            level,
            timestamp,
            patterns: this.matchPatterns(line)
        });
    }

    /**
     * 解析日志级别
     */
    parseLogLevel(line) {
        const lowerLine = line.toLowerCase();
        
        if (lowerLine.includes('error') || lowerLine.includes('err')) {
            return 'error';
        } else if (lowerLine.includes('warn') || lowerLine.includes('warning')) {
            return 'warn';
        } else if (lowerLine.includes('info')) {
            return 'info';
        } else if (lowerLine.includes('debug')) {
            return 'debug';
        }
        
        return null;
    }

    /**
     * 分析模式匹配
     */
    analyzePatterns(line, timestamp, source) {
        for (const [category, patterns] of Object.entries(this.patterns)) {
            for (const pattern of patterns) {
                if (pattern.test(line)) {
                    const key = `${category}:${pattern.source}`;
                    const count = this.statistics.patterns.get(key) || 0;
                    this.statistics.patterns.set(key, count + 1);
                    
                    this.emit('patternMatched', {
                        category,
                        pattern: pattern.source,
                        line,
                        source,
                        timestamp
                    });
                }
            }
        }
    }

    /**
     * 匹配模式
     */
    matchPatterns(line) {
        const matches = [];
        
        for (const [category, patterns] of Object.entries(this.patterns)) {
            for (const pattern of patterns) {
                if (pattern.test(line)) {
                    matches.push({
                        category,
                        pattern: pattern.source
                    });
                }
            }
        }
        
        return matches;
    }

    /**
     * 检查告警条件
     */
    checkForAlertsConditions(line, level, timestamp) {
        const now = timestamp;
        const windowStart = now - this.alerts.timeWindow;
        
        // 清理过期的记录
        this.alerts.recentErrors = this.alerts.recentErrors.filter(t => t > windowStart);
        this.alerts.recentWarnings = this.alerts.recentWarnings.filter(t => t > windowStart);
        
        // 记录新的错误和警告
        if (level === 'error') {
            this.alerts.recentErrors.push(now);
            
            // 记录错误详情
            this.statistics.errors.push({
                line,
                timestamp,
                level
            });
            
            // 只保留最近的错误
            if (this.statistics.errors.length > 1000) {
                this.statistics.errors = this.statistics.errors.slice(-1000);
            }
            
            // 检查错误阈值
            if (this.alerts.recentErrors.length >= this.alerts.errorThreshold) {
                this.triggerAlert('error_threshold', {
                    count: this.alerts.recentErrors.length,
                    threshold: this.alerts.errorThreshold,
                    timeWindow: this.alerts.timeWindow / 1000,
                    recentErrors: this.statistics.errors.slice(-5)
                });
            }
        } else if (level === 'warn') {
            this.alerts.recentWarnings.push(now);
            
            // 检查警告阈值
            if (this.alerts.recentWarnings.length >= this.alerts.warningThreshold) {
                this.triggerAlert('warning_threshold', {
                    count: this.alerts.recentWarnings.length,
                    threshold: this.alerts.warningThreshold,
                    timeWindow: this.alerts.timeWindow / 1000
                });
            }
        }
    }

    /**
     * 触发告警
     */
    triggerAlert(type, data) {
        const alert = {
            type,
            timestamp: Date.now(),
            data
        };
        
        // 只发出事件，不通过logger输出，避免循环
        this.emit('alert', alert);
    }

    /**
     * 启动定期分析
     */
    startPeriodicAnalysis() {
        const interval = config.get('logAnalyzer.analysisInterval', 300000); // 5分钟
        
        this.analysisInterval = setInterval(() => {
            this.performPeriodicAnalysis();
        }, interval);
    }

    /**
     * 停止定期分析
     */
    stopPeriodicAnalysis() {
        if (this.analysisInterval) {
            clearInterval(this.analysisInterval);
            this.analysisInterval = null;
        }
    }

    /**
     * 执行定期分析
     */
    performPeriodicAnalysis() {
        try {
            const analysis = this.generateAnalysis();
            this.emit('periodicAnalysis', analysis);
            
            // 检查异常模式
            this.detectAnomalies(analysis);
            
        } catch (error) {
            logger.error('Failed to perform periodic analysis:', error);
        }
    }

    /**
     * 生成分析报告
     */
    generateAnalysis() {
        const now = Date.now();
        const oneHourAgo = now - 3600000;
        
        // 计算错误率
        const recentErrors = this.statistics.errors.filter(e => e.timestamp > oneHourAgo);
        const errorRate = this.statistics.total > 0 ? (recentErrors.length / this.statistics.total) * 100 : 0;
        
        // 最活跃的模式
        const topPatterns = Array.from(this.statistics.patterns.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([pattern, count]) => ({ pattern, count }));
        
        // 按来源统计
        const sourceStats = Array.from(this.statistics.bySource.entries())
            .map(([source, count]) => ({ source, count }))
            .sort((a, b) => b.count - a.count);
        
        return {
            timestamp: now,
            period: {
                start: oneHourAgo,
                end: now
            },
            summary: {
                totalLines: this.statistics.total,
                errorRate: errorRate.toFixed(2),
                recentErrors: recentErrors.length,
                topPatterns,
                sourceStats
            },
            levels: { ...this.statistics.byLevel },
            hourlyDistribution: Object.fromEntries(this.statistics.byHour),
            alerts: {
                recentErrorCount: this.alerts.recentErrors.length,
                recentWarningCount: this.alerts.recentWarnings.length
            }
        };
    }

    /**
     * 检测异常模式
     */
    detectAnomalies(analysis) {
        const anomalies = [];
        
        // 检测错误率异常
        if (parseFloat(analysis.summary.errorRate) > 5) {
            anomalies.push({
                type: 'high_error_rate',
                severity: 'high',
                message: `Error rate is ${analysis.summary.errorRate}%`,
                data: { errorRate: analysis.summary.errorRate }
            });
        }
        
        // 检测日志量异常
        const avgHourlyLogs = analysis.summary.totalLines / 24;
        const currentHour = new Date().getHours();
        const currentHourLogs = analysis.hourlyDistribution[currentHour] || 0;
        
        if (currentHourLogs > avgHourlyLogs * 3) {
            anomalies.push({
                type: 'log_volume_spike',
                severity: 'medium',
                message: `Log volume spike detected: ${currentHourLogs} logs this hour vs ${avgHourlyLogs.toFixed(0)} average`,
                data: { current: currentHourLogs, average: avgHourlyLogs }
            });
        }
        
        // 检测新的错误模式
        const recentPatterns = analysis.summary.topPatterns.filter(p => p.pattern.includes('error'));
        if (recentPatterns.length > 0) {
            const topErrorPattern = recentPatterns[0];
            if (topErrorPattern.count > 10) {
                anomalies.push({
                    type: 'recurring_error_pattern',
                    severity: 'medium',
                    message: `Recurring error pattern detected: ${topErrorPattern.pattern}`,
                    data: topErrorPattern
                });
            }
        }
        
        // 发送异常告警
        anomalies.forEach(anomaly => {
            this.emit('anomaly', anomaly);
            logger.warn(`Log anomaly detected [${anomaly.type}]: ${anomaly.message}`);
        });
        
        return anomalies;
    }

    /**
     * 搜索日志
     */
    async searchLogs(query, options = {}) {
        const {
            startTime = Date.now() - 86400000, // 默认24小时
            endTime = Date.now(),
            level = null,
            source = null,
            limit = 100
        } = options;
        
        const results = [];
        const regex = new RegExp(query, 'i');
        
        // 搜索错误记录
        const filteredErrors = this.statistics.errors.filter(error => {
            if (error.timestamp < startTime || error.timestamp > endTime) {
                return false;
            }
            
            if (level && error.level !== level) {
                return false;
            }
            
            return regex.test(error.line);
        });
        
        return filteredErrors.slice(0, limit);
    }

    /**
     * 获取统计信息
     */
    getStatistics() {
        return {
            ...this.statistics,
            bySource: Object.fromEntries(this.statistics.bySource),
            byHour: Object.fromEntries(this.statistics.byHour),
            patterns: Object.fromEntries(this.statistics.patterns)
        };
    }

    /**
     * 重置统计信息
     */
    resetStatistics() {
        this.statistics = {
            total: 0,
            byLevel: {
                error: 0,
                warn: 0,
                info: 0,
                debug: 0
            },
            bySource: new Map(),
            byHour: new Map(),
            patterns: new Map(),
            errors: []
        };
        
        this.alerts.recentErrors = [];
        this.alerts.recentWarnings = [];
        
        logger.info('Log analyzer statistics reset');
    }

    /**
     * 添加自定义模式
     */
    addPattern(category, pattern) {
        if (!this.patterns[category]) {
            this.patterns[category] = [];
        }
        
        const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;
        this.patterns[category].push(regex);
        
        logger.info(`Added pattern to category ${category}: ${regex.source}`);
    }

    /**
     * 移除自定义模式
     */
    removePattern(category, patternSource) {
        if (!this.patterns[category]) {
            return false;
        }
        
        const index = this.patterns[category].findIndex(p => p.source === patternSource);
        if (index !== -1) {
            this.patterns[category].splice(index, 1);
            logger.info(`Removed pattern from category ${category}: ${patternSource}`);
            return true;
        }
        
        return false;
    }

    /**
     * 设置告警阈值
     */
    setAlertThresholds(thresholds) {
        this.alerts = { ...this.alerts, ...thresholds };
        logger.info('Alert thresholds updated:', thresholds);
    }

    /**
     * 生成日志分析报告
     */
    generateReport() {
        const analysis = this.generateAnalysis();
        const statistics = this.getStatistics();
        
        return {
            timestamp: Date.now(),
            analysis,
            statistics,
            configuration: {
                patterns: Object.keys(this.patterns),
                alerts: this.alerts,
                watchedFiles: Array.from(this.watchers.keys())
            },
            health: {
                isRunning: this.isRunning,
                watchedFiles: this.watchers.size,
                totalLinesProcessed: this.statistics.total,
                recentErrorRate: analysis.summary.errorRate
            }
        };
    }
}

// 创建单例实例
const logAnalyzer = new LogAnalyzer();

module.exports = logAnalyzer;