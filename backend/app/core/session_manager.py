"""WebSocket 会话管理模块"""
import asyncio
import json
from typing import Any
from fastapi import WebSocket
from claude_agent_sdk import AssistantMessage, UserMessage, TextBlock, ToolUseBlock, ToolResultBlock, ResultMessage
from claude_agent_sdk.types import StreamEvent
from app.core.agent_session import AgentSession
from app.services.chat_store import chat_store
from app.config import get_logger

logger = get_logger(__name__)


class Session:
    """
    管理单个聊天的 WebSocket 订阅者和 Agent 会话
    支持流式输出和会话恢复
    """

    def __init__(self, chat_id: str, resume_session_id: str | None = None, fork_session: bool = False):
        """初始化 Session

        Args:
            chat_id: 聊天 ID
            resume_session_id: 要恢复的 Claude SDK 会话 ID，如果为 None 则创建新会话
            fork_session: 是否从原会话分叉到新会话 ID
        """
        self.chat_id = chat_id
        self._subscribers: set[WebSocket] = set()
        self._agent_session = AgentSession(resume_session_id=resume_session_id, fork_session=fork_session)
        self._is_listening = False
        self._listen_task: asyncio.Task | None = None
        self._current_text_buffer = ""  # 用于累积流式文本
        self._resume_session_id = resume_session_id  # 保存恢复的会话 ID
        self._is_processing = False  # 是否正在处理查询
        self._pending_messages: list[dict] = []  # 待发送的消息队列（当没有订阅者时缓存）

    @property
    def sdk_session_id(self) -> str | None:
        """获取 Claude SDK 会话 ID（用于后续恢复）"""
        return self._agent_session.session_id

    async def _start_listening(self) -> None:
        """开始监听 Agent 输出

        这个方法会持续运行直到会话关闭，
        监听所有查询的响应消息。
        """
        if self._is_listening:
            return

        self._is_listening = True
        logger.info(f"Started listening for session {self.chat_id}")

        try:
            async for message in self._agent_session.get_output_stream():
                await self._handle_sdk_message(message)
        except asyncio.CancelledError:
            logger.info(f"Listening cancelled for session {self.chat_id}")
        except Exception as e:
            logger.error(f"Error in session {self.chat_id}: {e}")
            await self._broadcast_error(str(e))
        finally:
            self._is_listening = False
            logger.info(f"Stopped listening for session {self.chat_id}")

    async def _handle_sdk_message(self, message: Any) -> None:
        """处理 SDK 消息"""
        # 处理错误字典
        if isinstance(message, dict) and "error" in message:
            self._is_processing = False
            await self._broadcast_error(message["error"])
            return

        # 处理取消消息
        if isinstance(message, dict) and "cancelled" in message:
            self._is_processing = False
            await self.broadcast({
                "type": "cancelled",
                "chat_id": self.chat_id,
            })
            return

        # 处理 StreamEvent（流式输出）
        if isinstance(message, StreamEvent):
            event = message.event
            event_type = event.get("type", "")
            logger.debug(f"StreamEvent: type={event_type}, event={event}")

            # 处理文本增量
            if event_type == "content_block_delta":
                delta = event.get("delta", {})
                if delta.get("type") == "text_delta":
                    text = delta.get("text", "")
                    if text:
                        self._current_text_buffer += text
                        # 发送流式文本增量
                        await self.broadcast({
                            "type": "text_delta",
                            "delta": text,
                            "chat_id": self.chat_id,
                        })

            # 内容块开始
            elif event_type == "content_block_start":
                content_block = event.get("content_block", {})
                logger.debug(f"content_block_start: content_block={content_block}")
                if content_block.get("type") == "text":
                    # 重置文本缓冲区
                    self._current_text_buffer = ""
                    await self.broadcast({
                        "type": "stream_start",
                        "chat_id": self.chat_id,
                    })

            # 内容块结束
            elif event_type == "content_block_stop":
                logger.debug(f"content_block_stop: current_text_buffer length={len(self._current_text_buffer)}")
                if self._current_text_buffer:
                    # 存储完整消息到数据库
                    await chat_store.add_message(self.chat_id, "assistant", self._current_text_buffer)
                    await self.broadcast({
                        "type": "stream_end",
                        "chat_id": self.chat_id,
                    })
                    self._current_text_buffer = ""

            return

        # 处理 AssistantMessage（完整消息，作为备用）
        if isinstance(message, AssistantMessage):
            content = message.content

            if isinstance(content, str):
                # 如果没有通过流式输出，则存储并广播完整消息
                if not self._current_text_buffer:
                    await chat_store.add_message(self.chat_id, "assistant", content)
                    await self.broadcast({
                        "type": "assistant_message",
                        "content": content,
                        "chat_id": self.chat_id,
                    })
            elif isinstance(content, list):
                for block in content:
                    if isinstance(block, TextBlock):
                        # 跳过已通过流式输出的文本
                        pass
                    elif isinstance(block, ToolUseBlock):
                        # 存储工具调用到数据库
                        await chat_store.add_tool_use(
                            self.chat_id, block.id, block.name, block.input
                        )
                        await self.broadcast({
                            "type": "tool_use",
                            "tool_name": block.name,
                            "tool_id": block.id,
                            "tool_input": block.input,
                            "chat_id": self.chat_id,
                        })
                    elif isinstance(block, ToolResultBlock):
                        # 处理工具执行结果
                        result_content = block.content
                        # 如果内容是列表，尝试提取文本
                        if isinstance(result_content, list):
                            result_content = "\n".join(
                                str(item.get("text", item)) if isinstance(item, dict) else str(item)
                                for item in result_content
                            )
                        # 更新工具调用结果到数据库
                        await chat_store.update_tool_result(
                            block.tool_use_id, result_content, block.is_error or False
                        )
                        await self.broadcast({
                            "type": "tool_result",
                            "tool_id": block.tool_use_id,
                            "content": result_content,
                            "is_error": block.is_error or False,
                            "chat_id": self.chat_id,
                        })

        # 处理 UserMessage（包含工具执行结果）
        elif isinstance(message, UserMessage):
            content = message.content
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, ToolResultBlock):
                        # 处理工具执行结果
                        result_content = block.content
                        # 如果内容是列表，尝试提取文本
                        if isinstance(result_content, list):
                            result_content = "\n".join(
                                str(item.get("text", item)) if isinstance(item, dict) else str(item)
                                for item in result_content
                            )
                        # 更新工具调用结果到数据库
                        await chat_store.update_tool_result(
                            block.tool_use_id, result_content, block.is_error or False
                        )
                        logger.info(f"Broadcasting tool_result for tool_id: {block.tool_use_id}")
                        await self.broadcast({
                            "type": "tool_result",
                            "tool_id": block.tool_use_id,
                            "content": result_content,
                            "is_error": block.is_error or False,
                            "chat_id": self.chat_id,
                        })

        # 处理 ResultMessage
        elif isinstance(message, ResultMessage):
            # 标记处理完成
            self._is_processing = False

            # 保存 SDK session ID 到数据库（用于服务重启后恢复）
            # session_id 在 agent_session._run_query 中从 ResultMessage 提取并保存到 _session_id
            sdk_session_id = self._agent_session.session_id
            if sdk_session_id:
                await chat_store.update_sdk_session_id(self.chat_id, sdk_session_id)
                logger.info(f"Saved SDK session ID {sdk_session_id} for chat {self.chat_id}")

            await self.broadcast({
                "type": "result",
                "success": message.subtype == "success" if hasattr(message, 'subtype') else True,
                "chat_id": self.chat_id,
                "cost": message.total_cost_usd if hasattr(message, 'total_cost_usd') else None,
                "duration": message.duration_ms if hasattr(message, 'duration_ms') else None,
            })

    async def send_message(self, content: str, images: list[dict] | None = None) -> None:
        """发送用户消息给 Agent

        Args:
            content: 文本内容
            images: 可选的图片列表，每个图片包含 base64 和 media_type
        """
        # 标记开始处理
        self._is_processing = True

        # 存储用户消息（包含图片）
        # 转换图片格式：前端发送的是 media_type，需要转换为 mimeType
        images_for_store = None
        if images:
            images_for_store = [
                {
                    "id": img.get("id", ""),
                    "base64": img.get("base64", ""),
                    "mimeType": img.get("media_type", "image/png"),
                }
                for img in images
            ]
        await chat_store.add_message(
            self.chat_id, "user", content or "[图片]", images_for_store
        )

        # 广播用户消息给订阅者
        await self.broadcast({
            "type": "user_message",
            "content": content,
            "chat_id": self.chat_id,
        })

        # 发送给 Agent（包含图片）
        await self._agent_session.send_message(content, images)

        # 开始监听（如果还没开始）
        if not self._is_listening:
            self._listen_task = asyncio.create_task(self._start_listening())

    async def cancel(self) -> bool:
        """取消当前正在进行的查询（打断并允许发送新问题）"""
        # 记录取消前的查询 ID
        query_id_before = self._agent_session.active_query_id
        cancelled = await self._agent_session.cancel()
        if cancelled:
            # 重置文本缓冲区
            self._current_text_buffer = ""
            # 只有当没有新查询开始时才广播取消消息
            # 如果用户在取消后立即发送了新消息，active_query_id 会变化
            if self._agent_session.active_query_id == query_id_before:
                await self.broadcast({
                    "type": "cancelled",
                    "chat_id": self.chat_id,
                })
        return cancelled

    async def reset(self, clear_db: bool = True) -> str | None:
        """重置会话，清除 Claude Agent 的对话历史

        Args:
            clear_db: 是否同时清除数据库中的消息记录，默认为 True

        Returns:
            旧的 Claude SDK 会话 ID（可用于后续恢复），如果没有则返回 None
        """
        # 重置文本缓冲区
        self._current_text_buffer = ""

        # 停止当前的监听任务（重要：必须在 reset 之前停止，否则会导致状态不一致）
        if self._listen_task and not self._listen_task.done():
            self._listen_task.cancel()
            try:
                await self._listen_task
            except asyncio.CancelledError:
                pass
            logger.info(f"Cancelled listening task for session {self.chat_id}")
        self._is_listening = False
        self._listen_task = None

        # 重置 Agent 会话（清除 Claude SDK 的对话历史）
        old_session_id = await self._agent_session.reset()

        # 清除数据库中的消息和工具调用记录
        if clear_db:
            await chat_store.clear_messages(self.chat_id)
            await chat_store.clear_tool_uses(self.chat_id)

        # 广播重置完成消息
        await self.broadcast({
            "type": "history_cleared",
            "chat_id": self.chat_id,
            "old_session_id": old_session_id,  # 返回旧会话 ID，前端可用于恢复
        })

        logger.info(f"Session {self.chat_id} reset completed (old SDK session_id: {old_session_id})")
        return old_session_id

    def subscribe(self, websocket: WebSocket) -> None:
        """订阅会话"""
        self._subscribers.add(websocket)
        # 如果有缓存的消息，异步发送
        if self._pending_messages:
            asyncio.create_task(self._flush_pending_messages(websocket))

    async def _flush_pending_messages(self, websocket: WebSocket) -> None:
        """发送缓存的消息给新订阅者"""
        messages_to_send = self._pending_messages.copy()
        self._pending_messages.clear()

        for message in messages_to_send:
            try:
                await websocket.send_text(json.dumps(message, ensure_ascii=False))
            except Exception as e:
                logger.warning(f"Error sending cached message: {e}")
                # 如果发送失败，将消息放回队列
                self._pending_messages.extend(messages_to_send[messages_to_send.index(message):])
                break

        if messages_to_send:
            logger.info(f"Flushed {len(messages_to_send)} cached messages to subscriber")

    def unsubscribe(self, websocket: WebSocket) -> None:
        """取消订阅"""
        self._subscribers.discard(websocket)

    def has_subscribers(self) -> bool:
        """是否有订阅者"""
        return len(self._subscribers) > 0

    def get_streaming_state(self) -> dict | None:
        """获取当前流式输出状态

        Returns:
            如果正在流式输出，返回包含当前文本缓冲区的字典；否则返回 None
        """
        if self._current_text_buffer:
            return {
                "is_streaming": True,
                "current_content": self._current_text_buffer,
            }
        return None

    def is_processing(self) -> bool:
        """是否正在处理查询"""
        return self._is_processing

    async def broadcast(self, message: dict) -> None:
        """广播消息给所有订阅者

        如果没有订阅者且正在处理查询，消息会被缓存，
        等待订阅者重新连接后发送。
        """
        # 如果没有订阅者且正在处理，缓存消息
        if not self._subscribers and self._is_processing:
            # 只缓存重要消息（不缓存 text_delta，因为最终会有完整消息）
            msg_type = message.get("type")
            if msg_type not in ("text_delta",):
                self._pending_messages.append(message)
                logger.debug(f"Cached message (no subscribers): {msg_type}")
            return

        message_str = json.dumps(message, ensure_ascii=False)
        dead_subscribers = set()

        for ws in self._subscribers:
            try:
                await ws.send_text(message_str)
            except Exception as e:
                logger.warning(f"Error broadcasting to client: {e}")
                dead_subscribers.add(ws)

        # 移除断开的连接
        self._subscribers -= dead_subscribers

    async def _broadcast_error(self, error: str) -> None:
        """广播错误消息"""
        await self.broadcast({
            "type": "error",
            "error": error,
            "chat_id": self.chat_id,
        })

    async def close(self) -> None:
        """关闭会话"""
        if self._listen_task:
            self._listen_task.cancel()
        await self._agent_session.close()


