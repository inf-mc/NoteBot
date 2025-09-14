const logger = require('../../utils/logger');

/**
 * Onebot11 消息处理器
 */
class MessageHandler {
  constructor(onebotCore, pluginManager) {
    this.onebot = onebotCore;
    this.pluginManager = pluginManager;
    this.messageFilters = new Map();
    this.eventHandlers = new Map();
    
    this.init();
  }

  /**
   * 初始化消息处理器
   */
  init() {
    // 监听 Onebot 消息
    this.onebot.on('message', this.handleMessage.bind(this));
    
    // 注册默认处理器
    this.registerDefaultHandlers();
    
    logger.info('消息处理器初始化完成');
  }

  /**
   * 注册默认消息处理器
   */
  registerDefaultHandlers() {
    // 私聊消息处理
    this.registerHandler('message.private', async (data) => {
      const { message } = data;
      logger.info(`[NoteBot] <- 私聊 [${message.user_id}] ${message.raw_message}`);
      /*
      // 详细消息日志
      logger.info('OneBot]:', {
        messageId: message.message_id,
        userId: message.user_id,
        time: new Date(message.time * 1000).toLocaleString(),
        rawMessage: message.raw_message,
        message: message.message,
        sender: message.sender,
        postType: message.post_type,
        messageType: message.message_type,
        subType: message.sub_type,
        font: message.font,
        rawData: JSON.stringify(message, null, 2)
      });
      */
      // 触发插件事件
      await this.pluginManager.emit('private_message', {
        userId: message.user_id,
        message: message.raw_message,
        messageId: message.message_id,
        time: message.time,
        sender: message.sender,
        rawData: message
      });
    });

    // 群消息处理
    this.registerHandler('message.group', async (data) => {
      const { message } = data;
      
      // 获取群信息和用户昵称
      let groupName = message.group_id;
      let userName = message.user_id;
      
      try {
        // 尝试获取群信息
        const groupInfo = await this.onebot.callApi('get_group_info', { group_id: message.group_id });
        if (groupInfo && groupInfo.group_name) {
          groupName = `${groupInfo.group_name}(${message.group_id})`;
        }
      } catch (error) {
        logger.debug('获取群信息失败:', error.message);
      }
      
      // 从sender中获取用户昵称
      if (message.sender && message.sender.nickname) {
        userName = `${message.sender.nickname}(${message.user_id})`;
      } else if (message.sender && message.sender.card) {
        userName = `${message.sender.card}(${message.user_id})`;
      }
      
      logger.info(`[NoteBot] <- 群聊 [${groupName}] [${userName}] ${message.raw_message}`);
      /*
      // 详细消息日志
      logger.info('OneBot群消息详情:', {
        messageId: message.message_id,
        groupId: message.group_id,
        userId: message.user_id,
        time: new Date(message.time * 1000).toLocaleString(),
        rawMessage: message.raw_message,
        message: message.message,
        sender: message.sender,
        postType: message.post_type,
        messageType: message.message_type,
        subType: message.sub_type,
        font: message.font,
        rawData: JSON.stringify(message, null, 2)
      });
      */
      // 触发插件事件
      await this.pluginManager.emit('group_message', {
        groupId: message.group_id,
        userId: message.user_id,
        message: message.raw_message,
        messageId: message.message_id,
        time: message.time,
        sender: message.sender,
        rawData: message
      });
    });

    // 群通知处理
    this.registerHandler('notice.group_upload', async (data) => {
      const { message } = data;
      logger.info(`群文件上传 [${message.group_id}][${message.user_id}]: ${message.file.name}`);
      
      await this.pluginManager.emit('group_upload', {
        groupId: message.group_id,
        userId: message.user_id,
        file: message.file,
        time: message.time
      });
    });

    // 群成员增加
    this.registerHandler('notice.group_increase', async (data) => {
      const { message } = data;
      logger.info(`群成员增加 [${message.group_id}]: ${message.user_id}`);
      
      await this.pluginManager.emit('group_increase', {
        groupId: message.group_id,
        userId: message.user_id,
        operatorId: message.operator_id,
        subType: message.sub_type,
        time: message.time
      });
    });

    // 群成员减少
    this.registerHandler('notice.group_decrease', async (data) => {
      const { message } = data;
      logger.info(`群成员减少 [${message.group_id}]: ${message.user_id}`);
      
      await this.pluginManager.emit('group_decrease', {
        groupId: message.group_id,
        userId: message.user_id,
        operatorId: message.operator_id,
        subType: message.sub_type,
        time: message.time
      });
    });

    // 好友请求
    this.registerHandler('request.friend', async (data) => {
      const { message } = data;
      logger.info(`收到好友请求 [${message.user_id}]: ${message.comment}`);
      
      await this.pluginManager.emit('friend_request', {
        userId: message.user_id,
        comment: message.comment,
        flag: message.flag,
        time: message.time
      });
    });

    // 群请求
    this.registerHandler('request.group', async (data) => {
      const { message } = data;
      logger.info(`收到群请求 [${message.group_id}][${message.user_id}]: ${message.comment}`);
      
      await this.pluginManager.emit('group_request', {
        groupId: message.group_id,
        userId: message.user_id,
        comment: message.comment,
        flag: message.flag,
        subType: message.sub_type,
        time: message.time
      });
    });
  }

