const EventEmitter = require('events');
const logger = require('../../utils/logger');

/**
 * 插件基类
 * 所有插件都应该继承此类
 */
class BasePlugin extends EventEmitter {
  constructor() {
    super();
    
    this.name = this.constructor.name;
    this.version = '1.0.0';
    this.description = '';
    this.author = '';
    
    this.context = null;
    this.config = null;
    this.logger = null;
    
    this.initialized = false;
    this.destroyed = false;
    
    this.routes = new Map();
    this.scheduledTasks = new Map();
    this.eventHandlers = new Map();
  }

  /**
   * 插件初始化
   * 子类应该重写此方法
   */
  async init(context) {
    try {
      this.context = context;
      this.config = context.config;
      this.logger = context.logger || logger.child({ plugin: this.name });
      
      this.logger.info(`插件初始化开始: ${this.name}`);
      
      // 注册默认事件处理器
      this.registerDefaultHandlers();
      
      // 调用子类的初始化方法
      if (typeof this.onInit === 'function') {
        await this.onInit();
      }
      
      this.initialized = true;
      this.logger.info(`插件初始化完成: ${this.name}`);
      
    } catch (error) {
      this.logger.error(`插件初始化失败: ${this.name}`, error);
      throw error;
    }
  }

  /**
   * 插件销毁
   * 子类应该重写此方法进行清理
   */
  async destroy() {
    try {
      if (this.destroyed) {
        return;
      }
      
      this.logger.info(`插件销毁开始: ${this.name}`);
      
      // 调用子类的销毁方法
      if (typeof this.onDestroy === 'function') {
        await this.onDestroy();
      }
      
      // 清理定时任务
      this.clearAllTasks();
      
      // 清理事件监听器
      this.removeAllListeners();
      
      // 清理路由
      this.routes.clear();
      
      this.destroyed = true;
      this.initialized = false;
      
      this.logger.info(`插件销毁完成: ${this.name}`);
      
    } catch (error) {
      this.logger.error(`插件销毁失败: ${this.name}`, error);
      throw error;
    }
  }

  /**
   * 消息处理
   * 子类可以重写此方法处理消息
   */
  async onMessage(data, messageContext) {
    try {
      this.logger.debug(`收到消息 [${messageContext.from}]:`, data);
      
      // 更新活动时间
      this.updateActivity();
      
      // 调用子类的消息处理方法
      if (typeof this.handleMessage === 'function') {
        return await this.handleMessage(data, messageContext);
      }
      
      return null;
      
    } catch (error) {
      this.logger.error('消息处理失败:', error);
      throw error;
    }
  }

  /**
   * 事件处理
   * 子类可以重写此方法处理事件
   */
  async onEvent(eventType, eventData) {
    try {
      this.logger.debug(`收到事件 [${eventType}]:`, eventData);
      
      // 更新活动时间
      this.updateActivity();
      
      // 查找事件处理器
      const handler = this.eventHandlers.get(eventType);
      if (handler && typeof handler === 'function') {
        return await handler(eventData);
      }
      
      // 调用子类的事件处理方法
      if (typeof this.handleEvent === 'function') {
        return await this.handleEvent(eventType, eventData);
      }
      
      return null;
      
    } catch (error) {
      this.logger.error(`事件处理失败 [${eventType}]:`, error);
      throw error;
    }
  }

  /**
   * 注册默认事件处理器
   */
  registerDefaultHandlers() {
    // 注册系统事件处理器
    this.registerEventHandler('plugin_loaded', (data) => {
      this.logger.debug(`插件已加载: ${data.plugin}`);
    });
    
    this.registerEventHandler('plugin_unloaded', (data) => {
      this.logger.debug(`插件已卸载: ${data.plugin}`);
    });
  }

  /**
   * 注册事件处理器
   */
  registerEventHandler(eventType, handler) {
    if (typeof handler !== 'function') {
      throw new Error('事件处理器必须是函数');
    }
    
    this.eventHandlers.set(eventType, handler);
    this.logger.debug(`注册事件处理器: ${eventType}`);
  }

  /**
   * 取消事件处理器
   */
  unregisterEventHandler(eventType) {
    this.eventHandlers.delete(eventType);
    this.logger.debug(`取消事件处理器: ${eventType}`);
  }

  /**
   * 发送消息给其他插件
   */
  async sendMessage(targetPlugin, message) {
    if (!this.context) {
      throw new Error('插件未初始化');
    }
    
    return await this.context.sendToPlugin(targetPlugin, message);
  }

  /**
   * 广播消息给所有插件
   */
  async broadcastMessage(message) {
    if (!this.context) {
      throw new Error('插件未初始化');
    }
    
    return await this.context.broadcastToPlugins(message);
  }

