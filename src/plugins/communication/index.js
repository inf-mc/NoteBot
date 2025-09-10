const EventEmitter = require('events');
const logger = require('../../utils/logger');

/**
 * 插件间通信管理器
 */
class PluginCommunication extends EventEmitter {
  constructor(pluginManager) {
    super();
    this.pluginManager = pluginManager;
    this.messageQueue = new Map();
    this.subscriptions = new Map();
    this.messageHistory = [];
    this.maxHistorySize = 1000;
    
    this.init();
  }

  /**
   * 初始化通信管理器
   */
  init() {
    // 监听插件加载/卸载事件
    this.pluginManager.on('plugin_loaded', ({ name }) => {
      this.onPluginLoaded(name);
    });
    
    this.pluginManager.on('plugin_unloaded', ({ name }) => {
      this.onPluginUnloaded(name);
    });
    
    logger.debug('插件通信管理器初始化完成');
  }

  /**
   * 插件加载时的处理
   */
  onPluginLoaded(pluginName) {
    // 处理待发送的消息
    const queuedMessages = this.messageQueue.get(pluginName);
    if (queuedMessages && queuedMessages.length > 0) {
      logger.debug(`处理插件 ${pluginName} 的待发送消息: ${queuedMessages.length} 条`);
      
      for (const message of queuedMessages) {
        this.deliverMessage(message.from, pluginName, message.data, message.options);
      }
      
      this.messageQueue.delete(pluginName);
    }
    
    // 通知其他插件
    this.broadcast('system', {
      type: 'plugin_loaded',
      plugin: pluginName,
      timestamp: Date.now()
    }, { exclude: [pluginName] });
  }

  /**
   * 插件卸载时的处理
   */
  onPluginUnloaded(pluginName) {
    // 清理订阅
    this.subscriptions.delete(pluginName);
    
    // 清理消息队列
    this.messageQueue.delete(pluginName);
    
    // 通知其他插件
    this.broadcast('system', {
      type: 'plugin_unloaded',
      plugin: pluginName,
      timestamp: Date.now()
    }, { exclude: [pluginName] });
    
    logger.debug(`清理插件通信数据: ${pluginName}`);
  }

  /**
   * 发送消息给指定插件
   */
  async sendMessage(fromPlugin, toPlugin, data, options = {}) {
    try {
      const messageId = this.generateMessageId();
      const message = {
        id: messageId,
        from: fromPlugin,
        to: toPlugin,
        data,
        timestamp: Date.now(),
        options
      };
      
      // 记录消息历史
      this.addToHistory(message);
      
      // 检查目标插件是否已加载
      const targetPlugin = this.pluginManager.getPluginDetails(toPlugin);
      if (!targetPlugin || !targetPlugin.loaded) {
        if (options.queue !== false) {
          // 将消息加入队列
          this.queueMessage(toPlugin, message);
          logger.debug(`消息已加入队列 [${fromPlugin} -> ${toPlugin}]: ${messageId}`);
          return { queued: true, messageId };
        } else {
          throw new Error(`目标插件未加载: ${toPlugin}`);
        }
      }
      
      // 直接投递消息
      const result = await this.deliverMessage(fromPlugin, toPlugin, data, options);
      
      logger.debug(`消息发送成功 [${fromPlugin} -> ${toPlugin}]: ${messageId}`);
      return { delivered: true, messageId, result };
      
    } catch (error) {
      logger.error(`消息发送失败 [${fromPlugin} -> ${toPlugin}]:`, error);
      throw error;
    }
  }

