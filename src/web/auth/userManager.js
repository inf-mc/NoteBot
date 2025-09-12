const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../../utils/config');
const logger = require('../../utils/logger').module('UserManager');

class UserManager {
  constructor() {
    this.usersFile = path.join(process.cwd(), 'data', 'users.json');
    this.ensureDataDir();
    this.loadUsers();
  }

  ensureDataDir() {
    const dataDir = path.dirname(this.usersFile);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  loadUsers() {
    try {
      if (fs.existsSync(this.usersFile)) {
        const data = fs.readFileSync(this.usersFile, 'utf8');
        this.users = JSON.parse(data);
      } else {
        this.users = {};
        this.saveUsers();
      }
    } catch (error) {
      logger.error('加载用户数据失败:', error);
      this.users = {};
    }
  }

  saveUsers() {
    try {
      fs.writeFileSync(this.usersFile, JSON.stringify(this.users, null, 2));
    } catch (error) {
      logger.error('保存用户数据失败:', error);
      throw error;
    }
  }

  async createUser(username, password, role = 'admin') {
    if (this.users[username]) {
      throw new Error('用户已存在');
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    this.users[username] = {
      username,
      password: hashedPassword,
      role,
      createdAt: new Date().toISOString(),
      lastLogin: null
    };

    this.saveUsers();
    logger.info(`用户 ${username} 创建成功`);
    return { username, role, createdAt: this.users[username].createdAt };
  }

  async validateUser(username, password) {
    const user = this.users[username];
    if (!user) {
      return null;
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return null;
    }

    // 更新最后登录时间
    this.users[username].lastLogin = new Date().toISOString();
    this.saveUsers();

    return {
      username: user.username,
      role: user.role,
      lastLogin: user.lastLogin
    };
  }

  async changePassword(username, oldPassword, newPassword) {
    const user = this.users[username];
    if (!user) {
      throw new Error('用户不存在');
    }

    const isValid = await bcrypt.compare(oldPassword, user.password);
    if (!isValid) {
      throw new Error('原密码错误');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    this.users[username].password = hashedPassword;
    this.saveUsers();

    logger.info(`用户 ${username} 密码修改成功`);
    return true;
  }

  generateToken(user) {
    return jwt.sign(
      {
        username: user.username,
        role: user.role,
        iat: Math.floor(Date.now() / 1000)
      },
      config.get('security.jwtSecret'),
      { expiresIn: config.get('security.jwtExpiration') }
    );
  }

  verifyToken(token) {
    try {
      return jwt.verify(token, config.get('security.jwtSecret'));
    } catch (error) {
      return null;
    }
  }

  hasUsers() {
    return Object.keys(this.users).length > 0;
  }

  getUserList() {
    return Object.values(this.users).map(user => ({
      username: user.username,
      role: user.role,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin
    }));
  }

  deleteUser(username) {
    if (!this.users[username]) {
      throw new Error('用户不存在');
    }

    delete this.users[username];
    this.saveUsers();
    logger.info(`用户 ${username} 删除成功`);
    return true;
  }
}

module.exports = new UserManager();