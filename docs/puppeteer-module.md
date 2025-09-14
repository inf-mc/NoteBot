# Puppeteer模块使用指南

## 概述

Puppeteer模块为NoteBot提供了强大的浏览器自动化功能，允许插件执行网页截图、内容抓取、PDF生成、表单填写等操作。

## 模块架构

### 核心组件

- **PuppeteerManager**: 核心管理器，负责浏览器实例和页面池的管理
- **PuppeteerAPI**: 插件API接口，提供简化的浏览器操作方法
- **PuppeteerUtils**: 工具类，包含常用的浏览器操作辅助方法
- **PuppeteerMonitor**: 性能监控器，跟踪资源使用和操作统计
- **错误处理**: 完整的错误处理机制和资源清理逻辑

### 目录结构

```
src/core/puppeteer/
├── index.js          # PuppeteerManager主类
├── api.js            # PuppeteerAPI接口类
├── config.js         # 配置文件
├── errors.js         # 错误处理类
├── monitor.js        # 性能监控类
└── utils.js          # 工具类
```

## 安装和配置

### 依赖安装

Puppeteer模块已经集成到项目中，依赖包会在项目启动时自动安装。如果需要手动安装：

```bash
npm install puppeteer
```

### 配置选项

在插件配置中可以设置Puppeteer相关选项：

```json
{
  "puppeteer": {
    "enabled": true,
    "timeout": 30000,
    "maxConcurrentPages": 3,
    "browser": {
      "headless": true,
      "args": [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu"
      ]
    }
  }
}
```

## 在插件中使用Puppeteer

### 基础使用

所有继承自`BasePlugin`的插件都会自动获得Puppeteer功能：

```javascript
const BasePlugin = require('../base');

class MyPlugin extends BasePlugin {
    async onInit() {
        // 检查Puppeteer是否可用
        if (this.isPuppeteerAvailable()) {
            this.logger.info('Puppeteer模块可用');
        }
    }
    
    async someMethod() {
        // 使用Puppeteer API
        const result = await this.puppeteer.captureScreenshot('https://www.baidu.com');
    }
}
```

### 可用方法

#### 1. 页面导航

```javascript
// 导航到指定URL
const result = await this.puppeteer.goto('https://example.com', {
    waitUntil: 'networkidle0',
    timeout: 30000
});
```

#### 2. 网页截图

```javascript
// 截取网页截图
const result = await this.puppeteer.captureScreenshot('https://example.com', {
    viewport: { width: 1920, height: 1080 },
    fullPage: false,
    format: 'png'
});

if (result.success) {
    // result.buffer 包含截图数据
    const base64Image = result.buffer.toString('base64');
}
```

#### 3. 获取页面内容

```javascript
// 获取页面文本内容
const result = await this.puppeteer.getPageContent('https://example.com', {
    includeHtml: false,
    textOnly: true
});

// 获取特定元素的文本
const textResult = await this.puppeteer.getText('h1');
```

#### 4. 元素操作

```javascript
// 等待元素出现
const elementResult = await this.puppeteer.waitForElement('.my-button', {
    timeout: 10000,
    visible: true
});

// 点击元素
const clickResult = await this.puppeteer.click('.my-button', {
    waitForNavigation: false,
    delay: 100
});

// 输入文本
const typeResult = await this.puppeteer.type('#input-field', 'Hello World', {
    delay: 50,
    clear: true
});

// 获取元素属性
const attrResult = await this.puppeteer.getAttribute('.my-element', 'href');
```

#### 5. 表单操作

```javascript
// 填写并提交表单
const formData = {
    'input[name="username"]': 'myusername',
    'input[name="password"]': 'mypassword',
    'select[name="country"]': 'China'
};

const result = await this.puppeteer.fillAndSubmitForm('https://example.com/login', formData, {
    waitForNavigation: true,
    timeout: 30000
});
```

#### 6. PDF生成

