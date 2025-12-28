/**
 * 聊天列表管理 Hook
 * 管理聊天列表状态和操作
 */

import { useState, useEffect, useCallback } from 'react'
import { chatApi, type Chat } from '@/services/api'

export interface UseChatListReturn {
  chats: Chat[]
  currentChatId: string | null
  highlightMessageId: string | null
  isLoading: boolean
  error: string | null
  selectChat: (chatId: string, messageId?: string) => void
  clearHighlight: () => void
  clearCurrentChat: () => void
  createChat: (title?: string, autoSelect?: boolean) => Promise<Chat | null>
  deleteChat: (chatId: string) => Promise<boolean>
  updateChatTitle: (chatId: string, title: string) => Promise<boolean>
  refreshChats: () => Promise<void>
}

const CURRENT_CHAT_KEY = 'currentChatId'

export function useChatList(): UseChatListReturn {
  const [chats, setChats] = useState<Chat[]>([])
  // 从 localStorage 恢复上次选中的会话（刷新页面时保持状态）
  const [currentChatId, setCurrentChatId] = useState<string | null>(() => {
    return localStorage.getItem(CURRENT_CHAT_KEY)
  })
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 当 currentChatId 变化时，保存到 localStorage
  useEffect(() => {
    if (currentChatId) {
      localStorage.setItem(CURRENT_CHAT_KEY, currentChatId)
    } else {
      localStorage.removeItem(CURRENT_CHAT_KEY)
    }
  }, [currentChatId])

  /**
   * 加载聊天列表
   */
  const refreshChats = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const chatList = await chatApi.getChats()
      // 按更新时间降序排序
      chatList.sort((a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      )
      setChats(chatList)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载聊天列表失败')
    } finally {
      setIsLoading(false)
    }
  }, [])

  /**
   * 初始加载，并验证 localStorage 中的 chatId 是否有效
   */
  useEffect(() => {
    const init = async () => {
      await refreshChats()
    }
    init()
  }, [refreshChats])

  /**
   * 聊天列表加载完成后，验证 currentChatId 是否有效
   */
  useEffect(() => {
    if (!isLoading && currentChatId) {
      // 检查 currentChatId 是否存在于聊天列表中
      const chatExists = chats.some(chat => chat.id === currentChatId)
      if (!chatExists) {
        // 会话不存在，清除选中状态
        setCurrentChatId(null)
        localStorage.removeItem(CURRENT_CHAT_KEY)
      }
    }
  }, [isLoading, chats, currentChatId])

  /**
   * 选择聊天，可选传入要高亮的消息 ID
   */
  const selectChat = useCallback((chatId: string, messageId?: string) => {
    setCurrentChatId(chatId)
    setHighlightMessageId(messageId || null)
  }, [])

  /**
   * 清除高亮状态
   */
  const clearHighlight = useCallback(() => {
    setHighlightMessageId(null)
  }, [])

  /**
   * 清除当前选中的聊天（显示欢迎页面）
   */
  const clearCurrentChat = useCallback(() => {
    setCurrentChatId(null)
    localStorage.removeItem(CURRENT_CHAT_KEY)
  }, [])

  /**
   * 创建新聊天
   * @param title 可选的聊天标题
   * @param autoSelect 是否自动选中新聊天（默认 true）
   */
  const createChat = useCallback(async (title?: string, autoSelect: boolean = true): Promise<Chat | null> => {
    try {
      setError(null)
      const newChat = await chatApi.createChat(title)
      // 添加到列表顶部
      setChats(prev => [newChat, ...prev])
      // 只有在 autoSelect 为 true 时才自动选中新聊天
      if (autoSelect) {
        setCurrentChatId(newChat.id)
      }
      return newChat
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建聊天失败')
      return null
    }
  }, [])

  /**
   * 删除聊天
   */
  const deleteChat = useCallback(async (chatId: string): Promise<boolean> => {
    try {
      setError(null)
      await chatApi.deleteChat(chatId)
      // 从列表中移除
      setChats(prev => prev.filter(chat => chat.id !== chatId))
      // 如果删除的是当前选中的聊天，清除选中状态
      if (currentChatId === chatId) {
        setCurrentChatId(null)
      }
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除聊天失败')
      return false
    }
  }, [currentChatId])

  /**
   * 更新聊天标题
   */
  const updateChatTitle = useCallback(async (chatId: string, title: string): Promise<boolean> => {
    try {
      setError(null)
      const updatedChat = await chatApi.updateChatTitle(chatId, title)
      // 更新列表中的聊天标题
      setChats(prev => prev.map(chat =>
        chat.id === chatId ? { ...chat, title: updatedChat.title } : chat
      ))
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新标题失败')
      return false
    }
  }, [])

  return {
    chats,
    currentChatId,
    highlightMessageId,
    isLoading,
    error,
    selectChat,
    clearHighlight,
    clearCurrentChat,
    createChat,
    deleteChat,
    updateChatTitle,
    refreshChats,
  }
}
