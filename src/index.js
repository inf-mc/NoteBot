#!/usr/bin/env node

/**
 * NoteBot 项目入口文件
 * 负责启动整个应用程序
 */

const path = require('path');
const fs = require('fs');

// 设置环境变量
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

// 加载环境配置
require('dotenv').config({
  path: path.join(__dirname, '..', '.env')
});

// 导入应用程序
const Application = require('./app');
const logger = require('./utils/logger');

// 全局错误处理
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// 优雅关闭处理
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await Application.shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await Application.shutdown();
  process.exit(0);
});

// 启动应用程序
async function start() {
  try {
    logger.info('Starting NoteBot application...');
    logger.info(`Environment: ${process.env.NODE_ENV}`);
    logger.info(`Node.js version: ${process.version}`);
    logger.info(`Platform: ${process.platform}`);
    
    // 检查必要的目录
    const requiredDirs = [
      path.join(__dirname, '..', 'logs'),
      path.join(__dirname, '..', 'data'),
      path.join(__dirname, '..', 'uploads'),
      path.join(__dirname, '..', 'config')
    ];
    
    for (const dir of requiredDirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        logger.info(`Created directory: ${dir}`);
      }
    }
    
    // 启动应用程序
    await Application.start();
    
    logger.info('NoteBot application started successfully!');
    logger.info('Press Ctrl+C to stop the application');
    
  } catch (error) {
    logger.error('Failed to start application:', error);
    process.exit(1);
  }
}

// 如果直接运行此文件，则启动应用程序
if (require.main === module) {
  start();
}

module.exports = { start };