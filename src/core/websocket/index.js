const WebSocket = require('ws');
const EventEmitter = require('events');
const jwt = require('jsonwebtoken');
const logger = require('../../utils/logger');

/**
 * WebSocket 服务管理器
 */
class WebSocketManager extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.server = null;
    this.clients = new Map();
    this.rooms = new Map();
    this.isRunning = false;
    
    this.heartbeatInterval = null;
    this.heartbeatTimeout = 30000; // 30秒心跳超时
  }

  /**
   * 启动 WebSocket 服务器
   */
  async start() {
    try {
      const port = this.config.port || 3001;
      
      this.server = new WebSocket.Server({
        port,
        verifyClient: this.verifyClient.bind(this)
      });

      this.server.on('connection', this.handleConnection.bind(this));
      this.server.on('error', this.handleError.bind(this));
      
      this.startHeartbeat();
      this.isRunning = true;
      
      logger.info(`WebSocket 服务器启动在端口 ${port}`);
      this.emit('started', { port });
    } catch (error) {
      logger.error('WebSocket 服务器启动失败:', error);
      throw error;
    }
  }

  /**
   * 验证客户端连接
   */
  verifyClient(info) {
    try {
      const url = new URL(info.req.url, `http://${info.req.headers.host}`);
      const token = url.searchParams.get('token');
      
      if (!token && this.config.requireAuth) {
        logger.warn('WebSocket 连接被拒绝: 缺少认证令牌');
        return false;
      }
      
      if (token && this.config.jwtSecret) {
        try {
          jwt.verify(token, this.config.jwtSecret);
        } catch (error) {
          logger.warn('WebSocket 连接被拒绝: 无效的认证令牌');
          return false;
        }
      }
      
      return true;
    } catch (error) {
      logger.error('验证 WebSocket 客户端时发生错误:', error);
      return false;
    }
  }

  /**
   * 处理新的客户端连接
   */
  handleConnection(ws, req) {
    const clientId = this.generateClientId();
    const clientInfo = {
      id: clientId,
      ws,
      req,
      ip: req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      connectedAt: Date.now(),
      lastHeartbeat: Date.now(),
      rooms: new Set(),
      metadata: {}
    };

    this.clients.set(clientId, clientInfo);
    
    logger.info(`WebSocket 客户端连接 [${clientId}] from ${clientInfo.ip}`);
    
    // 发送欢迎消息
    this.sendToClient(clientId, {
      type: 'welcome',
      clientId,
      timestamp: Date.now()
    });

    // 设置消息处理
    ws.on('message', (data) => {
      this.handleMessage(clientId, data);
    });

    // 设置连接关闭处理
    ws.on('close', (code, reason) => {
      this.handleDisconnection(clientId, code, reason);
    });

    // 设置错误处理
    ws.on('error', (error) => {
      logger.error(`WebSocket 客户端错误 [${clientId}]:`, error);
    });

    // 设置 pong 处理（心跳响应）
    ws.on('pong', () => {
      const client = this.clients.get(clientId);
      if (client) {
        client.lastHeartbeat = Date.now();
      }
    });

    this.emit('client_connected', clientInfo);
  }

  /**
   * 处理客户端消息
   */
  handleMessage(clientId, data) {
    try {
      const message = JSON.parse(data.toString());
      const client = this.clients.get(clientId);
      
      if (!client) {
        return;
      }

      // 更新心跳时间
      client.lastHeartbeat = Date.now();

      // 处理不同类型的消息
      switch (message.type) {
        case 'ping':
          this.handlePing(clientId, message);
          break;
        case 'join_room':
          this.handleJoinRoom(clientId, message);
          break;
        case 'leave_room':
          this.handleLeaveRoom(clientId, message);
          break;
        case 'room_message':
          this.handleRoomMessage(clientId, message);
          break;
        case 'private_message':
          this.handlePrivateMessage(clientId, message);
          break;
        case 'subscribe':
          this.handleSubscribe(clientId, message);
          break;
        case 'unsubscribe':
          this.handleUnsubscribe(clientId, message);
          break;
        default:
          this.handleCustomMessage(clientId, message);
      }

      this.emit('message', {
        clientId,
        message,
        client
      });
    } catch (error) {
      logger.error(`处理 WebSocket 消息失败 [${clientId}]:`, error);
      this.sendError(clientId, 'INVALID_MESSAGE', '消息格式错误');
    }
  }

  /**
   * 处理 ping 消息
   */
  handlePing(clientId, message) {
    this.sendToClient(clientId, {
      type: 'pong',
      timestamp: Date.now(),
      echo: message.echo
    });
  }

  /**
   * 处理加入房间
   */
  handleJoinRoom(clientId, message) {
    const { room } = message;
    if (!room) {
      this.sendError(clientId, 'INVALID_ROOM', '房间名称不能为空');
      return;
    }

    this.joinRoom(clientId, room);
    this.sendToClient(clientId, {
      type: 'room_joined',
      room,
      timestamp: Date.now()
    });
  }

  /**
   * 处理离开房间
   */
  handleLeaveRoom(clientId, message) {
    const { room } = message;
    if (!room) {
      this.sendError(clientId, 'INVALID_ROOM', '房间名称不能为空');
      return;
    }

    this.leaveRoom(clientId, room);
    this.sendToClient(clientId, {
      type: 'room_left',
      room,
      timestamp: Date.now()
    });
  }

  /**
   * 处理房间消息
   */
  handleRoomMessage(clientId, message) {
    const { room, data } = message;
    if (!room || !data) {
      this.sendError(clientId, 'INVALID_MESSAGE', '房间消息格式错误');
      return;
    }

    this.broadcastToRoom(room, {
      type: 'room_message',
      room,
      from: clientId,
      data,
      timestamp: Date.now()
    }, clientId);
  }

  /**
   * 处理私聊消息
   */
  handlePrivateMessage(clientId, message) {
    const { to, data } = message;
    if (!to || !data) {
      this.sendError(clientId, 'INVALID_MESSAGE', '私聊消息格式错误');
      return;
    }

    if (!this.clients.has(to)) {
      this.sendError(clientId, 'CLIENT_NOT_FOUND', '目标客户端不存在');
      return;
    }

    this.sendToClient(to, {
      type: 'private_message',
      from: clientId,
      data,
      timestamp: Date.now()
    });
  }

  /**
   * 处理订阅
   */
  handleSubscribe(clientId, message) {
    const { channel } = message;
    if (!channel) {
      this.sendError(clientId, 'INVALID_CHANNEL', '频道名称不能为空');
      return;
    }

    const client = this.clients.get(clientId);
    if (client) {
      if (!client.subscriptions) {
        client.subscriptions = new Set();
      }
      client.subscriptions.add(channel);
      
      this.sendToClient(clientId, {
        type: 'subscribed',
        channel,
        timestamp: Date.now()
      });
    }
  }

  /**
   * 处理取消订阅
   */
  handleUnsubscribe(clientId, message) {
    const { channel } = message;
    if (!channel) {
      this.sendError(clientId, 'INVALID_CHANNEL', '频道名称不能为空');
      return;
    }

    const client = this.clients.get(clientId);
    if (client && client.subscriptions) {
      client.subscriptions.delete(channel);
      
      this.sendToClient(clientId, {
        type: 'unsubscribed',
        channel,
        timestamp: Date.now()
      });
    }
  }

  /**
   * 处理自定义消息
   */
  handleCustomMessage(clientId, message) {
    this.emit('custom_message', {
      clientId,
      message,
      client: this.clients.get(clientId)
    });
  }

  /**
   * 处理客户端断开连接
   */
  handleDisconnection(clientId, code, reason) {
    const client = this.clients.get(clientId);
    if (!client) {
      return;
    }

    // 从所有房间中移除
    for (const room of client.rooms) {
      this.leaveRoom(clientId, room, false);
    }

    this.clients.delete(clientId);
    
    logger.info(`WebSocket 客户端断开连接 [${clientId}] code: ${code}`);
    
    this.emit('client_disconnected', {
      clientId,
      client,
      code,
      reason: reason?.toString()
    });
  }

  /**
   * 处理服务器错误
   */
  handleError(error) {
    logger.error('WebSocket 服务器错误:', error);
    this.emit('error', error);
  }

  /**
   * 加入房间
   */
  joinRoom(clientId, room) {
    const client = this.clients.get(clientId);
    if (!client) {
      return false;
    }

    // 添加客户端到房间
    if (!this.rooms.has(room)) {
      this.rooms.set(room, new Set());
    }
    this.rooms.get(room).add(clientId);
    
    // 添加房间到客户端
    client.rooms.add(room);
    
    logger.debug(`客户端 [${clientId}] 加入房间 [${room}]`);
    return true;
  }

  /**
   * 离开房间
   */
  leaveRoom(clientId, room, notify = true) {
    const client = this.clients.get(clientId);
    if (!client) {
      return false;
    }

    // 从房间中移除客户端
    if (this.rooms.has(room)) {
      this.rooms.get(room).delete(clientId);
      
      // 如果房间为空，删除房间
      if (this.rooms.get(room).size === 0) {
        this.rooms.delete(room);
      }
    }
    
    // 从客户端中移除房间
    client.rooms.delete(room);
    
    if (notify) {
      logger.debug(`客户端 [${clientId}] 离开房间 [${room}]`);
    }
    
    return true;
  }

  /**
   * 发送消息到指定客户端
   */
  sendToClient(clientId, data) {
    const client = this.clients.get(clientId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      client.ws.send(JSON.stringify(data));
      return true;
    } catch (error) {
      logger.error(`发送消息到客户端失败 [${clientId}]:`, error);
      return false;
    }
  }

  /**
   * 广播消息到房间
   */
  broadcastToRoom(room, data, excludeClient = null) {
    const roomClients = this.rooms.get(room);
    if (!roomClients) {
      return 0;
    }

    let successCount = 0;
    for (const clientId of roomClients) {
      if (clientId !== excludeClient) {
        if (this.sendToClient(clientId, data)) {
          successCount++;
        }
      }
    }
    
    return successCount;
  }

  /**
   * 广播消息到所有客户端
   */
  broadcast(data, excludeClient = null) {
    let successCount = 0;
    for (const [clientId] of this.clients) {
      if (clientId !== excludeClient) {
        if (this.sendToClient(clientId, data)) {
          successCount++;
        }
      }
    }
    return successCount;
  }

  /**
   * 发布到订阅频道
   */
  publishToChannel(channel, data) {
    let successCount = 0;
    for (const [clientId, client] of this.clients) {
      if (client.subscriptions && client.subscriptions.has(channel)) {
        if (this.sendToClient(clientId, {
          type: 'channel_message',
          channel,
          data,
          timestamp: Date.now()
        })) {
          successCount++;
        }
      }
    }
    return successCount;
  }

  /**
   * 发送错误消息
   */
  sendError(clientId, code, message) {
    this.sendToClient(clientId, {
      type: 'error',
      error: {
        code,
        message
      },
      timestamp: Date.now()
    });
  }

  /**
   * 启动心跳检测
   */
  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const deadClients = [];

      for (const [clientId, client] of this.clients) {
        if (now - client.lastHeartbeat > this.heartbeatTimeout) {
          deadClients.push(clientId);
        } else if (client.ws.readyState === WebSocket.OPEN) {
          // 发送 ping
          client.ws.ping();
        }
      }

      // 清理死连接
      for (const clientId of deadClients) {
        logger.warn(`客户端心跳超时，断开连接 [${clientId}]`);
        const client = this.clients.get(clientId);
        if (client) {
          client.ws.terminate();
        }
      }
    }, 15000); // 每15秒检查一次
  }

  /**
   * 生成客户端ID
   */
  generateClientId() {
    return `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 获取服务器状态
   */
  getStatus() {
    return {
      running: this.isRunning,
      clientCount: this.clients.size,
      roomCount: this.rooms.size,
      clients: Array.from(this.clients.entries()).map(([id, client]) => ({
        id,
        ip: client.ip,
        connectedAt: client.connectedAt,
        rooms: Array.from(client.rooms),
        subscriptions: client.subscriptions ? Array.from(client.subscriptions) : []
      })),
      rooms: Array.from(this.rooms.entries()).map(([name, clients]) => ({
        name,
        clientCount: clients.size
      }))
    };
  }

  /**
   * 停止 WebSocket 服务器
   */
  async stop() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    if (this.server) {
      // 关闭所有客户端连接
      for (const [clientId, client] of this.clients) {
        client.ws.close(1001, 'Server shutting down');
      }
      
      // 关闭服务器
      this.server.close();
    }

    this.clients.clear();
    this.rooms.clear();
    this.isRunning = false;
    
    logger.info('WebSocket 服务器已停止');
    this.emit('stopped');
  }
}

module.exports = WebSocketManager;