const EventEmitter = require('events');
const v8 = require('v8');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const config = require('../utils/config');

/**
 * 性能分析器类
 * 负责代码性能分析、内存泄漏检测和性能优化
 */
class Profiler extends EventEmitter {
    constructor() {
        super();
        this.isRunning = false;
        this.profiles = new Map();
        this.memorySnapshots = [];
        this.performanceMarks = new Map();
        this.gcStats = {
            collections: 0,
            totalTime: 0,
            averageTime: 0,
            lastCollection: null
        };
        this.leakDetection = {
            enabled: false,
            threshold: 50 * 1024 * 1024, // 50MB
            checkInterval: 60000, // 1分钟
            intervalId: null
        };
        
        this.setupGCMonitoring();
    }

    /**
     * 设置垃圾回收监控
     */
    setupGCMonitoring() {
        if (global.gc) {
            // 如果启用了 --expose-gc 标志
            const originalGC = global.gc;
            global.gc = () => {
                const start = process.hrtime.bigint();
                originalGC();
                const end = process.hrtime.bigint();
                
                const duration = Number(end - start) / 1000000; // 转换为毫秒
                this.recordGCEvent(duration);
            };
        }
    }

    /**
     * 记录垃圾回收事件
     */
    recordGCEvent(duration) {
        this.gcStats.collections++;
        this.gcStats.totalTime += duration;
        this.gcStats.averageTime = this.gcStats.totalTime / this.gcStats.collections;
        this.gcStats.lastCollection = Date.now();
        
        this.emit('gcEvent', {
            duration,
            totalCollections: this.gcStats.collections,
            averageTime: this.gcStats.averageTime
        });
        
        if (duration > 100) { // 如果GC时间超过100ms
            logger.warn(`Long GC pause detected: ${duration.toFixed(2)}ms`);
        }
    }

    /**
     * 启动性能分析
     */
    start() {
        if (this.isRunning) {
            logger.warn('Profiler is already running');
            return;
        }

        this.isRunning = true;
        
        // 启用内存泄漏检测
        if (config.get('profiler.memoryLeakDetection', true)) {
            this.enableMemoryLeakDetection();
        }
        
        logger.info('Profiler started');
        this.emit('started');
    }

    /**
     * 停止性能分析
     */
    stop() {
        if (!this.isRunning) {
            return;
        }

        this.isRunning = false;
        
        // 停止内存泄漏检测
        this.disableMemoryLeakDetection();
        
        logger.info('Profiler stopped');
        this.emit('stopped');
    }

    /**
     * 启用内存泄漏检测
     */
    enableMemoryLeakDetection() {
        if (this.leakDetection.enabled) {
            return;
        }

        this.leakDetection.enabled = true;
        this.leakDetection.intervalId = setInterval(() => {
            this.checkMemoryLeak();
        }, this.leakDetection.checkInterval);
        
        logger.info('Memory leak detection enabled');
    }

    /**
     * 禁用内存泄漏检测
     */
    disableMemoryLeakDetection() {
        if (!this.leakDetection.enabled) {
            return;
        }

        this.leakDetection.enabled = false;
        
        if (this.leakDetection.intervalId) {
            clearInterval(this.leakDetection.intervalId);
            this.leakDetection.intervalId = null;
        }
        
        logger.info('Memory leak detection disabled');
    }

    /**
     * 检查内存泄漏
     */
    checkMemoryLeak() {
        const memUsage = process.memoryUsage();
        const snapshot = {
            timestamp: Date.now(),
            rss: memUsage.rss,
            heapUsed: memUsage.heapUsed,
            heapTotal: memUsage.heapTotal,
            external: memUsage.external
        };
        
        this.memorySnapshots.push(snapshot);
        
        // 只保留最近的快照
        if (this.memorySnapshots.length > 100) {
            this.memorySnapshots = this.memorySnapshots.slice(-100);
        }
        
        // 检查内存增长趋势
        if (this.memorySnapshots.length >= 10) {
            const recent = this.memorySnapshots.slice(-10);
            const growth = this.analyzeMemoryGrowth(recent);
            
            if (growth.isLeaking) {
                this.emit('memoryLeak', {
                    growth: growth.rate,
                    current: memUsage.heapUsed,
                    threshold: this.leakDetection.threshold,
                    snapshots: recent
                });
                
                logger.warn(`Potential memory leak detected. Growth rate: ${growth.rate.toFixed(2)} MB/min`);
            }
        }
    }

