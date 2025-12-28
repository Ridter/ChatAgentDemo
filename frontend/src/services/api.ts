/**
 * REST API 服务
 * 封装与后端的 HTTP 通信
 */

// 如果设置了 VITE_API_URL 则使用，否则使用相对路径（同域部署）
const API_BASE = import.meta.env.VITE_API_URL || ''

export interface Chat {
  id: string
  title: string
  created_at: string
  updated_at: string
}

export interface ChatMessage {
  id: string
  chat_id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

export interface CreateChatRequest {
  title?: string
}

/**
 * 聊天 API
 */
export const chatApi = {
  /**
   * 获取所有聊天
   */
  async getChats(): Promise<Chat[]> {
    const response = await fetch(`${API_BASE}/api/chats`)
    if (!response.ok) {
      throw new Error('Failed to fetch chats')
    }
    return response.json()
  },

  /**
   * 创建新聊天
   */
  async createChat(title?: string): Promise<Chat> {
    const response = await fetch(`${API_BASE}/api/chats`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title } as CreateChatRequest),
    })
    if (!response.ok) {
      throw new Error('Failed to create chat')
    }
    return response.json()
  },

  /**
   * 获取单个聊天
   */
  async getChat(chatId: string): Promise<Chat> {
    const response = await fetch(`${API_BASE}/api/chats/${chatId}`)
    if (!response.ok) {
      throw new Error('Chat not found')
    }
    return response.json()
  },

  /**
   * 删除聊天
   */
  async deleteChat(chatId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/api/chats/${chatId}`, {
      method: 'DELETE',
    })
    if (!response.ok) {
      throw new Error('Failed to delete chat')
    }
  },

  /**
   * 更新聊天标题
   */
  async updateChatTitle(chatId: string, title: string): Promise<Chat> {
    const response = await fetch(`${API_BASE}/api/chats/${chatId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title }),
    })
    if (!response.ok) {
      throw new Error('Failed to update chat title')
    }
    return response.json()
  },

  /**
   * 获取聊天消息
   */
  async getMessages(chatId: string): Promise<ChatMessage[]> {
    const response = await fetch(`${API_BASE}/api/chats/${chatId}/messages`)
    if (!response.ok) {
      throw new Error('Failed to fetch messages')
    }
    return response.json()
  },
}
