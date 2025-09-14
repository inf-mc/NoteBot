const EventEmitter = require('events');
const path = require('path');
const fs = require('fs').promises;
const chokidar = require('chokidar');
const logger = require('../../utils/logger');
const PluginLoader = require('../loader');
const PluginCommunication = require('../communication');
const { MessageHandler } = require('../../core/onebot/messageHandler');

/**
 * 插件管理器
 */
class PluginManager extends EventEmitter {
  constructor(config, redisManager, onebotCore, scheduler) {
    super();
    
    this.config = config;
    this.redis = redisManager;
    this.onebot = onebotCore;
    this.scheduler = scheduler;
    
    this.pluginDir = path.resolve(config.pluginDir || './plugins');
    this.plugins = new Map();
    this.pluginConfigs = new Map();
    this.pluginStates = new Map();
    this.loadingLocks = new Map(); // 添加加载锁防止竞态条件
    
    this.loader = new PluginLoader(this);
    this.communication = new PluginCommunication(this);
    this.messageHandler = new MessageHandler(onebotCore, this);
    
    this.hotReloadEnabled = config.hotReload !== false;
    this.watcher = null;
  }

  /**
   * 重写emit方法，支持消息事件分发给所有插件
   */
  emit(event, data) {
    // 先调用父类的emit方法
    super.emit(event, data);
    
    // 如果是消息事件，分发给所有插件
    if (event === 'private_message' || event === 'group_message' || 
        event.startsWith('notice.') || event.startsWith('request.')) {
      this.distributeEventToPlugins(event, data);
    }
    
    return this;
  }

  /**
   * 将事件分发给所有已加载的插件
   */
  async distributeEventToPlugins(event, data) {
    const plugins = this.getPluginList();
    
    for (const plugin of plugins) {
      if (!plugin.loaded) continue;
      
      try {
        const pluginData = this.plugins.get(plugin.name);
        if (!pluginData || !pluginData.instance) continue;
        
        const { instance } = pluginData;
        
        // 检查插件是否有对应的事件处理方法
        let handlerMethod = null;
        
        if (event === 'private_message' || event === 'group_message') {
          // 对于消息事件，优先调用onMessage方法（包含命令处理逻辑）
          if (typeof instance.onMessage === 'function') {
            const messageContext = {
              from: 'onebot',
              event: event,
              timestamp: Date.now()
            };
            handlerMethod = () => instance.onMessage(data, messageContext);
          } else {
            // 如果没有onMessage方法，回退到原有的处理方式
            if (event === 'private_message' && typeof instance.handlePrivateMessage === 'function') {
              handlerMethod = instance.handlePrivateMessage.bind(instance);
            } else if (event === 'group_message' && typeof instance.handleGroupMessage === 'function') {
              handlerMethod = instance.handleGroupMessage.bind(instance);
            }
          }
        } else if (event.startsWith('notice.') || event.startsWith('request.')) {
          // 对于通知和请求事件，查找对应的处理方法
          const methodName = this.getEventHandlerMethodName(event);
          if (typeof instance[methodName] === 'function') {
            handlerMethod = instance[methodName].bind(instance);
          }
        }
        
        // 如果插件有对应的处理方法，调用它
        if (handlerMethod) {
          await handlerMethod(data);
          
          // 更新插件统计信息
          const state = this.pluginStates.get(plugin.name);
          if (state && state.metrics) {
            state.metrics.messageCount++;
            state.metrics.lastActivity = Date.now();
          }
        }
        
      } catch (error) {
        logger.error(`插件 ${plugin.name} 处理事件 ${event} 时出错:`, error);
        
        // 更新错误统计
        const state = this.pluginStates.get(plugin.name);
        if (state && state.metrics) {
          state.metrics.errorCount++;
          state.errors = state.errors || [];
          state.errors.push({
            event,
            error: error.message,
            timestamp: Date.now()
          });
          
          // 只保留最近的10个错误
          if (state.errors.length > 10) {
            state.errors = state.errors.slice(-10);
          }
        }
      }
    }
  }

