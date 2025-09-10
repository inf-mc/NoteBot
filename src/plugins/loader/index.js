const path = require('path');
const fs = require('fs').promises;
const Module = require('module');
const logger = require('../../utils/logger');

/**
 * 插件加载器
 */
class PluginLoader {
  constructor(pluginManager) {
    this.pluginManager = pluginManager;
    this.loadedModules = new Map();
    this.moduleCache = new Map();
    this.originalRequire = Module.prototype.require;
    
    this.setupModuleInterception();
  }

  /**
   * 设置模块拦截
   */
  setupModuleInterception() {
    const self = this;
    
    Module.prototype.require = function(id) {
      // 记录模块依赖关系
      if (self.currentLoadingPlugin) {
        const dependencies = self.moduleCache.get(self.currentLoadingPlugin) || new Set();
        dependencies.add(id);
        self.moduleCache.set(self.currentLoadingPlugin, dependencies);
      }
      
      return self.originalRequire.apply(this, arguments);
    };
  }

  /**
   * 加载插件
   */
  async load(config) {
    try {
      const { name, path: pluginPath, main } = config;
      
      // 检查插件是否已加载
      if (this.loadedModules.has(name)) {
        throw new Error(`插件已加载: ${name}`);
      }
      
      // 验证插件文件
      const mainFile = path.resolve(pluginPath, main);
      await this.validatePluginFile(mainFile);
      
      // 设置当前加载的插件
      this.currentLoadingPlugin = name;
      
      try {
        // 清除模块缓存（用于热重载）
        this.clearModuleCache(mainFile);
        
        // 加载插件模块
        const PluginClass = require(mainFile);
        
        // 验证插件类
        this.validatePluginClass(PluginClass, name);
        
        // 创建插件实例
        const pluginInstance = new PluginClass();
        
        // 保存加载信息
        this.loadedModules.set(name, {
          instance: pluginInstance,
          config,
          mainFile,
          loadedAt: Date.now()
        });
        
        logger.debug(`插件模块加载成功: ${name}`);
        return pluginInstance;
        
      } finally {
        this.currentLoadingPlugin = null;
      }
      
    } catch (error) {
      logger.error(`插件加载失败 [${config.name}]:`, error);
      throw error;
    }
  }

  /**
   * 卸载插件
   */
  unload(name) {
    try {
      const moduleInfo = this.loadedModules.get(name);
      if (!moduleInfo) {
        logger.warn(`插件未加载，无法卸载: ${name}`);
        return false;
      }
      
      const { mainFile } = moduleInfo;
      
      // 清除模块缓存
      this.clearModuleCache(mainFile);
      
      // 清除依赖缓存
      const dependencies = this.moduleCache.get(name);
      if (dependencies) {
        for (const dep of dependencies) {
          if (dep.startsWith('./') || dep.startsWith('../')) {
            const depPath = path.resolve(path.dirname(mainFile), dep);
            delete require.cache[depPath];
          }
        }
        this.moduleCache.delete(name);
      }
      
      // 移除加载记录
      this.loadedModules.delete(name);
      
      logger.debug(`插件模块卸载成功: ${name}`);
      return true;
      
    } catch (error) {
      logger.error(`插件卸载失败 [${name}]:`, error);
      return false;
    }
  }

  /**
   * 验证插件文件
   */
  async validatePluginFile(filePath) {
    try {
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) {
        throw new Error(`插件主文件不存在: ${filePath}`);
      }
      
      // 检查文件扩展名
      const ext = path.extname(filePath);
      if (!['.js', '.json'].includes(ext)) {
        throw new Error(`不支持的插件文件类型: ${ext}`);
      }
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`插件主文件不存在: ${filePath}`);
      }
      throw error;
    }
  }

  /**
   * 验证插件类
   */
  validatePluginClass(PluginClass, name) {
    if (typeof PluginClass !== 'function') {
      throw new Error(`插件主文件必须导出一个类: ${name}`);
    }
    
    // 检查必需的方法
    const prototype = PluginClass.prototype;
    const requiredMethods = ['init'];
    
    for (const method of requiredMethods) {
      if (typeof prototype[method] !== 'function') {
        logger.warn(`插件缺少推荐方法 ${method}: ${name}`);
      }
    }
    
    // 检查可选方法
    const optionalMethods = ['destroy', 'onMessage', 'onEvent'];
    const availableMethods = [];
    
    for (const method of optionalMethods) {
      if (typeof prototype[method] === 'function') {
        availableMethods.push(method);
      }
    }
    
    logger.debug(`插件可用方法 [${name}]: ${availableMethods.join(', ')}`);
  }

  /**
   * 清除模块缓存
   */
  clearModuleCache(filePath) {
    try {
      // 获取绝对路径
      const absolutePath = path.resolve(filePath);
      
      // 清除主模块缓存
      delete require.cache[absolutePath];
      
      // 清除相关模块缓存
      const moduleDir = path.dirname(absolutePath);
      
      for (const cachedPath in require.cache) {
        if (cachedPath.startsWith(moduleDir)) {
          delete require.cache[cachedPath];
        }
      }
      
      logger.debug(`清除模块缓存: ${absolutePath}`);
      
    } catch (error) {
      logger.warn(`清除模块缓存失败: ${filePath}`, error);
    }
  }

  /**
   * 获取插件依赖
   */
  getPluginDependencies(name) {
    const dependencies = this.moduleCache.get(name);
    return dependencies ? Array.from(dependencies) : [];
  }

  /**
   * 检查插件是否已加载
   */
  isLoaded(name) {
    return this.loadedModules.has(name);
  }

  /**
   * 获取已加载的插件列表
   */
  getLoadedPlugins() {
    return Array.from(this.loadedModules.keys());
  }

  /**
   * 获取插件加载信息
   */
  getLoadInfo(name) {
    return this.loadedModules.get(name);
  }

  /**
   * 重置加载器
   */
  reset() {
    // 恢复原始 require
    Module.prototype.require = this.originalRequire;
    
    // 清除所有缓存
    this.loadedModules.clear();
    this.moduleCache.clear();
    this.currentLoadingPlugin = null;
    
    logger.debug('插件加载器已重置');
  }

  /**
   * 获取加载器状态
   */
  getStatus() {
    return {
      loadedCount: this.loadedModules.size,
      loadedPlugins: this.getLoadedPlugins(),
      cacheSize: this.moduleCache.size
    };
  }
}

module.exports = PluginLoader;