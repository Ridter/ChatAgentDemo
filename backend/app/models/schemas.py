"""Pydantic 数据模型"""
from datetime import datetime
from typing import Optional, Literal
from pydantic import BaseModel


class Chat(BaseModel):
    """聊天会话模型"""
    id: str
    title: str
    created_at: datetime
    updated_at: datetime
    sdk_session_id: Optional[str] = None  # Claude SDK 会话 ID（用于恢复）


class MessageImage(BaseModel):
    """消息图片模型"""
    id: str
    base64: str
    mimeType: str


class ChatMessage(BaseModel):
    """聊天消息模型"""
    id: str
    chat_id: str
    role: Literal["user", "assistant"]
    content: str
    timestamp: datetime
    images: Optional[list[MessageImage]] = None


class ToolUse(BaseModel):
    """工具调用记录模型"""
    id: str
    chat_id: str
    tool_name: str
    tool_input: dict
    result_content: Optional[str] = None
    is_error: bool = False
    timestamp: datetime


class CreateChatRequest(BaseModel):
    """创建聊天请求"""
    title: Optional[str] = None


class UpdateChatRequest(BaseModel):
    """更新聊天请求"""
    title: str


class ResumeSessionRequest(BaseModel):
    """恢复会话请求"""
    sdk_session_id: str  # Claude SDK 会话 ID
    fork_session: bool = False  # 是否从原会话分叉到新会话 ID


class SessionInfoResponse(BaseModel):
    """会话信息响应"""
    chat_id: str
    sdk_session_id: Optional[str] = None  # Claude SDK 会话 ID（用于恢复）
    is_active: bool = True


class ResetSessionResponse(BaseModel):
    """重置会话响应"""
    success: bool
    old_sdk_session_id: Optional[str] = None  # 旧的 SDK 会话 ID（可用于恢复）


class WSSubscribeMessage(BaseModel):
    """WebSocket 订阅消息"""
    type: Literal["subscribe"]
    chat_id: str


class WSChatMessage(BaseModel):
    """WebSocket 聊天消息"""
    type: Literal["chat"]
    chat_id: str
    content: str


class WSConnectedResponse(BaseModel):
    """WebSocket 连接成功响应"""
    type: Literal["connected"] = "connected"
    message: str = "Connected to chat server"


class WSHistoryResponse(BaseModel):
    """WebSocket 历史消息响应"""
    type: Literal["history"] = "history"
    chat_id: str
    messages: list[ChatMessage]


class WSUserMessageResponse(BaseModel):
    """WebSocket 用户消息响应"""
    type: Literal["user_message"] = "user_message"
    chat_id: str
    content: str


class WSAssistantMessageResponse(BaseModel):
    """WebSocket AI 回复响应"""
    type: Literal["assistant_message"] = "assistant_message"
    chat_id: str
    content: str


class WSToolUseResponse(BaseModel):
    """WebSocket 工具使用响应"""
    type: Literal["tool_use"] = "tool_use"
    chat_id: str
    tool_name: str
    tool_id: str
    tool_input: dict


class WSResultResponse(BaseModel):
    """WebSocket 完成响应"""
    type: Literal["result"] = "result"
    chat_id: str
    success: bool
    cost: Optional[float] = None
    duration: Optional[float] = None


class WSErrorResponse(BaseModel):
    """WebSocket 错误响应"""
    type: Literal["error"] = "error"
    chat_id: Optional[str] = None
    error: str
