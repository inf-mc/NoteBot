const EventEmitter = require('events');
const logger = require('../../utils/logger');
const OneBotApiWrapper = require('../../core/onebot/api-wrapper');
const CommandManager = require('../../core/command');
const { CommandBuilder, ArgumentParser, CommandGroup } = require('../../core/command/builder');
const PuppeteerManager = require('../../core/puppeteer');
const PuppeteerAPI = require('../../core/puppeteer/api');

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
    this.api = null;
    this.puppeteer = null;
    
    this.initialized = false;
    this.destroyed = false;
    
    this.routes = new Map();
    this.scheduledTasks = new Map();
    this.eventHandlers = new Map();
    this.commandManager = null;
    this.commands = new Map();
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
      
      // 创建API封装器实例
      if (context.onebot) {
        this.api = new OneBotApiWrapper(context.onebot, this.name);
      }
      
      // 初始化Puppeteer模块
      await this.initPuppeteer();
      
      this.logger.info(`插件初始化开始: ${this.name}`);
      
      // 初始化命令管理器
      this.initCommandManager();
      
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
      
      // 清理命令管理器
      if (this.commandManager) {
        this.commandManager.destroy();
        this.commandManager = null;
      }
      
      // 清理定时任务
      this.clearAllTasks();
      
      // 清理Puppeteer资源
      await this.cleanupPuppeteer();
      
      // 清理事件监听器
      this.removeAllListeners();
      
      // 清理路由
      this.routes.clear();
      
      // 清理命令
      this.commands.clear();
      
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
      
      // 转换消息数据格式以兼容命令处理器
      const message = {
        user_id: data.userId,
        group_id: data.groupId,
        raw_message: data.message,
        message_type: data.groupId ? 'group' : 'private',
        message_id: data.messageId,
        time: data.time,
        sender: data.sender,
        ...data.rawData // 包含原始数据
      };
      
      // 尝试处理命令
      const commandResult = await this.handleCommand(message, messageContext);
      if (commandResult && commandResult.success) {
        return commandResult;
      }
      
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
    const self = this;
    const wrappedHandler = async (req, res, next) => {
      try {
        self.logger.debug(`处理路由请求: ${method.toUpperCase()} ${path}`);
        self.updateActivity();
        
        const result = await handler(req, res, next);
        return result;
        
      } catch (error) {
        self.logger.error(`路由处理失败 [${method.toUpperCase()} ${path}]:`, error);
        
        if (!res.headersSent) {
          res.status(500).json({
            error: 'Internal Server Error',
            message: error.message
          });
        }
      }
    };
    
    this.context.web.registerRoute(method, path, wrappedHandler);
    
    // 存储路由时使用完整路径（包含插件前缀）
    const fullPath = `/plugins/${this.name}${path}`;
    this.routes.set(routeKey, { method, path: fullPath, handler: wrappedHandler, options });
    
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
  async getData(key, defaultValue = null) {
    if (!this.context) {
      throw new Error('插件未初始化');
    }
    
    const result = await this.context.storage.get(key);
    return result !== null ? result : defaultValue;
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
   * 发送 Onebot 消息 (已废弃，请使用 this.api)
   * @deprecated 请使用 this.api.sendPrivateMessage 或 this.api.sendGroupMessage
   */
  async sendOnebotMessage(messageType, data) {
    if (!this.context) {
      throw new Error('插件未初始化');
    }
    
    return await this.context.onebot.sendMessage(messageType, data);
  }

  /**
   * 调用 Onebot API (已废弃，请使用 this.api)
   * @deprecated 请使用 this.api 中的具体方法
   */
  async callOnebotAPI(action, params) {
    if (!this.context) {
      throw new Error('插件未初始化');
    }
    
    return await this.context.onebot.callAPI(action, params);
  }

  /**
   * 获取API封装器实例
   * @returns {OneBotApiWrapper} API封装器实例
   */
  getApi() {
    if (!this.api) {
      throw new Error('API封装器未初始化，请确保插件已正确初始化');
    }
    return this.api;
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
   * 初始化命令管理器
   */
  initCommandManager() {
    // 检查是否已初始化
    if (this.commandManager) {
      this.logger.warn('命令管理器已初始化，跳过重复初始化');
      return;
    }
    // 检查命令配置
    if (!this.config || !this.config.commands) {
      throw new Error('插件配置中缺少 commands 字段');
    }
    // 初始化命令管理器
    const options = {
      prefix: this.getConfig('commandPrefix', '#'),
      caseSensitive: this.getConfig('commandCaseSensitive', false),
      enableHelp: this.getConfig('enableHelp', true),
      helpCommand: this.getConfig('helpCommand', 'help')
    };
    
    this.commandManager = new CommandManager(options);
    
    // 监听命令事件
    this.commandManager.on('command_executed', (data) => {
      this.logger.debug(`命令执行成功: ${data.command.name}`);
      this.emit('command_executed', data);
    });
    
    this.commandManager.on('command_failed', (data) => {
      this.logger.error(`命令执行失败: ${data.command.name}`, data.error);
      this.emit('command_failed', data);
    });
    
    this.logger.debug('命令管理器初始化完成');
  }

  /**
   * 处理命令
   */
  async handleCommand(message, messageContext) {
    if (!this.commandManager || !message.raw_message) {
      return null;
    }
    
    try {
      const context = {
        message,
        user: this.extractUserInfo(message, messageContext),
        plugin: this,
        api: this.api
      };
      
      return await this.commandManager.execute(context);
      
    } catch (error) {
      this.logger.error('命令处理失败:', error);
      return {
        success: false,
        reason: 'handler_error',
        error: error.message
      };
    }
  }

  /**
   * 提取用户信息
   */
  extractUserInfo(message, messageContext) {
    const userId = String(message.user_id);
    const config = require('../../utils/config');
    const botConfig = config.get('bot', {});
    const admins = botConfig.admins || [];
    const owners = botConfig.owners || [];
    
    const isOwner = owners.includes(userId);
    const isAdmin = admins.includes(userId) || isOwner;
    
    let role = 'user';
    if (isOwner) {
      role = 'owner';
    } else if (isAdmin) {
      role = 'admin';
    }
    
    return {
      id: message.user_id,
      groupId: message.group_id,
      messageType: message.message_type,
      isAdmin: isAdmin,
      isOwner: isOwner,
      role: role
    };
  }

  /**
   * 注册命令
   * @param {Object|CommandBuilder} commandConfig 命令配置或构建器
   */
  registerCommand(commandConfig) {
    if (!this.commandManager) {
      throw new Error('命令管理器未初始化');
    }
    
    const config = commandConfig instanceof CommandBuilder ? commandConfig.build() : commandConfig;
    const command = this.commandManager.register(config);
    
    this.commands.set(command.name, command);
    this.logger.debug(`注册命令: ${command.name}`);
    
    return command;
  }

  /**
   * 取消注册命令
   * @param {string} name 命令名称
   */
  unregisterCommand(name) {
    if (!this.commandManager) {
      return false;
    }
    
    const result = this.commandManager.unregister(name);
    if (result) {
      this.commands.delete(name);
      this.logger.debug(`取消注册命令: ${name}`);
    }
    
    return result;
  }

  /**
   * 创建命令构建器
   * @param {string} name 命令名称
   * @returns {CommandBuilder} 命令构建器
   */
  createCommand(name) {
    return new CommandBuilder(name);
  }

  /**
   * 创建参数解析器
   * @returns {ArgumentParser} 参数解析器
   */
  createArgumentParser() {
    return new ArgumentParser();
  }

  /**
   * 创建命令组
   * @param {string} name 组名称
   * @param {Object} options 选项
   * @returns {CommandGroup} 命令组
   */
  createCommandGroup(name, options = {}) {
    return new CommandGroup(name, {
      category: this.name,
      ...options
    });
  }

  /**
   * 注册命令组
   * @param {CommandGroup} group 命令组
   */
  registerCommandGroup(group) {
    if (!this.commandManager) {
      throw new Error('命令管理器未初始化');
    }
    
    group.registerTo(this.commandManager);
    
    // 记录组中的命令
    for (const command of group.getCommands()) {
      this.commands.set(command.name, command);
    }
    
    this.logger.debug(`注册命令组: ${group.name}`);
  }

  /**
   * 添加命令中间件
   * @param {Function} middleware 中间件函数
   */
  addCommandMiddleware(middleware) {
    if (!this.commandManager) {
      throw new Error('命令管理器未初始化');
    }
    
    this.commandManager.use(middleware);
    this.logger.debug('添加命令中间件');
  }

  /**
   * 注册权限检查器
   * @param {string} permission 权限名称
   * @param {Function} checker 检查函数
   */
  registerPermission(permission, checker) {
    if (!this.commandManager) {
      throw new Error('命令管理器未初始化');
    }
    
    this.commandManager.registerPermission(permission, checker);
    this.logger.debug(`注册权限检查器: ${permission}`);
  }

  /**
   * 获取命令统计信息
   * @returns {Object} 统计信息
   */
  getCommandStats() {
    if (!this.commandManager) {
      return null;
    }
    
    return this.commandManager.getStats();
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
   * 更新插件配置
   */
  async updateConfig(newConfig) {
    try {
      // 深度合并配置
      if (newConfig.settings) {
        this.config.settings = { ...this.config.settings, ...newConfig.settings };
      }
      
      // 合并其他配置字段
      Object.keys(newConfig).forEach(key => {
        if (key !== 'settings') {
          this.config[key] = newConfig[key];
        }
      });
      
      this.logger.info('插件配置已更新');
      
      // 触发配置更新事件
      this.emit('config:updated', this.config);
      
      // 如果插件有配置更新处理器，调用它
      if (typeof this.onConfigUpdate === 'function') {
        await this.onConfigUpdate(this.config);
      }
      
    } catch (error) {
      this.logger.error('更新配置失败:', error);
      throw error;
    }
  }

  /**
   * 验证插件是否可用
   */
  isAvailable() {
    return this.initialized && !this.destroyed && this.context;
  }

  /**
   * 初始化Puppeteer模块
   */
  async initPuppeteer() {
    try {
      // 从全局配置中读取Puppeteer配置
      const globalConfig = global.config || require('../../utils/config');
      const puppeteerConfig = globalConfig.get('puppeteer', { enabled: true });
      
      if (!puppeteerConfig.enabled) {
        this.logger.debug('Puppeteer模块已禁用');
        return;
      }
      
      // 创建Puppeteer管理器实例（全局共享）
      if (!global.puppeteerManager) {
        const PuppeteerManager = require('../../core/puppeteer');
        const PuppeteerAPI = require('../../core/puppeteer/api');
        
        global.puppeteerManager = new PuppeteerManager(puppeteerConfig);
        await global.puppeteerManager.initialize();
        this.logger.info('全局Puppeteer管理器已初始化');
      }
      
      // 为插件创建API接口
      const PuppeteerAPI = require('../../core/puppeteer/api');
      this.puppeteer = new PuppeteerAPI(global.puppeteerManager);
      
      this.logger.debug(`插件 ${this.name} 的Puppeteer模块已初始化`);
      
    } catch (error) {
      this.logger.error('Puppeteer模块初始化失败:', error);
      // 不抛出错误，允许插件在没有Puppeteer的情况下运行
      this.puppeteer = null;
    }
  }
  
  /**
   * 清理Puppeteer资源
   */
  async cleanupPuppeteer() {
    try {
      if (this.puppeteer) {
        this.logger.debug(`清理插件 ${this.name} 的Puppeteer资源`);
        this.puppeteer = null;
      }
      
      // 注意：不在这里清理全局管理器，因为其他插件可能还在使用
      // 全局管理器的清理应该在应用程序关闭时进行
      
    } catch (error) {
      this.logger.error('Puppeteer资源清理失败:', error);
    }
  }
  
  /**
   * 检查Puppeteer是否可用
   */
  isPuppeteerAvailable() {
    return this.puppeteer !== null && global.puppeteerManager && global.puppeteerManager.isInitialized;
  }
  
  /**
   * 获取Puppeteer状态信息
   */
  getPuppeteerStatus() {
    if (!this.isPuppeteerAvailable()) {
      return {
        available: false,
        reason: 'Puppeteer模块未初始化或已禁用'
      };
    }
    
    return {
      available: true,
      status: global.puppeteerManager.getStatus()
    };
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