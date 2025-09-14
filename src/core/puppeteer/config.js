/**
 * Puppeteer模块配置
 */
module.exports = {
    // 默认配置
    defaults: {
        // 浏览器配置
        browser: {
            // 最大浏览器实例数
            maxBrowsers: 3,
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
                    '--disable-gpu',
                    '--disable-web-security',
                    '--disable-features=VizDisplayCompositor'
                ]
            }
        },
        
        // 页面配置
        page: {
            // 最大页面数
            maxPages: 10,
            // 页面空闲超时时间（毫秒）
            idleTimeout: 300000, // 5分钟
            // 默认视口
            viewport: {
                width: 1920,
                height: 1080
            },
            // 默认用户代理
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        },
        
        // 操作配置
        operation: {
            // 默认超时时间
            timeout: 30000,
            // 默认重试次数
            retries: 1,
            // 导航等待条件
            waitUntil: 'networkidle2'
        },
        
        // 截图配置
        screenshot: {
            type: 'jpeg',
            quality: 90,
            fullPage: true
        },
        
        // PDF配置
        pdf: {
            format: 'A4',
            printBackground: true,
            margin: {
                top: '1cm',
                right: '1cm',
                bottom: '1cm',
                left: '1cm'
            }
        }
    },
    
    // 错误类型
    errors: {
        INITIALIZATION_FAILED: 'PUPPETEER_INITIALIZATION_FAILED',
        BROWSER_CREATION_FAILED: 'BROWSER_CREATION_FAILED',
        PAGE_CREATION_FAILED: 'PAGE_CREATION_FAILED',
        OPERATION_TIMEOUT: 'OPERATION_TIMEOUT',
        NAVIGATION_FAILED: 'NAVIGATION_FAILED',
        RESOURCE_LIMIT_EXCEEDED: 'RESOURCE_LIMIT_EXCEEDED',
        BROWSER_DISCONNECTED: 'BROWSER_DISCONNECTED'
    },
    
    // 性能监控配置
    monitoring: {
        // 是否启用性能监控
        enabled: true,
        // 监控间隔（毫秒）
        interval: 60000, // 1分钟
        // 内存使用警告阈值（MB）
        memoryWarningThreshold: 500,
        // 内存使用错误阈值（MB）
        memoryErrorThreshold: 1000
    },
    
    // 安全配置
    security: {
        // 允许的域名列表（空数组表示允许所有）
        allowedDomains: [],
        // 禁止的域名列表
        blockedDomains: [
            'malware.com',
            'phishing.com'
        ],
        // 最大文件下载大小（字节）
        maxDownloadSize: 10 * 1024 * 1024, // 10MB
        // 是否允许执行JavaScript
        allowJavaScript: true,
        // 是否允许加载图片
        allowImages: true
    }
};