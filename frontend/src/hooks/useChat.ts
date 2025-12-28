/**
 * 聊天 Hook
 * 管理 WebSocket 连接和消息状态
 */

import { useState, useCallback, useRef, useEffect } from 'react'

// 如果设置了 VITE_WS_URL 则使用，否则根据当前页面协议自动推断（同域部署）
const WS_URL = import.meta.env.VITE_WS_URL || `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`

export interface MessageImage {
  id: string
  base64: string
  mimeType: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  images?: MessageImage[]
  isStreaming?: boolean  // 标记消息是否正在流式传输中
}

interface ToolUseInfo {
  toolName: string
  toolId: string
  toolInput: Record<string, unknown>
}

interface ToolResultInfo {
  toolId: string
  content: string | null
  isError: boolean
}

interface ToolHistoryItem {
  id: string
  toolName: string
  toolInput: Record<string, unknown>
  resultContent: string | null
  isError: boolean
  timestamp: string
}

interface UseChatOptions {
  chatId: string | null
  onError?: (error: string) => void
  onToolUse?: (info: ToolUseInfo) => void
  onToolResult?: (info: ToolResultInfo) => void
  onToolHistory?: (tools: ToolHistoryItem[]) => void
  onResult?: (success: boolean, cost?: number, duration?: number) => void
  onDisconnect?: () => void  // WebSocket 断开时的回调
}

// WebSocket 单例管理器（避免 React Strict Mode 双重挂载问题）
class WebSocketManager {
  private ws: WebSocket | null = null
  private listeners: Set<(data: unknown) => void> = new Set()
  private statusListeners: Set<(connected: boolean) => void> = new Set()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private isConnecting = false

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return
    if (this.ws?.readyState === WebSocket.CONNECTING) return
    if (this.isConnecting) return

    this.isConnecting = true
    const ws = new WebSocket(`${WS_URL}/ws/chat`)

    ws.onopen = () => {
      console.log('WebSocket connected')
      this.isConnecting = false
      this.notifyStatus(true)
    }

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      this.listeners.forEach((listener) => listener(data))
    }

    ws.onerror = () => {
      this.isConnecting = false
      this.notifyStatus(false)
    }

    ws.onclose = () => {
      console.log('WebSocket disconnected')
      this.isConnecting = false
      this.ws = null
      this.notifyStatus(false)
      // 自动重连
      this.scheduleReconnect()
    }

    this.ws = ws
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return
    if (this.listeners.size === 0) return // 没有监听器时不重连

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.listeners.size > 0) {
        console.log('Attempting to reconnect...')
        this.connect()
      }
    }, 2000)
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  send(data: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
      return true
    }
    return false
  }

  stop(chatId: string) {
    return this.send({ type: 'stop', chat_id: chatId })
  }

  addListener(listener: (data: unknown) => void) {
    this.listeners.add(listener)
    // 如果是第一个监听器，建立连接
    if (this.listeners.size === 1) {
      this.connect()
    }
  }

  removeListener(listener: (data: unknown) => void) {
    this.listeners.delete(listener)
    // 延迟检查是否需要断开连接（避免 React Strict Mode 双重挂载问题）
    // 使用较长的延迟时间（500ms）来避免页面刷新或组件重新挂载时误断开
    setTimeout(() => {
      if (this.listeners.size === 0) {
        this.disconnect()
      }
    }, 500)
  }

  addStatusListener(listener: (connected: boolean) => void) {
    this.statusListeners.add(listener)
    // 立即通知当前状态
    listener(this.ws?.readyState === WebSocket.OPEN)
  }

  removeStatusListener(listener: (connected: boolean) => void) {
    this.statusListeners.delete(listener)
  }

  private notifyStatus(connected: boolean) {
    this.statusListeners.forEach((listener) => listener(connected))
  }

  get isConnected() {
    return this.ws?.readyState === WebSocket.OPEN
  }
}

// 全局单例
const wsManager = new WebSocketManager()

// 会话消息缓存（每个会话独立保存消息状态）
interface SessionCache {
  messages: Message[]
  isStreaming: boolean
  streamingMessageId: string | null
  isLoading: boolean
}
const sessionCacheMap = new Map<string, SessionCache>()

// 缓存更新通知器（用于触发组件重渲染）
type CacheUpdateListener = () => void
const cacheUpdateListeners = new Set<CacheUpdateListener>()