  /**
   * 投递消息
   */
  async deliverMessage(fromPlugin, toPlugin, data, options = {}) {
    try {
      const pluginDetails = this.pluginManager.getPluginDetails(toPlugin);
      if (!pluginDetails || !pluginDetails.loaded) {
        throw new Error(`目标插件未加载: ${toPlugin}`);
      }
      
      const { instance } = pluginDetails;
      
      // 检查插件是否有消息处理方法
      if (typeof instance.onMessage === 'function') {
        const messageContext = {
          from: fromPlugin,
          to: toPlugin,
          timestamp: Date.now(),
          options
        };
        
        const result = await instance.onMessage(data, messageContext);
        
        // 触发消息投递事件
        this.emit('message_delivered', {
          from: fromPlugin,
          to: toPlugin,
          data,
          result,
          timestamp: Date.now()
        });
        
        return result;
      } else {
        logger.warn(`插件 ${toPlugin} 没有消息处理方法`);
        return null;
      }
      
    } catch (error) {
      logger.error(`消息投递失败 [${fromPlugin} -> ${toPlugin}]:`, error);
      
      // 触发消息投递失败事件
      this.emit('message_delivery_failed', {
        from: fromPlugin,
        to: toPlugin,
        data,
        error: error.message,
        timestamp: Date.now()
      });
      
      throw error;
    }
  }

  /**
   * 广播消息给所有插件
   */
  async broadcast(fromPlugin, data, options = {}) {
    try {
      const { exclude = [], include = [] } = options;
      const plugins = this.pluginManager.getPluginList();
      
      const targetPlugins = plugins.filter(plugin => {
        // 排除发送者自己
        if (plugin.name === fromPlugin) return false;
        
        // 排除指定插件
        if (exclude.includes(plugin.name)) return false;
        
        // 只包含指定插件（如果设置了 include）
        if (include.length > 0 && !include.includes(plugin.name)) return false;
        
        // 只广播给已加载的插件
        return plugin.loaded;
      });
      
      const results = [];
      const errors = [];
      
      for (const plugin of targetPlugins) {
        try {
          const result = await this.deliverMessage(fromPlugin, plugin.name, data, {
            ...options,
            broadcast: true
          });
          
          results.push({
            plugin: plugin.name,
            result,
            success: true
          });
          
        } catch (error) {
          errors.push({
            plugin: plugin.name,
            error: error.message,
            success: false
          });
        }
      }
      
      logger.debug(`广播消息完成 [${fromPlugin}]: 成功 ${results.length}, 失败 ${errors.length}`);
      
      return {
        totalTargets: targetPlugins.length,
        successful: results.length,
        failed: errors.length,
        results,
        errors
      };
      
    } catch (error) {
      logger.error(`广播消息失败 [${fromPlugin}]:`, error);
      throw error;
    }
  }

  /**
   * 订阅特定类型的消息
   */
  subscribe(pluginName, messageType, handler) {
    try {
      if (!this.subscriptions.has(pluginName)) {
        this.subscriptions.set(pluginName, new Map());
      }
      
      const pluginSubscriptions = this.subscriptions.get(pluginName);
      
      if (!pluginSubscriptions.has(messageType)) {
        pluginSubscriptions.set(messageType, []);
      }
      
      const handlers = pluginSubscriptions.get(messageType);
      handlers.push(handler);
      
      logger.debug(`插件 ${pluginName} 订阅消息类型: ${messageType}`);
      
      // 返回取消订阅函数
      return () => {
        this.unsubscribe(pluginName, messageType, handler);
      };
      
    } catch (error) {
      logger.error(`订阅消息失败 [${pluginName}]:`, error);
      throw error;
    }
  }

