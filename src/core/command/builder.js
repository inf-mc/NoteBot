/**
 * 命令构建器
 * 提供链式API来构建命令配置
 */
class CommandBuilder {
  constructor(name) {
    if (!name || typeof name !== 'string') {
      throw new Error('命令名称必须是非空字符串');
    }
    
    this.config = {
      name,
      description: '',
      handler: null,
      aliases: [],
      permission: 'user',
      usage: '',
      category: 'general',
      options: {}
    };
  }

  /**
   * 设置命令描述
   * @param {string} description 描述
   * @returns {CommandBuilder} 构建器实例
   */
  description(description) {
    this.config.description = description || '';
    return this;
  }

  /**
   * 设置命令处理函数
   * @param {Function} handler 处理函数
   * @returns {CommandBuilder} 构建器实例
   */
  handler(handler) {
    if (typeof handler !== 'function') {
      throw new Error('命令处理函数必须是函数');
    }
    this.config.handler = handler;
    return this;
  }

  /**
   * 设置命令别名
   * @param {...string} aliases 别名列表
   * @returns {CommandBuilder} 构建器实例
   */
  aliases(...aliases) {
    this.config.aliases = aliases.flat().filter(alias => 
      alias && typeof alias === 'string'
    );
    return this;
  }

  /**
   * 添加单个别名
   * @param {string} alias 别名
   * @returns {CommandBuilder} 构建器实例
   */
  alias(alias) {
    if (alias && typeof alias === 'string') {
      this.config.aliases.push(alias);
    }
    return this;
  }

  /**
   * 设置所需权限
   * @param {string} permission 权限级别
   * @returns {CommandBuilder} 构建器实例
   */
  permission(permission) {
    this.config.permission = permission || 'user';
    return this;
  }

  /**
   * 设置使用方法
   * @param {string} usage 使用方法
   * @returns {CommandBuilder} 构建器实例
   */
  usage(usage) {
    this.config.usage = usage || '';
    return this;
  }

  /**
   * 设置命令分类
   * @param {string} category 分类
   * @returns {CommandBuilder} 构建器实例
   */
  category(category) {
    this.config.category = category || 'general';
    return this;
  }

  /**
   * 设置命令选项
   * @param {Object} options 选项对象
   * @returns {CommandBuilder} 构建器实例
   */
  options(options) {
    this.config.options = { ...this.config.options, ...options };
    return this;
  }

  /**
   * 设置单个选项
   * @param {string} key 选项键
   * @param {*} value 选项值
   * @returns {CommandBuilder} 构建器实例
   */
  option(key, value) {
    this.config.options[key] = value;
    return this;
  }

  /**
   * 添加命令参数
   * @param {string} name 参数名称
   * @param {Object} definition 参数定义
   * @returns {CommandBuilder} 构建器实例
   */
  argument(name, definition) {
    if (!this.config.arguments) {
      this.config.arguments = [];
    }
    this.config.arguments.push({ name, ...definition });
    return this;
  }

  /**
   * 构建命令配置
   * @returns {Object} 命令配置对象
   */
  build() {
    if (!this.config.handler) {
      throw new Error('命令处理函数不能为空');
    }
    
    return { ...this.config };
  }

  /**
   * 创建新的命令构建器
   * @param {string} name 命令名称
   * @returns {CommandBuilder} 新的构建器实例
   */
  static create(name) {
    return new CommandBuilder(name);
  }
}

/**
 * 参数解析器
 * 提供命令参数解析功能
 */
class ArgumentParser {
  constructor() {
    this.definitions = [];
  }

  /**
   * 添加参数定义
   * @param {Object} definition 参数定义
   * @param {string} definition.name 参数名称
   * @param {string} definition.type 参数类型 (string, number, boolean)
   * @param {boolean} definition.required 是否必需
   * @param {*} definition.default 默认值
   * @param {string} definition.description 描述
   * @returns {ArgumentParser} 解析器实例
   */
  add(definition) {
    const {
      name,
      type = 'string',
      required = false,
      default: defaultValue,
      description = ''
    } = definition;
    
    if (!name || typeof name !== 'string') {
      throw new Error('参数名称必须是非空字符串');
    }
    
    this.definitions.push({
      name,
      type,
      required,
      default: defaultValue,
      description
    });
    
    return this;
  }

