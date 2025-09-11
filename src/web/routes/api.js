const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const logger = require('../../utils/logger');
const config = require('../../utils/config');

const router = express.Router();

// 限流中间件
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15分钟
    max: 100, // 限制每个IP 15分钟内最多100个请求
    message: { success: false, message: '请求过于频繁，请稍后再试' },
    standardHeaders: true,
    legacyHeaders: false
});

// 登录限流
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15分钟
    max: 5, // 限制每个IP 15分钟内最多5次登录尝试
    message: { success: false, message: '登录尝试过于频繁，请稍后再试' },
    standardHeaders: true,
    legacyHeaders: false
});

// 应用限流中间件
router.use(apiLimiter);

// JWT验证中间件
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ success: false, message: '访问令牌缺失' });
    }
    
    jwt.verify(token, config.get('security.jwtSecret'), (err, user) => {
        if (err) {
            return res.status(403).json({ success: false, message: '访问令牌无效' });
        }
        req.user = user;
        next();
    });
}

// 认证路由
router.post('/auth/login', loginLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ 
                success: false, 
                message: '用户名和密码不能为空' 
            });
        }
        
        // 获取管理员凭据
        const adminUsername = process.env.ADMIN_USERNAME || 'admin';
        const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
        
        // 调试：检查config对象
        console.log('Config object type:', typeof config);
        console.log('Config get method:', typeof config.get);
        console.log('Logger object type:', typeof logger);
        console.log('Logger info method:', typeof logger.info);
        
        // 验证用户名和密码
        if (username !== adminUsername || password !== adminPassword) {
            logger.warn('登录失败', { username, ip: req.ip });
            return res.status(401).json({ 
                success: false, 
                error: 'Login failed',
                message: '用户名或密码错误' 
            });
        }
        
        // 生成JWT令牌
        const token = jwt.sign(
            { username, role: 'admin' },
            config.get('security.jwtSecret'),
            { expiresIn: config.get('security.jwtExpiration', '24h') }
        );
        
        logger.info('用户登录成功', { username, ip: req.ip });
        
        res.json({
            success: true,
            token,
            user: { username, role: 'admin' }
        });
        
    } catch (error) {
        logger.error('登录处理错误:', error);
        res.status(500).json({ 
            success: false, 
            message: '服务器内部错误' 
        });
    }
});

// 验证令牌
router.get('/auth/verify', authenticateToken, (req, res) => {
    res.json({
        success: true,
        user: req.user
    });
});

// 以下所有路由都需要认证
router.use(authenticateToken);

// 系统状态API
router.get('/system/status', async (req, res) => {
    try {
        const app = req.app;
        const pluginManager = app.get('pluginManager');
        const taskScheduler = app.get('taskScheduler');
        const onebotCore = app.get('onebotCore');
        const redisManager = app.get('redisManager');
        
        // 获取系统信息
        const memoryUsage = process.memoryUsage();
        const uptime = process.uptime();
        
        // 获取插件数量
        const plugins = pluginManager ? await pluginManager.getPlugins() : [];
        const enabledPlugins = plugins.filter(p => p.enabled);
        
        // 获取任务数量
        const tasks = taskScheduler ? await taskScheduler.getTasks() : [];
        const runningTasks = tasks.filter(t => t.enabled);
        
        // 获取连接数量
        const connections = onebotCore ? onebotCore.getConnections() : [];
        
        // 检查Redis连接
        const redisConnected = redisManager ? await redisManager.ping() : false;
        
        const status = {
            status: redisConnected ? '正常' : '异常',
            version: require('../../../package.json').version,
            uptime: Math.floor(uptime),
            memoryUsage: memoryUsage.heapUsed,
            nodeVersion: process.version,
            pluginCount: enabledPlugins.length,
            taskCount: runningTasks.length,
            connectionCount: connections.length,
            redis: redisConnected
        };
        
        res.json({ success: true, data: status });
        
    } catch (error) {
        logger.error('获取系统状态失败:', error);
        res.status(500).json({ 
            success: false, 
            message: '获取系统状态失败' 
        });
    }
});

