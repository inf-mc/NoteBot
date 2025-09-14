const logger = require('../../utils/logger');
const { PuppeteerError, OperationError } = require('./errors');
const config = require('./config');
const PuppeteerUtils = require('./utils');

/**
 * Puppeteer API类
 * 为插件提供简化的浏览器操作接口
 */
class PuppeteerAPI {
    constructor(puppeteerManager) {
        this.manager = puppeteerManager;
        this.utils = PuppeteerUtils;
    }
    
    /**
     * 执行浏览器操作
     * @param {Function} operation - 操作函数
     * @param {Object} options - 选项
     */
    async execute(operation, options = {}) {
        try {
            return await this.manager.executeOperation(operation, options);
        } catch (error) {
            logger.error('[PuppeteerAPI]: 执行操作失败:', error);
            throw new OperationError('浏览器操作执行失败', error);
        }
    }
    
    /**
     * 导航到指定URL
     * @param {string} url 目标URL
     * @param {Object} options 选项
     */
    async goto(url, options = {}) {
        const {
            waitUntil = 'networkidle0',
            timeout = 30000,
            referer = null
        } = options;
        
        return this.execute(async (page) => {
            const navigationOptions = { waitUntil, timeout };
            if (referer) {
                navigationOptions.referer = referer;
            }
            
            logger.info(`[PuppeteerAPI]: 导航到: ${url}`);
            const response = await page.goto(url, navigationOptions);
            
            return {
                url: page.url(),
                title: await page.title(),
                status: response ? response.status() : null,
                ok: response ? response.ok() : null
            };
        }, options);
    }
    
    /**
     * 等待元素出现并获取
     * @param {string} selector CSS选择器
     * @param {Object} options 选项
     */
    async waitForElement(selector, options = {}) {
        const {
            timeout = 30000,
            visible = true,
            hidden = false
        } = options;
        
        return this.execute(async (page) => {
            logger.info(`[PuppeteerAPI]: 等待元素: ${selector}`);
            
            await page.waitForSelector(selector, {
                timeout,
                visible,
                hidden
            });
            
            return {
                selector,
                found: true,
                timestamp: Date.now()
            };
        }, options);
    }
    
    /**
     * 点击元素
     * @param {string} selector CSS选择器
     * @param {Object} options 选项
     */
    async click(selector, options = {}) {
        const {
            waitForNavigation = false,
            delay = 100,
            button = 'left',
            clickCount = 1
        } = options;
        
        return this.execute(async (page) => {
            logger.info(`[PuppeteerAPI]: 点击元素: ${selector}`);
            
            const success = await this.utils.safeClick(page, selector, {
                waitForNavigation,
                delay
            });
            
            if (!success) {
                throw new OperationError(`点击元素失败: ${selector}`);
            }
            
            return {
                selector,
                clicked: true,
                timestamp: Date.now()
            };
        }, options);
    }
    
    /**
     * 输入文本
     * @param {string} selector CSS选择器
     * @param {string} text 要输入的文本
     * @param {Object} options 选项
     */
    async type(selector, text, options = {}) {
        const {
            delay = 50,
            clear = true
        } = options;
        
        return this.execute(async (page) => {
            logger.info(`[PuppeteerAPI]: 在 ${selector} 中输入文本`);
            
            const success = await this.utils.safeType(page, selector, text, {
                delay,
                clear
            });
            
            if (!success) {
                throw new OperationError(`输入文本失败: ${selector}`);
            }
            
            return {
                selector,
                text: text.length > 50 ? text.substring(0, 50) + '...' : text,
                typed: true,
                timestamp: Date.now()
            };
        }, options);
    }
    
    /**
     * 获取元素文本
     * @param {string} selector CSS选择器
     * @param {Object} options 选项
     */
    async getText(selector, options = {}) {
        const { trim = true } = options;
        
        return this.execute(async (page) => {
            logger.info(`[PuppeteerAPI]: 获取元素文本: ${selector}`);
            
            const text = await this.utils.getElementText(page, selector, { trim });
            
            if (text === null) {
                throw new OperationError(`获取元素文本失败: ${selector}`);
            }
            
            return {
                selector,
                text,
                length: text.length,
                timestamp: Date.now()
            };
        }, options);
    }
    