    /**
     * 分析内存增长趋势
     */
    analyzeMemoryGrowth(snapshots) {
        if (snapshots.length < 2) {
            return { isLeaking: false, rate: 0 };
        }
        
        const first = snapshots[0];
        const last = snapshots[snapshots.length - 1];
        
        const timeDiff = (last.timestamp - first.timestamp) / 1000 / 60; // 分钟
        const memoryDiff = (last.heapUsed - first.heapUsed) / 1024 / 1024; // MB
        
        const growthRate = memoryDiff / timeDiff; // MB/min
        
        // 如果内存增长率超过阈值，认为可能存在内存泄漏
        const isLeaking = growthRate > 5 && last.heapUsed > this.leakDetection.threshold;
        
        return {
            isLeaking,
            rate: growthRate
        };
    }

    /**
     * 开始性能标记
     */
    mark(name) {
        const mark = {
            name,
            startTime: process.hrtime.bigint(),
            startMemory: process.memoryUsage(),
            startCpu: process.cpuUsage()
        };
        
        this.performanceMarks.set(name, mark);
        return mark;
    }

    /**
     * 结束性能标记并计算指标
     */
    measure(name) {
        const mark = this.performanceMarks.get(name);
        if (!mark) {
            throw new Error(`Performance mark '${name}' not found`);
        }
        
        const endTime = process.hrtime.bigint();
        const endMemory = process.memoryUsage();
        const endCpu = process.cpuUsage(mark.startCpu);
        
        const measurement = {
            name,
            duration: Number(endTime - mark.startTime) / 1000000, // 毫秒
            memoryDelta: {
                rss: endMemory.rss - mark.startMemory.rss,
                heapUsed: endMemory.heapUsed - mark.startMemory.heapUsed,
                heapTotal: endMemory.heapTotal - mark.startMemory.heapTotal,
                external: endMemory.external - mark.startMemory.external
            },
            cpuDelta: {
                user: endCpu.user / 1000, // 毫秒
                system: endCpu.system / 1000 // 毫秒
            },
            timestamp: Date.now()
        };
        
        this.performanceMarks.delete(name);
        
        // 存储测量结果
        if (!this.profiles.has(name)) {
            this.profiles.set(name, []);
        }
        
        const profile = this.profiles.get(name);
        profile.push(measurement);
        
        // 限制存储的测量结果数量
        if (profile.length > 1000) {
            profile.splice(0, profile.length - 1000);
        }
        
        this.emit('measurement', measurement);
        
        return measurement;
    }

    /**
     * 创建CPU性能分析
     */
    startCPUProfile(name = 'default') {
        if (!v8.startProfiling) {
            throw new Error('CPU profiling not available. Start Node.js with --prof flag.');
        }
        
        v8.startProfiling(name, true);
        logger.info(`CPU profiling started: ${name}`);
        
        return name;
    }

    /**
     * 停止CPU性能分析
     */
    stopCPUProfile(name = 'default') {
        if (!v8.stopProfiling) {
            throw new Error('CPU profiling not available.');
        }
        
        const profile = v8.stopProfiling(name);
        logger.info(`CPU profiling stopped: ${name}`);
        
        return profile;
    }

