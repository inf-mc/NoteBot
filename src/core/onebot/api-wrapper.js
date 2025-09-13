/**
 * OneBot API 封装器
 * 为插件提供便捷的API调用接口
 */

class OneBotApiWrapper {
  constructor(onebotCore) {
    this.onebot = onebotCore;
  }

  // ==================== 消息相关 ====================

  /**
   * 发送私聊消息
   * @param {string|number} userId 用户ID
   * @param {string|Array} message 消息内容
   * @param {boolean} autoEscape 是否自动转义
   * @returns {Promise<Object>} 发送结果
   */
  async sendPrivateMessage(userId, message, autoEscape = false) {
    return this.onebot.sendPrivateMessage(userId, message, autoEscape);
  }

  /**
   * 发送群消息
   * @param {string|number} groupId 群ID
   * @param {string|Array} message 消息内容
   * @param {boolean} autoEscape 是否自动转义
   * @returns {Promise<Object>} 发送结果
   */
  async sendGroupMessage(groupId, message, autoEscape = false) {
    return this.onebot.sendGroupMessage(groupId, message, autoEscape);
  }

  /**
   * 撤回消息
   * @param {string|number} messageId 消息ID
   * @returns {Promise<Object>} 撤回结果
   */
  async recallMessage(messageId) {
    return this.onebot.deleteMessage(messageId);
  }

  /**
   * 获取消息详情
   * @param {string|number} messageId 消息ID
   * @returns {Promise<Object>} 消息详情
   */
  async getMessageInfo(messageId) {
    return this.onebot.getMessage(messageId);
  }

  /**
   * 转发消息到群
   * @param {string|number} groupId 目标群ID
   * @param {string|number} messageId 要转发的消息ID
   * @returns {Promise<Object>} 转发结果
   */
  async forwardMessageToGroup(groupId, messageId) {
    return this.onebot.forwardMessage(groupId, messageId);
  }

  // ==================== 用户信息相关 ====================

  /**
   * 获取机器人登录信息
   * @returns {Promise<Object>} 登录信息
   */
  async getBotInfo() {
    return this.onebot.getLoginInfo();
  }

  /**
   * 获取用户信息
   * @param {string|number} userId 用户ID
   * @param {boolean} noCache 是否不使用缓存
   * @returns {Promise<Object>} 用户信息
   */
  async getUserInfo(userId, noCache = false) {
    return this.onebot.getStrangerInfo(userId, noCache);
  }

  /**
   * 获取好友列表
   * @returns {Promise<Array>} 好友列表
   */
  async getFriends() {
    return this.onebot.getFriendList();
  }

  // ==================== 群组信息相关 ====================

  /**
   * 获取群列表
   * @returns {Promise<Array>} 群列表
   */
  async getGroups() {
    return this.onebot.getGroupList();
  }

  /**
   * 获取群成员列表
   * @param {string|number} groupId 群ID
   * @returns {Promise<Array>} 群成员列表
   */
  async getGroupMembers(groupId) {
    return this.onebot.getGroupMemberList(groupId);
  }

  /**
   * 获取群成员信息
   * @param {string|number} groupId 群ID
   * @param {string|number} userId 用户ID
   * @param {boolean} noCache 是否不使用缓存
   * @returns {Promise<Object>} 群成员信息
   */
  async getGroupMemberInfo(groupId, userId, noCache = false) {
    return this.onebot.getGroupMemberInfo(groupId, userId, noCache);
  }

  // ==================== 群组管理相关 ====================

  /**
   * 踢出群成员
   * @param {string|number} groupId 群ID
   * @param {string|number} userId 用户ID
   * @param {boolean} rejectAddRequest 是否拒绝此人的加群请求
   * @returns {Promise<Object>} 操作结果
   */
  async kickGroupMember(groupId, userId, rejectAddRequest = false) {
    return this.onebot.setGroupKick(groupId, userId, rejectAddRequest);
  }

  /**
   * 禁言群成员
   * @param {string|number} groupId 群ID
   * @param {string|number} userId 用户ID
   * @param {number} duration 禁言时长（秒），0表示解除禁言
   * @returns {Promise<Object>} 操作结果
   */
  async muteGroupMember(groupId, userId, duration = 30 * 60) {
    return this.onebot.setGroupBan(groupId, userId, duration);
  }

  /**
   * 解除群成员禁言
   * @param {string|number} groupId 群ID
   * @param {string|number} userId 用户ID
   * @returns {Promise<Object>} 操作结果
   */
  async unmuteGroupMember(groupId, userId) {
    return this.onebot.setGroupBan(groupId, userId, 0);
  }

  /**
   * 全群禁言
   * @param {string|number} groupId 群ID
   * @param {boolean} enable 是否开启全群禁言
   * @returns {Promise<Object>} 操作结果
   */
  async muteAllGroupMembers(groupId, enable = true) {
    return this.onebot.setGroupWholeBan(groupId, enable);
  }

  /**
   * 设置群管理员
   * @param {string|number} groupId 群ID
   * @param {string|number} userId 用户ID
   * @param {boolean} enable 是否设置为管理员
   * @returns {Promise<Object>} 操作结果
   */
  async setGroupAdmin(groupId, userId, enable = true) {
    return this.onebot.setGroupAdmin(groupId, userId, enable);
  }