  /**
   * 注册定时任务
   */
  registerTask(name, cron, handler, options = {}) {
    if (!this.context) {
      throw new Error('插件未初始化');
    }
    
    const taskId = this.context.scheduler.register(cron, handler, {
      ...options,
      name: `${this.name}:${name}`
    });
    
    this.scheduledTasks.set(name, taskId);
    this.logger.debug(`注册定时任务: ${name} (${cron})`);
    
    return taskId;
  }

  /**
   * 取消定时任务
   */
  unregisterTask(name) {
    const taskId = this.scheduledTasks.get(name);
    if (taskId && this.context) {
      this.context.scheduler.unregister(taskId);
      this.scheduledTasks.delete(name);
      this.logger.debug(`取消定时任务: ${name}`);
      return true;
    }
    return false;
  }

  /**
   * 清理所有定时任务
   */
  clearAllTasks() {
    for (const [name, taskId] of this.scheduledTasks) {
      if (this.context) {
        this.context.scheduler.unregister(taskId);
      }
    }
    this.scheduledTasks.clear();
    this.logger.debug('清理所有定时任务');
  }

  /**
   * 注册 Web 路由
   */
  registerRoute(method, path, handler, options = {}) {
    if (!this.context) {
      throw new Error('插件未初始化');
    }
    
    const routeKey = `${method.toUpperCase()}:${path}`;
    
    // 包装处理器以添加错误处理和日志
    const wrappedHandler = async (req, res, next) => {
      try {
        this.logger.debug(`处理路由请求: ${method.toUpperCase()} ${path}`);
        this.updateActivity();
        
        const result = await handler(req, res, next);
        return result;
        
      } catch (error) {
        this.logger.error(`路由处理失败 [${method.toUpperCase()} ${path}]:`, error);
        
        if (!res.headersSent) {
          res.status(500).json({
            error: 'Internal Server Error',
            message: error.message
          });
        }
      }
    };
    
    this.context.web.registerRoute(method, path, wrappedHandler);
    this.routes.set(routeKey, { method, path, handler: wrappedHandler, options });
    
    this.logger.debug(`注册路由: ${method.toUpperCase()} ${path}`);
  }

  /**
   * 注册静态文件路径
   */
  registerStaticPath(urlPath, localPath) {
    if (!this.context) {
      throw new Error('插件未初始化');
    }
    
    this.context.web.registerStaticPath(urlPath, localPath);
    this.logger.debug(`注册静态路径: ${urlPath} -> ${localPath}`);
  }

  /**
   * 存储数据
   */
  async setData(key, value, ttl) {
    if (!this.context) {
      throw new Error('插件未初始化');
    }
    
    return await this.context.storage.set(key, value, ttl);
  }

  /**
   * 获取数据
   */
  async getData(key) {
    if (!this.context) {
      throw new Error('插件未初始化');
    }
    
    return await this.context.storage.get(key);
  }

  /**
   * 删除数据
   */
  async deleteData(key) {
    if (!this.context) {
      throw new Error('插件未初始化');
    }
    
    return await this.context.storage.del(key);
  }

  /**
   * 检查数据是否存在
   */
  async hasData(key) {
    if (!this.context) {
      throw new Error('插件未初始化');
    }
    
    return await this.context.storage.exists(key);
  }

  /**
   * 发送 Onebot 消息
   */
  async sendOnebotMessage(messageType, data) {
    if (!this.context) {
      throw new Error('插件未初始化');
    }
    
    return await this.context.onebot.sendMessage(messageType, data);
  }

  /**
   * 调用 Onebot API
   */
  async callOnebotAPI(action, params) {
    if (!this.context) {
      throw new Error('插件未初始化');
    }
    
    return await this.context.onebot.callAPI(action, params);
  }

  /**
   * 更新活动时间
   */
  updateActivity() {
    this.lastActivity = Date.now();
  }

  /**
   * 获取插件状态
   */
  getStatus() {
    return {
      name: this.name,
      version: this.version,
      description: this.description,
      author: this.author,
      initialized: this.initialized,
      destroyed: this.destroyed,
      lastActivity: this.lastActivity,
      routes: Array.from(this.routes.keys()),
      tasks: Array.from(this.scheduledTasks.keys()),
      eventHandlers: Array.from(this.eventHandlers.keys())
    };
  }

  /**
   * 获取插件配置
   */
  getConfig(key, defaultValue) {
    if (!this.config) {
      return defaultValue;
    }
    
    if (key) {
      return this.config[key] !== undefined ? this.config[key] : defaultValue;
    }
    
    return this.config;
  }

  /**
   * 设置插件配置
   */
  setConfig(key, value) {
    if (!this.config) {
      this.config = {};
    }
    
    if (typeof key === 'object') {
      Object.assign(this.config, key);
    } else {
      this.config[key] = value;
    }
  }

  /**
   * 验证插件是否可用
   */
  isAvailable() {
    return this.initialized && !this.destroyed && this.context;
  }

  /**
   * 插件信息
   */
  getInfo() {
    return {
      name: this.name,
      version: this.version,
      description: this.description,
      author: this.author
    };
  }
}

module.exports = BasePlugin;