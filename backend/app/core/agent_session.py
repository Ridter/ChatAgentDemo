"""Claude Agent 会话管理模块"""
import asyncio
import traceback
from typing import AsyncIterator, Any
from claude_agent_sdk import (
    ClaudeSDKClient,
    ClaudeAgentOptions,
    AssistantMessage,
    TextBlock,
    ToolUseBlock,
    ResultMessage,
)
from claude_agent_sdk.types import StreamEvent
from app.config import SYSTEM_PROMPT, ALLOWED_TOOLS, MAX_TURNS, PERMISSION_MODE, MCP_CONFIG_PATH, get_logger
from app.core.mcp_loader import load_mcp_servers, MCPConfig

logger = get_logger(__name__)


class AgentSession:
    """
    Claude Agent 会话，管理与 SDK 的交互
    使用 ClaudeSDKClient 保持持久化会话，支持多轮对话和流式输出

    支持会话恢复功能：
    - 通过 resume 参数恢复之前的会话
    - 通过 fork_session 参数从原会话分叉到新会话
    """

    def __init__(self, resume_session_id: str | None = None, fork_session: bool = False):
        """初始化 AgentSession

        Args:
            resume_session_id: 要恢复的会话 ID，如果为 None 则创建新会话
            fork_session: 是否从原会话分叉到新会话 ID（仅在 resume_session_id 不为 None 时有效）
        """
        # 加载 MCP 服务器配置
        mcp_config = load_mcp_servers(MCP_CONFIG_PATH)

        # 合并基础工具和 MCP 工具权限
        all_allowed_tools = ALLOWED_TOOLS + mcp_config.allowed_tools

        # 构建 ClaudeAgentOptions
        options_kwargs = {
            "system_prompt": SYSTEM_PROMPT,
            "max_turns": MAX_TURNS,
            "allowed_tools": all_allowed_tools,
            "permission_mode": PERMISSION_MODE,
            "include_partial_messages": True,  # 启用流式输出
            "mcp_servers": mcp_config.servers if mcp_config.servers else None,
            "stderr": lambda msg: logger.warning(f"CLI stderr: {msg}"),
        }

        # 如果指定了恢复会话 ID，添加 resume 参数
        if resume_session_id:
            options_kwargs["resume"] = resume_session_id
            if fork_session:
                options_kwargs["fork_session"] = True
            logger.info(f"AgentSession configured to resume from session: {resume_session_id}, fork: {fork_session}")

        self._options = ClaudeAgentOptions(**options_kwargs)
        self._resume_session_id = resume_session_id
        self._fork_session = fork_session
        self._session_id: str | None = None  # 当前会话 ID，在客户端初始化后获取
        self._client: ClaudeSDKClient | None = None
        self._current_task: asyncio.Task | None = None
        self._message_queue: asyncio.Queue = asyncio.Queue()
        self._closed = False
        self._client_lock = asyncio.Lock()
        self._operation_lock = asyncio.Lock()  # 防止 cancel 和 send_message 同时执行
        self._cancelled = False  # 用于标记是否被用户取消
        self._query_id = 0  # 查询 ID，用于区分不同查询的消息
        self._active_query_id = 0  # 当前活跃的查询 ID

    @property
    def session_id(self) -> str | None:
        """获取当前会话 ID"""
        return self._session_id

    async def _ensure_client(self) -> ClaudeSDKClient:
        """确保客户端已初始化"""
        async with self._client_lock:
            if self._client is None:
                self._client = ClaudeSDKClient(options=self._options)
                await self._client.__aenter__()
                # session_id 将在收到 ResultMessage 时从响应中提取
                if self._resume_session_id:
                    logger.info(f"ClaudeSDKClient initialized (resuming from session: {self._resume_session_id})")
                else:
                    logger.info("ClaudeSDKClient initialized (new session)")
            return self._client

    async def send_message(self, content: str, images: list[dict] | None = None) -> None:
        """发送消息给 Agent 并处理响应

        Args:
            content: 文本内容
            images: 可选的图片列表，每个图片包含 base64 和 media_type
        """
        if self._closed:
            return

        # 使用操作锁防止与 cancel() 同时执行
        async with self._operation_lock:
            # 递增查询 ID（在任何操作之前先递增，确保新查询有新 ID）
            self._query_id += 1
            current_query_id = self._query_id

            logger.info(f"send_message called, assigning query_id #{current_query_id}")

            # 如果有正在运行的任务，先中断并等待它完成
            if self._current_task and not self._current_task.done():
                logger.info(f"Previous task (query #{self._active_query_id}) still running, interrupting...")
                # 标记为取消，让 _run_query 知道要停止处理
                self._cancelled = True

                # 发送中断信号
                if self._client is not None:
                    try:
                        await self._client.interrupt()
                    except Exception as e:
                        logger.warning(f"Error sending interrupt: {e}")

                # 等待任务完成（SDK 要求 interrupt 后必须等待 receive_response 完成）
                try:
                    await asyncio.wait_for(self._current_task, timeout=5.0)
                    logger.info("Previous task completed after interrupt")
                except asyncio.TimeoutError:
                    logger.warning("Timeout waiting for previous task, forcing cancel")
                    self._current_task.cancel()
                    try:
                        await self._current_task
                    except asyncio.CancelledError:
                        pass
                except asyncio.CancelledError:
                    pass

            # 重置取消标记，准备新查询
            self._cancelled = False

            # 设置当前活跃查询 ID（在中断处理完成后设置）
            self._active_query_id = current_query_id
            logger.info(f"Active query ID set to #{self._active_query_id}")

            # 清空消息队列，确保新查询不会收到旧消息
            cleared_count = 0
            while not self._message_queue.empty():
                try:
                    self._message_queue.get_nowait()
                    cleared_count += 1
                except asyncio.QueueEmpty:
                    break
            if cleared_count > 0:
                logger.info(f"Cleared {cleared_count} stale messages before new query")

            # 启动新的查询任务
            self._current_task = asyncio.create_task(self._run_query(content, images, current_query_id))

    async def cancel(self) -> bool:
        """取消当前正在进行的查询（打断并允许发送新问题）

        根据 Claude Agent SDK 文档，interrupt() 会停止当前操作但保留对话历史，
        这样后续的查询可以在同一会话上下文中继续。

        重要：根据 SDK 文档，调用 interrupt() 后必须等待 receive_response() 完成，
        然后才能发送新的查询。
        """
        # 使用操作锁防止与 send_message() 同时执行
        async with self._operation_lock:
            if self._current_task and not self._current_task.done():
                self._cancelled = True

                # 使用 SDK 的 interrupt() 方法打断当前查询
                if self._client is not None:
                    try:
                        logger.info("Sending interrupt to Claude SDK...")
                        await self._client.interrupt()
                        logger.info("Interrupt sent successfully")
                    except Exception as e:
                        logger.warning(f"Error sending interrupt: {e}")

                # 重要：等待当前任务自然完成（不要强制取消）
                # SDK 文档指出：interrupt() 后必须等待 consume_task 完成
                try:
                    # 设置超时，避免无限等待
                    await asyncio.wait_for(self._current_task, timeout=5.0)
                    logger.info("Current task completed after interrupt")
                except asyncio.TimeoutError:
                    logger.warning("Timeout waiting for task to complete after interrupt, forcing cancel")
                    self._current_task.cancel()
                    try:
                        await self._current_task
                    except asyncio.CancelledError:
                        pass
                except asyncio.CancelledError:
                    pass

                # 清空消息队列，避免旧消息干扰新查询的响应
                cleared_count = 0
                while not self._message_queue.empty():
                    try:
                        self._message_queue.get_nowait()
                        cleared_count += 1
                    except asyncio.QueueEmpty:
                        break

                if cleared_count > 0:
                    logger.info(f"Cleared {cleared_count} messages from queue after cancel")

                logger.info("Query cancelled by user")
                return True
            return False

    @property
    def is_cancelled(self) -> bool:
        """是否被用户取消"""
        return self._cancelled

    @property
    def active_query_id(self) -> int:
        """当前活跃的查询 ID"""
        return self._active_query_id

    async def _create_multimodal_message(
        self, content: str, images: list[dict]
    ) -> AsyncIterator[dict]:
        """创建多模态消息的异步迭代器

        Args:
            content: 文本内容
            images: 图片列表，每个图片包含 base64 和 media_type

        Yields:
            消息字典
        """
        # 构建多模态消息内容
        message_content = []

        # 添加图片
        for img in images:
            message_content.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": img.get("media_type", "image/png"),
                    "data": img.get("base64", ""),
                }
            })

        # 添加文本（如果有）
        if content:
            message_content.append({
                "type": "text",
                "text": content,
            })

        # 构建完整的用户消息
        message = {
            "type": "user",
            "message": {"role": "user", "content": message_content},
            "parent_tool_use_id": None,
        }
        yield message

    async def _run_query(self, content: str, images: list[dict] | None = None, query_id: int = 0) -> None:
        """运行查询并将消息放入队列

        Args:
            content: 文本内容
            images: 可选的图片列表，每个图片包含 base64 和 media_type
            query_id: 查询 ID，用于检查消息是否属于当前活跃查询
        """
        try:
            logger.info(f"Starting query #{query_id}: {content[:50]}...")
            client = await self._ensure_client()

            # 发送消息
            if images and len(images) > 0:
                # 有图片时，使用多模态消息格式
                logger.info(f"Sending multimodal message with {len(images)} image(s)")
                await client.query(self._create_multimodal_message(content, images))
            else:
                # 纯文本消息
                await client.query(content)

            # 接收响应
            message_count = 0
            discarded_count = 0
            async for message in client.receive_response():
                # 检查是否被关闭（完全停止）
                if self._closed:
                    logger.info("Session closed, stopping response processing")
                    break

                # 从 ResultMessage 中提取 session_id（无论是否取消都要提取）
                if isinstance(message, ResultMessage) and message.session_id:
                    self._session_id = message.session_id
                    logger.info(f"Captured session_id from ResultMessage: {self._session_id}")

                # 检查是否被取消 - 继续消费但丢弃消息，确保 SDK 响应流被完全清空
                # 这样新查询不会收到旧查询的消息
                if self._cancelled:
                    discarded_count += 1
                    logger.debug(f"Query #{query_id} cancelled, discarding message #{discarded_count}: {type(message).__name__}")
                    continue  # 继续消费以清空 SDK 缓冲区
                # 检查是否仍然是活跃查询
                if query_id != self._active_query_id:
                    discarded_count += 1
                    logger.debug(f"Query #{query_id} no longer active (current: #{self._active_query_id}), discarding message #{discarded_count}")
                    continue
                message_count += 1
                logger.debug(f"Received message #{message_count} for query #{query_id}: {type(message).__name__}")
                await self._message_queue.put(message)

            if discarded_count > 0:
                logger.info(f"Query #{query_id} discarded {discarded_count} messages after cancellation")

            # 如果被取消，不发送取消消息（由 cancel() 方法处理）
            if not self._cancelled and query_id == self._active_query_id:
                logger.info(f"Query #{query_id} completed with {message_count} messages")

        except asyncio.CancelledError:
            logger.info(f"Query #{query_id} task cancelled")
            # 不在这里发送取消消息，由 cancel() 方法统一处理
        except Exception as e:
            error_str = str(e)
            # 忽略 SIGINT (exit code -2) 导致的错误，这是 Ctrl+C 中断的正常行为
            if "exit code -2" in error_str or "exit code: -2" in error_str:
                logger.info(f"Query #{query_id} interrupted by SIGINT (Ctrl+C)")
            else:
                logger.error(f"Query #{query_id} error: {e}")
                logger.error(traceback.format_exc())
                # 只有活跃查询才发送错误消息
                if query_id == self._active_query_id:
                    await self._message_queue.put({"error": str(e)})

    async def get_output_stream(self) -> AsyncIterator[Any]:
        """获取输出流

        注意：这个方法会持续运行直到会话关闭，
        每次查询完成后不会退出，而是等待下一次查询。
        """
        while not self._closed:
            try:
                # 使用超时避免永久阻塞
                message = await asyncio.wait_for(self._message_queue.get(), timeout=0.5)
                yield message
            except asyncio.TimeoutError:
                # 超时时继续等待，不检查任务状态
                # 这样可以持续监听多次查询的响应
                continue
            except asyncio.CancelledError:
                logger.info("Output stream cancelled")
                break

    async def reset(self) -> str | None:
        """重置会话，清除 Claude Agent 的对话历史

        通过关闭并重新创建 ClaudeSDKClient 来清除历史记录。
        这是 Claude Agent SDK 推荐的方式，因为 SDK 没有提供直接清除历史的 API。

        Returns:
            旧的会话 ID（可用于后续恢复），如果没有则返回 None
        """
        old_session_id = self._session_id

        async with self._operation_lock:
            # 如果有正在运行的任务，先中断
            if self._current_task and not self._current_task.done():
                self._cancelled = True
                if self._client is not None:
                    try:
                        await self._client.interrupt()
                    except Exception as e:
                        logger.warning(f"Error sending interrupt during reset: {e}")

                try:
                    await asyncio.wait_for(self._current_task, timeout=5.0)
                except (asyncio.TimeoutError, asyncio.CancelledError):
                    self._current_task.cancel()
                    try:
                        await self._current_task
                    except asyncio.CancelledError:
                        pass

            # 关闭当前客户端
            # 注意：由于 anyio cancel scope 的限制，__aexit__ 必须在与 __aenter__ 相同的任务中调用
            # 如果在不同任务中调用会报错，这里捕获并忽略该错误
            async with self._client_lock:
                if self._client is not None:
                    try:
                        await self._client.__aexit__(None, None, None)
                        logger.info("ClaudeSDKClient closed for reset")
                    except RuntimeError as e:
                        # 忽略 "cancel scope in a different task" 错误
                        # 这在重置时是预期的行为，因为 reset 可能从不同的任务调用
                        if "cancel scope" in str(e):
                            logger.debug(f"ClaudeSDKClient closed with expected task context warning: {e}")
                        else:
                            logger.warning(f"Error closing ClaudeSDKClient during reset: {e}")
                    except Exception as e:
                        logger.warning(f"Error closing ClaudeSDKClient during reset: {e}")
                    self._client = None

            # 重置状态
            self._cancelled = False
            self._query_id = 0
            self._active_query_id = 0
            self._session_id = None  # 清除会话 ID

            # 清空消息队列
            while not self._message_queue.empty():
                try:
                    self._message_queue.get_nowait()
                except asyncio.QueueEmpty:
                    break

            logger.info(f"AgentSession reset completed - conversation history cleared (old session_id: {old_session_id})")

        return old_session_id

    async def close(self) -> None:
        """关闭会话"""
        self._closed = True
        if self._current_task and not self._current_task.done():
            self._current_task.cancel()
            try:
                await self._current_task
            except asyncio.CancelledError:
                pass
        # 关闭 ClaudeSDKClient
        # 注意：由于 anyio cancel scope 的限制，__aexit__ 必须在与 __aenter__ 相同的任务中调用
        # 如果在不同任务中调用会报错，这里捕获并忽略该错误
        if self._client is not None:
            try:
                await self._client.__aexit__(None, None, None)
                logger.info("ClaudeSDKClient closed")
            except RuntimeError as e:
                # 忽略 "cancel scope in a different task" 错误
                # 这在服务关闭时是预期的行为
                if "cancel scope" in str(e):
                    logger.debug(f"ClaudeSDKClient closed with expected task context warning: {e}")
                else:
                    logger.warning(f"Error closing ClaudeSDKClient: {e}")
            except Exception as e:
                error_str = str(e)
                # 忽略 SIGINT (exit code -2) 导致的错误，这是 Ctrl+C 中断的正常行为
                if "exit code -2" in error_str or "exit code: -2" in error_str:
                    logger.debug(f"ClaudeSDKClient closed due to SIGINT (Ctrl+C)")
                else:
                    logger.warning(f"Error closing ClaudeSDKClient: {e}")
            self._client = None