  /**
   * 设置群名片
   * @param {string|number} groupId 群ID
   * @param {string|number} userId 用户ID
   * @param {string} card 群名片
   * @returns {Promise<Object>} 操作结果
   */
  async setGroupMemberCard(groupId, userId, card = '') {
    return this.onebot.setGroupCard(groupId, userId, card);
  }

  /**
   * 设置群名
   * @param {string|number} groupId 群ID
   * @param {string} groupName 群名
   * @returns {Promise<Object>} 操作结果
   */
  async setGroupName(groupId, groupName) {
    return this.onebot.setGroupName(groupId, groupName);
  }

  /**
   * 退出群聊
   * @param {string|number} groupId 群ID
   * @param {boolean} isDismiss 是否解散群（仅群主可用）
   * @returns {Promise<Object>} 操作结果
   */
  async leaveGroup(groupId, isDismiss = false) {
    return this.onebot.setGroupLeave(groupId, isDismiss);
  }

  /**
   * 设置群组专属头衔
   * @param {string|number} groupId 群ID
   * @param {string|number} userId 用户ID
   * @param {string} specialTitle 专属头衔
   * @param {number} duration 有效期（秒），-1为永久
   * @returns {Promise<Object>} 操作结果
   */
  async setGroupSpecialTitle(groupId, userId, specialTitle = '', duration = -1) {
    return this.onebot.setGroupSpecialTitle(groupId, userId, specialTitle, duration);
  }

  // ==================== 请求处理相关 ====================

  /**
   * 处理加好友请求
   * @param {string} flag 请求flag
   * @param {boolean} approve 是否同意
   * @param {string} remark 好友备注
   * @returns {Promise<Object>} 处理结果
   */
  async handleFriendRequest(flag, approve = true, remark = '') {
    return this.onebot.setFriendAddRequest(flag, approve, remark);
  }

  /**
   * 处理加群请求
   * @param {string} flag 请求flag
   * @param {string} subType 请求类型（add/invite）
   * @param {boolean} approve 是否同意
   * @param {string} reason 拒绝理由
   * @returns {Promise<Object>} 处理结果
   */
  async handleGroupRequest(flag, subType, approve = true, reason = '') {
    return this.onebot.setGroupAddRequest(flag, subType, approve, reason);
  }

  // ==================== 系统相关 ====================

  /**
   * 获取版本信息
   * @returns {Promise<Object>} 版本信息
   */
  async getVersion() {
    return this.onebot.getVersionInfo();
  }

  /**
   * 重启OneBot
   * @param {number} delay 延迟时间（毫秒）
   * @returns {Promise<Object>} 操作结果
   */
  async restart(delay = 0) {
    return this.onebot.setRestart(delay);
  }

  /**
   * 清理缓存
   * @returns {Promise<Object>} 操作结果
   */
  async clearCache() {
    return this.onebot.cleanCache();
  }

  // ==================== 便捷方法 ====================

  /**
   * 检查用户是否为群管理员或群主
   * @param {string|number} groupId 群ID
   * @param {string|number} userId 用户ID
   * @returns {Promise<boolean>} 是否为管理员
   */
  async isGroupAdmin(groupId, userId) {
    try {
      const memberInfo = await this.getGroupMemberInfo(groupId, userId);
      return memberInfo.role === 'admin' || memberInfo.role === 'owner';
    } catch (error) {
      return false;
    }
  }

  /**
   * 检查用户是否为群主
   * @param {string|number} groupId 群ID
   * @param {string|number} userId 用户ID
   * @returns {Promise<boolean>} 是否为群主
   */
  async isGroupOwner(groupId, userId) {
    try {
      const memberInfo = await this.getGroupMemberInfo(groupId, userId);
      return memberInfo.role === 'owner';
    } catch (error) {
      return false;
    }
  }

  /**
   * 发送@消息
   * @param {string|number} groupId 群ID
   * @param {string|number} userId 要@的用户ID
   * @param {string} message 消息内容
   * @returns {Promise<Object>} 发送结果
   */
  async sendAtMessage(groupId, userId, message) {
    const atMessage = [
      {
        type: 'at',
        data: {
          qq: userId
        }
      },
      {
        type: 'text',
        data: {
          text: ` ${message}`
        }
      }
    ];
    return this.sendGroupMessage(groupId, atMessage);
  }

  /**
   * 发送图片消息
   * @param {string|number} target 目标（群ID或用户ID）
   * @param {string} imageUrl 图片URL或本地路径
   * @param {string} type 消息类型（'group' 或 'private'）
   * @returns {Promise<Object>} 发送结果
   */
  async sendImageMessage(target, imageUrl, type = 'group') {
    const imageMessage = [
      {
        type: 'image',
        data: {
          file: imageUrl
        }
      }
    ];
    
    if (type === 'group') {
      return this.sendGroupMessage(target, imageMessage);
    } else {
      return this.sendPrivateMessage(target, imageMessage);
    }
  }
}

module.exports = OneBotApiWrapper;