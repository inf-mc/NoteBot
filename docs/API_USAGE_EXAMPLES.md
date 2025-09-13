# NapCat OneBot API 使用示例

本文档展示如何在 NoteBot 插件中使用新的 OneBot API 封装器，该封装器基于 NapCat 的 OneBot 11 标准实现。

## 快速开始

在插件中，你可以通过 `this.api` 访问所有的 OneBot API 功能：

```javascript
class MyPlugin extends BasePlugin {
    async handleMessage(message) {
        // 发送私聊消息
        await this.api.sendPrivateMessage(message.user_id, '你好！');
        
        // 发送群消息
        await this.api.sendGroupMessage(message.group_id, '大家好！');
    }
}
```

## 消息相关 API

### 发送消息

```javascript
// 发送私聊消息
await this.api.sendPrivateMessage(userId, '私聊消息内容');

// 发送群消息
await this.api.sendGroupMessage(groupId, '群消息内容');

// 发送@消息
await this.api.sendAtMessage(groupId, userId, '你被@了！');

// 发送图片消息
await this.api.sendImageMessage(groupId, 'https://example.com/image.jpg', 'group');
await this.api.sendImageMessage(userId, '/path/to/local/image.jpg', 'private');
```

### 消息管理

```javascript
// 撤回消息
await this.api.recallMessage(messageId);

// 获取消息详情
const messageInfo = await this.api.getMessageInfo(messageId);
console.log('消息内容:', messageInfo.message);

// 转发消息到群
await this.api.forwardMessageToGroup(targetGroupId, messageId);
```

## 用户信息 API

```javascript
// 获取机器人信息
const botInfo = await this.api.getBotInfo();
console.log('机器人QQ:', botInfo.user_id);
console.log('机器人昵称:', botInfo.nickname);

// 获取用户信息
const userInfo = await this.api.getUserInfo(userId);
console.log('用户昵称:', userInfo.nickname);
console.log('用户性别:', userInfo.sex);
console.log('用户年龄:', userInfo.age);

// 获取好友列表
const friends = await this.api.getFriends();
friends.forEach(friend => {
    console.log(`好友: ${friend.nickname} (${friend.user_id})`);
});
```

## 群组信息 API

```javascript
// 获取群列表
const groups = await this.api.getGroups();
groups.forEach(group => {
    console.log(`群组: ${group.group_name} (${group.group_id})`);
});

// 获取群成员列表
const members = await this.api.getGroupMembers(groupId);
members.forEach(member => {
    console.log(`成员: ${member.nickname} (${member.user_id}) - ${member.role}`);
});

// 获取群成员信息
const memberInfo = await this.api.getGroupMemberInfo(groupId, userId);
console.log('群名片:', memberInfo.card);
console.log('角色:', memberInfo.role); // member, admin, owner
console.log('加群时间:', new Date(memberInfo.join_time * 1000));
```

## 群组管理 API

### 成员管理

```javascript
// 踢出群成员
await this.api.kickGroupMember(groupId, userId, true); // true表示拒绝再次申请

// 禁言群成员（30分钟）
await this.api.muteGroupMember(groupId, userId, 30 * 60);

// 解除禁言
await this.api.unmuteGroupMember(groupId, userId);

// 全群禁言
await this.api.muteAllGroupMembers(groupId, true);

// 解除全群禁言
await this.api.muteAllGroupMembers(groupId, false);
```

### 权限管理

```javascript
// 设置管理员
await this.api.setGroupAdmin(groupId, userId, true);

// 取消管理员
await this.api.setGroupAdmin(groupId, userId, false);

// 检查是否为管理员
const isAdmin = await this.api.isGroupAdmin(groupId, userId);
if (isAdmin) {
    console.log('用户是管理员或群主');
}

// 检查是否为群主
const isOwner = await this.api.isGroupOwner(groupId, userId);
if (isOwner) {
    console.log('用户是群主');
}
```

### 群组设置

```javascript
// 设置群名片
await this.api.setGroupMemberCard(groupId, userId, '新的群名片');

// 设置群名
await this.api.setGroupName(groupId, '新的群名称');

// 设置专属头衔（仅群主可用）
await this.api.setGroupSpecialTitle(groupId, userId, '特殊头衔', -1); // -1表示永久

// 退出群聊
await this.api.leaveGroup(groupId, false); // false表示不解散群

// 解散群聊（仅群主可用）
await this.api.leaveGroup(groupId, true);
```

## 请求处理 API