function notifyCacheUpdate() {
  cacheUpdateListeners.forEach((listener) => listener())
}

function updateSessionCache(chatId: string, updates: Partial<SessionCache>) {
  const existing = sessionCacheMap.get(chatId)
  if (existing) {
    sessionCacheMap.set(chatId, { ...existing, ...updates })
  } else {
    sessionCacheMap.set(chatId, {
      messages: [],
      isStreaming: false,
      streamingMessageId: null,
      isLoading: false,
      ...updates,
    })
  }
  notifyCacheUpdate()
}

export function useChat(options: UseChatOptions) {
  const { chatId } = options
  const [messages, setMessages] = useState<Message[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  // 用于触发从缓存派生状态的重渲染
  const [, forceUpdate] = useState(0)
  const currentChatIdRef = useRef<string | null>(null)
  const optionsRef = useRef(options)
  const streamingMessageIdRef = useRef<string | null>(null)
  // 跟踪上一个 chatId，用于判断是否是新创建的会话
  const prevChatIdRef = useRef<string | null>(null)
  // 待发送的消息（用于新创建会话时保持消息显示）
  const pendingMessageRef = useRef<{ content: string; images?: Array<{ id: string; base64: string; mimeType: string }> } | null>(null)
  // 跳过下一次 chatId 变化的处理（用于新创建会话时避免 useEffect 清空消息）
  const skipNextChatIdChangeRef = useRef(false)

  // 用于同步获取当前消息状态的 ref
  const messagesRef = useRef<Message[]>([])

  // 从缓存派生 isLoading 和 isStreaming 状态（按 chatId 隔离）
  const currentCache = chatId ? sessionCacheMap.get(chatId) : null
  const isLoading = currentCache?.isLoading ?? false
  const isStreaming = currentCache?.isStreaming ?? false

  // 保持 ref 与 state 同步
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  // 订阅缓存更新，触发重渲染
  useEffect(() => {
    const listener = () => forceUpdate((n) => n + 1)
    cacheUpdateListeners.add(listener)
    return () => {
      cacheUpdateListeners.delete(listener)
    }
  }, [])


  // 保持 options 引用最新
  useEffect(() => {
    optionsRef.current = options
  }, [options])

  // 消息处理器
  useEffect(() => {
    const handleMessage = (data: unknown) => {
      const msg = data as Record<string, unknown>

      switch (msg.type) {
        case 'connected':
          // 连接成功，如果有 chatId 则订阅
          if (currentChatIdRef.current) {
            wsManager.send({
              type: 'subscribe',
              chat_id: currentChatIdRef.current,
            })
          }
          break

        case 'history':
          // 收到历史消息
          if (msg.chat_id === currentChatIdRef.current) {
            const historyMessages: Message[] = (msg.messages as Array<{
              id: string
              role: 'user' | 'assistant'
              content: string
              timestamp: string
              images?: Array<{
                id: string
                base64: string
                mimeType: string
              }> | null
            }>).map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              timestamp: new Date(m.timestamp),
              images: m.images || undefined,
            }))
            // 如果有待发送的消息且历史为空，保留当前消息（新创建会话的情况）
            if (pendingMessageRef.current && historyMessages.length === 0) {
              // 不覆盖，保留 subscribe 时设置的用户消息
              return
            }

            // 检查缓存中是否有正在流式输出的消息
            const historyChatId = msg.chat_id as string
            const cached = sessionCacheMap.get(historyChatId)
            if (cached && cached.isStreaming && cached.streamingMessageId) {
              // 正在流式输出，合并历史消息和当前流式消息
              const currentStreamingMessage = messagesRef.current.find(m => m.id === cached.streamingMessageId)
              if (currentStreamingMessage) {
                // 历史消息最后是用户消息，说明 AI 还没回复完，保留流式消息
                const lastHistoryMsg = historyMessages[historyMessages.length - 1]
                if (lastHistoryMsg && lastHistoryMsg.role === 'user') {
                  setMessages([...historyMessages, currentStreamingMessage])
                  return
                }
              }
              // 缓存中有流式消息，合并历史消息和流式消息
              const streamingMessage = cached.messages.find(m => m.id === cached.streamingMessageId)
              if (streamingMessage) {
                // 历史消息最后是用户消息，说明 AI 还没回复完，保留流式消息
                const lastHistoryMsg = historyMessages[historyMessages.length - 1]
                if (lastHistoryMsg && lastHistoryMsg.role === 'user') {
                  setMessages([...historyMessages, streamingMessage])
                  return
                }
              }
            }

            // 没有流式消息或流式消息已完成，直接使用历史消息
            setMessages(historyMessages)
          }
          break

        case 'processing_state':
          // 收到处理状态（重连后恢复）
          {
            const processingChatId = msg.chat_id as string
            if (processingChatId === currentChatIdRef.current && msg.is_processing) {
              updateSessionCache(processingChatId, { isLoading: true })
              const streamingState = msg.streaming_state as { is_streaming: boolean; current_content: string } | null
              if (streamingState && streamingState.is_streaming) {
                // 有正在进行的流式输出，创建一个流式消息
                const newMessageId = Date.now().toString()
                const streamingMessage: Message = {
                  id: newMessageId,
                  role: 'assistant',
                  content: streamingState.current_content || '',
                  timestamp: new Date(),
                  isStreaming: true,
                }
                streamingMessageIdRef.current = newMessageId
                updateSessionCache(processingChatId, { isStreaming: true, streamingMessageId: newMessageId })
                setMessages((prev) => {
                  // 检查最后一条消息是否是用户消息，如果是则添加流式消息
                  const lastMsg = prev[prev.length - 1]
                  if (lastMsg && lastMsg.role === 'user') {
                    return [...prev, streamingMessage]
                  }
                  // 否则替换最后一条助手消息（可能是之前的流式消息）
                  if (lastMsg && lastMsg.role === 'assistant') {
                    return [...prev.slice(0, -1), streamingMessage]
                  }
                  return [...prev, streamingMessage]
                })
              }
            }
          }
          break

        case 'user_message':
          // 用户消息（来自其他客户端或服务端确认）
          break

        case 'assistant_message':
          // AI 回复（非流式，作为备用）
          {
            const assistantChatId = msg.chat_id as string
            if (assistantChatId === currentChatIdRef.current) {
              // 只有在没有流式输出时才处理
              if (!streamingMessageIdRef.current) {
                updateSessionCache(assistantChatId, { isLoading: false })
                const assistantMessage: Message = {
                  id: Date.now().toString(),
                  role: 'assistant',
                  content: msg.content as string,
                  timestamp: new Date(),
                }
                setMessages((prev) => [...prev, assistantMessage])
              }
            }
          }
          break

        case 'stream_start':
          // 流式输出开始
          {
            const streamChatId = msg.chat_id as string
            const newMessageId = Date.now().toString()
            const streamingMessage: Message = {
              id: newMessageId,
              role: 'assistant',
              content: '',
              timestamp: new Date(),
              isStreaming: true,
            }

            if (streamChatId === currentChatIdRef.current) {
              // 当前会话，更新状态
              streamingMessageIdRef.current = newMessageId
              setMessages((prev) => [...prev, streamingMessage])
            }

            // 同时更新缓存（无论是否是当前会话）
            const cached = sessionCacheMap.get(streamChatId)
            if (cached) {
              sessionCacheMap.set(streamChatId, {
                messages: [...cached.messages, streamingMessage],
                isStreaming: true,
                streamingMessageId: newMessageId,
                isLoading: true,
              })
            } else {
              // 如果没有缓存，创建一个新的
              sessionCacheMap.set(streamChatId, {
                messages: [streamingMessage],
                isStreaming: true,
                streamingMessageId: newMessageId,
                isLoading: true,
              })
            }
            notifyCacheUpdate()
          }
          break

        case 'text_delta':
          // 流式文本增量
          {
            const deltaChatId = msg.chat_id as string
            const delta = msg.delta as string

            if (deltaChatId === currentChatIdRef.current && streamingMessageIdRef.current) {
              // 当前会话，更新状态
              setMessages((prev) => {
                const lastIndex = prev.length - 1
                if (lastIndex >= 0 && prev[lastIndex].id === streamingMessageIdRef.current) {
                  const updated = [...prev]
                  updated[lastIndex] = {
                    ...updated[lastIndex],
                    content: updated[lastIndex].content + delta,
                  }
                  return updated
                }
                return prev
              })
            }

            // 同时更新缓存（无论是否是当前会话）
            const cached = sessionCacheMap.get(deltaChatId)
            if (cached && cached.streamingMessageId) {
              const updatedMessages = cached.messages.map((m) =>
                m.id === cached.streamingMessageId
                  ? { ...m, content: m.content + delta }
                  : m
              )
              sessionCacheMap.set(deltaChatId, {
                ...cached,
                messages: updatedMessages,
              })
            }
          }
          break

        case 'stream_end':
          // 流式输出结束
          {
            const endChatId = msg.chat_id as string

            if (endChatId === currentChatIdRef.current) {
              // 当前会话，更新状态
              const endingMessageId = streamingMessageIdRef.current
              streamingMessageIdRef.current = null
              if (endingMessageId) {
                setMessages((prev) => {
                  const lastIndex = prev.length - 1
                  if (lastIndex >= 0 && prev[lastIndex].id === endingMessageId) {
                    const updated = [...prev]
                    updated[lastIndex] = {
                      ...updated[lastIndex],
                      isStreaming: false,
                    }
                    return updated
                  }
                  return prev
                })
              }
            }

            // 同时更新缓存（无论是否是当前会话）
            const cached = sessionCacheMap.get(endChatId)
            if (cached && cached.streamingMessageId) {
              const updatedMessages = cached.messages.map((m) =>
                m.id === cached.streamingMessageId
                  ? { ...m, isStreaming: false }
                  : m
              )
              sessionCacheMap.set(endChatId, {
                messages: updatedMessages,
                isStreaming: false,
                streamingMessageId: null,
                isLoading: false,  // 流式结束，loading 也结束
              })
              notifyCacheUpdate()
            }
          }
          break

        case 'tool_use':
          // 工具使用
          if (msg.chat_id === currentChatIdRef.current) {
            optionsRef.current.onToolUse?.({
              toolName: msg.tool_name as string,
              toolId: msg.tool_id as string,
              toolInput: msg.tool_input as Record<string, unknown>,
            })
          }
          break

        case 'tool_result':
          // 工具执行结果
          if (msg.chat_id === currentChatIdRef.current) {
            optionsRef.current.onToolResult?.({
              toolId: msg.tool_id as string,
              content: msg.content as string | null,
              isError: msg.is_error as boolean,
            })
          }
          break

        case 'tool_history':
          // 历史工具调用记录
          if (msg.chat_id === currentChatIdRef.current) {
            const toolUses = msg.tool_uses as Array<{
              id: string
              tool_name: string
              tool_input: Record<string, unknown>
              result_content: string | null
              is_error: boolean
              timestamp: string
            }>
            optionsRef.current.onToolHistory?.(
              toolUses.map((tool) => ({
                id: tool.id,
                toolName: tool.tool_name,
                toolInput: tool.tool_input,
                resultContent: tool.result_content,
                isError: tool.is_error,
                timestamp: tool.timestamp,
              }))
            )
          }
          break

        case 'result':
          // 完成
          {
            const resultChatId = msg.chat_id as string

            if (resultChatId === currentChatIdRef.current) {
              optionsRef.current.onResult?.(
                msg.success as boolean,
                msg.cost as number | undefined,
                msg.duration as number | undefined
              )
            }

            // 同时更新缓存（无论是否是当前会话）
            const cached = sessionCacheMap.get(resultChatId)
            if (cached) {
              sessionCacheMap.set(resultChatId, {
                ...cached,
                isStreaming: false,
                streamingMessageId: null,
                isLoading: false,
              })
              notifyCacheUpdate()
            }
          }
          break

        case 'cancelled':
          // 会话被取消
          {
            const cancelledChatId = msg.chat_id as string

            if (cancelledChatId === currentChatIdRef.current) {
              streamingMessageIdRef.current = null
            }

            // 同时更新缓存（无论是否是当前会话）
            const cached = sessionCacheMap.get(cancelledChatId)
            if (cached) {
              sessionCacheMap.set(cancelledChatId, {
                ...cached,
                isStreaming: false,
                streamingMessageId: null,
                isLoading: false,
              })
              notifyCacheUpdate()
            }
          }
          break

        case 'history_cleared':
          // 历史记录已清除
          {
            const clearedChatId = msg.chat_id as string
            // 清除缓存
            sessionCacheMap.delete(clearedChatId)
            notifyCacheUpdate()

            if (clearedChatId === currentChatIdRef.current) {
              setMessages([])
              setIsClearing(false)
              streamingMessageIdRef.current = null
              // 通知工具历史也被清除
              optionsRef.current.onToolHistory?.([])
            }
          }
          break

        case 'error':
          // 错误时重置当前会话的状态
          if (currentChatIdRef.current) {
            updateSessionCache(currentChatIdRef.current, { isLoading: false, isStreaming: false })
          }
          optionsRef.current.onError?.(msg.error as string)
          break
      }
    }

    const handleStatus = (connected: boolean) => {
      setIsConnected(connected)
      if (connected && currentChatIdRef.current) {
        // 重连后重新订阅
        wsManager.send({
          type: 'subscribe',
          chat_id: currentChatIdRef.current,
        })
        // 注意：不需要在这里恢复 isLoading 状态
        // 因为后端会发送缓存的消息（如 stream_start, result 等）
        // 前端会根据这些消息自动更新状态
      }
      // 断开连接时不重置状态，等待重连
      // 如果重连成功，后端会发送缓存的消息
      // 如果重连失败（超时），用户可以手动刷新
      if (!connected) {
        optionsRef.current.onDisconnect?.()
      }
    }

    wsManager.addListener(handleMessage)
    wsManager.addStatusListener(handleStatus)

    return () => {
      wsManager.removeListener(handleMessage)
      wsManager.removeStatusListener(handleStatus)
    }
  }, [])

  /**
   * 准备创建新会话（在调用 onCreateChat 之前调用）
   * 设置跳过标志，防止 chatId 变化时 useEffect 清空消息
   */
  const prepareForNewChat = useCallback(() => {
    skipNextChatIdChangeRef.current = true
  }, [])

  /**
   * 订阅聊天
   * @param newChatId 新的聊天 ID
   * @param pendingMessage 待发送的消息（用于新创建会话时立即显示用户消息）
   */
  const subscribe = useCallback((newChatId: string, pendingMessage?: { content: string; images?: Array<{ id: string; base64: string; mimeType: string }> }) => {
    const oldChatId = currentChatIdRef.current

    // 如果切换到不同的会话，先保存当前会话的消息到缓存
    if (oldChatId && oldChatId !== newChatId) {
      const oldCache = sessionCacheMap.get(oldChatId)
      sessionCacheMap.set(oldChatId, {
        messages: messagesRef.current,
        isStreaming: oldCache?.isStreaming ?? false,
        streamingMessageId: streamingMessageIdRef.current,
        isLoading: oldCache?.isLoading ?? false,
      })
    }

    currentChatIdRef.current = newChatId

    // 如果有待发送的消息，立即显示用户消息并设置 loading 状态
    if (pendingMessage) {
      const userMessage: Message = {
        id: Date.now().toString(),
        role: 'user',
        content: pendingMessage.content.trim(),
        timestamp: new Date(),
        images: pendingMessage.images && pendingMessage.images.length > 0 ? pendingMessage.images : undefined,
      }
      setMessages([userMessage])
      updateSessionCache(newChatId, { isLoading: true, isStreaming: false, messages: [userMessage], streamingMessageId: null })
      streamingMessageIdRef.current = null
      pendingMessageRef.current = pendingMessage
      // 确保跳过标志被设置（备用）
      skipNextChatIdChangeRef.current = true
    } else {
      // 尝试从缓存恢复消息
      const cached = sessionCacheMap.get(newChatId)
      if (cached) {
        // 有缓存，直接恢复
        setMessages(cached.messages)
        streamingMessageIdRef.current = cached.streamingMessageId
        // 缓存中已经有正确的 isLoading/isStreaming 状态，不需要额外更新
      } else {
        // 没有缓存，清空消息等待 history 消息
        setMessages([])
        streamingMessageIdRef.current = null
        updateSessionCache(newChatId, { isLoading: false, isStreaming: false, messages: [], streamingMessageId: null })
      }
      pendingMessageRef.current = null
    }

    if (wsManager.isConnected) {
      wsManager.send({
        type: 'subscribe',
        chat_id: newChatId,
      })
    }
  }, [])

  /**
   * 发送消息
   * 注意：使用 currentChatIdRef.current 而不是 chatId，
   * 因为在新创建会话时，chatId prop 可能还没更新
   * @param skipLocalMessage 是否跳过添加本地消息（用于 subscribe 已经添加了消息的情况）
   */
  const sendMessage = useCallback(
    (content: string, images?: Array<{ id: string; base64: string; mimeType: string }>, skipLocalMessage?: boolean) => {
      // 使用 ref 中的 chatId，因为它是最新的（subscribe 会更新它）
      const activeChatId = currentChatIdRef.current
      if ((!content.trim() && (!images || images.length === 0)) || !activeChatId) return

      // 如果正在流式输出，重置状态
      // 注意：不需要发送 stop 消息，因为后端的 send_message 会自动中断前一个查询
      if (isStreaming) {
        streamingMessageIdRef.current = null
      }

      // 添加用户消息到本地（包含图片）- 除非 skipLocalMessage 为 true
      if (!skipLocalMessage) {
        const userMessage: Message = {
          id: Date.now().toString(),
          role: 'user',
          content: content.trim(),
          timestamp: new Date(),
          images: images && images.length > 0 ? images : undefined,
        }
        setMessages((prev) => [...prev, userMessage])
      }
      updateSessionCache(activeChatId, { isLoading: true, isStreaming: false })

      // 通过 WebSocket 发送
      const messageData: Record<string, unknown> = {
        type: 'chat',
        chat_id: activeChatId,
        content: content.trim(),
      }

      // 如果有图片，添加到消息中
      if (images && images.length > 0) {
        messageData.images = images.map((img) => ({
          base64: img.base64,
          media_type: img.mimeType,
        }))
      }

      const sent = wsManager.send(messageData)

      if (sent) {
        // 发送成功，清除待发送消息标记
        pendingMessageRef.current = null
      } else {
        updateSessionCache(activeChatId, { isLoading: false })
        pendingMessageRef.current = null
        optionsRef.current.onError?.('WebSocket 未连接')
      }
    },
    [isStreaming]
  )

  /**
   * 清空消息
   */
  const clearMessages = useCallback(() => {
    setMessages([])
  }, [])

  /**
   * 停止当前会话
   */
  const stopChat = useCallback(() => {
    if (!chatId) return

    const stopped = wsManager.stop(chatId)
    if (stopped) {
      updateSessionCache(chatId, { isLoading: false, isStreaming: false })
    }
  }, [chatId])

  /**
   * 清除聊天历史记录（重置 Claude Agent 会话）
   * 这会清除 Claude Agent 的对话上下文，使其"忘记"之前的对话
   */
  const clearHistory = useCallback(() => {
    if (!chatId) return

    setIsClearing(true)
    const sent = wsManager.send({
      type: 'clear_history',
      chat_id: chatId,
    })

    if (!sent) {
      setIsClearing(false)
      optionsRef.current.onError?.('WebSocket 未连接')
    }
  }, [chatId])

  /**
   * chatId 变化时重新订阅（仅处理普通切换，不处理新创建会话）
   */
  useEffect(() => {
    // 如果标记了跳过，说明是新创建会话的情况，由 ChatContainer 调用 subscribe 处理
    if (skipNextChatIdChangeRef.current) {
      skipNextChatIdChangeRef.current = false
      prevChatIdRef.current = chatId
      return
    }

    // 如果有待发送的消息，也跳过（备用检查）
    if (pendingMessageRef.current) {
      prevChatIdRef.current = chatId
      return
    }

    // 如果 currentChatIdRef 已经等于新的 chatId，说明已经通过 subscribe 订阅了，跳过
    // 这处理了 App.tsx 中 selectChat 延迟调用的情况
    if (chatId && currentChatIdRef.current === chatId) {
      prevChatIdRef.current = chatId
      return
    }

    if (chatId) {
      subscribe(chatId)
    } else {
      // chatId 为 null 时，清空消息和状态
      currentChatIdRef.current = null
      setMessages([])
      streamingMessageIdRef.current = null
      // 不需要更新缓存，因为没有 chatId
    }

    // 更新 prevChatIdRef
    prevChatIdRef.current = chatId
  }, [chatId, subscribe])

  return {
    messages,
    isLoading,
    isConnected,
    isStreaming,
    isClearing,
    sendMessage,
    clearMessages,
    clearHistory,
    stopChat,
    subscribe,
    prepareForNewChat,
  }
}
