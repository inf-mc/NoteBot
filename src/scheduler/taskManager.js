const EventEmitter = require('events');
const logger = require('../utils/logger').module('TaskManager');

/**
 * 任务管理器 - 提供任务注册和管理的便捷接口
 */
class TaskManager extends EventEmitter {
  constructor(scheduler) {
    super();
    
    this.scheduler = scheduler;
    this.pluginTasks = new Map(); // 插件任务映射
    this.taskTemplates = new Map(); // 任务模板
    
    this.init();
  }

  /**
   * 初始化
   */
  init() {
    // 监听调度器事件
    this.scheduler.on('task_completed', (data) => {
      this.emit('task_completed', data);
    });
    
    this.scheduler.on('task_failed', (data) => {
      this.emit('task_failed', data);
    });
    
    this.scheduler.on('task_started', (data) => {
      this.emit('task_started', data);
    });
    
    // 注册内置任务模板
    this.registerBuiltinTemplates();
  }

  /**
   * 注册内置任务模板
   */
  registerBuiltinTemplates() {
    // 数据清理任务模板
    this.registerTemplate('cleanup', {
      name: '数据清理任务',
      description: '定期清理过期数据',
      defaultCron: '0 2 * * *', // 每天凌晨2点
      defaultOptions: {
        timeout: 600000, // 10分钟
        retryAttempts: 2
      },
      handler: async (context) => {
        const { logger, redis } = context;
        
        logger.info('开始执行数据清理任务');
        
        // 清理过期的会话数据
        const sessionKeys = await redis.keys('session:*');
        let cleanedSessions = 0;
        
        for (const key of sessionKeys) {
          const ttl = await redis.ttl(key);
          if (ttl === -1) { // 没有过期时间的key
            await redis.expire(key, 86400); // 设置24小时过期
            cleanedSessions++;
          }
        }
        
        // 清理过期的缓存数据
        const cacheKeys = await redis.keys('cache:*');
        let cleanedCache = 0;
        
        for (const key of cacheKeys) {
          const data = await redis.get(key);
          if (data && data.expiredAt && Date.now() > data.expiredAt) {
            await redis.del(key);
            cleanedCache++;
          }
        }
        
        const result = {
          cleanedSessions,
          cleanedCache,
          totalCleaned: cleanedSessions + cleanedCache
        };
        
        logger.info('数据清理任务完成:', result);
        return result;
      }
    });
    
    // 系统监控任务模板
    this.registerTemplate('monitor', {
      name: '系统监控任务',
      description: '监控系统状态和性能',
      defaultCron: '*/5 * * * *', // 每5分钟
      defaultOptions: {
        timeout: 30000, // 30秒
        retryAttempts: 1
      },
      handler: async (context) => {
        const { logger, redis } = context;
        
        logger.debug('执行系统监控检查');
        
        const stats = {
          timestamp: Date.now(),
          memory: process.memoryUsage(),
          uptime: process.uptime(),
          cpu: process.cpuUsage()
        };
        
        // 检查 Redis 连接
        try {
          await redis.ping();
          stats.redis = { status: 'connected' };
        } catch (error) {
          stats.redis = { status: 'disconnected', error: error.message };
          logger.error('Redis 连接检查失败:', error);
        }
        
        // 保存监控数据
        await redis.lpush('monitor:stats', stats);
        await redis.ltrim('monitor:stats', 0, 100); // 保留最近100条记录
        
        // 检查内存使用率
        const memoryUsage = stats.memory.heapUsed / stats.memory.heapTotal;
        if (memoryUsage > 0.9) {
          logger.warn(`内存使用率过高: ${(memoryUsage * 100).toFixed(2)}%`);
        }
        
        return stats;
      }
    });
    
    // 备份任务模板
    this.registerTemplate('backup', {
      name: '数据备份任务',
      description: '定期备份重要数据',
      defaultCron: '0 3 * * 0', // 每周日凌晨3点
      defaultOptions: {
        timeout: 1800000, // 30分钟
        retryAttempts: 2
      },
      handler: async (context) => {
        const { logger, redis, config } = context;
        
        logger.info('开始执行数据备份任务');
        
        const backupData = {
          timestamp: Date.now(),
          version: config.version || '1.0.0',
          data: {}
        };
        
        // 备份配置数据
        const configKeys = await redis.keys('config:*');
        for (const key of configKeys) {
          backupData.data[key] = await redis.get(key);
        }
        
        // 备份插件数据
        const pluginKeys = await redis.keys('plugin:*');
        for (const key of pluginKeys) {
          backupData.data[key] = await redis.get(key);
        }
        
        // 保存备份
        const backupKey = `backup:${new Date().toISOString().split('T')[0]}`;
        await redis.set(backupKey, backupData, 7 * 24 * 60 * 60); // 保存7天
        
        // 清理旧备份
        const backupKeys = await redis.keys('backup:*');
        const sortedKeys = backupKeys.sort().reverse();
        
        // 保留最近10个备份
        if (sortedKeys.length > 10) {
          const keysToDelete = sortedKeys.slice(10);
          for (const key of keysToDelete) {
            await redis.del(key);
          }
        }
        
        const result = {
          backupKey,
          dataCount: Object.keys(backupData.data).length,
          size: JSON.stringify(backupData).length
        };
        
        logger.info('数据备份任务完成:', result);
        return result;
      }
    });
  }