```javascript
// 处理加好友请求
class MyPlugin extends BasePlugin {
    async handleFriendRequest(event) {
        const { flag, user_id, comment } = event;
        
        // 自动同意包含关键词的请求
        if (comment.includes('机器人')) {
            await this.api.handleFriendRequest(flag, true, '欢迎使用机器人');
        } else {
            await this.api.handleFriendRequest(flag, false, '请说明添加原因');
        }
    }
    
    async handleGroupRequest(event) {
        const { flag, sub_type, group_id, user_id, comment } = event;
        
        // 处理加群请求
        if (sub_type === 'add') {
            // 检查群成员数量
            const members = await this.api.getGroupMembers(group_id);
            if (members.length < 500) {
                await this.api.handleGroupRequest(flag, sub_type, true);
            } else {
                await this.api.handleGroupRequest(flag, sub_type, false, '群成员已满');
            }
        }
        // 处理群邀请
        else if (sub_type === 'invite') {
            await this.api.handleGroupRequest(flag, sub_type, true);
        }
    }
}
```

## 系统相关 API

```javascript
// 获取版本信息
const version = await this.api.getVersion();
console.log('OneBot版本:', version.app_version);
console.log('协议版本:', version.protocol_version);

// 清理缓存
await this.api.clearCache();

// 重启OneBot（谨慎使用）
// await this.api.restart(5000); // 5秒后重启
```

## 复杂消息格式

### CQ码格式

```javascript
// 发送图片
await this.api.sendGroupMessage(groupId, '[CQ:image,file=https://example.com/image.jpg]');

// 发送@消息
await this.api.sendGroupMessage(groupId, `[CQ:at,qq=${userId}] 你好！`);

// 发送表情
await this.api.sendGroupMessage(groupId, '[CQ:face,id=178]'); // 发送表情ID为178的表情

// 发送语音
await this.api.sendGroupMessage(groupId, '[CQ:record,file=voice.amr]');
```

### 数组格式

```javascript
// 复合消息
const message = [
    {
        type: 'at',
        data: { qq: userId }
    },
    {
        type: 'text',
        data: { text: ' 你好！这是一条复合消息 ' }
    },
    {
        type: 'image',
        data: { file: 'https://example.com/image.jpg' }
    }
];

await this.api.sendGroupMessage(groupId, message);
```

## 错误处理

```javascript
try {
    await this.api.sendGroupMessage(groupId, '测试消息');
} catch (error) {
    if (error.message.includes('群不存在')) {
        console.log('群组不存在或机器人不在群中');
    } else if (error.message.includes('权限不足')) {
        console.log('机器人权限不足');
    } else {
        console.error('发送消息失败:', error.message);
    }
}
```

## 实用工具方法

```javascript
class UtilityPlugin extends BasePlugin {
    // 批量发送消息
    async broadcastToGroups(groupIds, message) {
        const results = [];
        for (const groupId of groupIds) {
            try {
                const result = await this.api.sendGroupMessage(groupId, message);
                results.push({ groupId, success: true, result });
            } catch (error) {
                results.push({ groupId, success: false, error: error.message });
            }
        }
        return results;
    }
    
    // 检查用户权限
    async checkUserPermission(groupId, userId) {
        try {
            const memberInfo = await this.api.getGroupMemberInfo(groupId, userId);
            return {
                isMember: true,
                isAdmin: memberInfo.role === 'admin',
                isOwner: memberInfo.role === 'owner',
                role: memberInfo.role
            };
        } catch (error) {
            return {
                isMember: false,
                isAdmin: false,
                isOwner: false,
                role: null
            };
        }
    }
    
    // 安全发送消息（自动重试）
    async safeSendMessage(type, target, message, maxRetries = 3) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                if (type === 'group') {
                    return await this.api.sendGroupMessage(target, message);
                } else {
                    return await this.api.sendPrivateMessage(target, message);
                }
            } catch (error) {
                if (i === maxRetries - 1) throw error;
                await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
            }
        }
    }
}
```

## 注意事项

1. **权限检查**: 在执行管理操作前，请确保机器人有足够的权限
2. **错误处理**: 始终使用 try-catch 包装 API 调用
3. **频率限制**: 避免过于频繁的 API 调用，可能会被限制
4. **异步操作**: 所有 API 方法都是异步的，记得使用 await
5. **参数验证**: 在调用 API 前验证参数的有效性

## 迁移指南

如果你的插件使用了旧的 API 调用方式，可以按以下方式迁移：

```javascript
// 旧方式（已废弃）
await this.context.onebot.sendPrivateMessage(userId, message);
await this.context.onebot.sendGroupMessage(groupId, message);
await this.callOnebotAPI('get_group_list');

// 新方式（推荐）
await this.api.sendPrivateMessage(userId, message);
await this.api.sendGroupMessage(groupId, message);
await this.api.getGroups();
```

新的 API 封装器提供了更好的类型安全、错误处理和使用体验。建议所有插件都迁移到新的 API 方式。