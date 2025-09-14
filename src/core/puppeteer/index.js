const puppeteer = require('puppeteer');
const logger = require('../../utils/logger');
const EventEmitter = require('events');
const { PuppeteerError, InitializationError, BrowserCreationError, PageCreationError } = require('./errors');
const config = require('./config');
const PuppeteerMonitor = require('./monitor');
const PuppeteerUtils = require('./utils');
const ChromeDetector = require('./chrome-detector');

/**
 * Puppeteer管理器类
 * 负责浏览器实例管理、页面池管理和资源优化
 */
class PuppeteerManager extends EventEmitter {
    constructor(options = {}) {
        super();
        
        // 初始化Chrome检测器
        this.chromeDetector = new ChromeDetector();
        
        // 配置选项
        this.options = {
            // 最大浏览器实例数
            maxBrowsers: options.maxBrowsers || 3,
            // 最大页面数
            maxPages: options.maxPages || 10,
            // 页面空闲超时时间（毫秒）
            pageIdleTimeout: options.pageIdleTimeout || 300000, // 5分钟
            // 浏览器启动选项
            launchOptions: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu'
                ],
                ...options.launchOptions
            }
        };
        
        // 浏览器实例池
        this.browsers = new Map();
        // 页面池
        this.pages = new Map();
        // 页面使用状态
        this.pageStatus = new Map();
        // 页面空闲定时器
        this.pageTimers = new Map();
        
        this.isInitialized = false;
        this.isShuttingDown = false;
        
        // 初始化监控器
        this.monitor = new PuppeteerMonitor(this, options.monitor);
        
        // 绑定清理函数
        this.cleanup = this.cleanup.bind(this);
        process.on('SIGINT', this.cleanup);
        process.on('SIGTERM', this.cleanup);
        process.on('exit', this.cleanup);
    }
    
    /**
     * 初始化Puppeteer管理器
     */
    async initialize() {
        if (this.isInitialized) {
            return;
        }
        
        try {
            //logger.info('[PuppeteerManager]: 正在初始化Puppeteer管理器...');
            
            // 启动监控器
            this.monitor.start();
            
            // 创建初始浏览器实例
            await this.createBrowser();
            
            this.isInitialized = true;
            logger.info('[PuppeteerManager]: Puppeteer管理器初始化完成');
            
            this.emit('initialized');
        } catch (error) {
            logger.error('[PuppeteerManager]: 初始化失败:', error);
            throw new InitializationError('Puppeteer管理器初始化失败', error);
        }
    }
    
    /**
     * 创建新的浏览器实例
     */
    async createBrowser() {
        if (this.browsers.size >= this.options.maxBrowsers) {
            throw new BrowserCreationError('已达到最大浏览器实例数限制');
        }
        
        try {
            // 自动检测Chrome路径
            const launchOptions = { ...this.options.launchOptions };
            
            // 如果没有指定executablePath，则自动检测
            if (!launchOptions.executablePath) {
                const chromePath = await this.chromeDetector.detectChrome();
                if (chromePath) {
                    launchOptions.executablePath = chromePath;
                    //logger.info(`[PuppeteerManager]: 使用检测到的Chrome路径: ${chromePath}`);
                    
                    // 获取Chrome版本信息
                    const version = await this.chromeDetector.getChromeVersion(chromePath);
                    if (version) {
                        //logger.info(`[PuppeteerManager]: Chrome版本: ${version}`);
                    }
                } else {
                    logger.warn('[PuppeteerManager]: 未检测到Chrome浏览器，将使用Puppeteer默认设置');
                }
            }
            
            const browser = await puppeteer.launch(launchOptions);
            const browserId = `browser_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            this.browsers.set(browserId, {
                instance: browser,
                createdAt: Date.now(),
                pageCount: 0
            });
            
            //logger.info(`[PuppeteerManager]: 创建浏览器实例: ${browserId}`);
            
            // 监听浏览器断开连接
            browser.on('disconnected', () => {
                this.handleBrowserDisconnect(browserId);
            });
            
            // 发出浏览器创建事件
            this.emit('browserCreated', { browserId, browser });
            
            return browserId;
        } catch (error) {
            logger.error('[PuppeteerManager]: 创建浏览器实例失败:', error);
            this.emit('error', new BrowserCreationError('创建浏览器实例失败', error));
            throw new BrowserCreationError('创建浏览器实例失败', error);
        }
    }
    
    /**
     * 获取可用的页面
     * @param {string} browserId 浏览器ID
     */
    async getPage(browserId = null) {
        if (!this.isInitialized) {
            await this.initialize();
        }
        
        // 查找空闲页面
        for (const [pageId, status] of this.pageStatus.entries()) {
            if (!status.inUse && (!browserId || status.browserId === browserId)) {
                this.setPageInUse(pageId, true);
                return {
                    pageId,
                    page: this.pages.get(pageId)
                };
            }
        }
        
        // 如果没有空闲页面，创建新页面
        if (this.pages.size < this.options.maxPages) {
            return await this.createPage(browserId);
        }
        
        throw new PageCreationError('已达到最大页面数限制，请稍后重试');
    }
    
    /**
     * 创建新页面
     * @param {string} browserId 指定的浏览器ID
     */
    async createPage(browserId = null) {
        try {
            let selectedBrowser = null;
            
            if (browserId && this.browsers.has(browserId)) {
                // 使用指定的浏览器
                selectedBrowser = { id: browserId, ...this.browsers.get(browserId) };
            } else {
                // 选择页面数最少的浏览器
                let minPageCount = Infinity;
                
                for (const [bId, browserInfo] of this.browsers.entries()) {
                    if (browserInfo.pageCount < minPageCount) {
                        minPageCount = browserInfo.pageCount;
                        selectedBrowser = { id: bId, ...browserInfo };
                    }
                }
            }
            
            if (!selectedBrowser) {
                // 如果没有可用浏览器，创建新的
                const newBrowserId = await this.createBrowser();
                selectedBrowser = { id: newBrowserId, ...this.browsers.get(newBrowserId) };
            }
            
            const page = await selectedBrowser.instance.newPage();
            const pageId = `page_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            // 设置页面默认配置
            await this.setupPage(page);
            
            this.pages.set(pageId, page);
            this.pageStatus.set(pageId, {
                inUse: true,
                browserId: selectedBrowser.id,
                createdAt: Date.now(),
                lastUsed: Date.now()
            });
            
            // 更新浏览器页面计数
            this.browsers.get(selectedBrowser.id).pageCount++;
            
            logger.info(`[PuppeteerManager]: 创建页面: ${pageId}`);
            
            // 发出页面创建事件
            this.emit('pageCreated', { pageId, browserId: selectedBrowser.id, page });
            
            return {
                pageId,
                page
            };
        } catch (error) {
            logger.error('[PuppeteerManager]: 创建页面失败:', error);
            this.emit('error', new PageCreationError('创建页面失败', error));
            throw new PageCreationError('创建页面失败', error);
        }
    }
    
    /**
     * 释放页面
     * @param {string} pageId 页面ID
     */
    async releasePage(pageId) {
        if (!this.pages.has(pageId)) {
            logger.warn(`[PuppeteerManager]: 页面不存在: ${pageId}`);
            return;
        }
        
        const page = this.pages.get(pageId);
        
        // 清理页面状态
        try {
            await PuppeteerUtils.cleanupPage(page);
            await page.goto('about:blank');
        } catch (error) {
            logger.warn('[PuppeteerManager]: 清理页面状态失败:', error);
        }
        
        this.setPageInUse(pageId, false);
        
        // 设置空闲超时
        this.setPageIdleTimeout(pageId);
        
        logger.debug(`[PuppeteerManager]: 释放页面: ${pageId}`);
    }
    
    /**
     * 设置页面使用状态
     */
    setPageInUse(pageId, inUse) {
        const status = this.pageStatus.get(pageId);
        if (status) {
            status.inUse = inUse;
            status.lastUsed = Date.now();
            
            if (inUse) {
                // 清除空闲定时器
                this.clearPageIdleTimeout(pageId);
            }
        }
    }
    
    /**
     * 设置页面空闲超时
     */
    setPageIdleTimeout(pageId) {
        this.clearPageIdleTimeout(pageId);
        
        const timer = setTimeout(() => {
            this.closePage(pageId);
        }, this.options.pageIdleTimeout);
        
        this.pageTimers.set(pageId, timer);
    }
    
    /**
     * 清除页面空闲定时器
     */
    clearPageIdleTimeout(pageId) {
        const timer = this.pageTimers.get(pageId);
        if (timer) {
            clearTimeout(timer);
            this.pageTimers.delete(pageId);
        }
    }
    
    /**
     * 关闭页面
     */
    async closePage(pageId) {
        try {
            const page = this.pages.get(pageId);
            const status = this.pageStatus.get(pageId);
            
            if (page && !page.isClosed()) {
                await page.close();
            }
            
            if (status) {
                // 更新浏览器页面计数
                const browserInfo = this.browsers.get(status.browserId);
                if (browserInfo) {
                    browserInfo.pageCount--;
                }
            }
            
            this.pages.delete(pageId);
            this.pageStatus.delete(pageId);
            this.clearPageIdleTimeout(pageId);
            
            logger.debug(`[PuppeteerManager]: 关闭页面: ${pageId}`);
        } catch (error) {
            logger.error(`[PuppeteerManager]: 关闭页面失败 ${pageId}:`, error);
        }
    }
    
    /**
     * 处理浏览器断开连接
     */
    handleBrowserDisconnect(browserId) {
        logger.warn(`[PuppeteerManager]: 浏览器断开连接: ${browserId}`);
        
        // 清理相关页面
        for (const [pageId, status] of this.pageStatus.entries()) {
            if (status.browserId === browserId) {
                this.pages.delete(pageId);
                this.pageStatus.delete(pageId);
                this.clearPageIdleTimeout(pageId);
            }
        }
        
        this.browsers.delete(browserId);
    }
    
    /**
     * 设置页面选项
     * @param {Page} page 页面实例
     */
    async setupPage(page) {
        // 设置视口
        await page.setViewport(config.page?.defaultViewport || { width: 1920, height: 1080 });
        
        // 设置用户代理
        const userAgent = config.page?.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
        await page.setUserAgent(userAgent);
        
        // 设置超时
        const timeout = config.page?.timeout || 30000;
        page.setDefaultTimeout(timeout);
        page.setDefaultNavigationTimeout(timeout);
        
        // 设置额外的页面选项
        if (config.page?.extraHTTPHeaders) {
            await page.setExtraHTTPHeaders(config.page.extraHTTPHeaders);
        }
        
        // 设置JavaScript启用状态
        await page.setJavaScriptEnabled(config.page?.javaScriptEnabled !== false);
    }
    
    /**
     * 执行浏览器操作
     * @param {Function} operation 操作函数
     * @param {Object} options 选项
     */
    async executeOperation(operation, options = {}) {
        const { browserId = null, timeout = 30000 } = options;
        
        let pageData = null;
        const operationData = {
            startTime: Date.now(),
            operation: operation.name || 'anonymous',
            success: false
        };
        
        // 发出操作开始事件
        this.emit('operationStart', operationData);
        
        try {
            pageData = await this.getPage(browserId);
            const { pageId, page } = pageData;
            
            // 设置操作超时
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('操作超时')), timeout);
            });
            
            // 执行操作
            const result = await Promise.race([
                operation(page),
                timeoutPromise
            ]);
            
            operationData.success = true;
            return result;
            
        } catch (error) {
            logger.error('[PuppeteerManager]: 执行操作失败:', error);
            operationData.error = error;
            this.emit('error', error);
            throw error;
        } finally {
            if (pageData) {
                await this.releasePage(pageData.pageId);
            }
            
            // 发出操作结束事件
            operationData.endTime = Date.now();
            operationData.duration = operationData.endTime - operationData.startTime;
            this.emit('operationEnd', operationData);
        }
    }
    
    /**
     * 获取状态信息
     */
    getStatus() {
        const totalPages = this.pages.size;
        const inUsePages = Array.from(this.pageStatus.values()).filter(status => status.inUse).length;
        const idlePages = totalPages - inUsePages;
        
        const status = {
            initialized: this.isInitialized,
            browsers: {
                count: this.browsers.size,
                max: this.options.maxBrowsers,
                details: Array.from(this.browsers.entries()).map(([id, info]) => ({
                    id,
                    pageCount: info.pageCount,
                    connected: !info.instance.isConnected || info.instance.isConnected()
                }))
            },
            pages: {
                total: totalPages,
                inUse: inUsePages,
                idle: idlePages,
                max: this.options.maxPages
            },
            performance: this.monitor ? this.monitor.getReport() : null
        };
        
        return status;
    }
    
    /**
     * 清理资源
     */
    async cleanup() {
        if (this.isShuttingDown) {
            return;
        }
        
        this.isShuttingDown = true;
        logger.info('[PuppeteerManager]: 开始清理资源...');
        
        try {
            // 停止监控器
            if (this.monitor) {
                this.monitor.stop();
            }
            
            // 清理所有定时器
            for (const timer of this.pageTimers.values()) {
                clearTimeout(timer);
            }
            this.pageTimers.clear();
            
            // 关闭所有页面
            const closePagePromises = [];
            for (const [pageId, page] of this.pages.entries()) {
                if (!page.isClosed()) {
                    closePagePromises.push(
                        PuppeteerUtils.cleanupPage(page)
                            .then(() => page.close())
                            .then(() => logger.info(`[PuppeteerManager]: 页面已关闭: ${pageId}`))
                            .catch(err => logger.error(`关闭页面失败 ${pageId}:`, err))
                    );
                }
            }
            await Promise.all(closePagePromises);
            
            // 关闭所有浏览器
            const closeBrowserPromises = [];
            for (const [browserId, browserInfo] of this.browsers.entries()) {
                closeBrowserPromises.push(
                    browserInfo.instance.close()
                        .then(() => logger.info(`[PuppeteerManager]: 浏览器已关闭: ${browserId}`))
                        .catch(err => logger.error(`关闭浏览器失败 ${browserId}:`, err))
                );
            }
            await Promise.all(closeBrowserPromises);
            
            this.pages.clear();
            this.pageStatus.clear();
            this.browsers.clear();
            
            this.isInitialized = false;
            logger.info('[PuppeteerManager]: 资源清理完成');
        } catch (error) {
            logger.error('[PuppeteerManager]: 清理资源时发生错误:', error);
        } finally {
            this.isShuttingDown = false;
        }
    }
}

// 导出工具类和配置
PuppeteerManager.Utils = PuppeteerUtils;
PuppeteerManager.Config = config;
PuppeteerManager.Errors = require('./errors');

module.exports = PuppeteerManager;