  /**
   * 注册任务模板
   */
  registerTemplate(templateId, template) {
    this.taskTemplates.set(templateId, {
      id: templateId,
      ...template,
      createdAt: Date.now()
    });
    
    logger.debug(`注册任务模板: ${templateId}`);
  }

  /**
   * 获取任务模板
   */
  getTemplate(templateId) {
    return this.taskTemplates.get(templateId);
  }

  /**
   * 获取所有模板
   */
  getTemplates() {
    return Array.from(this.taskTemplates.values());
  }

  /**
   * 使用模板创建任务
   */
  async createFromTemplate(templateId, taskId, options = {}) {
    const template = this.getTemplate(templateId);
    if (!template) {
      throw new Error(`任务模板不存在: ${templateId}`);
    }
    
    const taskOptions = {
      ...template.defaultOptions,
      ...options,
      name: options.name || template.name,
      description: options.description || template.description
    };
    
    const cronExpression = options.cron || template.defaultCron;
    
    return await this.scheduler.register(
      taskId,
      cronExpression,
      template.handler,
      taskOptions
    );
  }

  /**
   * 为插件注册任务
   */
  async registerPluginTask(pluginName, taskId, cronExpression, handler, options = {}) {
    const fullTaskId = `${pluginName}:${taskId}`;
    
    const taskOptions = {
      ...options,
      plugin: pluginName
    };
    
    const registeredTaskId = await this.scheduler.register(
      fullTaskId,
      cronExpression,
      handler,
      taskOptions
    );
    
    // 记录插件任务
    if (!this.pluginTasks.has(pluginName)) {
      this.pluginTasks.set(pluginName, new Set());
    }
    this.pluginTasks.get(pluginName).add(fullTaskId);
    
    logger.info(`插件任务注册成功: ${pluginName} -> ${taskId}`);
    
    return registeredTaskId;
  }

  /**
   * 取消插件任务
   */
  async unregisterPluginTask(pluginName, taskId) {
    const fullTaskId = `${pluginName}:${taskId}`;
    
    const result = await this.scheduler.unregister(fullTaskId);
    
    // 从插件任务记录中移除
    const pluginTaskSet = this.pluginTasks.get(pluginName);
    if (pluginTaskSet) {
      pluginTaskSet.delete(fullTaskId);
      
      if (pluginTaskSet.size === 0) {
        this.pluginTasks.delete(pluginName);
      }
    }
    
    logger.info(`插件任务取消注册: ${pluginName} -> ${taskId}`);
    
    return result;
  }