    /**
     * 获取元素属性
     * @param {string} selector CSS选择器
     * @param {string} attribute 属性名
     * @param {Object} options 选项
     */
    async getAttribute(selector, attribute, options = {}) {
        return this.execute(async (page) => {
            logger.info(`[PuppeteerAPI]: 获取元素属性: ${selector}.${attribute}`);
            
            const value = await this.utils.getElementAttribute(page, selector, attribute);
            
            return {
                selector,
                attribute,
                value,
                timestamp: Date.now()
            };
        }, options);
    }
    
    /**
     * 检查元素是否存在
     * @param {string} selector CSS选择器
     * @param {Object} options 选项
     */
    async elementExists(selector, options = {}) {
        const { timeout = 5000 } = options;
        
        return this.execute(async (page) => {
            logger.info(`[PuppeteerAPI]: 检查元素是否存在: ${selector}`);
            
            const exists = await this.utils.elementExists(page, selector, { timeout });
            
            return {
                selector,
                exists,
                timestamp: Date.now()
            };
        }, options);
    }
    
    /**
     * 滚动页面
     * @param {Object} options 滚动选项
     */
    async scroll(options = {}) {
        const {
            direction = 'down',
            distance = 500,
            smooth = true
        } = options;
        
        return this.execute(async (page) => {
            logger.info(`[PuppeteerAPI]: 滚动页面: ${direction}`);
            
            const success = await this.utils.scrollPage(page, {
                direction,
                distance,
                smooth
            });
            
            if (!success) {
                throw new OperationError('滚动页面失败');
            }
            
            return {
                direction,
                distance,
                scrolled: true,
                timestamp: Date.now()
            };
        }, options);
    }
    
    /**
     * 等待页面加载完成
     * @param {Object} options 选项
     */
    async waitForLoad(options = {}) {
        const {
            waitUntil = 'networkidle0',
            timeout = 30000
        } = options;
        
        return this.execute(async (page) => {
            logger.info('[PuppeteerAPI]: 等待页面加载完成');
            
            const success = await this.utils.waitForPageLoad(page, {
                waitUntil,
                timeout
            });
            
            return {
                loaded: success,
                url: page.url(),
                title: await page.title(),
                timestamp: Date.now()
            };
        }, options);
    }
    
    /**
     * 执行JavaScript代码
     * @param {string|Function} script JavaScript代码或函数
     * @param {Array} args 参数数组
     * @param {Object} options 选项
     */
    async evaluate(script, args = [], options = {}) {
        return this.execute(async (page) => {
            logger.info('[PuppeteerAPI]: 执行JavaScript代码');
            
            let result;
            if (typeof script === 'function') {
                result = await page.evaluate(script, ...args);
            } else {
                result = await page.evaluate(script);
            }
            
            return {
                result,
                script: typeof script === 'function' ? script.name || 'anonymous' : script.substring(0, 100),
                timestamp: Date.now()
            };
        }, options);
    }
    
    /**
     * 模拟移动设备
     * @param {string} deviceName 设备名称
     * @param {Object} options 选项
     */
    async emulateDevice(deviceName = 'iPhone X', options = {}) {
        return this.execute(async (page) => {
            logger.info(`[PuppeteerAPI]: 模拟设备: ${deviceName}`);
            
            const success = await this.utils.emulateMobileDevice(page, deviceName);
            
            if (!success) {
                throw new OperationError(`模拟设备失败: ${deviceName}`);
            }
            
            return {
                device: deviceName,
                emulated: true,
                timestamp: Date.now()
            };
        }, options);
    }
    
    /**
     * 设置请求拦截
     * @param {Object} interceptOptions 拦截选项
     * @param {Object} options 选项
     */
    async setupInterception(interceptOptions = {}, options = {}) {
        return this.execute(async (page) => {
            logger.info('[PuppeteerAPI]: 设置请求拦截');
            
            const success = await this.utils.setupRequestInterception(page, interceptOptions);
            
            if (!success) {
                throw new OperationError('设置请求拦截失败');
            }
            
            return {
                interception: interceptOptions,
                setup: true,
                timestamp: Date.now()
            };
        }, options);
    }
    