```javascript
// 生成PDF
const result = await this.puppeteer.generatePDF('https://example.com', {
    format: 'a4',
    printBackground: true,
    margin: {
        top: '1cm',
        right: '1cm',
        bottom: '1cm',
        left: '1cm'
    }
});

if (result.success) {
    // result.buffer 包含PDF数据
    const base64PDF = result.buffer.toString('base64');
}
```

#### 7. JavaScript执行

```javascript
// 执行JavaScript代码
const result = await this.puppeteer.evaluate(() => {
    return document.title;
});

// 带参数的函数执行
const result2 = await this.puppeteer.evaluate((selector) => {
    return document.querySelector(selector).textContent;
}, ['h1']);
```

#### 8. 设备模拟

```javascript
// 模拟移动设备
const result = await this.puppeteer.emulateDevice('iPhone X');
```

#### 9. 性能监控

```javascript
// 获取页面性能指标
const metrics = await this.puppeteer.getPerformanceMetrics();
console.log('页面加载时间:', metrics.loadTime);
console.log('内存使用:', metrics.memoryUsage);
```

### 错误处理

所有Puppeteer操作都应该包含适当的错误处理：

```javascript
try {
    const result = await this.puppeteer.captureScreenshot(url);
    if (result.success) {
        // 处理成功结果
    } else {
        // 处理失败情况
        this.logger.error('截图失败:', result.error);
    }
} catch (error) {
    this.logger.error('Puppeteer操作异常:', error);
}
```

### 状态检查

```javascript
// 检查Puppeteer是否可用
if (this.isPuppeteerAvailable()) {
    // 执行Puppeteer操作
} else {
    // 处理不可用情况
    const status = this.getPuppeteerStatus();
    this.logger.warn('Puppeteer不可用:', status.reason);
}
```

## 示例插件

项目中包含了一个完整的示例插件 `puppeteer-example`，展示了Puppeteer模块的各种用法：

- 网页截图命令 (`#screenshot`)
- 获取网页内容命令 (`#webcontent`)
- PDF生成命令 (`#webpdf`)
- 表单填写命令 (`#fillform`)
- 状态查询命令 (`#pupstatus`)

## 性能优化

### 浏览器实例复用

Puppeteer模块使用全局浏览器实例和页面池来优化性能：

- 浏览器实例在所有插件间共享
- 页面池管理减少页面创建/销毁开销
- 自动资源清理防止内存泄漏

### 配置优化

```json
{
  "puppeteer": {
    "maxConcurrentPages": 5,  // 增加并发页面数
    "browser": {
      "args": [
        "--disable-dev-shm-usage",  // 减少内存使用
        "--no-sandbox",             // 提高兼容性
        "--disable-gpu"             // 禁用GPU加速
      ]
    }
  }
}
```

## 安全注意事项

1. **URL验证**: 始终验证用户提供的URL
2. **资源限制**: 设置合理的超时时间和并发限制
3. **内容过滤**: 对获取的内容进行适当的过滤和验证
4. **权限控制**: 限制可访问的域名和操作类型

## 故障排除

### 常见问题

1. **浏览器启动失败**
   - 检查系统依赖是否完整
   - 尝试添加 `--no-sandbox` 参数

2. **页面加载超时**
   - 增加超时时间设置
   - 检查网络连接

3. **内存使用过高**
   - 减少并发页面数
   - 启用页面池清理

### 调试模式

```javascript
// 启用调试模式
const result = await this.puppeteer.captureScreenshot(url, {
    debug: true,  // 启用调试输出
    headless: false  // 显示浏览器窗口
});
```

## API参考

详细的API文档请参考源代码中的JSDoc注释，主要类和方法包括：

- `PuppeteerManager`: 核心管理器
- `PuppeteerAPI`: 插件接口
- `PuppeteerUtils`: 工具方法
- `PuppeteerMonitor`: 性能监控

## 更新日志

### v1.0.0
- 初始版本发布
- 基础浏览器自动化功能
- 插件集成支持
- 性能监控和错误处理