  /**
   * 清理插件所有任务
   */
  async clearPluginTasks(pluginName) {
    const pluginTaskSet = this.pluginTasks.get(pluginName);
    if (!pluginTaskSet) {
      return 0;
    }
    
    let clearedCount = 0;
    
    for (const taskId of pluginTaskSet) {
      try {
        await this.scheduler.unregister(taskId);
        clearedCount++;
      } catch (error) {
        logger.error(`清理插件任务失败 [${taskId}]:`, error);
      }
    }
    
    this.pluginTasks.delete(pluginName);
    
    logger.info(`清理插件任务完成: ${pluginName} (${clearedCount} 个)`);
    
    return clearedCount;
  }

  /**
   * 获取插件任务列表
   */
  getPluginTasks(pluginName) {
    const pluginTaskSet = this.pluginTasks.get(pluginName);
    if (!pluginTaskSet) {
      return [];
    }
    
    const tasks = [];
    const allTasks = this.scheduler.getTaskList();
    
    for (const task of allTasks) {
      if (pluginTaskSet.has(task.id)) {
        tasks.push(task);
      }
    }
    
    return tasks;
  }

  /**
   * 批量操作任务
   */
  async batchOperation(taskIds, operation) {
    const results = [];
    
    for (const taskId of taskIds) {
      try {
        let result;
        
        switch (operation) {
          case 'enable':
            await this.scheduler.enableTask(taskId);
            result = { taskId, status: 'enabled' };
            break;
            
          case 'disable':
            await this.scheduler.disableTask(taskId);
            result = { taskId, status: 'disabled' };
            break;
            
          case 'run':
            await this.scheduler.runTask(taskId);
            result = { taskId, status: 'executed' };
            break;
            
          case 'unregister':
            await this.scheduler.unregister(taskId);
            result = { taskId, status: 'unregistered' };
            break;
            
          default:
            throw new Error(`不支持的操作: ${operation}`);
        }
        
        results.push(result);
        
      } catch (error) {
        results.push({
          taskId,
          status: 'error',
          error: error.message
        });
      }
    }
    
    return results;
  }

  /**
   * 搜索任务
   */
  searchTasks(query) {
    const allTasks = this.scheduler.getTaskList();
    const lowerQuery = query.toLowerCase();
    
    return allTasks.filter(task => {
      return task.name.toLowerCase().includes(lowerQuery) ||
             task.description.toLowerCase().includes(lowerQuery) ||
             task.plugin.toLowerCase().includes(lowerQuery) ||
             task.id.toLowerCase().includes(lowerQuery);
    });
  }

  /**
   * 获取任务统计信息
   */
  getTaskStats() {
    const allTasks = this.scheduler.getTaskList();
    const runningTasks = this.scheduler.getRunningTasks();
    
    const stats = {
      total: allTasks.length,
      enabled: allTasks.filter(t => t.enabled).length,
      disabled: allTasks.filter(t => !t.enabled).length,
      running: runningTasks.length,
      byPlugin: {},
      byStatus: {
        success: 0,
        failed: 0,
        total: 0
      }
    };
    
    // 按插件统计
    for (const task of allTasks) {
      if (!stats.byPlugin[task.plugin]) {
        stats.byPlugin[task.plugin] = {
          total: 0,
          enabled: 0,
          disabled: 0
        };
      }
      
      stats.byPlugin[task.plugin].total++;
      
      if (task.enabled) {
        stats.byPlugin[task.plugin].enabled++;
      } else {
        stats.byPlugin[task.plugin].disabled++;
      }
      
      // 执行状态统计
      stats.byStatus.success += task.successCount;
      stats.byStatus.failed += task.failureCount;
      stats.byStatus.total += task.runCount;
    }
    
    return stats;
  }

