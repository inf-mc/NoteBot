const EventEmitter = require('events');
const cron = require('node-cron');
const logger = require('../utils/logger').module('Scheduler');
const config = require('../utils/config');

/**
 * 定时任务调度器
 */
class TaskScheduler extends EventEmitter {
  constructor(redisManager) {
    super();
    
    this.redis = redisManager;
    this.tasks = new Map();
    this.runningTasks = new Map();
    this.taskHistory = [];
    
    this.config = {
      enabled: config.get('scheduler.enabled', true),
      timezone: config.get('scheduler.timezone', 'Asia/Shanghai'),
      maxConcurrent: config.get('scheduler.maxConcurrent', 10),
      defaultTimeout: config.get('scheduler.defaultTimeout', 300000),
      historyLimit: config.get('scheduler.historyLimit', 1000),
      retryAttempts: config.get('scheduler.retryAttempts', 3),
      retryDelay: config.get('scheduler.retryDelay', 5000)
    };
    
    this.stats = {
      totalTasks: 0,
      successfulRuns: 0,
      failedRuns: 0,
      totalRunTime: 0
    };
    
    this.init();
  }

  /**
   * 初始化调度器
   */
  async init() {
    try {
      if (!this.config.enabled) {
        logger.info('定时任务调度器已禁用');
        return;
      }
      
      // 从 Redis 恢复任务状态
      await this.restoreTasksFromRedis();
      
      // 启动清理任务
      this.startCleanupTask();
      
      // 启动统计任务
      this.startStatsTask();
      
      logger.info('定时任务调度器初始化完成');
      
    } catch (error) {
      logger.error('定时任务调度器初始化失败:', error);
      throw error;
    }
  }

  /**
   * 注册定时任务
   */
  async register(taskId, cronExpression, handler, options = {}) {
    try {
      if (!this.config.enabled) {
        throw new Error('定时任务调度器已禁用');
      }
      
      if (this.tasks.has(taskId)) {
        throw new Error(`任务已存在: ${taskId}`);
      }
      
      // 验证 cron 表达式
      if (!cron.validate(cronExpression)) {
        throw new Error(`无效的 cron 表达式: ${cronExpression}`);
      }
      
      const taskConfig = {
        id: taskId,
        cron: cronExpression,
        handler,
        options: {
          name: options.name || taskId,
          description: options.description || '',
          plugin: options.plugin || 'system',
          timeout: options.timeout || this.config.defaultTimeout,
          retryAttempts: options.retryAttempts || this.config.retryAttempts,
          retryDelay: options.retryDelay || this.config.retryDelay,
          enabled: options.enabled !== false,
          timezone: options.timezone || this.config.timezone,
          runOnStart: options.runOnStart || false,
          singleton: options.singleton !== false,
          maxHistory: options.maxHistory || 50
        },
        createdAt: Date.now(),
        lastRun: null,
        nextRun: null,
        runCount: 0,
        successCount: 0,
        failureCount: 0,
        history: []
      };
      
      // 创建 cron 任务
      const cronTask = cron.schedule(cronExpression, async () => {
        await this.executeTask(taskId);
      }, {
        scheduled: false,
        timezone: taskConfig.options.timezone
      });
      
      taskConfig.cronTask = cronTask;
      
      // 计算下次运行时间
      taskConfig.nextRun = this.getNextRunTime(cronExpression, taskConfig.options.timezone);
      
      // 保存任务
      this.tasks.set(taskId, taskConfig);
      
      // 如果启用，启动任务
      if (taskConfig.options.enabled) {
        cronTask.start();
      }
      
      // 如果设置了启动时运行
      if (taskConfig.options.runOnStart) {
        setImmediate(() => this.executeTask(taskId));
      }
      
      // 保存到 Redis
      await this.saveTaskToRedis(taskConfig);
      
      this.stats.totalTasks++;
      
      logger.info(`注册定时任务: ${taskId} (${cronExpression})`);
      this.emit('task_registered', { taskId, config: taskConfig });
      
      return taskId;
      
    } catch (error) {
      logger.error(`注册定时任务失败 [${taskId}]:`, error);
      throw error;
    }
  }