class SessionManager:
    """会话管理器，管理所有聊天会话"""

    def __init__(self):
        self._sessions: dict[str, Session] = {}

    def get_or_create_session(
        self,
        chat_id: str,
        resume_session_id: str | None = None,
        fork_session: bool = False
    ) -> Session:
        """获取或创建会话

        Args:
            chat_id: 聊天 ID
            resume_session_id: 要恢复的 Claude SDK 会话 ID，如果为 None 则创建新会话
            fork_session: 是否从原会话分叉到新会话 ID

        Returns:
            Session 实例
        """
        if chat_id not in self._sessions:
            self._sessions[chat_id] = Session(
                chat_id,
                resume_session_id=resume_session_id,
                fork_session=fork_session
            )
            if resume_session_id:
                logger.info(f"Created session {chat_id} resuming from SDK session {resume_session_id}")
            else:
                logger.info(f"Created new session {chat_id}")
        return self._sessions[chat_id]

    def get_session(self, chat_id: str) -> Session | None:
        """获取会话"""
        return self._sessions.get(chat_id)

    async def resume_session(
        self,
        chat_id: str,
        sdk_session_id: str,
        fork_session: bool = False
    ) -> Session:
        """恢复会话

        如果该 chat_id 已有会话，先关闭旧会话再创建新的恢复会话。

        Args:
            chat_id: 聊天 ID
            sdk_session_id: 要恢复的 Claude SDK 会话 ID
            fork_session: 是否从原会话分叉到新会话 ID

        Returns:
            新的 Session 实例
        """
        # 如果已有会话，先关闭
        if chat_id in self._sessions:
            old_session = self._sessions[chat_id]
            await old_session.close()
            logger.info(f"Closed existing session {chat_id} for resume")

        # 创建新的恢复会话
        self._sessions[chat_id] = Session(
            chat_id,
            resume_session_id=sdk_session_id,
            fork_session=fork_session
        )
        logger.info(f"Resumed session {chat_id} from SDK session {sdk_session_id}, fork: {fork_session}")
        return self._sessions[chat_id]

    async def remove_session(self, chat_id: str) -> None:
        """移除会话"""
        session = self._sessions.pop(chat_id, None)
        if session:
            await session.close()

    async def close_all(self) -> None:
        """关闭所有会话"""
        for session in self._sessions.values():
            await session.close()
        self._sessions.clear()


# 单例实例
session_manager = SessionManager()