  /**
   * 根据事件名称获取对应的处理方法名
   */
  getEventHandlerMethodName(event) {
    const eventMap = {
      'notice.group_upload': 'handleGroupUpload',
      'notice.group_increase': 'handleGroupIncrease', 
      'notice.group_decrease': 'handleGroupDecrease',
      'notice.friend_add': 'handleFriendAdd',
      'request.friend': 'handleFriendRequest',
      'request.group': 'handleGroupRequest'
    };
    
    return eventMap[event] || null;
  }

  /**
   * 初始化插件管理器
   */
  async init() {
    try {
      // 确保插件目录存在
      await this.ensurePluginDirectory();
      
      // 加载插件配置
      await this.loadPluginConfigs();
      
      // 自动加载插件
      if (this.config.autoLoad) {
        await this.loadAllPlugins();
      }
      
      // 启用热重载
      if (this.hotReloadEnabled) {
        this.enableHotReload();
      }
      
      logger.info('插件管理器初始化完成');
    } catch (error) {
      logger.error('插件管理器初始化失败:', error);
      throw error;
    }
  }

  /**
   * 确保插件目录存在
   */
  async ensurePluginDirectory() {
    try {
      await fs.access(this.pluginDir);
    } catch (error) {
      await fs.mkdir(this.pluginDir, { recursive: true });
      logger.info(`创建插件目录: ${this.pluginDir}`);
    }
  }

