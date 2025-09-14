const EventEmitter = require('events');
const WebSocket = require('ws');
const axios = require('axios');
const crypto = require('crypto');
const express = require('express');
const logger = require('../../utils/logger');

/**
 * Onebot11 协议核心实现
 * 支持正向WebSocket、反向WebSocket、HTTP POST上报等多种连接模式
 */
class OnebotCore extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    
    // 连接管理
    this.connections = {
      reverseWs: null,      // 反向WebSocket服务器
      forwardWs: null,      // 正向WebSocket客户端
      httpApi: null,        // HTTP API服务器
      httpPost: null        // HTTP POST客户端
    };
    
    this.clients = new Map();           // 连接的客户端
    this.httpClients = new Map();       // HTTP客户端连接
    this.isConnected = false;
    this.heartbeatInterval = null;
    this.messageQueue = [];
    this.apiCallbacks = new Map();
    this.reconnectTimers = new Map();   // 重连定时器
    this.reconnectAttempts = {};        // 重连计数器
    
    // 消息统计
    this.messageStats = {
      totalMessages: 0,
      privateMessages: 0,
      groupMessages: 0,
      startTime: Date.now()
    };
    
    this.init();
  }

  /**
   * 初始化 Onebot 服务
   */
  async init() {
    try {
      const connections = this.config.connections || {};
      
      // 检查连接配置，确保只启用一个连接
      const enabledConnections = this.validateConnectionConfig(connections);
      
      if (enabledConnections.length === 0) {
        logger.warn('没有启用任何OneBot连接');
        return;
      }
      
      if (enabledConnections.length > 1) {
        logger.error(`检测到多个连接同时启用: ${enabledConnections.join(', ')}`);
        logger.error('OneBot每次只能启用一个连接类型，请检查配置');
        throw new Error('OneBot连接配置冲突：每次只能启用一个连接类型');
      }
      
      const activeConnection = enabledConnections[0];
      logger.info(`启用OneBot连接类型: ${activeConnection}`);
      
      // 根据启用的连接类型启动对应服务
      switch (activeConnection) {
        case 'reverse_ws':
          await this.startReverseWebSocket();
          break;
        case 'forward_ws':
          await this.startForwardWebSocket();
          break;
        case 'http_api':
          await this.startHttpApi();
          break;
        case 'http_post':
          this.startHttpPost();
          break;
        default:
          throw new Error(`未知的连接类型: ${activeConnection}`);
      }
      
      this.setupHeartbeat();
      logger.info(`Onebot11 核心服务启动成功 (${activeConnection})`);
    } catch (error) {
      logger.error('Onebot11 核心服务启动失败:', error);
      throw error;
    }
  }

  /**
   * 验证连接配置
   */
  validateConnectionConfig(connections) {
    const enabledConnections = [];
    
    if (connections.reverse_ws?.enabled) {
      enabledConnections.push('reverse_ws');
    }
    
    if (connections.forward_ws?.enabled) {
      enabledConnections.push('forward_ws');
    }
    
    if (connections.http_api?.enabled) {
      enabledConnections.push('http_api');
    }
    
    if (connections.http_post?.enabled) {
      enabledConnections.push('http_post');
    }
    
    return enabledConnections;
  }

  /**
   * 启动反向WebSocket服务器
   */
  async startReverseWebSocket() {
    const config = this.config.connections.reverse_ws;
    const port = config.port || 8080;
    
    this.connections.reverseWs = new WebSocket.Server({
      port,
      path: config.path || '/onebot/v11/ws',
      verifyClient: (info) => this.verifyClient(info, 'reverse_ws')
    });

    this.connections.reverseWs.on('connection', (ws, req) => {
      logger.info('反向WebSocket客户端连接:', req.socket.remoteAddress);
      this.handleReverseConnection(ws, req);
    });

    this.connections.reverseWs.on('error', (error) => {
      logger.error('反向WebSocket服务器错误:', error);
    });

    logger.info(`反向WebSocket服务器启动在端口 ${port}，路径: ${config.path || '/onebot/v11/ws'}`);
  }

  /**
   * 启动正向WebSocket客户端
   */
  async startForwardWebSocket() {
    const config = this.config.connections.forward_ws;
    const url = config.url;
    
    const connectForwardWs = () => {
      try {
        const headers = {};
        if (config.accessToken) {
          headers.Authorization = `Bearer ${config.accessToken}`;
        }
        
        this.connections.forwardWs = new WebSocket(url, { headers });
        
        this.connections.forwardWs.on('open', () => {
          logger.info('正向WebSocket连接成功:', url);
          this.isConnected = true;
          this.emit('connected', 'forward_ws');
          
          // 清除重连定时器和重置计数器
          if (this.reconnectTimers.has('forward_ws')) {
            clearTimeout(this.reconnectTimers.get('forward_ws'));
            this.reconnectTimers.delete('forward_ws');
          }
          this.reconnectAttempts.forward_ws = 0;
          
          // 启动心跳检测
          this.startForwardWsHeartbeat();
        });
        
        this.connections.forwardWs.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            this.handleForwardMessage(message);
          } catch (error) {
            logger.error('解析正向WebSocket消息失败:', error);
          }
        });
        
        this.connections.forwardWs.on('close', () => {
          logger.warn('正向WebSocket连接断开');
          this.isConnected = false;
          this.emit('disconnected', 'forward_ws');
          
          // 停止心跳检测
          this.stopForwardWsHeartbeat();
          
          // 自动重连（使用指数退避算法）
          const baseInterval = config.reconnectInterval || 5000;
          const maxAttempts = config.maxReconnectAttempts || 10;
          const currentAttempts = this.reconnectAttempts?.forward_ws || 0;
          
          if (currentAttempts < maxAttempts) {
            this.reconnectAttempts = this.reconnectAttempts || {};
            this.reconnectAttempts.forward_ws = currentAttempts + 1;
            
            // 指数退避：每次重连间隔翻倍，最大不超过60秒
            const backoffInterval = Math.min(baseInterval * Math.pow(2, currentAttempts), 60000);
            
            this.reconnectTimers.set('forward_ws', setTimeout(() => {
              logger.info(`尝试重连正向WebSocket... (${this.reconnectAttempts.forward_ws}/${maxAttempts}，间隔${backoffInterval}ms)`);
              connectForwardWs();
            }, backoffInterval));
          } else {
            logger.error('正向WebSocket重连次数已达上限，停止重连');
          }
        });
        
        this.connections.forwardWs.on('error', (error) => {
          logger.error('正向WebSocket连接错误:', error);
          this.emit('error', error);
        });
        
        this.connections.forwardWs.on('pong', () => {
          // 收到pong响应，更新最后心跳时间和计数
          this.lastForwardWsPong = Date.now();
          this.forwardWsPongCount++;
          logger.debug(`收到正向WebSocket pong响应 #${this.forwardWsPongCount}`);
        });
        
      } catch (error) {
        logger.error('创建正向WebSocket连接失败:', error);
        
        // 重连
        const reconnectInterval = config.reconnectInterval || 3000;
        this.reconnectTimers.set('forward_ws', setTimeout(() => {
          connectForwardWs();
        }, reconnectInterval));
      }
    };
    
    connectForwardWs();
  }

  /**
   * 启动HTTP API服务器
   */
  async startHttpApi() {
    const config = this.config.connections.http_api;
    const app = express();
    
    app.use(express.json());
    
    // 验证访问令牌中间件
    app.use((req, res, next) => {
      if (config.accessToken) {
        const token = req.headers.authorization?.replace('Bearer ', '') || req.query.access_token;
        if (token !== config.accessToken) {
          return res.status(401).json({ status: 'failed', retcode: 1403, msg: 'access token错误' });
        }
      }
      next();
    });
    
    // API路由
    app.post('/:action', async (req, res) => {
      try {
        const action = req.params.action;
        const params = req.body;
        
        // 处理API调用
        const result = await this.handleApiCall(action, params);
        res.json({ status: 'ok', retcode: 0, data: result });
      } catch (error) {
        logger.error('HTTP API调用失败:', error);
        res.status(500).json({ status: 'failed', retcode: 1400, msg: error.message });
      }
    });
    
    this.connections.httpApi = app.listen(config.port, config.host, () => {
      logger.info(`HTTP API服务器启动在 ${config.host}:${config.port}`);
    });
  }

  /**
   * 启动HTTP POST客户端
   */
  startHttpPost() {
    const config = this.config.connections.http_post;
    this.connections.httpPost = {
      url: config.url,
      timeout: config.timeout || 5000
    };
    
    logger.info('HTTP POST上报客户端已配置:', config.url);
  }

  /**
   * 验证客户端连接
   */
  verifyClient(info, connectionType = 'reverse_ws') {
    const config = this.config.connections[connectionType];
    const token = config?.accessToken;
    if (!token) return true;

    const authHeader = info.req.headers.authorization;
    if (!authHeader) return false;

    const providedToken = authHeader.replace('Bearer ', '');
    return providedToken === token;
  }

  /**
   * 处理反向WebSocket客户端连接
   */
  handleReverseConnection(ws, req) {
    const clientId = this.generateClientId();
    this.clients.set(clientId, {
      type: 'reverse_ws',
      ws,
      req,
      lastHeartbeat: Date.now()
    });

    this.isConnected = true;
    this.emit('connected', clientId);

    // 处理消息
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(clientId, message);
      } catch (error) {
        logger.error('解析反向WebSocket消息失败:', error);
      }
    });

    // 处理断开连接
    ws.on('close', () => {
      this.clients.delete(clientId);
      if (this.clients.size === 0) {
        this.isConnected = false;
      }
      this.emit('disconnected', clientId);
      logger.info('反向WebSocket客户端断开连接:', clientId);
    });

    // 处理错误
    ws.on('error', (error) => {
      logger.error('反向WebSocket连接错误:', error);
    });

    // 发送欢迎消息
    this.sendToClient(clientId, {
      post_type: 'meta_event',
      meta_event_type: 'lifecycle',
      sub_type: 'connect',
      time: Math.floor(Date.now() / 1000)
    });
  }

  /**
   * 处理正向WebSocket消息
   */
  handleForwardMessage(message) {
    logger.debug('收到正向WebSocket消息:', message);

    // 处理API调用响应
    if (message.echo && this.apiCallbacks.has(message.echo)) {
      const callback = this.apiCallbacks.get(message.echo);
      this.apiCallbacks.delete(message.echo);
      callback(message);
      return;
    }

    // 发送到事件总线
    this.emit('message', {
      clientId: 'forward_ws',
      message,
      timestamp: Date.now()
    });
  }

  /**
   * 处理API调用
   */
  async handleApiCall(action, params) {
    // 这里可以添加API调用的具体实现
    // 目前返回一个基本响应
    logger.info(`处理API调用: ${action}`, params);
    
    switch (action) {
      case 'get_login_info':
        return { user_id: 123456, nickname: 'NoteBot' };
      case 'send_private_msg':
        // 通过事件上报消息发送
        this.emit('api_call', { action, params });
        return { message_id: this.generateMessageId() };
      case 'send_group_msg':
        this.emit('api_call', { action, params });
        return { message_id: this.generateMessageId() };
      default:
        throw new Error(`不支持的API调用: ${action}`);
    }
  }

  /**
   * 生成消息ID
   */
  generateMessageId() {
    return Math.floor(Date.now() / 1000) * 1000 + Math.floor(Math.random() * 1000);
  }

  /**
   * 处理接收到的消息
   */
  handleMessage(clientId, message) {
    logger.debug('收到消息:', message);

    // 处理心跳
    if (message.post_type === 'meta_event' && message.meta_event_type === 'heartbeat') {
      const client = this.clients.get(clientId);
      if (client) {
        client.lastHeartbeat = Date.now();
      }
      return;
    }

    // 处理 API 调用响应
    if (message.echo && this.apiCallbacks.has(message.echo)) {
      const callback = this.apiCallbacks.get(message.echo);
      this.apiCallbacks.delete(message.echo);
      callback(message);
      return;
    }

    // HTTP POST上报
    if (this.connections.httpPost) {
      this.sendHttpPost(message);
    }

    // 发送到事件总线
    this.emit('message', {
      clientId,
      message,
      timestamp: Date.now()
    });
  }

  /**
   * HTTP POST上报
   */
  async sendHttpPost(data) {
    if (!this.connections.httpPost) return;
    
    const config = this.config.connections.http_post;
    
    try {
      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'OneBot/11'
      };
      
      if (config.accessToken) {
        headers.Authorization = `Bearer ${config.accessToken}`;
      }
      
      await axios.post(this.connections.httpPost.url, data, {
        headers,
        timeout: this.connections.httpPost.timeout
      });
      
      logger.debug('HTTP POST上报成功');
    } catch (error) {
      logger.error('HTTP POST上报失败:', error.message);
    }
  }

  /**
   * 发送消息到指定客户端
   */
  sendToClient(clientId, data) {
    const client = this.clients.get(clientId);
    if (!client) {
      logger.warn('客户端不存在:', clientId);
      return false;
    }

    if (client.type === 'reverse_ws') {
      if (client.ws.readyState !== WebSocket.OPEN) {
        logger.warn('反向WebSocket客户端不可用:', clientId);
        return false;
      }
      
      try {
        client.ws.send(JSON.stringify(data));
        return true;
      } catch (error) {
        logger.error('发送反向WebSocket消息失败:', error);
        return false;
      }
    }
    
    return false;
  }

  /**
   * 发送消息到正向WebSocket
   */
  sendToForwardWs(data) {
    if (!this.connections.forwardWs || this.connections.forwardWs.readyState !== WebSocket.OPEN) {
      logger.warn('正向WebSocket连接不可用');
      return false;
    }
    
    try {
      this.connections.forwardWs.send(JSON.stringify(data));
      return true;
    } catch (error) {
      logger.error('发送正向WebSocket消息失败:', error);
      return false;
    }
  }

  /**
   * 广播消息到所有客户端
   */
  broadcast(data) {
    let successCount = 0;
    
    // 发送到反向WebSocket客户端
    for (const [clientId] of this.clients) {
      if (this.sendToClient(clientId, data)) {
        successCount++;
      }
    }
    
    // 发送到正向WebSocket
    if (this.sendToForwardWs(data)) {
      successCount++;
    }
    
    return successCount;
  }

  /**
   * 调用 Onebot API
   */
  async callApi(action, params = {}, timeout = 30000) {
    // 优先使用HTTP API
    if (this.config.connections?.http_api?.enabled) {
      return this.callHttpApi(action, params);
    }
    
    // 使用WebSocket API - 检查实际连接状态
    const hasValidConnection = (
      (this.connections.forwardWs && this.connections.forwardWs.readyState === WebSocket.OPEN) ||
      (this.clients.size > 0)
    );
    
    if (!hasValidConnection) {
      throw new Error('Onebot 客户端未连接');
    }

    const echo = this.generateEcho();
    const apiCall = {
      action,
      params,
      echo
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.apiCallbacks.delete(echo);
        reject(new Error('API 调用超时'));
      }, timeout);

      this.apiCallbacks.set(echo, (response) => {
        clearTimeout(timer);
        if (response.status === 'ok') {
          resolve(response.data);
        } else {
          reject(new Error(response.msg || 'API 调用失败'));
        }
      });

      // 尝试发送API调用
      let sent = false;
      
      // 优先使用正向WebSocket
      if (this.connections.forwardWs && this.connections.forwardWs.readyState === WebSocket.OPEN) {
        sent = this.sendToForwardWs(apiCall);
      }
      
      // 如果正向WebSocket不可用，使用反向WebSocket
      if (!sent && this.clients.size > 0) {
        const firstClient = this.clients.keys().next().value;
        sent = this.sendToClient(firstClient, apiCall);
      }
      
      if (!sent) {
        this.apiCallbacks.delete(echo);
        clearTimeout(timer);
        reject(new Error('发送 API 调用失败'));
      }
    });
  }

  /**
   * HTTP API调用
   */
  async callHttpApi(action, params) {
    const config = this.config.connections.http_api;
    const url = `http://${config.host}:${config.port}/${action}`;
    
    const headers = {
      'Content-Type': 'application/json'
    };
    
    if (config.accessToken) {
      headers.Authorization = `Bearer ${config.accessToken}`;
    }
    
    try {
      const response = await axios.post(url, params, { headers });
      
      if (response.data.status === 'ok') {
        return response.data.data;
      } else {
        throw new Error(response.data.msg || 'API调用失败');
      }
    } catch (error) {
      if (error.response) {
        throw new Error(`HTTP API调用失败: ${error.response.status} ${error.response.statusText}`);
      } else {
        throw new Error(`HTTP API调用失败: ${error.message}`);
      }
    }
  }

  /**
   * 发送私聊消息
   */
  async sendPrivateMessage(userId, message, autoEscape = false) {
    return this.callApi('send_private_msg', {
      user_id: userId,
      message,
      auto_escape: autoEscape
    });
  }

  /**
   * 发送群消息
   */
  async sendGroupMessage(groupId, message, autoEscape = false) {
    return this.callApi('send_group_msg', {
      group_id: groupId,
      message,
      auto_escape: autoEscape
    });
  }

  /**
   * 获取登录信息
   */
  async getLoginInfo() {
    return this.callApi('get_login_info');
  }

  /**
   * 获取好友列表
   */
  async getFriendList() {
    return this.callApi('get_friend_list');
  }

  /**
   * 获取群列表
   */
  async getGroupList() {
    return this.callApi('get_group_list');
  }

  /**
   * 获取群成员列表
   */
  async getGroupMemberList(groupId) {
    return this.callApi('get_group_member_list', {
      group_id: groupId
    });
  }

  /**
   * 获取群成员信息
   */
  async getGroupMemberInfo(groupId, userId, noCache = false) {
    return this.callApi('get_group_member_info', {
      group_id: groupId,
      user_id: userId,
      no_cache: noCache
    });
  }

  /**
   * 获取陌生人信息
   */
  async getStrangerInfo(userId, noCache = false) {
    return this.callApi('get_stranger_info', {
      user_id: userId,
      no_cache: noCache
    });
  }

  /**
   * 撤回消息
   */
  async deleteMessage(messageId) {
    return this.callApi('delete_msg', {
      message_id: messageId
    });
  }

  /**
   * 获取消息
   */
  async getMessage(messageId) {
    return this.callApi('get_msg', {
      message_id: messageId
    });
  }

  /**
   * 转发消息
   */
  async forwardMessage(groupId, messageId) {
    return this.callApi('forward_msg', {
      group_id: groupId,
      message_id: messageId
    });
  }

  /**
   * 群组踢人
   */
  async setGroupKick(groupId, userId, rejectAddRequest = false) {
    return this.callApi('set_group_kick', {
      group_id: groupId,
      user_id: userId,
      reject_add_request: rejectAddRequest
    });
  }

  /**
   * 群组单人禁言
   */
  async setGroupBan(groupId, userId, duration = 30 * 60) {
    return this.callApi('set_group_ban', {
      group_id: groupId,
      user_id: userId,
      duration: duration
    });
  }

  /**
   * 群组全员禁言
   */
  async setGroupWholeBan(groupId, enable = true) {
    return this.callApi('set_group_whole_ban', {
      group_id: groupId,
      enable: enable
    });
  }

  /**
   * 群组设置管理员
   */
  async setGroupAdmin(groupId, userId, enable = true) {
    return this.callApi('set_group_admin', {
      group_id: groupId,
      user_id: userId,
      enable: enable
    });
  }

  /**
   * 设置群名片（群备注）
   */
  async setGroupCard(groupId, userId, card = '') {
    return this.callApi('set_group_card', {
      group_id: groupId,
      user_id: userId,
      card: card
    });
  }

  /**
   * 设置群名
   */
  async setGroupName(groupId, groupName) {
    return this.callApi('set_group_name', {
      group_id: groupId,
      group_name: groupName
    });
  }

  /**
   * 退出群组
   */
  async setGroupLeave(groupId, isDismiss = false) {
    return this.callApi('set_group_leave', {
      group_id: groupId,
      is_dismiss: isDismiss
    });
  }

  /**
   * 设置群组专属头衔
   */
  async setGroupSpecialTitle(groupId, userId, specialTitle = '', duration = -1) {
    return this.callApi('set_group_special_title', {
      group_id: groupId,
      user_id: userId,
      special_title: specialTitle,
      duration: duration
    });
  }

  /**
   * 处理加好友请求
   */
  async setFriendAddRequest(flag, approve = true, remark = '') {
    return this.callApi('set_friend_add_request', {
      flag: flag,
      approve: approve,
      remark: remark
    });
  }

  /**
   * 处理加群请求／邀请
   */
  async setGroupAddRequest(flag, subType, approve = true, reason = '') {
    return this.callApi('set_group_add_request', {
      flag: flag,
      sub_type: subType,
      approve: approve,
      reason: reason
    });
  }

  /**
   * 获取版本信息
   */
  async getVersionInfo() {
    return this.callApi('get_version_info');
  }

  /**
   * 重启 OneBot 实现
   */
  async setRestart(delay = 0) {
    return this.callApi('set_restart', {
      delay: delay
    });
  }

  /**
   * 清理缓存
   */
  async cleanCache() {
    return this.callApi('clean_cache');
  }

  /**
   * 设置心跳检测
   */
  setupHeartbeat() {
    const reverseWsConfig = this.config.connections.reverse_ws;
    const heartbeatInterval = reverseWsConfig?.heartbeatInterval || 30000;
    const timeout = heartbeatInterval * 2; // 心跳超时时间为间隔的2倍

    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();

      for (const [clientId, client] of this.httpClients) {
        if (now - client.lastHeartbeat > timeout) {
          logger.warn('客户端心跳超时，断开连接:', clientId);
          client.ws.terminate();
          this.httpClients.delete(clientId);
        }
      }

      if (this.httpClients.size === 0) {
        this.isConnected = false;
      }
    }, heartbeatInterval);
  }

  /**
   * 启动正向WebSocket心跳检测
   */
  startForwardWsHeartbeat() {
    const config = this.config.connections.forward_ws;
    const heartbeatInterval = config?.heartbeatInterval || 30000;
    const enableHeartbeat = config?.enableHeartbeat !== false; // 默认启用心跳检测
    
    if (!enableHeartbeat) {
      logger.debug('正向WebSocket心跳检测已禁用');
      return;
    }
    
    // 清除之前的心跳定时器
    this.stopForwardWsHeartbeat();
    
    // 初始化心跳状态
    this.lastForwardWsPing = Date.now();
    this.lastForwardWsPong = Date.now();
    this.forwardWsPingCount = 0;
    this.forwardWsPongCount = 0;
    
    // 发送ping的定时器
    this.forwardWsPingTimer = setInterval(() => {
      if (this.connections.forwardWs && this.connections.forwardWs.readyState === WebSocket.OPEN) {
        this.lastForwardWsPing = Date.now();
        this.forwardWsPingCount++;
        logger.debug(`发送正向WebSocket ping #${this.forwardWsPingCount}`);
        this.connections.forwardWs.ping();
        
        // 检查连接健康状态：如果连续多次ping没有pong响应，才认为连接有问题
        const missedPongs = this.forwardWsPingCount - this.forwardWsPongCount;
        if (missedPongs >= 3) {
          logger.warn(`正向WebSocket连续${missedPongs}次ping无响应，可能连接异常`);
          // 只有在连续多次无响应且连接状态异常时才断开
          if (this.connections.forwardWs.readyState !== WebSocket.OPEN) {
            logger.warn('正向WebSocket连接状态异常，主动断开连接');
            this.connections.forwardWs.terminate();
          }
        }
      }
    }, heartbeatInterval);
    
    logger.debug(`正向WebSocket心跳检测已启动，间隔${heartbeatInterval}ms`);
  }

  /**
   * 停止正向WebSocket心跳检测
   */
  stopForwardWsHeartbeat() {
    if (this.forwardWsPingTimer) {
      clearInterval(this.forwardWsPingTimer);
      this.forwardWsPingTimer = null;
    }
    
    // 清理心跳状态
    this.lastForwardWsPing = null;
    this.lastForwardWsPong = null;
    this.forwardWsPingCount = 0;
    this.forwardWsPongCount = 0;
    
    logger.debug('正向WebSocket心跳检测已停止');
  }

  /**
   * 生成客户端ID
   */
  generateClientId() {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * 生成 API 调用 echo
   */
  generateEcho() {
    return `api_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 获取连接状态
   */
  getStatus() {
    const now = Date.now();
    const uptimeMs = now - this.messageStats.startTime;
    
    return {
      connected: this.isConnected,
      clientCount: this.httpClients.size,
      uptime: process.uptime(),
      messageStats: {
        totalMessages: this.messageStats.totalMessages,
        privateMessages: this.messageStats.privateMessages,
        groupMessages: this.messageStats.groupMessages,
        startTime: this.messageStats.startTime,
        uptimeMs: uptimeMs
      },
      onlineUsers: this.httpClients.size // 使用连接的客户端数量作为在线用户数
    };
  }

  /**
   * 检查是否已连接
   */
  getConnectionStatus() {
    return this.isConnected;
  }

  /**
   * 关闭服务
   */
  async close() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    // 停止正向WebSocket心跳检测
    this.stopForwardWsHeartbeat();
    
    // 清除重连定时器
    for (const [key, timer] of this.reconnectTimers) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();

    if (this.wsServer) {
      this.wsServer.close();
    }
    
    // 关闭正向WebSocket连接
    if (this.connections.forwardWs) {
      this.connections.forwardWs.close();
    }

    this.httpClients.clear();
    this.apiCallbacks.clear();
    this.isConnected = false;
    
    logger.info('Onebot11 核心服务已关闭');
  }
}

module.exports = OnebotCore;