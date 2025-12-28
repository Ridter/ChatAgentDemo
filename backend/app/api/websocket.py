"""WebSocket 处理模块"""
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.core.session_manager import session_manager
from app.services.chat_store import chat_store
from app.config import get_logger

logger = get_logger(__name__)

router = APIRouter()


@router.websocket("/ws/chat")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket 端点，处理聊天连接"""
    await websocket.accept()

    current_session = None

    try:
        # 发送连接成功消息
        await websocket.send_json({"type": "connected"})

        while True:
            # 接收消息
            data = await websocket.receive_text()
            message = json.loads(data)

            msg_type = message.get("type")
            chat_id = message.get("chat_id")

            if msg_type == "subscribe":
                # 订阅聊天
                if not chat_id:
                    await websocket.send_json({
                        "type": "error",
                        "error": "chat_id is required",
                    })
                    continue

                # 检查聊天是否存在
                chat = await chat_store.get_chat(chat_id)
                if not chat:
                    await websocket.send_json({
                        "type": "error",
                        "error": "Chat not found",
                    })
                    continue

                # 如果之前订阅了其他会话，先取消订阅
                if current_session:
                    current_session.unsubscribe(websocket)

                # 获取或创建会话并订阅
                # 如果数据库中有保存的 sdk_session_id，则自动恢复会话
                existing_session = session_manager.get_session(chat_id)
                if existing_session:
                    # 已有活跃会话，直接使用
                    current_session = existing_session
                else:
                    # 没有活跃会话，检查是否可以从数据库恢复
                    sdk_session_id = chat.sdk_session_id
                    if sdk_session_id:
                        # 从数据库中的 sdk_session_id 恢复会话
                        current_session = session_manager.get_or_create_session(
                            chat_id,
                            resume_session_id=sdk_session_id,
                            fork_session=False
                        )
                        logger.info(f"Auto-resumed session {chat_id} from SDK session {sdk_session_id}")
                    else:
                        # 创建新会话
                        current_session = session_manager.get_or_create_session(chat_id)

                current_session.subscribe(websocket)

                # 发送当前处理状态（如果正在处理查询）
                if current_session.is_processing():
                    streaming_state = current_session.get_streaming_state()
                    await websocket.send_json({
                        "type": "processing_state",
                        "chat_id": chat_id,
                        "is_processing": True,
                        "streaming_state": streaming_state,
                    })

                # 发送历史消息
                messages = await chat_store.get_messages(chat_id)
                await websocket.send_json({
                    "type": "history",
                    "chat_id": chat_id,
                    "messages": [
                        {
                            "id": msg.id,
                            "role": msg.role,
                            "content": msg.content,
                            "timestamp": msg.timestamp.isoformat(),
                            "images": [
                                {
                                    "id": img.id,
                                    "base64": img.base64,
                                    "mimeType": img.mimeType,
                                }
                                for img in msg.images
                            ] if msg.images else None,
                        }
                        for msg in messages
                    ],
                })

                # 发送历史工具调用记录
                tool_uses = await chat_store.get_tool_uses(chat_id)
                if tool_uses:
                    await websocket.send_json({
                        "type": "tool_history",
                        "chat_id": chat_id,
                        "tool_uses": [
                            {
                                "id": tool.id,
                                "tool_name": tool.tool_name,
                                "tool_input": tool.tool_input,
                                "result_content": tool.result_content,
                                "is_error": tool.is_error,
                                "timestamp": tool.timestamp.isoformat(),
                            }
                            for tool in tool_uses
                        ],
                    })

            elif msg_type == "chat":
                # 发送聊天消息
                content = message.get("content", "").strip()
                images = message.get("images")  # 可选的图片列表

                if not chat_id:
                    await websocket.send_json({
                        "type": "error",
                        "error": "chat_id is required",
                    })
                    continue

                if not content and not images:
                    await websocket.send_json({
                        "type": "error",
                        "error": "content or images is required",
                    })
                    continue

                # 确保已订阅该聊天
                session = session_manager.get_session(chat_id)
                if not session:
                    # 自动订阅
                    chat = await chat_store.get_chat(chat_id)
                    if not chat:
                        await websocket.send_json({
                            "type": "error",
                            "error": "Chat not found",
                        })
                        continue

                    # 检查是否可以从数据库恢复会话
                    sdk_session_id = chat.sdk_session_id
                    if sdk_session_id:
                        session = session_manager.get_or_create_session(
                            chat_id,
                            resume_session_id=sdk_session_id,
                            fork_session=False
                        )
                        logger.info(f"Auto-resumed session {chat_id} from SDK session {sdk_session_id}")
                    else:
                        session = session_manager.get_or_create_session(chat_id)
                    session.subscribe(websocket)
                    current_session = session

                # 发送消息给 Agent（包含可选的图片）
                await session.send_message(content, images)

            elif msg_type == "stop":
                # 停止当前会话
                if not chat_id:
                    await websocket.send_json({
                        "type": "error",
                        "error": "chat_id is required",
                    })
                    continue

                session = session_manager.get_session(chat_id)
                if session:
                    cancelled = await session.cancel()
                    if cancelled:
                        logger.info(f"Session {chat_id} cancelled by user")
                else:
                    await websocket.send_json({
                        "type": "error",
                        "error": "No active session",
                    })

            elif msg_type == "clear_history":
                # 清除聊天历史记录（重置 Claude Agent 会话）
                if not chat_id:
                    await websocket.send_json({
                        "type": "error",
                        "error": "chat_id is required",
                    })
                    continue

                # 检查聊天是否存在
                chat = await chat_store.get_chat(chat_id)
                if not chat:
                    await websocket.send_json({
                        "type": "error",
                        "error": "Chat not found",
                    })
                    continue

                session = session_manager.get_session(chat_id)
                if session:
                    # 重置会话（清除 Claude Agent 历史和数据库记录）
                    await session.reset(clear_db=True)
                    logger.info(f"Session {chat_id} history cleared by user")
                else:
                    # 如果没有活跃会话，只清除数据库记录
                    await chat_store.clear_messages(chat_id)
                    await chat_store.clear_tool_uses(chat_id)
                    await websocket.send_json({
                        "type": "history_cleared",
                        "chat_id": chat_id,
                    })
                    logger.info(f"Chat {chat_id} database history cleared (no active session)")

            else:
                await websocket.send_json({
                    "type": "error",
                    "error": f"Unknown message type: {msg_type}",
                })

    except WebSocketDisconnect:
        logger.info("Client disconnected")
    except json.JSONDecodeError:
        await websocket.send_json({
            "type": "error",
            "error": "Invalid JSON",
        })
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        # 清理：取消订阅
        if current_session:
            current_session.unsubscribe(websocket)