  /**
   * 处理接收到的消息
   */
  async handleMessage(message) {
    try {
      // 记录所有OneBot收到的原始消息
      /*
      logger.info('OneBot收到消息:', {
        timestamp: new Date().toLocaleString(),
        messageType: this.getMessageType(message),
        postType: message.post_type,
        rawData: JSON.stringify(message, null, 2)
      });
      */
      // 应用消息过滤器
      if (!this.applyFilters(message)) {
        logger.debug('消息被过滤器拦截');
        return;
      }

      // 确定消息类型
      const messageType = this.getMessageType(message);
      
      // 更新OneBot核心模块的消息统计
      if (message.post_type === 'message') {
        this.onebot.messageStats.totalMessages++;
        if (message.message_type === 'private') {
          this.onebot.messageStats.privateMessages++;
        } else if (message.message_type === 'group') {
          this.onebot.messageStats.groupMessages++;
        }
      }
      
      // 查找对应的处理器
      const handler = this.eventHandlers.get(messageType);
      if (handler) {
        await handler({ message });
      } else {
        logger.debug(`未找到处理器: ${messageType}`);
      }
      
      // 触发通用事件
      await this.pluginManager.emit('any_message', {
        type: messageType,
        data: message,
        timestamp: Date.now()
      });
      
    } catch (error) {
      logger.error('处理消息时发生错误:', error);
    }
  }

  /**
   * 获取消息类型
   */
  getMessageType(message) {
    const { post_type, message_type, notice_type, request_type, sub_type } = message;
    
    if (post_type === 'message') {
      return `message.${message_type}`;
    } else if (post_type === 'notice') {
      return `notice.${notice_type}`;
    } else if (post_type === 'request') {
      return `request.${request_type}`;
    } else if (post_type === 'meta_event') {
      return `meta.${message.meta_event_type}`;
    }
    
    return 'unknown';
  }

  /**
   * 注册事件处理器
   */
  registerHandler(eventType, handler) {
    this.eventHandlers.set(eventType, handler);
    logger.debug(`注册事件处理器: ${eventType}`);
  }

  /**
   * 注销事件处理器
   */
  unregisterHandler(eventType) {
    this.eventHandlers.delete(eventType);
    logger.debug(`注销事件处理器: ${eventType}`);
  }

  /**
   * 注册消息过滤器
   */
  registerFilter(name, filter) {
    this.messageFilters.set(name, filter);
    logger.debug(`注册消息过滤器: ${name}`);
  }

  /**
   * 注销消息过滤器
   */
  unregisterFilter(name) {
    this.messageFilters.delete(name);
    logger.debug(`注销消息过滤器: ${name}`);
  }

  /**
   * 应用消息过滤器
   */
  applyFilters(message) {
    for (const [name, filter] of this.messageFilters) {
      try {
        if (!filter(message)) {
          logger.debug(`消息被过滤器拦截: ${name}`);
          return false;
        }
      } catch (error) {
        logger.error(`过滤器执行错误 [${name}]:`, error);
      }
    }
    return true;
  }

  /**
   * 创建消息构建器
   */
  createMessageBuilder() {
    return new MessageBuilder(this.onebot);
  }

  /**
   * 获取处理器统计信息
   */
  getStats() {
    return {
      handlerCount: this.eventHandlers.size,
      filterCount: this.messageFilters.size,
      registeredHandlers: Array.from(this.eventHandlers.keys()),
      registeredFilters: Array.from(this.messageFilters.keys())
    };
  }
}

/**
 * 消息构建器
 */
class MessageBuilder {
  constructor(onebotCore) {
    this.onebot = onebotCore;
    this.segments = [];
  }

  /**
   * 添加文本
   */
  text(content) {
    this.segments.push({
      type: 'text',
      data: { text: content }
    });
    return this;
  }

  /**
   * 添加表情
   */
  face(id) {
    this.segments.push({
      type: 'face',
      data: { id: id.toString() }
    });
    return this;
  }

  /**
   * 添加图片
   */
  image(file, type = null, cache = true) {
    const data = { file };
    if (type) data.type = type;
    if (!cache) data.cache = 0;
    
    this.segments.push({
      type: 'image',
      data
    });
    return this;
  }

  /**
   * 添加语音
   */
  record(file, magic = false) {
    this.segments.push({
      type: 'record',
      data: {
        file,
        magic: magic ? 1 : 0
      }
    });
    return this;
  }

  /**
   * 添加视频
   */
  video(file, cover = null) {
    const data = { file };
    if (cover) data.cover = cover;
    
    this.segments.push({
      type: 'video',
      data
    });
    return this;
  }

  /**
   * 添加 @ 某人
   */
  at(qq) {
    this.segments.push({
      type: 'at',
      data: { qq: qq.toString() }
    });
    return this;
  }

  /**
   * 添加回复
   */
  reply(messageId) {
    this.segments.push({
      type: 'reply',
      data: { id: messageId.toString() }
    });
    return this;
  }

  /**
   * 构建消息
   */
  build() {
    return this.segments;
  }

  /**
   * 发送私聊消息
   */
  async sendPrivate(userId) {
    return this.onebot.sendPrivateMessage(userId, this.build());
  }

  /**
   * 发送群消息
   */
  async sendGroup(groupId) {
    return this.onebot.sendGroupMessage(groupId, this.build());
  }

  /**
   * 清空消息
   */
  clear() {
    this.segments = [];
    return this;
  }
}

module.exports = { MessageHandler, MessageBuilder };