  /**
   * 加载所有插件配置
   */
  async loadPluginConfigs() {
    try {
      const entries = await fs.readdir(this.pluginDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const pluginPath = path.join(this.pluginDir, entry.name);
          const configPath = path.join(pluginPath, 'plugin.json');
          
          try {
            const configData = await fs.readFile(configPath, 'utf8');
            const config = JSON.parse(configData);
            
            // 验证配置
            if (this.validatePluginConfig(config)) {
              config.path = pluginPath;
              config.name = config.name || entry.name;
              this.pluginConfigs.set(config.name, config);
              
              logger.debug(`加载插件配置: ${config.name}`);
            }
          } catch (error) {
            logger.warn(`加载插件配置失败 [${entry.name}]:`, error.message);
          }
        }
      }
      
      logger.info(`加载了 ${this.pluginConfigs.size} 个插件配置`);
    } catch (error) {
      logger.error('加载插件配置失败:', error);
    }
  }

  /**
   * 验证插件配置
   */
  validatePluginConfig(config) {
    const required = ['name', 'version', 'main'];
    
    for (const field of required) {
      if (!config[field]) {
        logger.warn(`插件配置缺少必需字段: ${field}`);
        return false;
      }
    }
    
    return true;
  }

  /**
   * 加载所有插件
   */
  async loadAllPlugins() {
    const loadPromises = [];
    
    for (const [name, config] of this.pluginConfigs) {
      if (config.enabled !== false) {
        loadPromises.push(this.loadPlugin(name));
      }
    }
    
    const results = await Promise.allSettled(loadPromises);
    
    let successCount = 0;
    let failureCount = 0;
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        successCount++;
      } else {
        failureCount++;
        logger.error(`插件加载失败:`, result.reason);
      }
    });
    
    logger.info(`插件加载完成: 成功 ${successCount}, 失败 ${failureCount}`);
  }

  /**
   * 加载单个插件
   */
  async loadPlugin(name) {
    // 检查是否正在加载中
    if (this.loadingLocks.has(name)) {
      logger.warn(`插件正在加载中，跳过重复加载: ${name}`);
      return;
    }
    
    // 设置加载锁
    this.loadingLocks.set(name, true);
    
    try {
      const config = this.pluginConfigs.get(name);
      if (!config) {
        throw new Error(`插件配置不存在: ${name}`);
      }
      
      if (this.plugins.has(name)) {
        logger.warn(`插件已加载，跳过重复加载: ${name}`);
        return;
      }
      
      // 使用加载器加载插件
      const plugin = await this.loader.load(config);
      
      // 创建插件上下文
      const context = this.createPluginContext(name, config);
      
      // 初始化插件
      if (typeof plugin.init === 'function') {
        await plugin.init(context);
      }
      
      // 保存插件实例
      this.plugins.set(name, {
        instance: plugin,
        config,
        context,
        loadedAt: Date.now(),
        state: 'loaded'
      });
      
      this.pluginStates.set(name, {
        status: 'running',
        loadedAt: Date.now(),
        errors: [],
        metrics: {
          messageCount: 0,
          errorCount: 0,
          lastActivity: Date.now()
        }
      });
      
      // 保存到 Redis
      await this.savePluginState(name);
      
      logger.info(`插件加载成功: ${name} v${config.version}`);
      this.emit('plugin_loaded', { name, config, plugin });
      
      return plugin;
    } catch (error) {
      logger.error(`插件加载失败 [${name}]:`, error);
      
      this.pluginStates.set(name, {
        status: 'error',
        error: error.message,
        lastError: Date.now()
      });
      
      await this.savePluginState(name);
      this.emit('plugin_error', { name, error });
      
      throw error;
    } finally {
      // 清除加载锁
      this.loadingLocks.delete(name);
    }
  }

  /**
   * 卸载插件
   */
  async unloadPlugin(name) {
    // 检查是否正在加载中，如果是则等待
    if (this.loadingLocks.has(name)) {
      logger.warn(`插件正在加载中，等待加载完成后再卸载: ${name}`);
      // 等待加载完成
      while (this.loadingLocks.has(name)) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    try {
      const pluginData = this.plugins.get(name);
      if (!pluginData) {
        logger.warn(`插件未加载，无需卸载: ${name}`);
        return true;
      }
      
      const { instance, context } = pluginData;
      
      // 调用插件的销毁方法
      if (typeof instance.destroy === 'function') {
        await instance.destroy();
      }
      
      // 清理定时任务
      if (context.scheduler) {
        context.scheduler.clearAll();
      }
      
      // 清理事件监听器
      if (context.eventBus) {
        context.eventBus.removeAllListeners();
      }
      
      // 从缓存中移除
      this.loader.unload(name);
      this.plugins.delete(name);
      
      this.pluginStates.set(name, {
        status: 'unloaded',
        unloadedAt: Date.now()
      });
      
      await this.savePluginState(name);
      
      logger.info(`插件卸载成功: ${name}`);
      this.emit('plugin_unloaded', { name });
      
      return true;
    } catch (error) {
      logger.error(`插件卸载失败 [${name}]:`, error);
      this.emit('plugin_error', { name, error });
      throw error;
    }
  }

  /**
   * 重新加载插件
   */
  async reloadPlugin(name) {
    try {
      // 检查插件配置是否存在
      const config = this.pluginConfigs.get(name);
      if (!config) {
        throw new Error(`插件配置不存在: ${name}`);
      }
      
      // 如果插件已加载，先卸载
      if (this.plugins.has(name)) {
        await this.unloadPlugin(name);
      }
      
      // 重新加载配置
      const configPath = path.join(config.path, 'plugin.json');
      try {
        const configData = await fs.readFile(configPath, 'utf8');
        const newConfig = JSON.parse(configData);
        newConfig.path = config.path;
        this.pluginConfigs.set(name, newConfig);
      } catch (configError) {
        logger.warn(`无法重新加载插件配置 [${name}]:`, configError.message);
      }
      
      // 重新加载插件
      await this.loadPlugin(name);
      
      logger.info(`插件重新加载成功: ${name}`);
      this.emit('plugin_reloaded', { name });
      
      return true;
    } catch (error) {
      logger.error(`插件重新加载失败 [${name}]:`, error);
      throw error;
    }
  }

  /**
   * 启用插件
   */
  async enablePlugin(name) {
    try {
      const config = this.pluginConfigs.get(name);
      if (!config) {
        throw new Error(`插件配置不存在: ${name}`);
      }
      
      config.enabled = true;
      await this.savePluginConfig(name, config);
      
      if (!this.plugins.has(name)) {
        await this.loadPlugin(name);
      }
      
      logger.info(`插件启用成功: ${name}`);
      this.emit('plugin_enabled', { name });
      
      return true;
    } catch (error) {
      logger.error(`插件启用失败 [${name}]:`, error);
      throw error;
    }
  }

  /**
   * 禁用插件
   */
  async disablePlugin(name) {
    try {
      const config = this.pluginConfigs.get(name);
      if (!config) {
        throw new Error(`插件配置不存在: ${name}`);
      }
      
      config.enabled = false;
      await this.savePluginConfig(name, config);
      
      if (this.plugins.has(name)) {
        await this.unloadPlugin(name);
      }
      
      logger.info(`插件禁用成功: ${name}`);
      this.emit('plugin_disabled', { name });
      
      return true;
    } catch (error) {
      logger.error(`插件禁用失败 [${name}]:`, error);
      throw error;
    }
  }

  /**
   * 创建插件上下文
   */
  createPluginContext(name, config) {
    // 构建插件配置，将notebot.commands映射到config.commands
    const pluginConfig = {
      ...config.notebot?.config?.default || {},
      commands: config.notebot?.commands || []
    };
    
    const context = {
      name,
      config: pluginConfig,
      logger: logger.child({ plugin: name }),
      redis: this.redis,
      onebot: this.onebot,
      pluginManager: this,
      
      // 事件系统
      on: (event, handler) => this.on(`plugin:${name}:${event}`, handler),
      emit: (event, data) => this.emit(`plugin:${name}:${event}`, data),
      off: (event, handler) => this.off(`plugin:${name}:${event}`, handler),
      
      // 插件间通信
      sendToPlugin: (targetPlugin, message) => {
        return this.communication.sendMessage(name, targetPlugin, message);
      },
      
      broadcastToPlugins: (message) => {
        return this.communication.broadcast(name, message);
      },
      
      // 定时任务
      scheduler: {
        register: (cron, handler, options = {}) => {
          return this.scheduler.register(`${name}:${Date.now()}`, cron, handler, {
            ...options,
            plugin: name
          });
        },
        
        unregister: (taskId) => {
          return this.scheduler.unregister(taskId);
        },
        
        clearAll: () => {
          return this.scheduler.clearPluginTasks(name);
        }
      },
      
      // 数据存储
      storage: {
        set: (key, value, ttl) => {
          return this.redis.set(`plugin:${name}:${key}`, value, ttl);
        },
        
        get: (key) => {
          return this.redis.get(`plugin:${name}:${key}`);
        },
        
        del: (key) => {
          return this.redis.del(`plugin:${name}:${key}`);
        },
        
        exists: (key) => {
          return this.redis.exists(`plugin:${name}:${key}`);
        }
      },
      
      // Web 路由注册
      web: {
        registerRoute: (method, path, handler) => {
          this.emit('register_route', {
            plugin: name,
            method,
            path: `/plugins/${name}${path}`,
            handler
          });
        },
        
        registerStaticPath: (urlPath, localPath) => {
          this.emit('register_static', {
            plugin: name,
            urlPath: `/plugins/${name}${urlPath}`,
            localPath: path.resolve(config.path, localPath)
          });
        }
      }
    };
    
    return context;
  }

  /**
   * 启用热重载
   */
  enableHotReload() {
    this.watcher = chokidar.watch(this.pluginDir, {
      ignored: /node_modules/,
      persistent: true,
      ignoreInitial: true
    });
    
    this.watcher.on('change', async (filePath) => {
      const pluginName = this.getPluginNameFromPath(filePath);
      if (pluginName && this.plugins.has(pluginName)) {
        logger.info(`检测到插件文件变化，重新加载: ${pluginName}`);
        try {
          await this.reloadPlugin(pluginName);
        } catch (error) {
          logger.error(`热重载失败 [${pluginName}]:`, error);
        }
      }
    });
    
    logger.info('插件热重载已启用');
  }

  /**
   * 从文件路径获取插件名称
   */
  getPluginNameFromPath(filePath) {
    const relativePath = path.relative(this.pluginDir, filePath);
    const parts = relativePath.split(path.sep);
    return parts[0];
  }

  /**
   * 保存插件配置
   */
  async savePluginConfig(name, config) {
    try {
      const configPath = path.join(config.path, 'plugin.json');
      const configData = JSON.stringify(config, null, 2);
      await fs.writeFile(configPath, configData, 'utf8');
      
      this.pluginConfigs.set(name, config);
    } catch (error) {
      logger.error(`保存插件配置失败 [${name}]:`, error);
      throw error;
    }
  }

  /**
   * 保存插件状态到 Redis
   */
  async savePluginState(name) {
    try {
      const state = this.pluginStates.get(name);
      if (state) {
        await this.redis.set(`plugin_state:${name}`, state);
      }
    } catch (error) {
      logger.error(`保存插件状态失败 [${name}]:`, error);
    }
  }

  /**
   * 获取插件列表
   */
  getPluginList() {
    const plugins = [];
    
    for (const [name, config] of this.pluginConfigs) {
      const pluginData = this.plugins.get(name);
      const state = this.pluginStates.get(name);
      
      plugins.push({
        name,
        version: config.version,
        description: config.description,
        enabled: config.enabled !== false,
        loaded: !!pluginData,
        state: state?.status || 'unknown',
        loadedAt: pluginData?.loadedAt,
        config
      });
    }
    
    return plugins;
  }

  /**
   * 获取插件详情
   */
  getPluginDetails(name) {
    const config = this.pluginConfigs.get(name);
    const pluginData = this.plugins.get(name);
    const state = this.pluginStates.get(name);
    
    if (!config) {
      return null;
    }
    
    return {
      name,
      config,
      loaded: !!pluginData,
      state,
      loadedAt: pluginData?.loadedAt,
      instance: pluginData?.instance
    };
  }

  /**
   * 获取管理器状态
   */
  getStatus() {
    return {
      pluginCount: this.pluginConfigs.size,
      loadedCount: this.plugins.size,
      hotReloadEnabled: this.hotReloadEnabled,
      pluginDir: this.pluginDir
    };
  }

  /**
   * 关闭插件管理器
   */
  async close() {
    // 停止热重载监听
    if (this.watcher) {
      await this.watcher.close();
    }
    
    // 卸载所有插件
    const unloadPromises = [];
    for (const name of this.plugins.keys()) {
      unloadPromises.push(this.unloadPlugin(name).catch(error => {
        logger.error(`卸载插件失败 [${name}]:`, error);
      }));
    }
    
    await Promise.all(unloadPromises);
    
    logger.info('插件管理器已关闭');
  }

  /**
   * 获取插件管理器统计信息
   */
  getStats() {
    return {
      totalPlugins: this.plugins.size,
      enabledPlugins: Array.from(this.plugins.values()).filter(p => p.enabled).length,
      loadedPlugins: Array.from(this.plugins.values()).filter(p => p.instance).length,
      pluginList: Array.from(this.plugins.entries()).map(([name, plugin]) => ({
        name,
        enabled: plugin.enabled,
        loaded: !!plugin.instance,
        version: plugin.config.version || '1.0.0'
      }))
    };
  }
}

module.exports = PluginManager;