    /**
     * 获取页面性能指标
     * @param {Object} options 选项
     */
    async getPerformanceMetrics(options = {}) {
        return this.execute(async (page) => {
            logger.info('[PuppeteerAPI]: 获取性能指标');
            
            const metrics = await this.utils.getPerformanceMetrics(page);
            
            if (!metrics) {
                throw new OperationError('获取性能指标失败');
            }
            
            return {
                ...metrics,
                timestamp: Date.now()
            };
        }, options);
    }
    
    /**
     * 截取网页截图
     * @param {string} url - 网页URL
     * @param {Object} options - 截图选项
     */
    async screenshot(url, options = {}) {
        const {
            fullPage = true,
            quality = 90,
            type = 'jpeg',
            clip = null,
            waitFor = null,
            viewport = { width: 1920, height: 1080 }
        } = options;
        
        return await this.execute(async (page) => {
            // 设置视口
            await page.setViewport(viewport);
            
            // 导航到页面
            await page.goto(url, { waitUntil: 'networkidle2' });
            
            // 等待特定元素或时间
            if (waitFor) {
                if (typeof waitFor === 'string') {
                    await page.waitForSelector(waitFor);
                } else if (typeof waitFor === 'number') {
                    await page.waitForTimeout(waitFor);
                }
            }
            
            // 截图选项
            const screenshotOptions = {
                type,
                fullPage,
                quality: type === 'jpeg' ? quality : undefined
            };
            
            if (clip) {
                screenshotOptions.clip = clip;
                screenshotOptions.fullPage = false;
            }
            
            return await page.screenshot(screenshotOptions);
        }, options);
    }
    
    /**
     * 获取网页内容
     * @param {string} url - 网页URL
     * @param {Object} options - 选项
     */
    async getContent(url, options = {}) {
        const {
            waitFor = null,
            selector = null,
            attribute = null
        } = options;
        
        return await this.execute(async (page) => {
            await page.goto(url, { waitUntil: 'networkidle2' });
            
            if (waitFor) {
                if (typeof waitFor === 'string') {
                    await page.waitForSelector(waitFor);
                } else if (typeof waitFor === 'number') {
                    await page.waitForTimeout(waitFor);
                }
            }
            
            if (selector) {
                if (attribute) {
                    return await page.$eval(selector, (el, attr) => el.getAttribute(attr), attribute);
                } else {
                    return await page.$eval(selector, el => el.textContent);
                }
            }
            
            return await page.content();
        }, options);
    }
    
    /**
     * 获取多个元素内容
     * @param {string} url - 网页URL
     * @param {string} selector - CSS选择器
     * @param {Object} options - 选项
     */
    async getElements(url, selector, options = {}) {
        const {
            waitFor = null,
            attribute = null,
            limit = null
        } = options;
        
        return await this.execute(async (page) => {
            await page.goto(url, { waitUntil: 'networkidle2' });
            
            if (waitFor) {
                if (typeof waitFor === 'string') {
                    await page.waitForSelector(waitFor);
                } else if (typeof waitFor === 'number') {
                    await page.waitForTimeout(waitFor);
                }
            }
            
            let elements;
            if (attribute) {
                elements = await page.$$eval(selector, (els, attr) => 
                    els.map(el => el.getAttribute(attr)), attribute);
            } else {
                elements = await page.$$eval(selector, els => 
                    els.map(el => el.textContent));
            }
            
            return limit ? elements.slice(0, limit) : elements;
        }, options);
    }
    
    /**
     * 执行JavaScript代码
     * @param {string} url - 网页URL
     * @param {string|Function} script - JavaScript代码或函数
     * @param {Object} options - 选项
     */
    async executeScript(url, script, options = {}) {
        const { waitFor = null, args = [] } = options;
        
        return await this.execute(async (page) => {
            await page.goto(url, { waitUntil: 'networkidle2' });
            
            if (waitFor) {
                if (typeof waitFor === 'string') {
                    await page.waitForSelector(waitFor);
                } else if (typeof waitFor === 'number') {
                    await page.waitForTimeout(waitFor);
                }
            }
            
            if (typeof script === 'function') {
                return await page.evaluate(script, ...args);
            } else {
                return await page.evaluate(script);
            }
        }, options);
    }
    
