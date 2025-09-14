/**
 * Puppeteer模块自定义错误类
 */

/**
 * 基础Puppeteer错误类
 */
class PuppeteerError extends Error {
    constructor(message, code, details = {}) {
        super(message);
        this.name = this.constructor.name;
        this.code = code;
        this.details = details;
        this.timestamp = new Date().toISOString();
        
        // 保持错误堆栈
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
    
    toJSON() {
        return {
            name: this.name,
            message: this.message,
            code: this.code,
            details: this.details,
            timestamp: this.timestamp,
            stack: this.stack
        };
    }
}

/**
 * 初始化失败错误
 */
class InitializationError extends PuppeteerError {
    constructor(message, details = {}) {
        super(message, 'PUPPETEER_INITIALIZATION_FAILED', details);
    }
}

/**
 * 浏览器创建失败错误
 */
class BrowserCreationError extends PuppeteerError {
    constructor(message, details = {}) {
        super(message, 'BROWSER_CREATION_FAILED', details);
    }
}

/**
 * 页面创建失败错误
 */
class PageCreationError extends PuppeteerError {
    constructor(message, details = {}) {
        super(message, 'PAGE_CREATION_FAILED', details);
    }
}

/**
 * 操作超时错误
 */
class OperationTimeoutError extends PuppeteerError {
    constructor(message, timeout, details = {}) {
        super(message, 'OPERATION_TIMEOUT', { ...details, timeout });
    }
}

/**
 * 导航失败错误
 */
class NavigationError extends PuppeteerError {
    constructor(message, url, details = {}) {
        super(message, 'NAVIGATION_FAILED', { ...details, url });
    }
}

/**
 * 资源限制超出错误
 */
class ResourceLimitError extends PuppeteerError {
    constructor(message, resource, limit, current, details = {}) {
        super(message, 'RESOURCE_LIMIT_EXCEEDED', {
            ...details,
            resource,
            limit,
            current
        });
    }
}

/**
 * 浏览器断开连接错误
 */
class BrowserDisconnectedError extends PuppeteerError {
    constructor(message, browserId, details = {}) {
        super(message, 'BROWSER_DISCONNECTED', { ...details, browserId });
    }
}

/**
 * 安全策略违规错误
 */
class SecurityViolationError extends PuppeteerError {
    constructor(message, violation, details = {}) {
        super(message, 'SECURITY_VIOLATION', { ...details, violation });
    }
}

/**
 * 错误处理工具类
 */
class ErrorHandler {
    /**
     * 包装异步操作，提供统一的错误处理
     */
    static async wrapAsync(operation, errorType = PuppeteerError, context = {}) {
        try {
            return await operation();
        } catch (error) {
            if (error instanceof PuppeteerError) {
                throw error;
            }
            
            // 根据错误类型创建相应的错误实例
            const wrappedError = new errorType(
                error.message || '未知错误',
                { ...context, originalError: error.message, stack: error.stack }
            );
            
            throw wrappedError;
        }
    }
    
    /**
     * 检查是否为可重试的错误
     */
    static isRetryableError(error) {
        const retryableCodes = [
            'ECONNRESET',
            'ENOTFOUND',
            'ECONNREFUSED',
            'ETIMEDOUT',
            'ERR_NETWORK_CHANGED',
            'ERR_INTERNET_DISCONNECTED'
        ];
        
        return retryableCodes.some(code => 
            error.message.includes(code) || error.code === code
        );
    }
    
    /**
     * 获取错误的严重程度
     */
    static getErrorSeverity(error) {
        if (error instanceof InitializationError || 
            error instanceof BrowserCreationError) {
            return 'critical';
        }
        
        if (error instanceof ResourceLimitError || 
            error instanceof SecurityViolationError) {
            return 'high';
        }
        
        if (error instanceof OperationTimeoutError || 
            error instanceof NavigationError) {
            return 'medium';
        }
        
        return 'low';
    }
    
    /**
     * 格式化错误信息用于日志记录
     */
    static formatErrorForLogging(error) {
        if (error instanceof PuppeteerError) {
            return {
                type: error.name,
                code: error.code,
                message: error.message,
                details: error.details,
                timestamp: error.timestamp,
                severity: this.getErrorSeverity(error)
            };
        }
        
        return {
            type: 'UnknownError',
            message: error.message || '未知错误',
            stack: error.stack,
            severity: 'medium'
        };
    }
}

module.exports = {
    PuppeteerError,
    InitializationError,
    BrowserCreationError,
    PageCreationError,
    OperationTimeoutError,
    NavigationError,
    ResourceLimitError,
    BrowserDisconnectedError,
    SecurityViolationError,
    ErrorHandler
};