// 插件管理API
router.get('/plugins', async (req, res) => {
    try {
        const pluginManager = req.app.get('pluginManager');
        
        if (!pluginManager) {
            return res.status(503).json({ 
                success: false, 
                message: '插件管理器未初始化' 
            });
        }
        
        const plugins = await pluginManager.getPlugins();
        res.json({ success: true, data: plugins });
        
    } catch (error) {
        logger.error('获取插件列表失败:', error);
        res.status(500).json({ 
            success: false, 
            message: '获取插件列表失败' 
        });
    }
});

router.post('/plugins/:id/enable', async (req, res) => {
    try {
        const pluginManager = req.app.get('pluginManager');
        const { id } = req.params;
        
        if (!pluginManager) {
            return res.status(503).json({ 
                success: false, 
                message: '插件管理器未初始化' 
            });
        }
        
        await pluginManager.enablePlugin(id);
        logger.info(`插件已启用: ${id}`, { user: req.user.username });
        
        res.json({ success: true, message: '插件已启用' });
        
    } catch (error) {
        logger.error(`启用插件失败: ${req.params.id}`, error);
        res.status(500).json({ 
            success: false, 
            message: '启用插件失败' 
        });
    }
});

router.post('/plugins/:id/disable', async (req, res) => {
    try {
        const pluginManager = req.app.get('pluginManager');
        const { id } = req.params;
        
        if (!pluginManager) {
            return res.status(503).json({ 
                success: false, 
                message: '插件管理器未初始化' 
            });
        }
        
        await pluginManager.disablePlugin(id);
        logger.info(`插件已禁用: ${id}`, { user: req.user.username });
        
        res.json({ success: true, message: '插件已禁用' });
        
    } catch (error) {
        logger.error(`禁用插件失败: ${req.params.id}`, error);
        res.status(500).json({ 
            success: false, 
            message: '禁用插件失败' 
        });
    }
});

router.post('/plugins/:id/reload', async (req, res) => {
    try {
        const pluginManager = req.app.get('pluginManager');
        const { id } = req.params;
        
        if (!pluginManager) {
            return res.status(503).json({ 
                success: false, 
                message: '插件管理器未初始化' 
            });
        }
        
        await pluginManager.reloadPlugin(id);
        logger.info(`插件已重载: ${id}`, { user: req.user.username });
        
        res.json({ success: true, message: '插件已重载' });
        
    } catch (error) {
        logger.error(`重载插件失败: ${req.params.id}`, error);
        res.status(500).json({ 
            success: false, 
            message: '重载插件失败' 
        });
    }
});

// 定时任务API
router.get('/tasks', async (req, res) => {
    try {
        const taskScheduler = req.app.get('taskScheduler');
        
        if (!taskScheduler) {
            return res.status(503).json({ 
                success: false, 
                message: '任务调度器未初始化' 
            });
        }
        
        const tasks = await taskScheduler.getTasks();
        res.json({ success: true, data: tasks });
        
    } catch (error) {
        logger.error('获取任务列表失败:', error);
        res.status(500).json({ 
            success: false, 
            message: '获取任务列表失败' 
        });
    }
});

router.post('/tasks/:id/start', async (req, res) => {
    try {
        const taskScheduler = req.app.get('taskScheduler');
        const { id } = req.params;
        
        if (!taskScheduler) {
            return res.status(503).json({ 
                success: false, 
                message: '任务调度器未初始化' 
            });
        }
        
        await taskScheduler.enableTask(id);
        logger.info(`任务已启动: ${id}`, { user: req.user.username });
        
        res.json({ success: true, message: '任务已启动' });
        
    } catch (error) {
        logger.error(`启动任务失败: ${req.params.id}`, error);
        res.status(500).json({ 
            success: false, 
            message: '启动任务失败' 
        });
    }
});

router.post('/tasks/:id/stop', async (req, res) => {
    try {
        const taskScheduler = req.app.get('taskScheduler');
        const { id } = req.params;
        
        if (!taskScheduler) {
            return res.status(503).json({ 
                success: false, 
                message: '任务调度器未初始化' 
            });
        }
        
        await taskScheduler.disableTask(id);
        logger.info(`任务已停止: ${id}`, { user: req.user.username });
        
        res.json({ success: true, message: '任务已停止' });
        
    } catch (error) {
        logger.error(`停止任务失败: ${req.params.id}`, error);
        res.status(500).json({ 
            success: false, 
            message: '停止任务失败' 
        });
    }
});

