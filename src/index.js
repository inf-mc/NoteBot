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
  logger.error('NoteBot 未捕获异常:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('NoteBot 未处理拒绝:', promise, '原因:', reason);
  process.exit(1);
});

// 信号处理由 Application 类统一管理
// process.on('SIGTERM', async () => {
//   logger.info('NoteBot 收到 SIGTERM 信号，正在关闭...');
//   await Application.shutdown();
//   logger.info('NoteBot 已关闭');
//   process.exit(0);
// });

// process.on('SIGINT', async () => {
//   logger.info('NoteBot 收到 SIGINT 信号，正在关闭...');
//   await Application.shutdown();
//   logger.info('NoteBot 已关闭');
//   process.exit(0);
// });

// 启动应用程序
async function start() {
  try {
    logger.info('NoteBot 正在启动...');
    logger.info(`环境: ${process.env.NODE_ENV}`);
    logger.info(`Node.js 版本: ${process.version}`);
    logger.info(`平台: ${process.platform}`);
    
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
    
    logger.info('NoteBot 成功启动！');
  } catch (error) {
    logger.error('NoteBot 启动失败:', error);
    process.exit(1);
  }
}

// 如果直接运行此文件，则启动应用程序
if (require.main === module) {
  start();
}

module.exports = { start };