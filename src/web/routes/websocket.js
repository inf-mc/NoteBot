const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const url = require('url');
const logger = require('../../utils/logger');
const config = require('../../utils/config');

class WebSocketManager {
    constructor() {
        this.clients = new Map();
        this.server = null;
    }
    
    // 初始化WebSocket服务器
    initialize(httpServer) {
        this.server = new WebSocket.Server({
            server: httpServer,
            path: '/ws',
            verifyClient: this.verifyClient.bind(this)
        });
        
        this.server.on('connection', this.handleConnection.bind(this));
        this.server.on('error', this.handleError.bind(this));
        
        logger.info('WebSocket服务器已启动');
    }
    
    // 验证客户端连接
    verifyClient(info) {
        try {
            const query = url.parse(info.req.url, true).query;
            const token = query.token;
            
            if (!token) {
                logger.warn('WebSocket连接被拒绝：缺少token', { 
                    origin: info.origin,
                    ip: info.req.connection.remoteAddress 
                });
                return false;
            }
            
            // 验证JWT token
            const decoded = jwt.verify(token, config.get('auth.jwtSecret'));
            
            // 将用户信息附加到请求对象
            info.req.user = decoded;
            
            return true;
            
        } catch (error) {
            logger.warn('WebSocket连接被拒绝：token无效', { 
                error: error.message,
                ip: info.req.connection.remoteAddress 
            });
            return false;
        }
    }
    
    // 处理新连接
    handleConnection(ws, req) {
        const clientId = this.generateClientId();
        const user = req.user;
        
        // 创建客户端信息
        const client = {
            id: clientId,
            ws: ws,
            user: user,
            connectedAt: new Date(),
            lastPing: new Date(),
            subscriptions: new Set()
        };
        
        this.clients.set(clientId, client);
        
        logger.info('WebSocket客户端已连接', { 
            clientId, 
            username: user.username,
            ip: req.connection.remoteAddress 
        });
        
        // 发送欢迎消息
        this.sendToClient(clientId, {
            type: 'welcome',
            data: {
                clientId: clientId,
                serverTime: new Date().toISOString()
            }
        });
        
        // 设置消息处理器
        ws.on('message', (data) => this.handleMessage(clientId, data));
        ws.on('close', () => this.handleDisconnection(clientId));
        ws.on('error', (error) => this.handleClientError(clientId, error));
        ws.on('pong', () => this.handlePong(clientId));
        
        // 开始心跳检测
        this.startHeartbeat(clientId);
    }
    
    // 处理客户端消息
    handleMessage(clientId, data) {
        try {
            const client = this.clients.get(clientId);
            if (!client) return;
            
            const message = JSON.parse(data.toString());
            
            logger.debug('收到WebSocket消息', { 
                clientId, 
                type: message.type,
                username: client.user.username 
            });
            
            switch (message.type) {
                case 'ping':
                    this.handlePing(clientId);
                    break;
                    
                case 'subscribe':
                    this.handleSubscribe(clientId, message.data);
                    break;
                    
                case 'unsubscribe':
                    this.handleUnsubscribe(clientId, message.data);
                    break;
                    
                case 'get_status':
                    this.handleGetStatus(clientId);
                    break;
                    
                default:
                    logger.warn('未知的WebSocket消息类型', { 
                        clientId, 
                        type: message.type 
                    });
            }
            
        } catch (error) {
            logger.error('处理WebSocket消息失败', { 
                clientId, 
                error: error.message 
            });
        }
    }
    
    // 处理ping消息
    handlePing(clientId) {
        const client = this.clients.get(clientId);
        if (!client) return;
        
        client.lastPing = new Date();
        
        this.sendToClient(clientId, {
            type: 'pong',
            data: {
                timestamp: new Date().toISOString()
            }
        });
    }
    
    // 处理pong响应
    handlePong(clientId) {
        const client = this.clients.get(clientId);
        if (client) {
            client.lastPing = new Date();
        }
    }
    
    // 处理订阅
    handleSubscribe(clientId, data) {
        const client = this.clients.get(clientId);
        if (!client) return;
        
        const { channels } = data;
        
        if (Array.isArray(channels)) {
            channels.forEach(channel => {
                client.subscriptions.add(channel);
            });
            
            logger.info('客户端订阅频道', { 
                clientId, 
                channels,
                username: client.user.username 
            });
            
            this.sendToClient(clientId, {
                type: 'subscribed',
                data: { channels }
            });
        }
    }
    
    // 处理取消订阅
    handleUnsubscribe(clientId, data) {
        const client = this.clients.get(clientId);
        if (!client) return;
        
        const { channels } = data;
        
        if (Array.isArray(channels)) {
            channels.forEach(channel => {
                client.subscriptions.delete(channel);
            });
            
            logger.info('客户端取消订阅频道', { 
                clientId, 
                channels,
                username: client.user.username 
            });
            
            this.sendToClient(clientId, {
                type: 'unsubscribed',
                data: { channels }
            });
        }
    }
    