router.post('/tasks/:id/run', async (req, res) => {
    try {
        const taskScheduler = req.app.get('taskScheduler');
        const { id } = req.params;
        
        if (!taskScheduler) {
            return res.status(503).json({ 
                success: false, 
                message: '任务调度器未初始化' 
            });
        }
        
        await taskScheduler.runTask(id);
        logger.info(`任务已手动执行: ${id}`, { user: req.user.username });
        
        res.json({ success: true, message: '任务已触发执行' });
        
    } catch (error) {
        logger.error(`执行任务失败: ${req.params.id}`, error);
        res.status(500).json({ 
            success: false, 
            message: '执行任务失败' 
        });
    }
});

// Onebot状态API
router.get('/onebot/status', async (req, res) => {
    try {
        const onebotCore = req.app.get('onebotCore');
        const wsManager = req.app.get('wsManager');
        
        const status = {
            wsServer: {
                running: onebotCore ? onebotCore.isRunning() : false,
                port: config.get('onebot.wsPort', 8080),
                connections: onebotCore ? onebotCore.getConnections().length : 0
            },
            httpServer: {
                running: onebotCore ? onebotCore.isRunning() : false,
                port: config.get('onebot.httpPort', 5700)
            },
            connections: onebotCore ? onebotCore.getConnections().map(conn => ({
                id: conn.id,
                connectedAt: conn.connectedAt,
                lastHeartbeat: conn.lastHeartbeat
            })) : []
        };
        
        res.json({ success: true, data: status });
        
    } catch (error) {
        logger.error('获取Onebot状态失败:', error);
        res.status(500).json({ 
            success: false, 
            message: '获取Onebot状态失败' 
        });
    }
});

// 配置管理API
router.get('/config', async (req, res) => {
    try {
        const currentConfig = {
            server: {
                port: config.get('server.port'),
                wsPort: config.get('server.wsPort')
            },
            redis: {
                host: config.get('redis.host'),
                port: config.get('redis.port')
            },
            onebot: {
                accessToken: config.get('onebot.accessToken'),
                heartbeatInterval: config.get('onebot.heartbeatInterval')
            }
        };
        
        res.json({ success: true, data: currentConfig });
        
    } catch (error) {
        logger.error('获取配置失败:', error);
        res.status(500).json({ 
            success: false, 
            message: '获取配置失败' 
        });
    }
});

router.post('/config', async (req, res) => {
    try {
        const newConfig = req.body;
        
        // 验证配置格式
        if (!newConfig || typeof newConfig !== 'object') {
            return res.status(400).json({ 
                success: false, 
                message: '配置格式无效' 
            });
        }
        
        // 更新配置
        for (const [section, values] of Object.entries(newConfig)) {
            if (values && typeof values === 'object') {
                for (const [key, value] of Object.entries(values)) {
                    config.set(`${section}.${key}`, value);
                }
            }
        }
        
        // 保存配置
        await config.save();
        
        logger.info('配置已更新', { user: req.user.username, config: newConfig });
        
        res.json({ success: true, message: '配置已保存' });
        
    } catch (error) {
        logger.error('保存配置失败:', error);
        res.status(500).json({ 
            success: false, 
            message: '保存配置失败' 
        });
    }
});

// 日志API
router.get('/logs', async (req, res) => {
    try {
        const { level = 'info', limit = 100 } = req.query;
        
        // 这里应该从日志文件或数据库中读取日志
        // 暂时返回模拟数据
        const logs = [
            {
                timestamp: new Date().toISOString(),
                level: 'info',
                message: '系统启动完成'
            },
            {
                timestamp: new Date(Date.now() - 60000).toISOString(),
                level: 'info',
                message: 'Redis连接已建立'
            },
            {
                timestamp: new Date(Date.now() - 120000).toISOString(),
                level: 'info',
                message: 'Onebot服务已启动'
            }
        ];
        
        res.json({ success: true, data: logs });
        
    } catch (error) {
        logger.error('获取日志失败:', error);
        res.status(500).json({ 
            success: false, 
            message: '获取日志失败' 
        });
    }
});

// 错误处理中间件
router.use((error, req, res, next) => {
    logger.error('API错误:', error);
    
    res.status(500).json({
        success: false,
        message: '服务器内部错误'
    });
});

module.exports = router;