  /**
   * 导出任务配置
   */
  exportTasks(pluginName = null) {
    const allTasks = this.scheduler.getTaskList();
    const tasksToExport = pluginName ? 
      allTasks.filter(t => t.plugin === pluginName) : 
      allTasks;
    
    const exportData = {
      version: '1.0.0',
      exportTime: Date.now(),
      plugin: pluginName,
      tasks: tasksToExport.map(task => ({
        id: task.id,
        name: task.name,
        description: task.description,
        cron: task.cron,
        plugin: task.plugin,
        enabled: task.enabled,
        options: this.scheduler.getTaskDetails(task.id)?.options || {}
      }))
    };
    
    return exportData;
  }

  /**
   * 导入任务配置
   */
  async importTasks(importData, options = {}) {
    const { overwrite = false, skipExisting = true } = options;
    
    if (!importData.tasks || !Array.isArray(importData.tasks)) {
      throw new Error('无效的导入数据格式');
    }
    
    const results = [];
    
    for (const taskConfig of importData.tasks) {
      try {
        const existingTask = this.scheduler.getTaskDetails(taskConfig.id);
        
        if (existingTask) {
          if (skipExisting) {
            results.push({
              taskId: taskConfig.id,
              status: 'skipped',
              reason: 'Task already exists'
            });
            continue;
          }
          
          if (overwrite) {
            await this.scheduler.unregister(taskConfig.id);
          } else {
            throw new Error('Task already exists');
          }
        }
        
        // 注意：这里无法导入处理器函数，需要插件重新注册
        results.push({
          taskId: taskConfig.id,
          status: 'imported',
          config: taskConfig
        });
        
      } catch (error) {
        results.push({
          taskId: taskConfig.id,
          status: 'error',
          error: error.message
        });
      }
    }
    
    return results;
  }

  /**
   * 获取任务执行历史
   */
  getTaskHistory(taskId, limit = 50) {
    const task = this.scheduler.getTaskDetails(taskId);
    if (!task) {
      return null;
    }
    
    return task.history.slice(-limit);
  }

  /**
   * 获取系统任务执行报告
   */
  getExecutionReport(startTime, endTime) {
    const allTasks = this.scheduler.getTaskList();
    const report = {
      period: { startTime, endTime },
      summary: {
        totalTasks: allTasks.length,
        totalExecutions: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
        totalDuration: 0
      },
      tasks: []
    };
    
    for (const task of allTasks) {
      const taskDetails = this.scheduler.getTaskDetails(task.id);
      if (!taskDetails) continue;
      
      const taskReport = {
        id: task.id,
        name: task.name,
        plugin: task.plugin,
        executions: [],
        summary: {
          count: 0,
          success: 0,
          failed: 0,
          totalDuration: 0,
          averageDuration: 0
        }
      };
      
      // 过滤时间范围内的执行记录
      const filteredHistory = taskDetails.history.filter(record => {
        return record.startTime >= startTime && record.startTime <= endTime;
      });
      
      taskReport.executions = filteredHistory;
      taskReport.summary.count = filteredHistory.length;
      
      for (const record of filteredHistory) {
        if (record.status === 'success') {
          taskReport.summary.success++;
        } else {
          taskReport.summary.failed++;
        }
        
        if (record.duration) {
          taskReport.summary.totalDuration += record.duration;
        }
      }
      
      if (taskReport.summary.count > 0) {
        taskReport.summary.averageDuration = 
          Math.round(taskReport.summary.totalDuration / taskReport.summary.count);
      }
      
      // 更新总体统计
      report.summary.totalExecutions += taskReport.summary.count;
      report.summary.successfulExecutions += taskReport.summary.success;
      report.summary.failedExecutions += taskReport.summary.failed;
      report.summary.totalDuration += taskReport.summary.totalDuration;
      
      if (taskReport.summary.count > 0) {
        report.tasks.push(taskReport);
      }
    }
    
    return report;
  }
}

module.exports = TaskManager;