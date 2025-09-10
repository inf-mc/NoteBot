const EventEmitter = require('events');
const WebSocket = require('ws');
const axios = require('axios');
const crypto = require('crypto');
const logger = require('../../utils/logger');

/**
 * Onebot11 协议核心实现
 */
class OnebotCore extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.wsServer = null;
    this.httpClients = new Map();
    this.isConnected = false;
    this.heartbeatInterval = null;
    this.messageQueue = [];
    this.apiCallbacks = new Map();
    
    this.init();
  }

  /**
   * 初始化 Onebot 服务
   */
  async init() {
    try {
      await this.startWebSocketServer();
      this.setupHeartbeat();
      logger.info('Onebot11 核心服务启动成功');
    } catch (error) {
      logger.error('Onebot11 核心服务启动失败:', error);
      throw error;
    }
  }

  /**
   * 启动 WebSocket 服务器
   */
  async startWebSocketServer() {
    const port = this.config.wsPort || 8080;
    
    this.wsServer = new WebSocket.Server({
      port,
      verifyClient: (info) => this.verifyClient(info)
    });

    this.wsServer.on('connection', (ws, req) => {
      logger.info('Onebot 客户端连接:', req.socket.remoteAddress);
      this.handleConnection(ws, req);
    });

    this.wsServer.on('error', (error) => {
      logger.error('WebSocket 服务器错误:', error);
    });

    logger.info(`Onebot WebSocket 服务器启动在端口 ${port}`);
  }

  /**
   * 验证客户端连接
   */
  verifyClient(info) {
    const token = this.config.accessToken;
    if (!token) return true;

    const authHeader = info.req.headers.authorization;
    if (!authHeader) return false;

    const providedToken = authHeader.replace('Bearer ', '');
    return providedToken === token;
  }

  /**
   * 处理客户端连接
   */
  handleConnection(ws, req) {
    const clientId = this.generateClientId();
    this.httpClients.set(clientId, {
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
        logger.error('解析消息失败:', error);
      }
    });

    // 处理断开连接
    ws.on('close', () => {
      this.httpClients.delete(clientId);
      if (this.httpClients.size === 0) {
        this.isConnected = false;
      }
      this.emit('disconnected', clientId);
      logger.info('Onebot 客户端断开连接:', clientId);
    });

    // 处理错误
    ws.on('error', (error) => {
      logger.error('WebSocket 连接错误:', error);
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
   * 处理接收到的消息
   */
  handleMessage(clientId, message) {
    logger.debug('收到消息:', message);

    // 处理心跳
    if (message.post_type === 'meta_event' && message.meta_event_type === 'heartbeat') {
      const client = this.httpClients.get(clientId);
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

    // 发送到事件总线
    this.emit('message', {
      clientId,
      message,
      timestamp: Date.now()
    });
  }

  /**
   * 发送消息到指定客户端
   */
  sendToClient(clientId, data) {
    const client = this.httpClients.get(clientId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) {
      logger.warn('客户端不可用:', clientId);
      return false;
    }

    try {
      client.ws.send(JSON.stringify(data));
      return true;
    } catch (error) {
      logger.error('发送消息失败:', error);
      return false;
    }
  }

  /**
   * 广播消息到所有客户端
   */
  broadcast(data) {
    let successCount = 0;
    for (const [clientId] of this.httpClients) {
      if (this.sendToClient(clientId, data)) {
        successCount++;
      }
    }
    return successCount;
  }

  /**
   * 调用 Onebot API
   */
  async callApi(action, params = {}, timeout = 30000) {
    if (!this.isConnected) {
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

      // 发送到第一个可用客户端
      const firstClient = this.httpClients.keys().next().value;
      if (!this.sendToClient(firstClient, apiCall)) {
        this.apiCallbacks.delete(echo);
        clearTimeout(timer);
        reject(new Error('发送 API 调用失败'));
      }
    });
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
   * 设置心跳检测
   */
  setupHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const timeout = 60000; // 60秒超时

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
    }, 30000); // 每30秒检查一次
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
    return {
      connected: this.isConnected,
      clientCount: this.httpClients.size,
      uptime: process.uptime()
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

    if (this.wsServer) {
      this.wsServer.close();
    }

    this.httpClients.clear();
    this.apiCallbacks.clear();
    this.isConnected = false;
    
    logger.info('Onebot11 核心服务已关闭');
  }
}

module.exports = OnebotCore;