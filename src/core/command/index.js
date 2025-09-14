const EventEmitter = require('events');
const logger = require('../../utils/logger');

/**
 * 命令管理器
 * 提供命令注册、解析、执行和权限管理功能
 */
class CommandManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.commands = new Map();
    this.aliases = new Map();
    this.middleware = [];
    this.permissions = new Map();
    
    this.options = {
      prefix: options.prefix || '/',
      caseSensitive: options.caseSensitive || false,
      enableHelp: options.enableHelp !== false,
      helpCommand: options.helpCommand || 'help',
      ...options
    };
    
    this.stats = {
      totalCommands: 0,
      executedCommands: 0,
      failedCommands: 0,
      lastExecuted: null
    };
    
    this.logger = logger.child({ module: 'CommandManager' });
    
    // 注册内置帮助命令
    if (this.options.enableHelp) {
      this.registerBuiltinCommands();
    }
    
    this.logger.info('命令管理器初始化完成');
  }

  /**
   * 注册命令
   * @param {Object} commandConfig 命令配置
   * @param {string} commandConfig.name 命令名称
   * @param {string} commandConfig.description 命令描述
   * @param {Function} commandConfig.handler 命令处理函数
   * @param {Array} commandConfig.aliases 命令别名
   * @param {string} commandConfig.permission 所需权限
   * @param {string} commandConfig.usage 使用方法
   * @param {Object} commandConfig.options 其他选项
   */
  register(commandConfig) {
    const {
      name,
      description = '',
      handler,
      aliases = [],
      permission = 'user',
      usage = '',
      category = 'general',
      options = {}
    } = commandConfig;
    
    if (!name || typeof name !== 'string') {
      throw new Error('命令名称必须是非空字符串');
    }
    
    if (typeof handler !== 'function') {
      throw new Error('命令处理函数必须是函数');
    }
    
    const commandName = this.options.caseSensitive ? name : name.toLowerCase();
    
    if (this.commands.has(commandName)) {
      throw new Error(`命令 '${name}' 已存在`);
    }
    
    const command = {
      name: commandName,
      originalName: name,
      description,
      handler,
      aliases: aliases.map(alias => this.options.caseSensitive ? alias : alias.toLowerCase()),
      permission,
      usage: usage || `${this.options.prefix}${name}`,
      category,
      options,
      registeredAt: Date.now()
    };
    
    // 注册命令
    this.commands.set(commandName, command);
    
    // 注册别名
    for (const alias of command.aliases) {
      if (this.aliases.has(alias)) {
        this.logger.warn(`别名 '${alias}' 已存在，将被覆盖`);
      }
      this.aliases.set(alias, commandName);
    }
    
    this.stats.totalCommands++;
    this.logger.debug(`注册命令: ${name}${aliases.length > 0 ? ` (别名: ${aliases.join(', ')})` : ''}`);
    
    this.emit('command_registered', { command });
    
    return command;
  }

  /**
   * 取消注册命令
   * @param {string} name 命令名称
   */
  unregister(name) {
    const commandName = this.options.caseSensitive ? name : name.toLowerCase();
    const command = this.commands.get(commandName);
    
    if (!command) {
      return false;
    }
    
    // 移除别名
    for (const alias of command.aliases) {
      this.aliases.delete(alias);
    }
    
    // 移除命令
    this.commands.delete(commandName);
    this.stats.totalCommands--;
    
    this.logger.debug(`取消注册命令: ${name}`);
    this.emit('command_unregistered', { command });
    
    return true;
  }

  /**
   * 解析命令
   * @param {string} message 消息内容
   * @returns {Object|null} 解析结果
   */
  parse(message) {
    if (!message || typeof message !== 'string') {
      return null;
    }
    
    const trimmed = message.trim();
    if (!trimmed.startsWith(this.options.prefix)) {
      return null;
    }
    
    const content = trimmed.substring(this.options.prefix.length);
    if (!content) {
      return null;
    }
    
    const parts = content.split(/\s+/);
    const commandName = this.options.caseSensitive ? parts[0] : parts[0].toLowerCase();
    const args = parts.slice(1);
    
    // 查找命令
    let command = this.commands.get(commandName);
    
    // 如果没找到，尝试别名
    if (!command) {
      const aliasTarget = this.aliases.get(commandName);
      if (aliasTarget) {
        command = this.commands.get(aliasTarget);
      }
    }
    
    if (!command) {
      return {
        found: false,
        commandName,
        args,
        raw: message
      };
    }
    
    return {
      found: true,
      command,
      commandName,
      args,
      raw: message
    };
  }

  /**
   * 执行命令
   * @param {Object} context 执行上下文
   * @param {Object} context.message 消息对象
   * @param {Object} context.user 用户信息
   * @param {Object} context.plugin 插件实例
   * @param {Object} context.api API实例
   */
  async execute(context) {
    const { message, user = {}, plugin, api } = context;
    
    if (!message || !message.raw_message) {
      throw new Error('无效的消息对象');
    }
    
    const parseResult = this.parse(message.raw_message);
    
    if (!parseResult) {
      return { success: false, reason: 'not_command' };
    }
    
    if (!parseResult.found) {
      return {
        success: false,
        reason: 'command_not_found',
        commandName: parseResult.commandName
      };
    }
    
    const { command, args } = parseResult;
    
    try {
      // 权限检查
      if (!this.checkPermission(command, user)) {
        return {
          success: false,
          reason: 'permission_denied',
          command: command.name,
          requiredPermission: command.permission
        };
      }
      
      // 执行中间件
      const middlewareContext = {
        command,
        args,
        message,
        user,
        plugin,
        api
      };
      
      for (const middleware of this.middleware) {
        const result = await middleware(middlewareContext);
        if (result === false) {
          return {
            success: false,
            reason: 'middleware_blocked',
            command: command.name
          };
        }
      }
      
      // 执行命令
      const startTime = Date.now();
      const result = await command.handler({
        command,
        args,
        message,
        user,
        plugin,
        api
      });
      
      const duration = Date.now() - startTime;
      
      this.stats.executedCommands++;
      this.stats.lastExecuted = Date.now();
      
      this.logger.debug(`命令执行成功: ${command.name} (${duration}ms)`);
      
      this.emit('command_executed', {
        command,
        args,
        result,
        duration,
        context
      });
      
      return {
        success: true,
        command: command.name,
        result,
        duration
      };
      
    } catch (error) {
      this.stats.failedCommands++;
      
      this.logger.error(`命令执行失败: ${command.name}`, error);
      
      this.emit('command_failed', {
        command,
        args,
        error,
        context
      });
      
      return {
        success: false,
        reason: 'execution_error',
        command: command.name,
        error: error.message
      };
    }
  }

  /**
   * 添加中间件
   * @param {Function} middleware 中间件函数
   */
  use(middleware) {
    if (typeof middleware !== 'function') {
      throw new Error('中间件必须是函数');
    }
    
    this.middleware.push(middleware);
    this.logger.debug('添加中间件');
  }

  /**
   * 检查权限
   * @param {Object} command 命令对象
   * @param {Object} user 用户信息
   * @returns {boolean} 是否有权限
   */
  checkPermission(command, user) {
    const requiredPermission = command.permission;
    
    if (requiredPermission === 'user') {
      return true;
    }
    
    if (requiredPermission === 'admin') {
      return user.isAdmin || user.role === 'admin';
    }
    
    if (requiredPermission === 'owner') {
      return user.isOwner || user.role === 'owner';
    }
    
    // 自定义权限检查
    const customChecker = this.permissions.get(requiredPermission);
    if (customChecker && typeof customChecker === 'function') {
      return customChecker(user, command);
    }
    
    return false;
  }

  /**
   * 注册权限检查器
   * @param {string} permission 权限名称
   * @param {Function} checker 检查函数
   */
  registerPermission(permission, checker) {
    if (typeof checker !== 'function') {
      throw new Error('权限检查器必须是函数');
    }
    
    this.permissions.set(permission, checker);
    this.logger.debug(`注册权限检查器: ${permission}`);
  }

  /**
   * 获取命令列表
   * @param {string} category 分类过滤
   * @returns {Array} 命令列表
   */
  getCommands(category = null) {
    const commands = Array.from(this.commands.values());
    
    if (category) {
      return commands.filter(cmd => cmd.category === category);
    }
    
    return commands;
  }

  /**
   * 获取命令分类
   * @returns {Array} 分类列表
   */
  getCategories() {
    const categories = new Set();
    for (const command of this.commands.values()) {
      categories.add(command.category);
    }
    return Array.from(categories);
  }

  /**
   * 获取统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    return {
      ...this.stats,
      registeredCommands: this.commands.size,
      registeredAliases: this.aliases.size,
      categories: this.getCategories().length
    };
  }

  /**
   * 注册内置命令
   */
  registerBuiltinCommands() {
    // 帮助命令
    this.register({
      name: this.options.helpCommand,
      description: '显示帮助信息',
      handler: this.handleHelpCommand.bind(this),
      aliases: ['h'],
      permission: 'user',
      category: 'system'
    });
  }

  /**
   * 处理帮助命令
   */
  async handleHelpCommand({ args, message, api }) {
    const commandName = args[0];
    
    if (commandName) {
      // 显示特定命令的帮助
      const command = this.commands.get(commandName.toLowerCase()) || 
                     this.commands.get(this.aliases.get(commandName.toLowerCase()));
      
      if (!command) {
        const response = `命令 '${commandName}' 不存在。使用 ${this.options.prefix}${this.options.helpCommand} 查看所有命令。`;
        return this.sendResponse(message, response, api);
      }
      
      const helpText = this.formatCommandHelp(command);
      return this.sendResponse(message, helpText, api);
    }
    
    // 显示所有命令的帮助
    const helpText = this.formatAllCommandsHelp();
    return this.sendResponse(message, helpText, api);
  }

  /**
   * 格式化命令帮助信息
   */
  formatCommandHelp(command) {
    let help = `📖 命令帮助\n\n`;
    help += `命令: ${command.originalName}\n`;
    help += `描述: ${command.description}\n`;
    help += `用法: ${command.usage}\n`;
    
    if (command.aliases.length > 0) {
      help += `别名: ${command.aliases.join(', ')}\n`;
    }
    
    help += `权限: ${command.permission}\n`;
    help += `分类: ${command.category}`;
    
    return help;
  }

  /**
   * 格式化所有命令帮助信息
   */
  formatAllCommandsHelp() {
    const categories = this.getCategories();
    let help = `📚 命令列表\n\n`;
    
    for (const category of categories) {
      const commands = this.getCommands(category);
      help += `【${category}】\n`;
      
      for (const command of commands) {
        help += `${this.options.prefix}${command.originalName} - ${command.description}\n`;
      }
      
      help += '\n';
    }
    
    help += `使用 ${this.options.prefix}${this.options.helpCommand} <命令名> 查看详细帮助`;
    
    return help;
  }

  /**
   * 发送响应消息
   */
  async sendResponse(message, text, api) {
    if (!api) {
      return text;
    }
    
    if (message.message_type === 'group') {
      return await api.sendGroupMessage(message.group_id, text);
    } else if (message.message_type === 'private') {
      return await api.sendPrivateMessage(message.user_id, text);
    }
    
    return text;
  }

  /**
   * 清理资源
   */
  destroy() {
    this.commands.clear();
    this.aliases.clear();
    this.middleware = [];
    this.permissions.clear();
    this.removeAllListeners();
    
    this.logger.info('命令管理器已销毁');
  }
}

module.exports = CommandManager;