  /**
   * 解析参数
   * @param {Array} args 参数数组
   * @returns {Object} 解析结果
   */
  parse(args = []) {
    const result = {
      parsed: {},
      errors: [],
      remaining: [...args]
    };
    
    for (let i = 0; i < this.definitions.length; i++) {
      const def = this.definitions[i];
      const value = args[i];
      
      if (value === undefined) {
        if (def.required) {
          result.errors.push(`缺少必需参数: ${def.name}`);
        } else if (def.default !== undefined) {
          result.parsed[def.name] = def.default;
        }
        continue;
      }
      
      try {
        result.parsed[def.name] = this.convertType(value, def.type);
        result.remaining.shift();
      } catch (error) {
        result.errors.push(`参数 ${def.name} 类型错误: ${error.message}`);
      }
    }
    
    return result;
  }

  /**
   * 类型转换
   * @param {string} value 原始值
   * @param {string} type 目标类型
   * @returns {*} 转换后的值
   */
  convertType(value, type) {
    switch (type) {
      case 'string':
        return String(value);
        
      case 'number':
        const num = Number(value);
        if (isNaN(num)) {
          throw new Error(`无法转换为数字: ${value}`);
        }
        return num;
        
      case 'boolean':
        const lower = String(value).toLowerCase();
        if (['true', '1', 'yes', 'on'].includes(lower)) {
          return true;
        }
        if (['false', '0', 'no', 'off'].includes(lower)) {
          return false;
        }
        throw new Error(`无法转换为布尔值: ${value}`);
        
      default:
        return value;
    }
  }

  /**
   * 生成使用说明
   * @param {string} commandName 命令名称
   * @param {string} prefix 命令前缀
   * @returns {string} 使用说明
   */
  generateUsage(commandName, prefix = '/') {
    let usage = `${prefix}${commandName}`;
    
    for (const def of this.definitions) {
      if (def.required) {
        usage += ` <${def.name}>`;
      } else {
        usage += ` [${def.name}]`;
      }
    }
    
    return usage;
  }

  /**
   * 生成参数说明
   * @returns {string} 参数说明
   */
  generateHelp() {
    if (this.definitions.length === 0) {
      return '此命令不需要参数';
    }
    
    let help = '参数说明:\n';
    
    for (const def of this.definitions) {
      const required = def.required ? '(必需)' : '(可选)';
      const defaultText = def.default !== undefined ? ` [默认: ${def.default}]` : '';
      help += `  ${def.name} (${def.type}) ${required}${defaultText} - ${def.description}\n`;
    }
    
    return help.trim();
  }
}

/**
 * 命令组
 * 用于组织相关命令
 */
class CommandGroup {
  constructor(name, options = {}) {
    this.name = name;
    this.description = options.description || '';
    this.permission = options.permission || 'user';
    this.category = options.category || 'general';
    this.commands = new Map();
  }

  /**
   * 添加命令到组
   * @param {CommandBuilder|Object} command 命令构建器或配置
   * @returns {CommandGroup} 组实例
   */
  add(command) {
    const config = command instanceof CommandBuilder ? command.build() : command;
    
    // 继承组的属性
    if (!config.category || config.category === 'general') {
      config.category = this.category;
    }
    
    if (!config.permission || config.permission === 'user') {
      config.permission = this.permission;
    }
    
    this.commands.set(config.name, config);
    return this;
  }

  /**
   * 添加命令到组（别名方法）
   * @param {CommandBuilder|Object} command 命令构建器或配置
   * @returns {CommandGroup} 组实例
   */
  addCommand(command) {
    return this.add(command);
  }

  /**
   * 获取组中的所有命令
   * @returns {Array} 命令配置数组
   */
  getCommands() {
    return Array.from(this.commands.values());
  }

  /**
   * 注册组中的所有命令到命令管理器
   * @param {CommandManager} manager 命令管理器
   */
  registerTo(manager) {
    for (const command of this.commands.values()) {
      manager.register(command);
    }
  }
}

module.exports = {
  CommandBuilder,
  ArgumentParser,
  CommandGroup
};