    // 处理获取状态请求
    async handleGetStatus(clientId) {
        try {
            // 这里可以获取系统状态信息
            const status = {
                connectedClients: this.clients.size,
                serverTime: new Date().toISOString(),
                uptime: process.uptime()
            };
            
            this.sendToClient(clientId, {
                type: 'status',
                data: status
            });
            
        } catch (error) {
            logger.error('获取状态失败', { clientId, error: error.message });
        }
    }
    
    // 处理客户端断开连接
    handleDisconnection(clientId) {
        const client = this.clients.get(clientId);
        
        if (client) {
            logger.info('WebSocket客户端已断开连接', { 
                clientId,
                username: client.user.username,
                connectedDuration: Date.now() - client.connectedAt.getTime()
            });
            
            // 清理心跳定时器
            if (client.heartbeatInterval) {
                clearInterval(client.heartbeatInterval);
            }
            
            this.clients.delete(clientId);
        }
    }
    
    // 处理客户端错误
    handleClientError(clientId, error) {
        logger.error('WebSocket客户端错误', { 
            clientId, 
            error: error.message 
        });
    }
    
    // 处理服务器错误
    handleError(error) {
        logger.error('WebSocket服务器错误', { error: error.message });
    }
    
    // 开始心跳检测
    startHeartbeat(clientId) {
        const client = this.clients.get(clientId);
        if (!client) return;
        
        const heartbeatInterval = config.get('websocket.heartbeatInterval', 30000);
        const heartbeatTimeout = config.get('websocket.heartbeatTimeout', 60000);
        
        client.heartbeatInterval = setInterval(() => {
            const now = new Date();
            const timeSinceLastPing = now - client.lastPing;
            
            if (timeSinceLastPing > heartbeatTimeout) {
                logger.warn('客户端心跳超时，断开连接', { 
                    clientId,
                    timeSinceLastPing 
                });
                
                client.ws.terminate();
                return;
            }
            
            // 发送ping
            if (client.ws.readyState === WebSocket.OPEN) {
                client.ws.ping();
            }
            
        }, heartbeatInterval);
    }
    
    // 发送消息给指定客户端
    sendToClient(clientId, message) {
        const client = this.clients.get(clientId);
        
        if (client && client.ws.readyState === WebSocket.OPEN) {
            try {
                client.ws.send(JSON.stringify(message));
                return true;
            } catch (error) {
                logger.error('发送WebSocket消息失败', { 
                    clientId, 
                    error: error.message 
                });
                return false;
            }
        }
        
        return false;
    }
    
    // 广播消息给所有客户端
    broadcast(message, filter = null) {
        let sentCount = 0;
        
        for (const [clientId, client] of this.clients) {
            // 应用过滤器
            if (filter && !filter(client)) {
                continue;
            }
            
            if (this.sendToClient(clientId, message)) {
                sentCount++;
            }
        }
        
        logger.debug('广播WebSocket消息', { 
            sentCount, 
            totalClients: this.clients.size,
            messageType: message.type 
        });
        
        return sentCount;
    }
    
    // 发送消息给订阅了指定频道的客户端
    broadcastToChannel(channel, message) {
        return this.broadcast(message, (client) => {
            return client.subscriptions.has(channel);
        });
    }
    
    // 发送系统状态更新
    broadcastSystemStatus(status) {
        this.broadcastToChannel('system', {
            type: 'system_status',
            data: status
        });
    }
    
    // 发送插件状态更新
    broadcastPluginStatus(pluginId, status) {
        this.broadcastToChannel('plugins', {
            type: 'plugin_status',
            data: { pluginId, status }
        });
    }
    
    // 发送任务状态更新
    broadcastTaskStatus(taskId, status) {
        this.broadcastToChannel('tasks', {
            type: 'task_status',
            data: { taskId, status }
        });
    }
    
    // 发送日志消息
    broadcastLog(log) {
        this.broadcastToChannel('logs', {
            type: 'log',
            data: log
        });
    }
    
    // 生成客户端ID
    generateClientId() {
        return 'client_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
    
    // 获取连接的客户端数量
    getClientCount() {
        return this.clients.size;
    }
    
    // 获取所有客户端信息
    getClients() {
        const clients = [];
        
        for (const [clientId, client] of this.clients) {
            clients.push({
                id: clientId,
                username: client.user.username,
                connectedAt: client.connectedAt,
                lastPing: client.lastPing,
                subscriptions: Array.from(client.subscriptions)
            });
        }
        
        return clients;
    }
    
    // 关闭WebSocket服务器
    close() {
        if (this.server) {
            // 断开所有客户端连接
            for (const [clientId, client] of this.clients) {
                if (client.heartbeatInterval) {
                    clearInterval(client.heartbeatInterval);
                }
                client.ws.terminate();
            }
            
            this.clients.clear();
            
            // 关闭服务器
            this.server.close(() => {
                logger.info('WebSocket服务器已关闭');
            });
            
            this.server = null;
        }
    }
}

module.exports = WebSocketManager;