# ChatAgent Backend

基于 Claude Agent SDK 的智能对话后端服务。

## 技术栈

- **Python 3.11+**
- **FastAPI** - Web 框架
- **Claude Agent SDK** - AI 对话能力
- **SQLite + aiosqlite** - 异步数据持久化
- **WebSocket** - 实时通信

## 项目结构

```
backend/
├── main.py                     # FastAPI 应用入口
├── pyproject.toml              # 项目依赖配置
├── .env                        # 环境变量
├── data/                       # 数据目录
│   └── chat.db                 # SQLite 数据库 (运行时生成)
│
└── app/                        # 应用核心模块
    ├── config.py               # 应用配置
    │
    ├── models/                 # 数据模型层
    │   ├── schemas.py          # Pydantic 模型
    │   └── database.py         # SQLite 数据库
    │
    ├── services/               # 业务逻辑层
    │   └── chat_store.py       # 聊天数据 CRUD
    │
    ├── core/                   # 核心组件
    │   ├── agent_session.py    # Claude Agent 会话管理
    │   └── session_manager.py  # WebSocket 会话管理
    │
    └── api/                    # API 路由层
        ├── routes.py           # REST API 路由
        └── websocket.py        # WebSocket 处理
```

## 快速开始

### 1. 安装依赖

```bash
cd backend
uv sync
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 设置 ANTHROPIC_API_KEY
```

### 3. 启动服务

```bash
uv run uvicorn main:app --reload --port 8000
```

## API 接口

### REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/chats` | 获取所有聊天 |
| POST | `/api/chats` | 创建新聊天 |
| GET | `/api/chats/{id}` | 获取单个聊天 |
| PUT | `/api/chats/{id}` | 更新聊天标题 |
| DELETE | `/api/chats/{id}` | 删除聊天 |
| GET | `/api/chats/{id}/messages` | 获取聊天消息 |

### WebSocket

**端点**: `ws://localhost:8000/ws/chat`

**客户端发送**:
```json
{"type": "subscribe", "chat_id": "uuid"}
{"type": "chat", "chat_id": "uuid", "content": "消息内容"}
{"type": "chat", "chat_id": "uuid", "content": "消息内容", "images": [{"base64": "...", "media_type": "image/png"}]}
{"type": "stop", "chat_id": "uuid"}
```

**服务端发送**:
```json
{"type": "connected"}
{"type": "history", "chat_id": "uuid", "messages": [...]}
{"type": "stream_start", "chat_id": "uuid"}
{"type": "text_delta", "delta": "文本片段", "chat_id": "uuid"}
{"type": "stream_end", "chat_id": "uuid"}
{"type": "tool_use", "tool_name": "...", "tool_id": "...", "tool_input": {...}, "chat_id": "uuid"}
{"type": "tool_result", "tool_id": "...", "content": "...", "is_error": false, "chat_id": "uuid"}
{"type": "result", "success": true, "cost": 0.01, "duration": 1234, "chat_id": "uuid"}
{"type": "cancelled", "chat_id": "uuid"}
{"type": "error", "error": "错误信息"}
```

## 核心功能

### Claude Agent 工具

支持以下工具能力：
- `Bash` - 执行 Shell 命令
- `Read` - 读取文件
- `Write` - 写入文件
- `Edit` - 编辑文件
- `Glob` - 文件匹配
- `Grep` - 内容搜索
- `WebSearch` - 网页搜索
- `WebFetch` - 获取网页内容

### 中断处理机制

系统实现了完善的查询中断机制，确保用户可以随时中断当前查询并发送新问题：

**核心设计**:

1. **查询 ID 隔离** - 每个查询分配唯一 ID，确保消息不会混淆
2. **操作锁保护** - 使用 `asyncio.Lock` 防止 `cancel()` 和 `send_message()` 同时执行
3. **SDK 中断协议** - 遵循 Claude Agent SDK 的 `interrupt()` 规范

**工作流程**:

```
用户点击停止 → cancel() 获取操作锁 → 调用 SDK interrupt() → 等待响应流清空 → 释放锁

用户发送新消息 → send_message() 获取操作锁 → 中断旧查询(如有) → 清空消息队列 → 启动新查询
```

**关键实现** (`agent_session.py`):

```python
async def send_message(self, content: str, images: list[dict] | None = None):
    async with self._operation_lock:  # 防止与 cancel() 同时执行
        # 递增查询 ID
        self._query_id += 1
        current_query_id = self._query_id

        # 如果有正在运行的任务，先中断
        if self._current_task and not self._current_task.done():
            self._cancelled = True
            await self._client.interrupt()
            await asyncio.wait_for(self._current_task, timeout=5.0)

        # 重置状态，启动新查询
        self._cancelled = False
        self._active_query_id = current_query_id
        self._current_task = asyncio.create_task(self._run_query(...))
```

**消息丢弃策略** (`_run_query`):

```python
async for message in client.receive_response():
    # 被取消时继续消费但丢弃消息，确保 SDK 缓冲区被清空
    if self._cancelled:
        continue
    # 非活跃查询的消息也丢弃
    if query_id != self._active_query_id:
        continue
    # 只有活跃查询的消息才放入队列
    await self._message_queue.put(message)
```

### 多模态支持

支持图片上传，图片以 Base64 格式传输并存储在数据库中。

## 配置选项

在 `app/config.py` 中可配置：

```python
SYSTEM_PROMPT = "..."           # 系统提示词
MAX_TURNS = 100                 # 最大对话轮数
ALLOWED_TOOLS = [...]           # 允许的工具列表
PERMISSION_MODE = "..."         # 权限模式
```

## 数据库结构

- `chats` - 聊天会话
- `messages` - 聊天消息
- `message_images` - 消息图片
- `tool_uses` - 工具调用记录