    /**
     * 创建堆快照
     */
    takeHeapSnapshot() {
        const snapshot = v8.getHeapSnapshot();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `heap-${timestamp}.heapsnapshot`;
        const filepath = path.join(process.cwd(), 'logs', 'profiles', filename);
        
        // 确保目录存在
        const dir = path.dirname(filepath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        const writeStream = fs.createWriteStream(filepath);
        snapshot.pipe(writeStream);
        
        return new Promise((resolve, reject) => {
            writeStream.on('finish', () => {
                logger.info(`Heap snapshot saved: ${filepath}`);
                resolve(filepath);
            });
            
            writeStream.on('error', reject);
        });
    }

    /**
     * 获取堆统计信息
     */
    getHeapStatistics() {
        return v8.getHeapStatistics();
    }

    /**
     * 获取堆空间统计信息
     */
    getHeapSpaceStatistics() {
        return v8.getHeapSpaceStatistics();
    }

    /**
     * 分析性能数据
     */
    analyzePerformance(name) {
        const profile = this.profiles.get(name);
        if (!profile || profile.length === 0) {
            return null;
        }
        
        const measurements = profile.slice();
        const count = measurements.length;
        
        // 计算统计信息
        const durations = measurements.map(m => m.duration);
        const memoryUsages = measurements.map(m => m.memoryDelta.heapUsed);
        const cpuUsages = measurements.map(m => m.cpuDelta.user + m.cpuDelta.system);
        
        const analysis = {
            name,
            count,
            duration: {
                min: Math.min(...durations),
                max: Math.max(...durations),
                avg: durations.reduce((a, b) => a + b, 0) / count,
                median: this.calculateMedian(durations),
                p95: this.calculatePercentile(durations, 95),
                p99: this.calculatePercentile(durations, 99)
            },
            memory: {
                min: Math.min(...memoryUsages),
                max: Math.max(...memoryUsages),
                avg: memoryUsages.reduce((a, b) => a + b, 0) / count,
                median: this.calculateMedian(memoryUsages)
            },
            cpu: {
                min: Math.min(...cpuUsages),
                max: Math.max(...cpuUsages),
                avg: cpuUsages.reduce((a, b) => a + b, 0) / count,
                median: this.calculateMedian(cpuUsages)
            },
            trends: this.analyzeTrends(measurements),
            recommendations: this.generateRecommendations(measurements)
        };
        
        return analysis;
    }

    /**
     * 计算中位数
     */
    calculateMedian(values) {
        const sorted = values.slice().sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        
        if (sorted.length % 2 === 0) {
            return (sorted[mid - 1] + sorted[mid]) / 2;
        } else {
            return sorted[mid];
        }
    }

    /**
     * 计算百分位数
     */
    calculatePercentile(values, percentile) {
        const sorted = values.slice().sort((a, b) => a - b);
        const index = Math.ceil((percentile / 100) * sorted.length) - 1;
        return sorted[Math.max(0, index)];
    }

    /**
     * 分析趋势
     */
    analyzeTrends(measurements) {
        if (measurements.length < 10) {
            return { insufficient_data: true };
        }
        
        const recent = measurements.slice(-10);
        const older = measurements.slice(-20, -10);
        
        if (older.length === 0) {
            return { insufficient_data: true };
        }
        
        const recentAvgDuration = recent.reduce((a, b) => a + b.duration, 0) / recent.length;
        const olderAvgDuration = older.reduce((a, b) => a + b.duration, 0) / older.length;
        
        const recentAvgMemory = recent.reduce((a, b) => a + b.memoryDelta.heapUsed, 0) / recent.length;
        const olderAvgMemory = older.reduce((a, b) => a + b.memoryDelta.heapUsed, 0) / older.length;
        
        return {
            duration: {
                trend: recentAvgDuration > olderAvgDuration ? 'increasing' : 'decreasing',
                change: ((recentAvgDuration - olderAvgDuration) / olderAvgDuration) * 100
            },
            memory: {
                trend: recentAvgMemory > olderAvgMemory ? 'increasing' : 'decreasing',
                change: olderAvgMemory !== 0 ? ((recentAvgMemory - olderAvgMemory) / Math.abs(olderAvgMemory)) * 100 : 0
            }
        };
    }

    /**
     * 生成优化建议
     */
    generateRecommendations(measurements) {
        const recommendations = [];
        
        if (measurements.length === 0) {
            return recommendations;
        }
        
        const avgDuration = measurements.reduce((a, b) => a + b.duration, 0) / measurements.length;
        const avgMemory = measurements.reduce((a, b) => a + b.memoryDelta.heapUsed, 0) / measurements.length;
        
        // 性能建议
        if (avgDuration > 1000) {
            recommendations.push({
                type: 'performance',
                severity: 'high',
                message: 'Average execution time is over 1 second. Consider optimization.',
                suggestion: 'Profile the code to identify bottlenecks and optimize critical paths.'
            });
        } else if (avgDuration > 500) {
            recommendations.push({
                type: 'performance',
                severity: 'medium',
                message: 'Average execution time is over 500ms. Room for improvement.',
                suggestion: 'Review algorithm efficiency and consider caching strategies.'
            });
        }
        
        // 内存建议
        if (avgMemory > 10 * 1024 * 1024) { // 10MB
            recommendations.push({
                type: 'memory',
                severity: 'high',
                message: 'High memory usage detected. Potential memory leak.',
                suggestion: 'Review object lifecycle and ensure proper cleanup of resources.'
            });
        } else if (avgMemory > 5 * 1024 * 1024) { // 5MB
            recommendations.push({
                type: 'memory',
                severity: 'medium',
                message: 'Moderate memory usage. Monitor for growth.',
                suggestion: 'Consider object pooling or more efficient data structures.'
            });
        }
        
        // 变异性建议
        const durations = measurements.map(m => m.duration);
        const variance = this.calculateVariance(durations);
        const stdDev = Math.sqrt(variance);
        
        if (stdDev > avgDuration * 0.5) {
            recommendations.push({
                type: 'consistency',
                severity: 'medium',
                message: 'High performance variance detected.',
                suggestion: 'Investigate causes of performance inconsistency. Consider load balancing or resource pooling.'
            });
        }
        
        return recommendations;
    }

    /**
     * 计算方差
     */
    calculateVariance(values) {
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const squaredDiffs = values.map(value => Math.pow(value - mean, 2));
        return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
    }

    /**
     * 获取所有性能分析结果
     */
    getAllProfiles() {
        const result = {};
        
        for (const [name, profile] of this.profiles) {
            result[name] = this.analyzePerformance(name);
        }
        
        return result;
    }

    /**
     * 清除性能数据
     */
    clearProfiles(name = null) {
        if (name) {
            this.profiles.delete(name);
            logger.info(`Cleared profile data for: ${name}`);
        } else {
            this.profiles.clear();
            logger.info('Cleared all profile data');
        }
    }

    /**
     * 获取垃圾回收统计信息
     */
    getGCStats() {
        return { ...this.gcStats };
    }

    /**
     * 获取内存快照历史
     */
    getMemorySnapshots(limit = null) {
        return limit ? this.memorySnapshots.slice(-limit) : this.memorySnapshots.slice();
    }

    /**
     * 生成性能报告
     */
    generateReport() {
        const profiles = this.getAllProfiles();
        const heapStats = this.getHeapStatistics();
        const gcStats = this.getGCStats();
        const memorySnapshots = this.getMemorySnapshots(10);
        
        return {
            timestamp: Date.now(),
            profiles,
            heap: heapStats,
            gc: gcStats,
            memory: {
                snapshots: memorySnapshots,
                leakDetection: {
                    enabled: this.leakDetection.enabled,
                    threshold: this.leakDetection.threshold
                }
            },
            summary: {
                totalProfiles: this.profiles.size,
                activeMarks: this.performanceMarks.size,
                memorySnapshots: this.memorySnapshots.length,
                gcCollections: gcStats.collections
            }
        };
    }
}

// 创建单例实例
const profiler = new Profiler();

module.exports = profiler;