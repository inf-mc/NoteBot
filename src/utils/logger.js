const winston = require('winston');
const path = require('path');
const fs = require('fs');

// 确保日志目录存在
const logDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// 自定义日志格式
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let log = `${timestamp} [${level.toUpperCase()}]`;
    
    // 添加插件信息
    if (meta.plugin) {
      log += ` [${meta.plugin}]`;
    }
    
    // 添加模块信息
    if (meta.module) {
      log += ` [${meta.module}]`;
    }
    
    log += `: ${message}`;
    
    // 添加错误堆栈
    if (stack) {
      log += `\n${stack}`;
    }
    
    // 添加额外的元数据
    const extraMeta = { ...meta };
    delete extraMeta.plugin;
    delete extraMeta.module;
    
    if (Object.keys(extraMeta).length > 0) {
      log += ` ${JSON.stringify(extraMeta)}`;
    }
    
    return log;
  })
);

// 控制台格式
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({
    format: 'HH:mm:ss'
  }),
  winston.format.printf(({ timestamp, level, message, plugin, module, ...meta }) => {
    let log = `${timestamp} ${level}`;
    
    if (plugin) {
      log += ` [${plugin}]`;
    }
    
    if (module) {
      log += ` [${module}]`;
    }
    
    log += `: ${message}`;
    
    return log;
  })
);

// 创建传输器
const transports = [
  // 控制台输出
  new winston.transports.Console({
    level: process.env.LOG_LEVEL || 'info',
    format: consoleFormat,
    handleExceptions: true,
    handleRejections: true
  }),
  
  // 所有日志文件
  new winston.transports.File({
    filename: path.join(logDir, 'combined.log'),
    level: 'debug',
    format: logFormat,
    maxsize: 10 * 1024 * 1024, // 10MB
    maxFiles: 5,
    tailable: true
  }),
  
  // 错误日志文件
  new winston.transports.File({
    filename: path.join(logDir, 'error.log'),
    level: 'error',
    format: logFormat,
    maxsize: 10 * 1024 * 1024, // 10MB
    maxFiles: 5,
    tailable: true
  }),
  
  // 警告日志文件
  new winston.transports.File({
    filename: path.join(logDir, 'warn.log'),
    level: 'warn',
    format: logFormat,
    maxsize: 5 * 1024 * 1024, // 5MB
    maxFiles: 3,
    tailable: true
  })
];

// 如果是生产环境，添加每日轮转日志
if (process.env.NODE_ENV === 'production') {
  const DailyRotateFile = require('winston-daily-rotate-file');
  
  transports.push(
    new DailyRotateFile({
      filename: path.join(logDir, 'application-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d',
      format: logFormat
    })
  );
}

// 创建主日志器
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports,
  exitOnError: false
});

// 添加自定义方法
logger.plugin = function(pluginName) {
  return this.child({ plugin: pluginName });
};

logger.module = function(moduleName) {
  return this.child({ module: moduleName });
};

// 性能日志
logger.performance = function(operation, duration, metadata = {}) {
  this.info(`Performance: ${operation} completed in ${duration}ms`, {
    operation,
    duration,
    performance: true,
    ...metadata
  });
};

// 审计日志
logger.audit = function(action, user, resource, metadata = {}) {
  this.info(`Audit: ${action}`, {
    action,
    user,
    resource,
    audit: true,
    timestamp: new Date().toISOString(),
    ...metadata
  });
};

// 安全日志
logger.security = function(event, details = {}) {
  this.warn(`Security: ${event}`, {
    event,
    security: true,
    timestamp: new Date().toISOString(),
    ...details
  });
};

// 业务日志
logger.business = function(event, data = {}) {
  this.info(`Business: ${event}`, {
    event,
    business: true,
    timestamp: new Date().toISOString(),
    ...data
  });
};

