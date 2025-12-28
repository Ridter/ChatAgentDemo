"""聊天数据存储服务"""
import json
import uuid
from datetime import datetime
from typing import Optional
from app.models.database import get_db
from app.models.schemas import Chat, ChatMessage, ToolUse, MessageImage


class ChatStore:
    """聊天数据 CRUD 服务"""

    async def create_chat(self, title: Optional[str] = None) -> Chat:
        """创建新聊天"""
        chat_id = str(uuid.uuid4())
        now = datetime.now().isoformat()
        chat_title = title or "New Chat"

        async with get_db() as db:
            await db.execute(
                "INSERT INTO chats (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
                (chat_id, chat_title, now, now),
            )
            await db.commit()

        return Chat(
            id=chat_id,
            title=chat_title,
            created_at=datetime.fromisoformat(now),
            updated_at=datetime.fromisoformat(now),
        )

    async def get_chat(self, chat_id: str) -> Optional[Chat]:
        """获取单个聊天"""
        async with get_db() as db:
            cursor = await db.execute(
                "SELECT id, title, created_at, updated_at, sdk_session_id FROM chats WHERE id = ?",
                (chat_id,),
            )
            row = await cursor.fetchone()

        if not row:
            return None

        return Chat(
            id=row["id"],
            title=row["title"],
            created_at=datetime.fromisoformat(row["created_at"]),
            updated_at=datetime.fromisoformat(row["updated_at"]),
            sdk_session_id=row["sdk_session_id"],
        )

    async def get_all_chats(self) -> list[Chat]:
        """获取所有聊天，按更新时间倒序"""
        async with get_db() as db:
            cursor = await db.execute(
                "SELECT id, title, created_at, updated_at, sdk_session_id FROM chats ORDER BY updated_at DESC"
            )
            rows = await cursor.fetchall()

        return [
            Chat(
                id=row["id"],
                title=row["title"],
                created_at=datetime.fromisoformat(row["created_at"]),
                updated_at=datetime.fromisoformat(row["updated_at"]),
                sdk_session_id=row["sdk_session_id"],
            )
            for row in rows
        ]

    async def update_sdk_session_id(
        self, chat_id: str, sdk_session_id: str
    ) -> Optional[Chat]:
        """更新聊天的 SDK 会话 ID

        Args:
            chat_id: 聊天 ID
            sdk_session_id: Claude SDK 会话 ID

        Returns:
            更新后的聊天对象，如果聊天不存在则返回 None
        """
        now = datetime.now().isoformat()

        async with get_db() as db:
            cursor = await db.execute(
                "UPDATE chats SET sdk_session_id = ?, updated_at = ? WHERE id = ?",
                (sdk_session_id, now, chat_id),
            )
            await db.commit()

            if cursor.rowcount == 0:
                return None

        return await self.get_chat(chat_id)

    async def update_chat_title(self, chat_id: str, title: str) -> Optional[Chat]:
        """更新聊天标题"""
        now = datetime.now().isoformat()

        async with get_db() as db:
            await db.execute(
                "UPDATE chats SET title = ?, updated_at = ? WHERE id = ?",
                (title, now, chat_id),
            )
            await db.commit()

        return await self.get_chat(chat_id)

    async def delete_chat(self, chat_id: str) -> bool:
        """删除聊天及其所有消息和工具调用记录"""
        async with get_db() as db:
            # 先获取所有消息 ID
            cursor = await db.execute(
                "SELECT id FROM messages WHERE chat_id = ?", (chat_id,)
            )
            message_rows = await cursor.fetchall()
            message_ids = [row["id"] for row in message_rows]

            # 删除消息关联的图片
            if message_ids:
                placeholders = ",".join("?" * len(message_ids))
                await db.execute(
                    f"DELETE FROM message_images WHERE message_id IN ({placeholders})",
                    message_ids,
                )

            # 删除工具调用记录
            await db.execute("DELETE FROM tool_uses WHERE chat_id = ?", (chat_id,))
            # 删除消息
            await db.execute("DELETE FROM messages WHERE chat_id = ?", (chat_id,))
            # 最后删除聊天
            cursor = await db.execute("DELETE FROM chats WHERE id = ?", (chat_id,))
            await db.commit()
            return cursor.rowcount > 0

    async def add_message(
        self,
        chat_id: str,
        role: str,
        content: str,
        images: list[dict] | None = None,
    ) -> ChatMessage:
        """添加消息到聊天

        Args:
            chat_id: 聊天 ID
            role: 角色 (user/assistant)
            content: 文本内容
            images: 可选的图片列表，每个图片包含 id, base64, mimeType
        """
        message_id = str(uuid.uuid4())
        now = datetime.now().isoformat()

        async with get_db() as db:
            # 插入消息
            await db.execute(
                "INSERT INTO messages (id, chat_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)",
                (message_id, chat_id, role, content, now),
            )

            # 插入图片
            message_images: list[MessageImage] = []
            if images:
                for img in images:
                    img_id = img.get("id", str(uuid.uuid4()))
                    base64_data = img.get("base64", "")
                    mime_type = img.get("mimeType", img.get("media_type", "image/png"))
                    await db.execute(
                        "INSERT INTO message_images (id, message_id, base64, mime_type) VALUES (?, ?, ?, ?)",
                        (img_id, message_id, base64_data, mime_type),
                    )
                    message_images.append(
                        MessageImage(id=img_id, base64=base64_data, mimeType=mime_type)
                    )

            # 更新聊天的 updated_at
            await db.execute(
                "UPDATE chats SET updated_at = ? WHERE id = ?",
                (now, chat_id),
            )

            # 如果是第一条用户消息且标题是 "New Chat"，自动更新标题
            if role == "user":
                cursor = await db.execute(
                    "SELECT title FROM chats WHERE id = ?", (chat_id,)
                )
                row = await cursor.fetchone()
                if row and row["title"] == "New Chat":
                    new_title = content[:50] + ("..." if len(content) > 50 else "")
                    await db.execute(
                        "UPDATE chats SET title = ? WHERE id = ?",
                        (new_title, chat_id),
                    )

            await db.commit()

        return ChatMessage(
            id=message_id,
            chat_id=chat_id,
            role=role,
            content=content,
            timestamp=datetime.fromisoformat(now),
            images=message_images if message_images else None,
        )

    async def get_messages(self, chat_id: str) -> list[ChatMessage]:
        """获取聊天的所有消息（包含图片）"""
        async with get_db() as db:
            # 获取消息
            cursor = await db.execute(
                "SELECT id, chat_id, role, content, timestamp FROM messages WHERE chat_id = ? ORDER BY timestamp ASC",
                (chat_id,),
            )
            rows = await cursor.fetchall()

            messages = []
            for row in rows:
                # 获取消息关联的图片
                img_cursor = await db.execute(
                    "SELECT id, base64, mime_type FROM message_images WHERE message_id = ?",
                    (row["id"],),
                )
                img_rows = await img_cursor.fetchall()
                images = [
                    MessageImage(
                        id=img_row["id"],
                        base64=img_row["base64"],
                        mimeType=img_row["mime_type"],
                    )
                    for img_row in img_rows
                ] if img_rows else None

                messages.append(
                    ChatMessage(
                        id=row["id"],
                        chat_id=row["chat_id"],
                        role=row["role"],
                        content=row["content"],
                        timestamp=datetime.fromisoformat(row["timestamp"]),
                        images=images,
                    )
                )

        return messages

    async def add_tool_use(
        self, chat_id: str, tool_id: str, tool_name: str, tool_input: dict
    ) -> ToolUse:
        """添加工具调用记录"""
        now = datetime.now().isoformat()
        tool_input_json = json.dumps(tool_input, ensure_ascii=False)

        async with get_db() as db:
            await db.execute(
                "INSERT INTO tool_uses (id, chat_id, tool_name, tool_input, timestamp) VALUES (?, ?, ?, ?, ?)",
                (tool_id, chat_id, tool_name, tool_input_json, now),
            )
            await db.commit()

        return ToolUse(
            id=tool_id,
            chat_id=chat_id,
            tool_name=tool_name,
            tool_input=tool_input,
            timestamp=datetime.fromisoformat(now),
        )

    async def update_tool_result(
        self, tool_id: str, result_content: Optional[str], is_error: bool
    ) -> Optional[ToolUse]:
        """更新工具调用结果"""
        async with get_db() as db:
            await db.execute(
                "UPDATE tool_uses SET result_content = ?, is_error = ? WHERE id = ?",
                (result_content, 1 if is_error else 0, tool_id),
            )
            await db.commit()

            cursor = await db.execute(
                "SELECT id, chat_id, tool_name, tool_input, result_content, is_error, timestamp FROM tool_uses WHERE id = ?",
                (tool_id,),
            )
            row = await cursor.fetchone()

        if not row:
            return None

        return ToolUse(
            id=row["id"],
            chat_id=row["chat_id"],
            tool_name=row["tool_name"],
            tool_input=json.loads(row["tool_input"]),
            result_content=row["result_content"],
            is_error=bool(row["is_error"]),
            timestamp=datetime.fromisoformat(row["timestamp"]),
        )

    async def get_tool_uses(self, chat_id: str) -> list[ToolUse]:
        """获取聊天的所有工具调用记录"""
        async with get_db() as db:
            cursor = await db.execute(
                "SELECT id, chat_id, tool_name, tool_input, result_content, is_error, timestamp FROM tool_uses WHERE chat_id = ? ORDER BY timestamp ASC",
                (chat_id,),
            )
            rows = await cursor.fetchall()

        return [
            ToolUse(
                id=row["id"],
                chat_id=row["chat_id"],
                tool_name=row["tool_name"],
                tool_input=json.loads(row["tool_input"]),
                result_content=row["result_content"],
                is_error=bool(row["is_error"]),
                timestamp=datetime.fromisoformat(row["timestamp"]),
            )
            for row in rows
        ]

    async def clear_messages(self, chat_id: str) -> int:
        """清除聊天的所有消息（保留聊天本身）

        Args:
            chat_id: 聊天 ID

        Returns:
            删除的消息数量
        """
        async with get_db() as db:
            # 先获取所有消息 ID
            cursor = await db.execute(
                "SELECT id FROM messages WHERE chat_id = ?", (chat_id,)
            )
            message_rows = await cursor.fetchall()
            message_ids = [row["id"] for row in message_rows]

            # 删除消息关联的图片
            if message_ids:
                placeholders = ",".join("?" * len(message_ids))
                await db.execute(
                    f"DELETE FROM message_images WHERE message_id IN ({placeholders})",
                    message_ids,
                )

            # 删除消息
            cursor = await db.execute(
                "DELETE FROM messages WHERE chat_id = ?", (chat_id,)
            )
            deleted_count = cursor.rowcount

            # 更新聊天的 updated_at
            now = datetime.now().isoformat()
            await db.execute(
                "UPDATE chats SET updated_at = ? WHERE id = ?",
                (now, chat_id),
            )

            await db.commit()

        return deleted_count

    async def clear_tool_uses(self, chat_id: str) -> int:
        """清除聊天的所有工具调用记录

        Args:
            chat_id: 聊天 ID

        Returns:
            删除的工具调用记录数量
        """
        async with get_db() as db:
            cursor = await db.execute(
                "DELETE FROM tool_uses WHERE chat_id = ?", (chat_id,)
            )
            deleted_count = cursor.rowcount
            await db.commit()

        return deleted_count

    async def search_chats(
        self, query: str, limit: int = 20
    ) -> list[dict]:
        """搜索聊天内容

        Args:
            query: 搜索关键词
            limit: 最大返回数量

        Returns:
            匹配的聊天列表，包含 chat_id、message_id 和匹配的内容片段
        """
        async with get_db() as db:
            # 搜索消息内容，返回消息 ID
            search_pattern = f"%{query}%"
            cursor = await db.execute(
                """
                SELECT m.id, m.chat_id, m.content
                FROM messages m
                JOIN chats c ON m.chat_id = c.id
                WHERE m.content LIKE ?
                ORDER BY c.updated_at DESC, m.timestamp ASC
                LIMIT ?
                """,
                (search_pattern, limit),
            )
            rows = await cursor.fetchall()

        results = []
        for row in rows:
            content = row["content"]
            # 提取匹配内容的上下文（前后各 30 个字符）
            query_lower = query.lower()
            content_lower = content.lower()
            idx = content_lower.find(query_lower)
            if idx != -1:
                start = max(0, idx - 30)
                end = min(len(content), idx + len(query) + 30)
                matched_content = content[start:end]
                if start > 0:
                    matched_content = "..." + matched_content
                if end < len(content):
                    matched_content = matched_content + "..."
            else:
                matched_content = content[:60] + ("..." if len(content) > 60 else "")

            results.append({
                "chat_id": row["chat_id"],
                "message_id": row["id"],
                "matched_content": matched_content,
            })

        return results


# 单例实例
chat_store = ChatStore()