    /**
     * 填写表单并提交
     * @param {string} url - 网页URL
     * @param {Object} formData - 表单数据
     * @param {Object} options - 选项
     */
    async submitForm(url, formData, options = {}) {
        const {
            submitSelector = 'input[type="submit"], button[type="submit"]',
            waitAfterSubmit = 3000
        } = options;
        
        return await this.execute(async (page) => {
            await page.goto(url, { waitUntil: 'networkidle2' });
            
            // 填写表单字段
            for (const [selector, value] of Object.entries(formData)) {
                await page.waitForSelector(selector);
                await page.type(selector, value);
            }
            
            // 提交表单
            await page.click(submitSelector);
            
            // 等待页面响应
            if (waitAfterSubmit) {
                await page.waitForTimeout(waitAfterSubmit);
            }
            
            return {
                url: page.url(),
                content: await page.content()
            };
        }, options);
    }
    
    /**
     * 生成PDF
     * @param {string} url - 网页URL
     * @param {Object} options - PDF选项
     */
    async generatePDF(url, options = {}) {
        const {
            format = 'A4',
            printBackground = true,
            margin = { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' },
            waitFor = null
        } = options;
        
        return await this.execute(async (page) => {
            await page.goto(url, { waitUntil: 'networkidle2' });
            
            if (waitFor) {
                if (typeof waitFor === 'string') {
                    await page.waitForSelector(waitFor);
                } else if (typeof waitFor === 'number') {
                    await page.waitForTimeout(waitFor);
                }
            }
            
            return await page.pdf({
                format,
                printBackground,
                margin
            });
        }, options);
    }
    
    /**
     * 模拟用户交互
     * @param {string} url - 网页URL
     * @param {Array} actions - 操作序列
     * @param {Object} options - 选项
     */
    async interact(url, actions, options = {}) {
        return await this.execute(async (page) => {
            await page.goto(url, { waitUntil: 'networkidle2' });
            
            for (const action of actions) {
                const { type, selector, value, delay = 100 } = action;
                
                switch (type) {
                    case 'click':
                        await page.waitForSelector(selector);
                        await page.click(selector);
                        break;
                    case 'type':
                        await page.waitForSelector(selector);
                        await page.type(selector, value);
                        break;
                    case 'select':
                        await page.waitForSelector(selector);
                        await page.select(selector, value);
                        break;
                    case 'wait':
                        if (typeof value === 'string') {
                            await page.waitForSelector(value);
                        } else {
                            await page.waitForTimeout(value);
                        }
                        break;
                    case 'scroll':
                        await page.evaluate((y) => window.scrollTo(0, y), value);
                        break;
                }
                
                if (delay) {
                    await page.waitForTimeout(delay);
                }
            }
            
            return {
                url: page.url(),
                content: await page.content()
            };
        }, options);
    }
    
    /**
     * 检查网页可访问性
     * @param {string} url - 网页URL
     * @param {Object} options - 选项
     */
    async checkAccessibility(url, options = {}) {
        return await this.execute(async (page) => {
            await page.goto(url, { waitUntil: 'networkidle2' });
            
            // 基本可访问性检查
            const result = await page.evaluate(() => {
                const checks = {
                    hasTitle: !!document.title,
                    hasHeadings: document.querySelectorAll('h1, h2, h3, h4, h5, h6').length > 0,
                    hasAltTexts: Array.from(document.querySelectorAll('img')).every(img => img.alt),
                    hasLabels: Array.from(document.querySelectorAll('input')).every(input => 
                        input.labels && input.labels.length > 0 || input.getAttribute('aria-label')
                    ),
                    hasLandmarks: document.querySelectorAll('[role="main"], main, [role="navigation"], nav').length > 0
                };
                
                return {
                    ...checks,
                    score: Object.values(checks).filter(Boolean).length / Object.keys(checks).length
                };
            });
            
            return result;
        }, options);
    }
    
    /**
     * 延迟函数
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    /**
     * 获取管理器状态
     */
    getStatus() {
        return this.manager.getStatus();
    }
}

module.exports = PuppeteerAPI;