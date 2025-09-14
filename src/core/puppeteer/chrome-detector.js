const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const logger = require('../../utils/logger');

/**
 * Chrome浏览器自动检测工具
 * 支持Windows、macOS和Linux系统
 */
class ChromeDetector {
    constructor() {
        this.platform = process.platform;
        this.chromePaths = this.getDefaultChromePaths();
    }

    /**
     * 获取不同平台的默认Chrome安装路径
     */
    getDefaultChromePaths() {
        const paths = {
            win32: [
                // Chrome稳定版
                'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                // Chrome Beta版
                'C:\\Program Files\\Google\\Chrome Beta\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome Beta\\Application\\chrome.exe',
                // Chrome Dev版
                'C:\\Program Files\\Google\\Chrome Dev\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome Dev\\Application\\chrome.exe',
                // Chrome Canary版
                'C:\\Users\\%USERNAME%\\AppData\\Local\\Google\\Chrome SxS\\Application\\chrome.exe',
                // Edge (基于Chromium)
                'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
                'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
            ],
            darwin: [
                '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
                '/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev',
                '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
                '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
            ],
            linux: [
                '/usr/bin/google-chrome',
                '/usr/bin/google-chrome-stable',
                '/usr/bin/google-chrome-beta',
                '/usr/bin/google-chrome-unstable',
                '/usr/bin/chromium-browser',
                '/usr/bin/chromium',
                '/snap/bin/chromium',
                '/usr/bin/microsoft-edge',
                '/usr/bin/microsoft-edge-stable'
            ]
        };

        return paths[this.platform] || [];
    }

    /**
     * 检测Chrome浏览器路径
     * @returns {string|null} Chrome可执行文件路径，如果未找到返回null
     */
    async detectChrome() {
        try {
            //logger.info('[ChromeDetector]: 开始检测Chrome浏览器...');

            // 1. 首先尝试从环境变量检测
            const envPath = this.detectFromEnvironment();
            if (envPath) {
                //logger.info(`[ChromeDetector]: 从环境变量检测到Chrome: ${envPath}`);
                return envPath;
            }

            // 2. 检查默认安装路径
            const defaultPath = this.detectFromDefaultPaths();
            if (defaultPath) {
                //logger.info(`[ChromeDetector]: 从默认路径检测到Chrome: ${defaultPath}`);
                return defaultPath;
            }

            // 3. 尝试从注册表检测（仅Windows）
            if (this.platform === 'win32') {
                const registryPath = this.detectFromRegistry();
                if (registryPath) {
                    //logger.info(`[ChromeDetector]: 从注册表检测到Chrome: ${registryPath}`);
                    return registryPath;
                }
            }

            // 4. 尝试从命令行检测
            const commandPath = this.detectFromCommand();
            if (commandPath) {
                //logger.info(`[ChromeDetector]: 从命令行检测到Chrome: ${commandPath}`);
                return commandPath;
            }

            logger.warn('[ChromeDetector]: 未检测到Chrome浏览器');
            return null;
        } catch (error) {
            logger.error('[ChromeDetector]: Chrome检测过程中发生错误:', error);
            return null;
        }
    }

    /**
     * 从环境变量检测Chrome
     */
    detectFromEnvironment() {
        const envVars = ['CHROME_BIN', 'GOOGLE_CHROME_BIN', 'CHROMIUM_BIN'];
        
        for (const envVar of envVars) {
            const chromePath = process.env[envVar];
            if (chromePath && this.isValidChrome(chromePath)) {
                return chromePath;
            }
        }
        
        return null;
    }

    /**
     * 从默认路径检测Chrome
     */
    detectFromDefaultPaths() {
        for (const chromePath of this.chromePaths) {
            // 处理Windows路径中的环境变量
            let resolvedPath = chromePath;
            if (this.platform === 'win32' && chromePath.includes('%USERNAME%')) {
                resolvedPath = chromePath.replace('%USERNAME%', process.env.USERNAME || process.env.USER || '');
            }

            if (this.isValidChrome(resolvedPath)) {
                return resolvedPath;
            }
        }
        
        return null;
    }

    /**
     * 从Windows注册表检测Chrome
     */
    detectFromRegistry() {
        if (this.platform !== 'win32') {
            return null;
        }

        const registryKeys = [
            'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
            'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
            'HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe'
        ];

        for (const key of registryKeys) {
            try {
                const result = execSync(`reg query "${key}" /ve`, { encoding: 'utf8', timeout: 5000 });
                const match = result.match(/REG_SZ\s+(.+)/i);
                if (match && match[1]) {
                    const chromePath = match[1].trim().replace(/"/g, '');
                    if (this.isValidChrome(chromePath)) {
                        return chromePath;
                    }
                }
            } catch (error) {
                // 忽略注册表查询错误
            }
        }

        return null;
    }

    /**
     * 从命令行检测Chrome
     */
    detectFromCommand() {
        const commands = {
            win32: ['where chrome', 'where google-chrome', 'where msedge'],
            darwin: ['which google-chrome', 'which chrome', 'which chromium'],
            linux: ['which google-chrome', 'which google-chrome-stable', 'which chromium-browser', 'which chromium']
        };

        const platformCommands = commands[this.platform] || [];

        for (const command of platformCommands) {
            try {
                const result = execSync(command, { encoding: 'utf8', timeout: 5000 });
                const chromePath = result.trim().split('\n')[0];
                if (chromePath && this.isValidChrome(chromePath)) {
                    return chromePath;
                }
            } catch (error) {
                // 忽略命令执行错误
            }
        }

        return null;
    }

    /**
     * 验证Chrome路径是否有效
     * @param {string} chromePath Chrome路径
     * @returns {boolean} 是否有效
     */
    isValidChrome(chromePath) {
        if (!chromePath || typeof chromePath !== 'string') {
            return false;
        }

        try {
            // 检查文件是否存在
            if (!fs.existsSync(chromePath)) {
                return false;
            }

            // 检查是否为文件
            const stats = fs.statSync(chromePath);
            if (!stats.isFile()) {
                return false;
            }

            // 检查文件扩展名（Windows）
            if (this.platform === 'win32' && !chromePath.toLowerCase().endsWith('.exe')) {
                return false;
            }

            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * 获取Chrome版本信息
     * @param {string} chromePath Chrome路径
     * @returns {string|null} 版本信息
     */
    async getChromeVersion(chromePath) {
        if (!chromePath || !this.isValidChrome(chromePath)) {
            return null;
        }

        try {
            const versionCommand = `"${chromePath}" --version`;
            const result = execSync(versionCommand, { encoding: 'utf8', timeout: 10000 });
            return result.trim();
        } catch (error) {
            //logger.warn(`[ChromeDetector]: 无法获取Chrome版本信息: ${error.message}`);
            return null;
        }
    }
}

module.exports = ChromeDetector;