"""REST API 路由"""
from fastapi import APIRouter, HTTPException, Query
from app.services.chat_store import chat_store
from app.core.session_manager import session_manager
from app.models.schemas import (
    Chat,
    ChatMessage,
    CreateChatRequest,
    UpdateChatRequest,
    ResumeSessionRequest,
    SessionInfoResponse,
    ResetSessionResponse,
)

router = APIRouter(prefix="/api")


@router.get("/chats/search")
async def search_chats(q: str = Query(..., min_length=1, description="搜索关键词")):
    """搜索聊天内容"""
    return await chat_store.search_chats(q)


@router.get("/chats", response_model=list[Chat])
async def get_all_chats():
    """获取所有聊天"""
    return await chat_store.get_all_chats()


@router.post("/chats", response_model=Chat, status_code=201)
async def create_chat(request: CreateChatRequest = None):
    """创建新聊天"""
    title = request.title if request else None
    return await chat_store.create_chat(title)


@router.get("/chats/{chat_id}", response_model=Chat)
async def get_chat(chat_id: str):
    """获取单个聊天"""
    chat = await chat_store.get_chat(chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    return chat


@router.patch("/chats/{chat_id}", response_model=Chat)
async def update_chat(chat_id: str, request: UpdateChatRequest):
    """更新聊天标题"""
    chat = await chat_store.update_chat_title(chat_id, request.title)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    return chat


@router.delete("/chats/{chat_id}")
async def delete_chat(chat_id: str):
    """删除聊天"""
    deleted = await chat_store.delete_chat(chat_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Chat not found")

    # 关闭并移除会话
    await session_manager.remove_session(chat_id)

    return {"success": True}


@router.get("/chats/{chat_id}/messages", response_model=list[ChatMessage])
async def get_chat_messages(chat_id: str):
    """获取聊天消息"""
    # 检查聊天是否存在
    chat = await chat_store.get_chat(chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    return await chat_store.get_messages(chat_id)


@router.get("/chats/{chat_id}/session", response_model=SessionInfoResponse)
async def get_session_info(chat_id: str):
    """获取会话信息，包括 Claude SDK 会话 ID（用于恢复）"""
    # 检查聊天是否存在
    chat = await chat_store.get_chat(chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    # 获取会话（如果存在）
    session = session_manager.get_session(chat_id)
    if session:
        return SessionInfoResponse(
            chat_id=chat_id,
            sdk_session_id=session.sdk_session_id,
            is_active=True,
        )
    else:
        return SessionInfoResponse(
            chat_id=chat_id,
            sdk_session_id=None,
            is_active=False,
        )


@router.post("/chats/{chat_id}/session/reset", response_model=ResetSessionResponse)
async def reset_session(chat_id: str):
    """重置会话，清除 Claude Agent 的对话历史

    返回旧的 SDK 会话 ID，可用于后续恢复
    """
    # 检查聊天是否存在
    chat = await chat_store.get_chat(chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    # 获取会话
    session = session_manager.get_session(chat_id)
    if not session:
        return ResetSessionResponse(success=True, old_sdk_session_id=None)

    # 重置会话并获取旧的会话 ID
    old_session_id = await session.reset()
    return ResetSessionResponse(success=True, old_sdk_session_id=old_session_id)


@router.post("/chats/{chat_id}/session/resume", response_model=SessionInfoResponse)
async def resume_session(chat_id: str, request: ResumeSessionRequest):
    """恢复会话 - 使用之前保存的 SDK 会话 ID 恢复对话上下文

    Args:
        chat_id: 聊天 ID
        request: 包含 sdk_session_id 和 fork_session 参数

    Returns:
        新会话的信息
    """
    # 检查聊天是否存在
    chat = await chat_store.get_chat(chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    # 恢复会话
    session = await session_manager.resume_session(
        chat_id=chat_id,
        sdk_session_id=request.sdk_session_id,
        fork_session=request.fork_session,
    )

    return SessionInfoResponse(
        chat_id=chat_id,
        sdk_session_id=session.sdk_session_id,
        is_active=True,
    )
