# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

ChatAgent 是一个基于 Anthropic Claude Agent SDK 构建的全栈对话应用，支持流式响应、多轮对话、工具调用和多模态输入（文本+图片）。

## 常用命令

### 后端 (Python FastAPI)
```bash
cd backend
uv sync                                              # 安装依赖
uv run uvicorn main:app --reload --host 0.0.0.0 --port 3001  # 启动开发服务器
uv run python -m py_compile main.py                  # 语法检查
```

### 前端 (React + TypeScript)
```bash
cd frontend
pnpm install          # 安装依赖
pnpm dev              # 启动开发服务器 (http://localhost:5173)
pnpm build            # 生产构建
pnpm tsc --noEmit     # 类型检查
pnpm lint             # ESLint 检查
```

## 架构概览

```
ChatAgent/
├── backend/                    # Python FastAPI 后端
│   ├── main.py                # 应用入口
│   └── app/
│       ├── config.py          # 全局配置（系统提示词、允许的工具等）
│       ├── core/
│       │   ├── agent_session.py    # Claude Agent SDK 会话管理（核心）
│       │   └── session_manager.py  # WebSocket 会话和消息广播
│       ├── api/
│       │   ├── routes.py      # REST API 路由
│       │   └── websocket.py   # WebSocket 端点
│       └── services/
│           └── chat_store.py  # SQLite 数据库 CRUD
│
└── frontend/                   # React TypeScript 前端
    └── src/
        ├── components/
        │   ├── chat/          # ChatContainer, ChatMessage, ChatInput, ToolUseCard
        │   └── sidebar/       # ChatSidebar
        ├── hooks/
        │   ├── useChat.ts     # WebSocket 管理和消息处理（核心）
        │   └── useChatList.ts # 聊天列表管理
        └── services/
            └── api.ts         # REST API 调用
```

## 数据流

```
用户输入 → WebSocket (useChat) → websocket.py → session_manager.py
    → AgentSession (Claude SDK) → 流式响应 → 数据库存储 → WebSocket 广播 → UI 更新
```

## WebSocket 消息协议

**客户端 → 服务器**：
- `subscribe`: 订阅聊天 `{ type: "subscribe", chat_id }`
- `chat`: 发送消息 `{ type: "chat", chat_id, content, images? }`
- `stop`: 停止生成 `{ type: "stop", chat_id }`

**服务器 → 客户端**：
- `text_delta`: 流式文本增量
- `tool_use` / `tool_result`: 工具调用和结果
- `stream_start` / `stream_end`: 流式响应边界
- `history` / `tool_history`: 历史消息和工具调用

## 环境变量

```bash
# backend/.env
ANTHROPIC_API_KEY=sk-ant-xxxxx

# frontend/.env
VITE_API_URL=http://localhost:3001
VITE_WS_URL=ws://localhost:3001
```

## 关键配置

后端配置位于 `backend/app/config.py`：
- `SYSTEM_PROMPT`: Claude 系统提示词
- `ALLOWED_TOOLS`: 允许的工具列表
- `MAX_TURNS`: 最大对话轮数
- `PERMISSION_MODE`: 权限模式

## 数据库

SQLite 数据库位于 `backend/data/chat.db`，包含表：
- `chats`: 聊天会话
- `messages`: 聊天消息
- `message_images`: 消息中的图片
- `tool_uses`: 工具调用记录

## 常修改的文件

- `backend/app/config.py` - 配置和系统提示词
- `backend/app/core/agent_session.py` - Agent 逻辑
- `frontend/src/hooks/useChat.ts` - WebSocket 和消息处理
- `frontend/src/components/chat/` - 聊天 UI 组件
