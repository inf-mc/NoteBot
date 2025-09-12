const redis = require('redis');
const { EventEmitter } = require('events');
const logger = require('../../utils/logger');

/**
 * Redis 数据存储层
 */
class RedisManager extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.client = null;
    this.subscriber = null;
    this.publisher = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000;
    
    this.keyPrefix = config.prefix || 'notebot:';
  }

  /**
   * 初始化 Redis 连接
   */
  async init() {
    try {
      await this.connect();
      await this.setupSubscriber();
      await this.setupPublisher();
      
      logger.info('Redis 连接初始化成功');
    } catch (error) {
      logger.error('Redis 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 建立 Redis 连接
   */
  async connect() {
    const options = {
      host: this.config.host || 'localhost',
      port: this.config.port || 6379,
      db: this.config.db || 0,
      retryDelayOnFailover: 100,
      enableReadyCheck: true,
      maxRetriesPerRequest: 3
    };

    if (this.config.password) {
      options.password = this.config.password;
    }

    this.client = redis.createClient(options);

    // 错误处理
    this.client.on('error', (error) => {
      logger.error('Redis 客户端错误:', error);
      this.isConnected = false;
      this.emit('error', error);
    });

    // 连接成功
    this.client.on('connect', () => {
      logger.info('Redis 连接建立');
      this.reconnectAttempts = 0;
      this.emit('connect');
    });

    // 准备就绪
    this.client.on('ready', () => {
      logger.info('Redis 客户端就绪');
      this.isConnected = true;
    });

    // 连接断开
    this.client.on('end', () => {
      logger.warn('Redis 连接断开');
      this.isConnected = false;
      this.emit('disconnect');
      this.handleReconnect();
    });

    await this.client.connect();
  }

  /**
   * 设置订阅客户端
   */
  async setupSubscriber() {
    const options = {
      host: this.config.host || 'localhost',
      port: this.config.port || 6379,
      db: this.config.db || 0
    };

    if (this.config.password) {
      options.password = this.config.password;
    }

    this.subscriber = redis.createClient(options);
    
    this.subscriber.on('error', (error) => {
      logger.error('Redis 订阅客户端错误:', error);
    });

    await this.subscriber.connect();
    logger.info('Redis 订阅客户端就绪');
  }

  /**
   * 设置发布客户端
   */
  async setupPublisher() {
    const options = {
      host: this.config.host || 'localhost',
      port: this.config.port || 6379,
      db: this.config.db || 0
    };

    if (this.config.password) {
      options.password = this.config.password;
    }

    this.publisher = redis.createClient(options);
    
    this.publisher.on('error', (error) => {
      logger.error('Redis 发布客户端错误:', error);
    });

    await this.publisher.connect();
    logger.info('Redis 发布客户端就绪');
  }

  /**
   * 处理重连
   */
  async handleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Redis 重连次数超过限制，停止重连');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    logger.info(`Redis 重连尝试 ${this.reconnectAttempts}/${this.maxReconnectAttempts}，${delay}ms 后重试`);
    
    setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        logger.error('Redis 重连失败:', error);
        this.handleReconnect();
      }
    }, delay);
  }

  /**
   * 生成带前缀的键名
   */
  getKey(key) {
    return `${this.keyPrefix}${key}`;
  }

  /**
   * 设置键值
   */
  async set(key, value, ttl = null) {
    try {
      const redisKey = this.getKey(key);
      const serializedValue = JSON.stringify(value);
      
      if (ttl) {
        await this.client.setEx(redisKey, ttl, serializedValue);
      } else {
        await this.client.set(redisKey, serializedValue);
      }
      
      return true;
    } catch (error) {
      logger.error('Redis SET 操作失败:', error);
      return false;
    }
  }

  /**
   * 获取键值
   */
  async get(key) {
    try {
      const redisKey = this.getKey(key);
      const value = await this.client.get(redisKey);
      
      if (value === null) {
        return null;
      }
      
      return JSON.parse(value);
    } catch (error) {
      logger.error('Redis GET 操作失败:', error);
      return null;
    }
  }

  /**
   * 删除键
   */
  async del(key) {
    try {
      const redisKey = this.getKey(key);
      const result = await this.client.del(redisKey);
      return result > 0;
    } catch (error) {
      logger.error('Redis DEL 操作失败:', error);
      return false;
    }
  }

  /**
   * 检查键是否存在
   */
  async exists(key) {
    try {
      const redisKey = this.getKey(key);
      const result = await this.client.exists(redisKey);
      return result === 1;
    } catch (error) {
      logger.error('Redis EXISTS 操作失败:', error);
      return false;
    }
  }

  /**
   * 设置键的过期时间
   */
  async expire(key, ttl) {
    try {
      const redisKey = this.getKey(key);
      const result = await this.client.expire(redisKey, ttl);
      return result === 1;
    } catch (error) {
      logger.error('Redis EXPIRE 操作失败:', error);
      return false;
    }
  }

  /**
   * 获取键的剩余过期时间
   */
  async ttl(key) {
    try {
      const redisKey = this.getKey(key);
      return await this.client.ttl(redisKey);
    } catch (error) {
      logger.error('Redis TTL 操作失败:', error);
      return -1;
    }
  }

  /**
   * 哈希表操作 - 设置字段
   */
  async hset(key, field, value) {
    try {
      const redisKey = this.getKey(key);
      const serializedValue = JSON.stringify(value);
      await this.client.hSet(redisKey, field, serializedValue);
      return true;
    } catch (error) {
      logger.error('Redis HSET 操作失败:', error);
      return false;
    }
  }

  /**
   * 哈希表操作 - 获取字段
   */
  async hget(key, field) {
    try {
      const redisKey = this.getKey(key);
      const value = await this.client.hGet(redisKey, field);
      
      if (value === null) {
        return null;
      }
      
      return JSON.parse(value);
    } catch (error) {
      logger.error('Redis HGET 操作失败:', error);
      return null;
    }
  }

  /**
   * 哈希表操作 - 获取所有字段
   */
  async hgetall(key) {
    try {
      const redisKey = this.getKey(key);
      const hash = await this.client.hGetAll(redisKey);
      
      const result = {};
      for (const [field, value] of Object.entries(hash)) {
        try {
          result[field] = JSON.parse(value);
        } catch {
          result[field] = value;
        }
      }
      
      return result;
    } catch (error) {
      logger.error('Redis HGETALL 操作失败:', error);
      return {};
    }
  }

  /**
   * 哈希表操作 - 删除字段
   */
  async hdel(key, field) {
    try {
      const redisKey = this.getKey(key);
      const result = await this.client.hDel(redisKey, field);
      return result > 0;
    } catch (error) {
      logger.error('Redis HDEL 操作失败:', error);
      return false;
    }
  }

  /**
   * 列表操作 - 左侧推入
   */
  async lpush(key, ...values) {
    try {
      const redisKey = this.getKey(key);
      const serializedValues = values.map(v => JSON.stringify(v));
      return await this.client.lPush(redisKey, serializedValues);
    } catch (error) {
      logger.error('Redis LPUSH 操作失败:', error);
      return 0;
    }
  }

  /**
   * 列表操作 - 右侧推入
   */
  async rpush(key, ...values) {
    try {
      const redisKey = this.getKey(key);
      const serializedValues = values.map(v => JSON.stringify(v));
      return await this.client.rPush(redisKey, serializedValues);
    } catch (error) {
      logger.error('Redis RPUSH 操作失败:', error);
      return 0;
    }
  }

  /**
   * 列表操作 - 左侧弹出
   */
  async lpop(key) {
    try {
      const redisKey = this.getKey(key);
      const value = await this.client.lPop(redisKey);
      
      if (value === null) {
        return null;
      }
      
      return JSON.parse(value);
    } catch (error) {
      logger.error('Redis LPOP 操作失败:', error);
      return null;
    }
  }

  /**
   * 列表操作 - 获取范围
   */
  async lrange(key, start, stop) {
    try {
      const redisKey = this.getKey(key);
      const values = await this.client.lRange(redisKey, start, stop);
      
      return values.map(value => {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      });
    } catch (error) {
      logger.error('Redis LRANGE 操作失败:', error);
      return [];
    }
  }

  /**
   * 发布消息
   */
  async publish(channel, message) {
    try {
      const serializedMessage = JSON.stringify(message);
      return await this.publisher.publish(channel, serializedMessage);
    } catch (error) {
      logger.error('Redis PUBLISH 操作失败:', error);
      return 0;
    }
  }

  /**
   * 订阅频道
   */
  async subscribe(channel, callback) {
    try {
      await this.subscriber.subscribe(channel, (message) => {
        try {
          const parsedMessage = JSON.parse(message);
          callback(parsedMessage);
        } catch (error) {
          logger.error('解析订阅消息失败:', error);
          callback(message);
        }
      });
      
      logger.info(`订阅频道: ${channel}`);
    } catch (error) {
      logger.error('Redis SUBSCRIBE 操作失败:', error);
    }
  }

  /**
   * 取消订阅
   */
  async unsubscribe(channel) {
    try {
      await this.subscriber.unsubscribe(channel);
      logger.info(`取消订阅频道: ${channel}`);
    } catch (error) {
      logger.error('Redis UNSUBSCRIBE 操作失败:', error);
    }
  }

  /**
   * 获取匹配模式的键
   */
  async keys(pattern) {
    try {
      const fullPattern = this.getKey(pattern);
      const keys = await this.client.keys(fullPattern);
      // 移除前缀，返回原始键名
      return keys.map(key => key.replace(this.keyPrefix, ''));
    } catch (error) {
      logger.error('Redis KEYS 操作失败:', error);
      return [];
    }
  }

  /**
   * 检查连接状态
   */
  async ping() {
    try {
      return await this.client.ping();
    } catch (error) {
      logger.error('Redis PING 操作失败:', error);
      throw error;
    }
  }

  /**
   * 获取连接状态
   */
  getStatus() {
    return {
      connected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      config: {
        host: this.config.host,
        port: this.config.port,
        db: this.config.db
      }
    };
  }

  /**
   * 关闭连接
   */
  async close() {
    try {
      if (this.client) {
        await this.client.quit();
      }
      if (this.subscriber) {
        await this.subscriber.quit();
      }
      if (this.publisher) {
        await this.publisher.quit();
      }
      
      this.isConnected = false;
      logger.info('Redis 连接已关闭');
    } catch (error) {
      logger.error('关闭 Redis 连接时发生错误:', error);
    }
  }
}

module.exports = RedisManager;