// 请求日志中间件
logger.requestMiddleware = function() {
  return (req, res, next) => {
    const start = Date.now();
    const requestId = req.headers['x-request-id'] || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // 添加请求ID到请求对象
    req.requestId = requestId;
    
    // 记录请求开始
    logger.info(`Request started: ${req.method} ${req.url}`, {
      requestId,
      method: req.method,
      url: req.url,
      userAgent: req.headers['user-agent'],
      ip: req.ip || req.connection.remoteAddress,
      request: true
    });
    
    // 监听响应结束
    res.on('finish', () => {
      const duration = Date.now() - start;
      const level = res.statusCode >= 400 ? 'warn' : 'info';
      
      logger[level](`Request completed: ${req.method} ${req.url}`, {
        requestId,
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        duration,
        response: true
      });
    });
    
    next();
  };
};

// 错误处理中间件
logger.errorMiddleware = function() {
  return (err, req, res, next) => {
    logger.error(`Request error: ${req.method} ${req.url}`, {
      requestId: req.requestId,
      method: req.method,
      url: req.url,
      error: err.message,
      stack: err.stack,
      statusCode: err.statusCode || 500
    });
    
    next(err);
  };
};

// 日志级别管理
logger.setLevel = function(level) {
  this.level = level;
  this.transports.forEach(transport => {
    if (transport.level !== 'error' && transport.level !== 'warn') {
      transport.level = level;
    }
  });
  this.info(`Log level changed to: ${level}`);
};

// 获取日志统计
logger.getStats = function() {
  const stats = {
    level: this.level,
    transports: this.transports.length,
    logDir,
    files: []
  };
  
  try {
    const files = fs.readdirSync(logDir);
    stats.files = files.map(file => {
      const filePath = path.join(logDir, file);
      const stat = fs.statSync(filePath);
      return {
        name: file,
        size: stat.size,
        modified: stat.mtime
      };
    });
  } catch (error) {
    this.error('Failed to get log file stats:', error);
  }
  
  return stats;
};

// 清理旧日志
logger.cleanup = function(daysToKeep = 7) {
  try {
    const files = fs.readdirSync(logDir);
    const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
    
    let deletedCount = 0;
    
    files.forEach(file => {
      const filePath = path.join(logDir, file);
      const stat = fs.statSync(filePath);
      
      if (stat.mtime.getTime() < cutoffTime) {
        fs.unlinkSync(filePath);
        deletedCount++;
        this.info(`Deleted old log file: ${file}`);
      }
    });
    
    this.info(`Log cleanup completed: ${deletedCount} files deleted`);
    return deletedCount;
    
  } catch (error) {
    this.error('Log cleanup failed:', error);
    return 0;
  }
};

// 导出日志到文件
logger.exportLogs = function(options = {}) {
  const {
    startDate,
    endDate,
    level,
    plugin,
    module,
    outputFile
  } = options;
  
  return new Promise((resolve, reject) => {
    try {
      const query = {
        from: startDate || new Date(Date.now() - 24 * 60 * 60 * 1000),
        until: endDate || new Date(),
        limit: 10000,
        start: 0,
        order: 'desc'
      };
      
      if (level) query.level = level;
      
      this.query(query, (err, results) => {
        if (err) {
          reject(err);
          return;
        }
        
        let logs = results.file || [];
        
        // 过滤插件和模块
        if (plugin || module) {
          logs = logs.filter(log => {
            if (plugin && log.plugin !== plugin) return false;
            if (module && log.module !== module) return false;
            return true;
          });
        }
        
        if (outputFile) {
          const output = logs.map(log => JSON.stringify(log)).join('\n');
          fs.writeFileSync(outputFile, output);
          this.info(`Logs exported to: ${outputFile}`);
        }
        
        resolve(logs);
      });
      
    } catch (error) {
      reject(error);
    }
  });
};

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// 优雅关闭
process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down gracefully');
  logger.end();
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  logger.end();
});

module.exports = logger;