  /**
   * 执行任务
   */
  async executeTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) {
      logger.warn(`任务不存在: ${taskId}`);
      return;
    }
    
    if (!task.options.enabled) {
      logger.debug(`任务已禁用: ${taskId}`);
      return;
    }
    
    // 检查并发限制
    if (this.runningTasks.size >= this.config.maxConcurrent) {
      logger.warn(`达到最大并发限制，跳过任务: ${taskId}`);
      return;
    }
    
    // 检查单例模式
    if (task.options.singleton && this.runningTasks.has(taskId)) {
      logger.debug(`任务正在运行中，跳过: ${taskId}`);
      return;
    }
    
    const execution = {
      id: `${taskId}_${Date.now()}`,
      taskId,
      startTime: Date.now(),
      endTime: null,
      duration: null,
      status: 'running',
      result: null,
      error: null,
      attempt: 1
    };
    
    this.runningTasks.set(taskId, execution);
    
    try {
      logger.debug(`开始执行任务: ${taskId}`);
      
      // 更新任务状态
      task.lastRun = execution.startTime;
      task.runCount++;
      task.nextRun = this.getNextRunTime(task.cron, task.options.timezone);
      
      this.emit('task_started', { taskId, execution });
      
      // 设置超时
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`任务执行超时: ${task.options.timeout}ms`));
        }, task.options.timeout);
      });
      
      // 执行任务处理器
      const taskPromise = this.executeTaskHandler(task, execution);
      
      // 等待任务完成或超时
      const result = await Promise.race([taskPromise, timeoutPromise]);
      
      // 任务成功完成
      execution.endTime = Date.now();
      execution.duration = execution.endTime - execution.startTime;
      execution.status = 'success';
      execution.result = result;
      
      task.successCount++;
      this.stats.successfulRuns++;
      this.stats.totalRunTime += execution.duration;
      
      logger.debug(`任务执行成功: ${taskId} (${execution.duration}ms)`);
      this.emit('task_completed', { taskId, execution, result });
      
    } catch (error) {
      // 任务执行失败
      execution.endTime = Date.now();
      execution.duration = execution.endTime - execution.startTime;
      execution.status = 'failed';
      execution.error = error.message;
      
      task.failureCount++;
      this.stats.failedRuns++;
      
      logger.error(`任务执行失败 [${taskId}]:`, error);
      this.emit('task_failed', { taskId, execution, error });
      
      // 重试逻辑
      if (execution.attempt < task.options.retryAttempts) {
        setTimeout(() => {
          this.retryTask(taskId, execution.attempt + 1);
        }, task.options.retryDelay);
      }
    } finally {
      // 清理运行状态
      this.runningTasks.delete(taskId);
      
      // 添加到历史记录
      this.addToHistory(task, execution);
      
      // 保存任务状态到 Redis
      await this.saveTaskToRedis(task);
    }
  }

  /**
   * 执行任务处理器
   */
  async executeTaskHandler(task, execution) {
    const context = {
      taskId: task.id,
      execution,
      config: task.options,
      logger: logger.child({ task: task.id }),
      redis: this.redis,
      
      // 工具方法
      updateProgress: (progress, message) => {
        execution.progress = progress;
        execution.progressMessage = message;
        this.emit('task_progress', { taskId: task.id, execution, progress, message });
      },
      
      setResult: (result) => {
        execution.result = result;
      },
      
      getData: async (key) => {
        return await this.redis.get(`task:${task.id}:${key}`);
      },
      
      setData: async (key, value, ttl) => {
        return await this.redis.set(`task:${task.id}:${key}`, value, ttl);
      }
    };
    
    return await task.handler(context);
  }

  /**
   * 重试任务
   */
  async retryTask(taskId, attempt) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    
    logger.info(`重试任务: ${taskId} (第 ${attempt} 次)`);
    
    const execution = {
      id: `${taskId}_${Date.now()}_retry_${attempt}`,
      taskId,
      startTime: Date.now(),
      endTime: null,
      duration: null,
      status: 'running',
      result: null,
      error: null,
      attempt
    };
    
    this.runningTasks.set(taskId, execution);
    
    try {
      this.emit('task_retry', { taskId, execution, attempt });
      
      const result = await this.executeTaskHandler(task, execution);
      
      execution.endTime = Date.now();
      execution.duration = execution.endTime - execution.startTime;
      execution.status = 'success';
      execution.result = result;
      
      task.successCount++;
      this.stats.successfulRuns++;
      
      logger.info(`任务重试成功: ${taskId} (第 ${attempt} 次)`);
      this.emit('task_completed', { taskId, execution, result });
      
    } catch (error) {
      execution.endTime = Date.now();
      execution.duration = execution.endTime - execution.startTime;
      execution.status = 'failed';
      execution.error = error.message;
      
      task.failureCount++;
      this.stats.failedRuns++;
      
      logger.error(`任务重试失败 [${taskId}] (第 ${attempt} 次):`, error);
      this.emit('task_failed', { taskId, execution, error });
      
      // 继续重试
      if (attempt < task.options.retryAttempts) {
        setTimeout(() => {
          this.retryTask(taskId, attempt + 1);
        }, task.options.retryDelay);
      }
    } finally {
      this.runningTasks.delete(taskId);
      this.addToHistory(task, execution);
      await this.saveTaskToRedis(task);
    }
  }

  /**
   * 取消注册任务
   */
  async unregister(taskId) {
    try {
      const task = this.tasks.get(taskId);
      if (!task) {
        logger.warn(`任务不存在: ${taskId}`);
        return false;
      }
      
      // 停止 cron 任务
      if (task.cronTask) {
        task.cronTask.stop();
        task.cronTask.destroy();
      }
      
      // 如果任务正在运行，等待完成
      if (this.runningTasks.has(taskId)) {
        logger.info(`等待任务完成: ${taskId}`);
        await this.waitForTaskCompletion(taskId);
      }
      
      // 从内存中移除
      this.tasks.delete(taskId);
      
      // 从 Redis 中移除
      await this.removeTaskFromRedis(taskId);
      
      this.stats.totalTasks--;
      
      logger.info(`取消注册任务: ${taskId}`);
      this.emit('task_unregistered', { taskId });
      
      return true;
      
    } catch (error) {
      logger.error(`取消注册任务失败 [${taskId}]:`, error);
      throw error;
    }
  }

  /**
   * 启用任务
   */
  async enableTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`任务不存在: ${taskId}`);
    }
    
    task.options.enabled = true;
    task.cronTask.start();
    
    await this.saveTaskToRedis(task);
    
    logger.info(`启用任务: ${taskId}`);
    this.emit('task_enabled', { taskId });
  }

  /**
   * 禁用任务
   */
  async disableTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`任务不存在: ${taskId}`);
    }
    
    task.options.enabled = false;
    task.cronTask.stop();
    
    await this.saveTaskToRedis(task);
    
    logger.info(`禁用任务: ${taskId}`);
    this.emit('task_disabled', { taskId });
  }

  /**
   * 手动执行任务
   */
  async runTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`任务不存在: ${taskId}`);
    }
    
    logger.info(`手动执行任务: ${taskId}`);
    await this.executeTask(taskId);
  }

  /**
   * 清理插件任务
   */
  async clearPluginTasks(pluginName) {
    const pluginTasks = [];
    
    for (const [taskId, task] of this.tasks) {
      if (task.options.plugin === pluginName) {
        pluginTasks.push(taskId);
      }
    }
    
    for (const taskId of pluginTasks) {
      await this.unregister(taskId);
    }
    
    logger.info(`清理插件任务: ${pluginName} (${pluginTasks.length} 个)`);
  }

  /**
   * 获取任务列表
   */
  getTaskList() {
    const tasks = [];
    
    for (const [taskId, task] of this.tasks) {
      tasks.push({
        id: taskId,
        name: task.options.name,
        description: task.options.description,
        plugin: task.options.plugin,
        cron: task.cron,
        enabled: task.options.enabled,
        createdAt: task.createdAt,
        lastRun: task.lastRun,
        nextRun: task.nextRun,
        runCount: task.runCount,
        successCount: task.successCount,
        failureCount: task.failureCount,
        running: this.runningTasks.has(taskId)
      });
    }
    
    return tasks;
  }

  /**
   * 获取任务详情
   */
  getTaskDetails(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) {
      return null;
    }
    
    const running = this.runningTasks.get(taskId);
    
    return {
      ...task,
      running,
      history: task.history.slice(-10) // 最近10次执行记录
    };
  }

  /**
   * 获取运行中的任务
   */
  getRunningTasks() {
    return Array.from(this.runningTasks.values());
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      activeTasks: this.tasks.size,
      runningTasks: this.runningTasks.size,
      averageRunTime: this.stats.successfulRuns > 0 ? 
        Math.round(this.stats.totalRunTime / this.stats.successfulRuns) : 0
    };
  }

  /**
   * 添加到历史记录
   */
  addToHistory(task, execution) {
    task.history.push({
      id: execution.id,
      startTime: execution.startTime,
      endTime: execution.endTime,
      duration: execution.duration,
      status: execution.status,
      result: execution.result,
      error: execution.error,
      attempt: execution.attempt
    });
    
    // 限制历史记录数量
    if (task.history.length > task.options.maxHistory) {
      task.history.shift();
    }
    
    // 添加到全局历史
    this.taskHistory.push({
      taskId: task.id,
      ...execution
    });
    
    // 限制全局历史记录数量
    if (this.taskHistory.length > this.config.historyLimit) {
      this.taskHistory.shift();
    }
  }

  /**
   * 获取下次运行时间
   */
  getNextRunTime(cronExpression, timezone) {
    try {
      const task = cron.schedule(cronExpression, () => {}, {
        scheduled: false,
        timezone
      });
      
      // 这里需要使用 cron 库的内部方法来计算下次运行时间
      // 由于 node-cron 没有直接提供这个方法，我们使用一个简单的估算
      const now = new Date();
      const nextMinute = new Date(now.getTime() + 60000);
      return nextMinute.getTime();
      
    } catch (error) {
      logger.warn(`计算下次运行时间失败: ${cronExpression}`, error);
      return null;
    }
  }

  /**
   * 等待任务完成
   */
  async waitForTaskCompletion(taskId, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      const checkInterval = setInterval(() => {
        if (!this.runningTasks.has(taskId)) {
          clearInterval(checkInterval);
          resolve();
        } else if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval);
          reject(new Error(`等待任务完成超时: ${taskId}`));
        }
      }, 100);
    });
  }

  /**
   * 保存任务到 Redis
   */
  async saveTaskToRedis(task) {
    try {
      const taskData = {
        id: task.id,
        cron: task.cron,
        options: task.options,
        createdAt: task.createdAt,
        lastRun: task.lastRun,
        nextRun: task.nextRun,
        runCount: task.runCount,
        successCount: task.successCount,
        failureCount: task.failureCount
      };
      
      await this.redis.set(`scheduler:task:${task.id}`, taskData);
      
    } catch (error) {
      logger.error(`保存任务到 Redis 失败 [${task.id}]:`, error);
    }
  }

  /**
   * 从 Redis 移除任务
   */
  async removeTaskFromRedis(taskId) {
    try {
      await this.redis.del(`scheduler:task:${taskId}`);
    } catch (error) {
      logger.error(`从 Redis 移除任务失败 [${taskId}]:`, error);
    }
  }

  /**
   * 从 Redis 恢复任务
   */
  async restoreTasksFromRedis() {
    try {
      const keys = await this.redis.keys('scheduler:task:*');
      
      for (const key of keys) {
        try {
          const taskData = await this.redis.get(key);
          if (taskData) {
            logger.debug(`从 Redis 恢复任务: ${taskData.id}`);
            // 注意：这里只恢复任务配置，不恢复处理器函数
            // 处理器函数需要在插件重新加载时重新注册
          }
        } catch (error) {
          logger.warn(`恢复任务失败 [${key}]:`, error);
        }
      }
      
    } catch (error) {
      logger.error('从 Redis 恢复任务失败:', error);
    }
  }

  /**
   * 启动清理任务
   */
  startCleanupTask() {
    // 每小时清理一次过期的历史记录
    setInterval(() => {
      this.cleanupHistory();
    }, 60 * 60 * 1000);
  }

  /**
   * 启动统计任务
   */
  startStatsTask() {
    // 每分钟更新一次统计信息
    setInterval(() => {
      this.updateStats();
    }, 60 * 1000);
  }

  /**
   * 清理历史记录
   */
  cleanupHistory() {
    const cutoffTime = Date.now() - (24 * 60 * 60 * 1000); // 24小时前
    
    this.taskHistory = this.taskHistory.filter(record => {
      return record.startTime > cutoffTime;
    });
    
    logger.debug('清理历史记录完成');
  }

  /**
   * 更新统计信息
   */
  async updateStats() {
    try {
      await this.redis.set('scheduler:stats', this.stats);
    } catch (error) {
      logger.error('更新统计信息失败:', error);
    }
  }

  /**
   * 关闭调度器
   */
  async close() {
    logger.info('关闭定时任务调度器...');
    
    // 停止所有任务
    for (const [taskId, task] of this.tasks) {
      if (task.cronTask) {
        task.cronTask.stop();
        task.cronTask.destroy();
      }
    }
    
    // 等待运行中的任务完成
    const runningTaskIds = Array.from(this.runningTasks.keys());
    for (const taskId of runningTaskIds) {
      try {
        await this.waitForTaskCompletion(taskId, 10000);
      } catch (error) {
        logger.warn(`强制停止任务: ${taskId}`);
      }
    }
    
    // 清理资源
    this.tasks.clear();
    this.runningTasks.clear();
    this.removeAllListeners();
    
    logger.info('定时任务调度器已关闭');
  }
}

module.exports = TaskScheduler;