  /**
   * 取消订阅
   */
  unsubscribe(pluginName, messageType, handler) {
    try {
      const pluginSubscriptions = this.subscriptions.get(pluginName);
      if (!pluginSubscriptions) return false;
      
      const handlers = pluginSubscriptions.get(messageType);
      if (!handlers) return false;
      
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
        
        // 如果没有处理器了，删除该消息类型
        if (handlers.length === 0) {
          pluginSubscriptions.delete(messageType);
        }
        
        // 如果插件没有任何订阅了，删除插件记录
        if (pluginSubscriptions.size === 0) {
          this.subscriptions.delete(pluginName);
        }
        
        logger.debug(`插件 ${pluginName} 取消订阅消息类型: ${messageType}`);
        return true;
      }
      
      return false;
      
    } catch (error) {
      logger.error(`取消订阅失败 [${pluginName}]:`, error);
      return false;
    }
  }

  /**
   * 发布消息给订阅者
   */
  async publish(messageType, data, fromPlugin = 'system') {
    try {
      const results = [];
      const errors = [];
      
      for (const [pluginName, pluginSubscriptions] of this.subscriptions) {
        const handlers = pluginSubscriptions.get(messageType);
        if (!handlers || handlers.length === 0) continue;
        
        for (const handler of handlers) {
          try {
            const result = await handler(data, {
              type: messageType,
              from: fromPlugin,
              to: pluginName,
              timestamp: Date.now()
            });
            
            results.push({
              plugin: pluginName,
              result,
              success: true
            });
            
          } catch (error) {
            errors.push({
              plugin: pluginName,
              error: error.message,
              success: false
            });
            
            logger.error(`消息处理失败 [${pluginName}]:`, error);
          }
        }
      }
      
      logger.debug(`发布消息完成 [${messageType}]: 成功 ${results.length}, 失败 ${errors.length}`);
      
      return {
        messageType,
        successful: results.length,
        failed: errors.length,
        results,
        errors
      };
      
    } catch (error) {
      logger.error(`发布消息失败 [${messageType}]:`, error);
      throw error;
    }
  }

  /**
   * 将消息加入队列
   */
  queueMessage(toPlugin, message) {
    if (!this.messageQueue.has(toPlugin)) {
      this.messageQueue.set(toPlugin, []);
    }
    
    const queue = this.messageQueue.get(toPlugin);
    queue.push(message);
    
    // 限制队列大小
    const maxQueueSize = 100;
    if (queue.length > maxQueueSize) {
      queue.shift(); // 移除最旧的消息
      logger.warn(`插件 ${toPlugin} 消息队列已满，移除最旧消息`);
    }
  }

  /**
   * 生成消息ID
   */
  generateMessageId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 添加到消息历史
   */
  addToHistory(message) {
    this.messageHistory.push({
      ...message,
      recordedAt: Date.now()
    });
    
    // 限制历史记录大小
    if (this.messageHistory.length > this.maxHistorySize) {
      this.messageHistory.shift();
    }
  }

  /**
   * 获取消息历史
   */
  getMessageHistory(options = {}) {
    const { fromPlugin, toPlugin, limit = 50, since } = options;
    
    let history = this.messageHistory;
    
    // 过滤条件
    if (fromPlugin) {
      history = history.filter(msg => msg.from === fromPlugin);
    }
    
    if (toPlugin) {
      history = history.filter(msg => msg.to === toPlugin);
    }
    
    if (since) {
      history = history.filter(msg => msg.timestamp >= since);
    }
    
    // 限制数量
    return history.slice(-limit);
  }

  /**
   * 获取插件的消息队列
   */
  getMessageQueue(pluginName) {
    return this.messageQueue.get(pluginName) || [];
  }

  /**
   * 清空插件的消息队列
   */
  clearMessageQueue(pluginName) {
    this.messageQueue.delete(pluginName);
    logger.debug(`清空插件消息队列: ${pluginName}`);
  }

  /**
   * 获取通信统计
   */
  getStats() {
    const queueSizes = {};
    for (const [plugin, queue] of this.messageQueue) {
      queueSizes[plugin] = queue.length;
    }
    
    const subscriptionCounts = {};
    for (const [plugin, subscriptions] of this.subscriptions) {
      subscriptionCounts[plugin] = subscriptions.size;
    }
    
    return {
      messageHistory: this.messageHistory.length,
      queuedMessages: Array.from(this.messageQueue.values()).reduce((sum, queue) => sum + queue.length, 0),
      activeSubscriptions: Array.from(this.subscriptions.values()).reduce((sum, subs) => sum + subs.size, 0),
      queueSizes,
      subscriptionCounts
    };
  }

  /**
   * 清理通信数据
   */
  cleanup() {
    // 清理过期的消息历史
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    this.messageHistory = this.messageHistory.filter(msg => msg.timestamp > oneHourAgo);
    
    logger.debug('通信数据清理完成');
  }

  /**
   * 关闭通信管理器
   */
  close() {
    this.messageQueue.clear();
    this.subscriptions.clear();
    this.messageHistory = [];
    this.removeAllListeners();
    
    logger.debug('插件通信管理器已关闭');
  }
}

module.exports = PluginCommunication;