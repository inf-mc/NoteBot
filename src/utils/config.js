const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const logger = require('./logger').module('Config');

/**
 * 配置管理器
 */
class ConfigManager {
  constructor() {
    this.config = {};
    this.watchers = new Map();
    this.callbacks = new Map();
    
    this.init();
  }

  /**
   * 初始化配置管理器
   */
  init() {
    try {
      // 加载环境变量
      this.loadEnvironment();
      
      // 加载默认配置
      this.loadDefaultConfig();
      
      // 加载用户配置
      this.loadUserConfig();
      
      // 验证配置
      this.validateConfig();
      
      logger.info('配置管理器初始化完成');
      
    } catch (error) {
      logger.error('配置管理器初始化失败:', error);
      throw error;
    }
  }

  /**
   * 加载环境变量
   */
  loadEnvironment() {
    // 加载 .env 文件
    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
      logger.debug('已加载 .env 文件');
    }
    
    // 根据环境加载特定的 .env 文件
    const nodeEnv = process.env.NODE_ENV || 'development';
    const envSpecificPath = path.join(process.cwd(), `.env.${nodeEnv}`);
    if (fs.existsSync(envSpecificPath)) {
      dotenv.config({ path: envSpecificPath });
      logger.debug(`已加载 .env.${nodeEnv} 文件`);
    }
  }

  /**
   * 加载默认配置
   */
  loadDefaultConfig() {
    this.config = {
      // 服务器配置
      server: {
        port: parseInt(process.env.PORT) || 3000,
        host: process.env.HOST || '0.0.0.0',
        env: process.env.NODE_ENV || 'development'
      },
      
      // Redis 配置
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT) || 6379,
        password: process.env.REDIS_PASSWORD || '',
        db: parseInt(process.env.REDIS_DB) || 0,
        keyPrefix: process.env.REDIS_KEY_PREFIX || 'notebot:',
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
        lazyConnect: true
      },
      
      // Onebot 配置
      onebot: {
        wsPort: parseInt(process.env.ONEBOT_WS_PORT) || 8080,
        accessToken: process.env.ONEBOT_ACCESS_TOKEN || '',
        secret: process.env.ONEBOT_SECRET || '',
  
        reconnectInterval: parseInt(process.env.ONEBOT_RECONNECT_INTERVAL) || 5000,
        maxReconnectAttempts: parseInt(process.env.ONEBOT_MAX_RECONNECT_ATTEMPTS) || 10
      },
      
      // 插件配置
      plugins: {
        dir: process.env.PLUGIN_DIR || 'plugins',
        autoLoad: process.env.PLUGIN_AUTO_LOAD !== 'false',
        hotReload: process.env.PLUGIN_HOT_RELOAD === 'true',
        maxLoadTime: parseInt(process.env.PLUGIN_MAX_LOAD_TIME) || 30000,
        sandboxed: process.env.PLUGIN_SANDBOXED === 'true'
      },
      
      // 定时任务配置
      scheduler: {
        enabled: process.env.SCHEDULER_ENABLED !== 'false',
        timezone: process.env.SCHEDULER_TIMEZONE || 'Asia/Shanghai',
        maxConcurrent: parseInt(process.env.SCHEDULER_MAX_CONCURRENT) || 10,
        defaultTimeout: parseInt(process.env.SCHEDULER_DEFAULT_TIMEOUT) || 300000
      },
      
      // 日志配置
      logging: {
        level: process.env.LOG_LEVEL || 'info',
        dir: process.env.LOG_DIR || 'logs',
        maxSize: process.env.LOG_MAX_SIZE || '10m',
        maxFiles: parseInt(process.env.LOG_MAX_FILES) || 5,
        datePattern: process.env.LOG_DATE_PATTERN || 'YYYY-MM-DD'
      },
      
      // 安全配置
      security: {
        jwtSecret: process.env.JWT_SECRET || 'your-secret-key',
        jwtExpiration: process.env.JWT_EXPIRATION || '24h',
        bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS) || 10,
        rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW) || 900000,
        rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX) || 100
      },
      
      // 文件上传配置
      upload: {
        maxSize: parseInt(process.env.UPLOAD_MAX_SIZE) || 10 * 1024 * 1024,
        allowedTypes: (process.env.UPLOAD_ALLOWED_TYPES || 'image/jpeg,image/png,image/gif').split(','),
        dir: process.env.UPLOAD_DIR || 'uploads',
        urlPrefix: process.env.UPLOAD_URL_PREFIX || '/uploads'
      },
      
      // 监控配置
      monitoring: {
        enabled: process.env.MONITORING_ENABLED === 'true',
        interval: parseInt(process.env.MONITORING_INTERVAL) || 60000,
        metricsRetention: parseInt(process.env.METRICS_RETENTION) || 7 * 24 * 60 * 60 * 1000
      },
      
      // 集群配置
      cluster: {
        enabled: process.env.CLUSTER_ENABLED === 'true',
        workers: parseInt(process.env.CLUSTER_WORKERS) || require('os').cpus().length,
        restartDelay: parseInt(process.env.CLUSTER_RESTART_DELAY) || 1000
      }
    };
    
    logger.debug('默认配置已加载');
  }

  /**
   * 加载用户配置
   */
  loadUserConfig() {
    const configPaths = [
      path.join(process.cwd(), 'config', 'config.json'),
      path.join(process.cwd(), 'config.json'),
      path.join(process.cwd(), 'notebot.config.js')
    ];
    
    for (const configPath of configPaths) {
      if (fs.existsSync(configPath)) {
        try {
          let userConfig;
          
          if (configPath.endsWith('.js')) {
            // 清除缓存以支持热重载
            delete require.cache[require.resolve(configPath)];
            userConfig = require(configPath);
          } else {
            const configData = fs.readFileSync(configPath, 'utf8');
            userConfig = JSON.parse(configData);
          }
          
          // 深度合并配置
          this.config = this.deepMerge(this.config, userConfig);
          
          logger.info(`已加载用户配置: ${configPath}`);
          break;
          
        } catch (error) {
          logger.warn(`加载用户配置失败 [${configPath}]:`, error.message);
        }
      }
    }
  }

  /**
   * 深度合并对象
   */
  deepMerge(target, source) {
    const result = { ...target };
    
    for (const key in source) {
      if (source.hasOwnProperty(key)) {
        if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
          result[key] = this.deepMerge(target[key] || {}, source[key]);
        } else {
          result[key] = source[key];
        }
      }
    }
    
    return result;
  }

  /**
   * 验证配置
   */
  validateConfig() {
    const errors = [];
    
    // 验证必需的配置
    if (!this.config.security.jwtSecret || this.config.security.jwtSecret === 'your-secret-key') {
      errors.push('JWT密钥未设置或使用默认值，请设置 JWT_SECRET 环境变量');
    }
    
    if (this.config.server.port < 1 || this.config.server.port > 65535) {
      errors.push('服务器端口号无效');
    }
    
    if (this.config.redis.port < 1 || this.config.redis.port > 65535) {
      errors.push('Redis端口号无效');
    }
    
    if (this.config.onebot.wsPort < 1 || this.config.onebot.wsPort > 65535) {
      errors.push('Onebot WebSocket端口号无效');
    }
    
    if (errors.length > 0) {
      logger.error('配置验证失败:');
      errors.forEach(error => logger.error(`  - ${error}`));
      throw new Error('配置验证失败');
    }
    
    logger.debug('配置验证通过');
  }

  /**
   * 获取配置值
   */
  get(path, defaultValue) {
    const keys = path.split('.');
    let value = this.config;
    
    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return defaultValue;
      }
    }
    
    return value;
  }

  /**
   * 设置配置值
   */
  set(path, value) {
    const keys = path.split('.');
    let current = this.config;
    
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!(key in current) || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }
    
    const lastKey = keys[keys.length - 1];
    const oldValue = current[lastKey];
    current[lastKey] = value;
    
    // 触发配置变更回调
    this.triggerCallbacks(path, value, oldValue);
    
    logger.debug(`配置已更新: ${path} = ${JSON.stringify(value)}`);
  }

  /**
   * 获取所有配置
   */
  getAll() {
    return JSON.parse(JSON.stringify(this.config));
  }

  /**
   * 监听配置变更
   */
  watch(path, callback) {
    if (!this.callbacks.has(path)) {
      this.callbacks.set(path, []);
    }
    
    this.callbacks.get(path).push(callback);
    
    // 返回取消监听的函数
    return () => {
      const callbacks = this.callbacks.get(path);
      if (callbacks) {
        const index = callbacks.indexOf(callback);
        if (index > -1) {
          callbacks.splice(index, 1);
        }
        
        if (callbacks.length === 0) {
          this.callbacks.delete(path);
        }
      }
    };
  }

  /**
   * 触发配置变更回调
   */
  triggerCallbacks(path, newValue, oldValue) {
    const callbacks = this.callbacks.get(path);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(newValue, oldValue, path);
        } catch (error) {
          logger.error(`配置变更回调执行失败 [${path}]:`, error);
        }
      });
    }
  }

  /**
   * 重新加载配置
   */
  reload() {
    try {
      logger.info('重新加载配置...');
      
      const oldConfig = this.getAll();
      
      // 重新初始化
      this.init();
      
      // 比较配置变更
      this.compareAndNotifyChanges(oldConfig, this.config);
      
      logger.info('配置重新加载完成');
      
    } catch (error) {
      logger.error('配置重新加载失败:', error);
      throw error;
    }
  }

  /**
   * 比较配置变更并通知
   */
  compareAndNotifyChanges(oldConfig, newConfig, prefix = '') {
    for (const key in newConfig) {
      const path = prefix ? `${prefix}.${key}` : key;
      const oldValue = this.getValueByPath(oldConfig, path);
      const newValue = newConfig[key];
      
      if (typeof newValue === 'object' && newValue !== null && !Array.isArray(newValue)) {
        this.compareAndNotifyChanges(oldConfig, newValue, path);
      } else if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        this.triggerCallbacks(path, newValue, oldValue);
      }
    }
  }

  /**
   * 根据路径获取值
   */
  getValueByPath(obj, path) {
    const keys = path.split('.');
    let value = obj;
    
    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return undefined;
      }
    }
    
    return value;
  }

  /**
   * 保存配置到文件
   */
  save(filePath) {
    try {
      const configPath = filePath || path.join(process.cwd(), 'config', 'config.json');
      const configDir = path.dirname(configPath);
      
      // 确保目录存在
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      
      // 保存配置
      fs.writeFileSync(configPath, JSON.stringify(this.config, null, 2));
      
      logger.info(`配置已保存到: ${configPath}`);
      
    } catch (error) {
      logger.error('保存配置失败:', error);
      throw error;
    }
  }

  /**
   * 获取环境信息
   */
  getEnvironment() {
    return {
      nodeEnv: this.config.server.env,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage()
    };
  }

  /**
   * 检查配置是否为开发环境
   */
  isDevelopment() {
    return this.config.server.env === 'development';
  }

  /**
   * 检查配置是否为生产环境
   */
  isProduction() {
    return this.config.server.env === 'production';
  }

  /**
   * 检查配置是否为测试环境
   */
  isTest() {
    return this.config.server.env === 'test';
  }
}

// 创建单例实例
const configManager = new ConfigManager();

module.exports = configManager;