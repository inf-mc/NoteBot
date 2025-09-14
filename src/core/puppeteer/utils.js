const fs = require('fs').promises;
const path = require('path');
const logger = require('../../utils/logger');

/**
 * Puppeteer工具类
 */
class PuppeteerUtils {
    /**
     * 等待指定时间
     * @param {number} ms 毫秒数
     */
    static async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    /**
     * 等待元素出现
     * @param {Page} page Puppeteer页面对象
     * @param {string} selector CSS选择器
     * @param {Object} options 选项
     */
    static async waitForElement(page, selector, options = {}) {
        const {
            timeout = 30000,
            visible = true,
            hidden = false
        } = options;
        
        try {
            await page.waitForSelector(selector, {
                timeout,
                visible,
                hidden
            });
            return true;
        } catch (error) {
            logger.warn(`[PuppeteerUtils]: 等待元素超时: ${selector}`);
            return false;
        }
    }
    
    /**
     * 安全点击元素
     * @param {Page} page Puppeteer页面对象
     * @param {string} selector CSS选择器
     * @param {Object} options 选项
     */
    static async safeClick(page, selector, options = {}) {
        const {
            timeout = 30000,
            waitForNavigation = false,
            delay = 100
        } = options;
        
        try {
            // 等待元素可见
            await page.waitForSelector(selector, { timeout, visible: true });
            
            // 滚动到元素位置
            await page.evaluate((sel) => {
                const element = document.querySelector(sel);
                if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, selector);
            
            // 等待一小段时间确保滚动完成
            await this.sleep(delay);
            
            // 点击元素
            if (waitForNavigation) {
                await Promise.all([
                    page.waitForNavigation({ waitUntil: 'networkidle0' }),
                    page.click(selector)
                ]);
            } else {
                await page.click(selector);
            }
            
            return true;
        } catch (error) {
            logger.error(`[PuppeteerUtils]: 点击元素失败: ${selector}`, error);
            return false;
        }
    }
    
    /**
     * 安全输入文本
     * @param {Page} page Puppeteer页面对象
     * @param {string} selector CSS选择器
     * @param {string} text 要输入的文本
     * @param {Object} options 选项
     */
    static async safeType(page, selector, text, options = {}) {
        const {
            timeout = 30000,
            delay = 50,
            clear = true
        } = options;
        
        try {
            // 等待元素可见
            await page.waitForSelector(selector, { timeout, visible: true });
            
            // 聚焦到输入框
            await page.focus(selector);
            
            // 清空现有内容
            if (clear) {
                await page.evaluate((sel) => {
                    const element = document.querySelector(sel);
                    if (element) {
                        element.value = '';
                    }
                }, selector);
            }
            
            // 输入文本
            await page.type(selector, text, { delay });
            
            return true;
        } catch (error) {
            logger.error(`[PuppeteerUtils]: 输入文本失败: ${selector}`, error);
            return false;
        }
    }
    
    /**
     * 获取元素文本内容
     * @param {Page} page Puppeteer页面对象
     * @param {string} selector CSS选择器
     * @param {Object} options 选项
     */
    static async getElementText(page, selector, options = {}) {
        const { timeout = 30000, trim = true } = options;
        
        try {
            await page.waitForSelector(selector, { timeout });
            
            const text = await page.evaluate((sel) => {
                const element = document.querySelector(sel);
                return element ? element.textContent : null;
            }, selector);
            
            return trim && text ? text.trim() : text;
        } catch (error) {
            logger.error(`[PuppeteerUtils]: 获取元素文本失败: ${selector}`, error);
            return null;
        }
    }
    
    /**
     * 获取元素属性值
     * @param {Page} page Puppeteer页面对象
     * @param {string} selector CSS选择器
     * @param {string} attribute 属性名
     * @param {Object} options 选项
     */
    static async getElementAttribute(page, selector, attribute, options = {}) {
        const { timeout = 30000 } = options;
        
        try {
            await page.waitForSelector(selector, { timeout });
            
            const value = await page.evaluate((sel, attr) => {
                const element = document.querySelector(sel);
                return element ? element.getAttribute(attr) : null;
            }, selector, attribute);
            
            return value;
        } catch (error) {
            logger.error(`[PuppeteerUtils]: 获取元素属性失败: ${selector}.${attribute}`, error);
            return null;
        }
    }
    
    /**
     * 检查元素是否存在
     * @param {Page} page Puppeteer页面对象
     * @param {string} selector CSS选择器
     * @param {Object} options 选项
     */
    static async elementExists(page, selector, options = {}) {
        const { timeout = 5000 } = options;
        
        try {
            await page.waitForSelector(selector, { timeout });
            return true;
        } catch (error) {
            return false;
        }
    }
    
    /**
     * 滚动页面
     * @param {Page} page Puppeteer页面对象
     * @param {Object} options 滚动选项
     */
    static async scrollPage(page, options = {}) {
        const {
            direction = 'down', // 'up', 'down', 'top', 'bottom'
            distance = 500,
            smooth = true
        } = options;
        
        try {
            await page.evaluate((dir, dist, isSmooth) => {
                const behavior = isSmooth ? 'smooth' : 'auto';
                
                switch (dir) {
                    case 'up':
                        window.scrollBy({ top: -dist, behavior });
                        break;
                    case 'down':
                        window.scrollBy({ top: dist, behavior });
                        break;
                    case 'top':
                        window.scrollTo({ top: 0, behavior });
                        break;
                    case 'bottom':
                        window.scrollTo({ top: document.body.scrollHeight, behavior });
                        break;
                }
            }, direction, distance, smooth);
            
            // 等待滚动完成
            await this.sleep(500);
            
            return true;
        } catch (error) {
            logger.error('[PuppeteerUtils]: 滚动页面失败', error);
            return false;
        }
    }
    
    /**
     * 等待页面加载完成
     * @param {Page} page Puppeteer页面对象
     * @param {Object} options 选项
     */
    static async waitForPageLoad(page, options = {}) {
        const {
            waitUntil = 'networkidle0',
            timeout = 30000
        } = options;
        
        try {
            await page.waitForLoadState ? 
                page.waitForLoadState(waitUntil, { timeout }) :
                page.waitForNavigation({ waitUntil, timeout });
            return true;
        } catch (error) {
            logger.warn('[PuppeteerUtils]: 等待页面加载超时');
            return false;
        }
    }
    
    /**
     * 保存截图到文件
     * @param {Buffer} screenshotBuffer 截图缓冲区
     * @param {string} filename 文件名
     * @param {string} directory 保存目录
     */
    static async saveScreenshot(screenshotBuffer, filename, directory = './screenshots') {
        try {
            // 确保目录存在
            await fs.mkdir(directory, { recursive: true });
            
            // 生成完整文件路径
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const fullFilename = `${timestamp}_${filename}`;
            const filePath = path.join(directory, fullFilename);
            
            // 保存文件
            await fs.writeFile(filePath, screenshotBuffer);
            
            logger.info(`[PuppeteerUtils]: 截图已保存: ${filePath}`);
            return filePath;
        } catch (error) {
            logger.error('[PuppeteerUtils]: 保存截图失败', error);
            throw error;
        }
    }
    
    /**
     * 保存PDF到文件
     * @param {Buffer} pdfBuffer PDF缓冲区
     * @param {string} filename 文件名
     * @param {string} directory 保存目录
     */
    static async savePDF(pdfBuffer, filename, directory = './pdfs') {
        try {
            // 确保目录存在
            await fs.mkdir(directory, { recursive: true });
            
            // 生成完整文件路径
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const fullFilename = `${timestamp}_${filename}`;
            const filePath = path.join(directory, fullFilename);
            
            // 保存文件
            await fs.writeFile(filePath, pdfBuffer);
            
            logger.info(`[PuppeteerUtils]: PDF已保存: ${filePath}`);
            return filePath;
        } catch (error) {
            logger.error('[PuppeteerUtils]: 保存PDF失败', error);
            throw error;
        }
    }
    
    /**
     * 模拟移动设备
     * @param {Page} page Puppeteer页面对象
     * @param {string} deviceName 设备名称
     */
    static async emulateMobileDevice(page, deviceName = 'iPhone X') {
        try {
            const devices = {
                'iPhone X': {
                    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1',
                    viewport: { width: 375, height: 812, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
                },
                'iPad': {
                    userAgent: 'Mozilla/5.0 (iPad; CPU OS 11_0 like Mac OS X) AppleWebKit/604.1.34 (KHTML, like Gecko) Version/11.0 Mobile/15A5341f Safari/604.1',
                    viewport: { width: 768, height: 1024, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
                },
                'Android': {
                    userAgent: 'Mozilla/5.0 (Linux; Android 8.0.0; SM-G960F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/62.0.3202.84 Mobile Safari/537.36',
                    viewport: { width: 360, height: 640, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
                }
            };
            
            const device = devices[deviceName];
            if (!device) {
                throw new Error(`不支持的设备: ${deviceName}`);
            }
            
            await page.setUserAgent(device.userAgent);
            await page.setViewport(device.viewport);
            
            return true;
        } catch (error) {
            logger.error(`[PuppeteerUtils]: 模拟移动设备失败: ${deviceName}`, error);
            return false;
        }
    }
    
    /**
     * 设置请求拦截
     * @param {Page} page Puppeteer页面对象
     * @param {Object} options 拦截选项
     */
    static async setupRequestInterception(page, options = {}) {
        const {
            blockImages = false,
            blockCSS = false,
            blockFonts = false,
            blockMedia = false,
            allowedDomains = [],
            blockedDomains = []
        } = options;
        
        try {
            await page.setRequestInterception(true);
            
            page.on('request', (request) => {
                const url = request.url();
                const resourceType = request.resourceType();
                
                // 检查域名白名单
                if (allowedDomains.length > 0) {
                    const isAllowed = allowedDomains.some(domain => url.includes(domain));
                    if (!isAllowed) {
                        request.abort();
                        return;
                    }
                }
                
                // 检查域名黑名单
                if (blockedDomains.length > 0) {
                    const isBlocked = blockedDomains.some(domain => url.includes(domain));
                    if (isBlocked) {
                        request.abort();
                        return;
                    }
                }
                
                // 根据资源类型进行拦截
                if ((blockImages && resourceType === 'image') ||
                    (blockCSS && resourceType === 'stylesheet') ||
                    (blockFonts && resourceType === 'font') ||
                    (blockMedia && (resourceType === 'media' || resourceType === 'video'))) {
                    request.abort();
                    return;
                }
                
                request.continue();
            });
            
            return true;
        } catch (error) {
            logger.error('[PuppeteerUtils]: 设置请求拦截失败', error);
            return false;
        }
    }
    
    /**
     * 获取页面性能指标
     * @param {Page} page Puppeteer页面对象
     */
    static async getPerformanceMetrics(page) {
        try {
            const metrics = await page.metrics();
            const performanceTiming = await page.evaluate(() => {
                return JSON.stringify(window.performance.timing);
            });
            
            return {
                puppeteerMetrics: metrics,
                performanceTiming: JSON.parse(performanceTiming)
            };
        } catch (error) {
            logger.error('[PuppeteerUtils]: 获取性能指标失败', error);
            return null;
        }
    }
    
    /**
     * 清理页面资源
     * @param {Page} page Puppeteer页面对象
     */
    static async cleanupPage(page) {
        try {
            // 移除所有监听器
            page.removeAllListeners();
            
            // 清理JavaScript堆
            await page.evaluate(() => {
                // 清理全局变量
                if (window.gc) {
                    window.gc();
                }
            });
            
            return true;
        } catch (error) {
            logger.error('[PuppeteerUtils]: 清理页面资源失败', error);
            return false;
        }
    }
}

module.exports = PuppeteerUtils;