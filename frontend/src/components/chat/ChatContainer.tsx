/**
 * 聊天容器组件
 * 显示消息列表和输入框，工具调用集成在消息流中
 */

import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { ChatMessage } from './ChatMessage'
import { ChatInput } from './ChatInput'
import { ToolUseCard } from './ToolUseCard'
import { useChat } from '@/hooks/useChat'

// 工具调用信息
interface ToolUseInfo {
  id: string
  toolName: string
  toolInput: Record<string, unknown>
  timestamp: Date
  result?: {
    content: string | null
    isError: boolean
  }
}

// 流项目类型：消息或工具调用
type StreamItem =
  | { type: 'message'; data: { id: string; role: 'user' | 'assistant'; content: string; timestamp: Date } }
  | { type: 'tool'; data: ToolUseInfo }

interface ChatContainerProps {
  chatId: string | null
  highlightMessageId?: string | null
  onHighlightComplete?: () => void
  onCreateChat?: () => Promise<string | null>
}

export function ChatContainer({ chatId, highlightMessageId, onHighlightComplete, onCreateChat }: ChatContainerProps) {
  const [toolUses, setToolUses] = useState<Map<string, ToolUseInfo>>(new Map())
  const [toolOrder, setToolOrder] = useState<string[]>([]) // 保持工具调用顺序
  // 本地临时消息（用于在创建会话过程中立即显示用户输入，防止页面闪烁）
  const [localMessage, setLocalMessage] = useState<{ content: string; images?: Array<{ id: string; base64: string; mimeType: string }> } | null>(null)
  // 是否正在创建会话（用于防止页面闪烁）- 使用 state 触发重渲染
  const [isCreatingChat, setIsCreatingChat] = useState(false)
  // 使用 ref 同步跟踪创建状态（ref 更新是同步的，不会有延迟）
  const isCreatingChatRef = useRef(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const { messages, isLoading, isConnected, isStreaming, isClearing, sendMessage, clearHistory, stopChat, subscribe, prepareForNewChat } = useChat({
    chatId,
    onError: (error) => {
      console.error('Chat error:', error)
    },
    onToolUse: (info) => {
      console.log('Tool use:', info.toolName, info.toolInput)
      const toolInfo: ToolUseInfo = {
        id: info.toolId,
        toolName: info.toolName,
        toolInput: info.toolInput,
        timestamp: new Date(),
      }
      setToolUses((prev) => {
        const newMap = new Map(prev)
        newMap.set(info.toolId, toolInfo)
        return newMap
      })
      setToolOrder((prev) => {
        if (!prev.includes(info.toolId)) {
          return [...prev, info.toolId]
        }
        return prev
      })
    },
    onToolResult: (info) => {
      console.log('Tool result:', info.toolId, info.isError ? 'error' : 'success')
      setToolUses((prev) => {
        const newMap = new Map(prev)
        const existing = newMap.get(info.toolId)
        if (existing) {
          newMap.set(info.toolId, {
            ...existing,
            result: {
              content: info.content,
              isError: info.isError,
            },
          })
        }
        return newMap
      })
    },
    onResult: (success, cost, duration) => {
      console.log('Result:', { success, cost, duration })
    },
    onToolHistory: (tools) => {
      console.log('Tool history loaded:', tools.length, 'items')
      // 恢复历史工具调用记录
      const newToolUses = new Map<string, ToolUseInfo>()
      const newToolOrder: string[] = []
      for (const tool of tools) {
        const toolInfo: ToolUseInfo = {
          id: tool.id,
          toolName: tool.toolName,
          toolInput: tool.toolInput,
          timestamp: new Date(tool.timestamp),
          result: tool.resultContent !== null ? {
            content: tool.resultContent,
            isError: tool.isError,
          } : undefined,
        }
        newToolUses.set(tool.id, toolInfo)
        newToolOrder.push(tool.id)
      }
      setToolUses(newToolUses)
      setToolOrder(newToolOrder)
    },
    onDisconnect: () => {
      // WebSocket 断开时，将所有未完成的工具调用标记为失败
      console.log('WebSocket disconnected, marking pending tools as failed')
      setToolUses((prev) => {
        const newMap = new Map(prev)
        let hasChanges = false
        for (const [id, tool] of newMap) {
          if (!tool.result) {
            // 没有结果的工具调用，标记为连接断开错误
            newMap.set(id, {
              ...tool,
              result: {
                content: '连接已断开，工具执行被中断',
                isError: true,
              },
            })
            hasChanges = true
          }
        }
        return hasChanges ? newMap : prev
      })
    },
  })

  // 构建流项目列表：将消息和工具调用按时间顺序合并
  const streamItems = useMemo<StreamItem[]>(() => {
    const items: StreamItem[] = []
    let toolIndex = 0
    const toolArray = toolOrder.map((id) => toolUses.get(id)).filter(Boolean) as ToolUseInfo[]

    for (const message of messages) {
      // 在用户消息之后、AI消息之前插入工具调用
      if (message.role === 'assistant') {
        // 插入在此消息之前发生的工具调用
        while (toolIndex < toolArray.length && toolArray[toolIndex].timestamp <= message.timestamp) {
          items.push({ type: 'tool', data: toolArray[toolIndex] })
          toolIndex++
        }
      }
      items.push({ type: 'message', data: message })
    }

    // 添加剩余的工具调用（正在进行中的）
    while (toolIndex < toolArray.length) {
      items.push({ type: 'tool', data: toolArray[toolIndex] })
      toolIndex++
    }

    return items
  }, [messages, toolUses, toolOrder])

  // 是否需要在渲染后滚动到底部
  const needsScrollRef = useRef(false)
  // 上一次消息数量，用于检测新消息
  const prevMessageCountRef = useRef(0)
  // 上一次工具数量，用于检测新工具调用
  const prevToolCountRef = useRef(0)

  // 自动滚动到底部
  const scrollToBottom = useCallback(() => {
    // 方法1：尝试使用 ScrollArea 的 viewport
    const viewport = scrollAreaRef.current?.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement | null

    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight
      return true
    }

    // 方法2：备用方案 - 使用 messagesEndRef
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'instant', block: 'end' })
      return true
    }

    return false
  }, [])

  // 检测消息变化，标记需要滚动
  useEffect(() => {
    const currentCount = messages.length
    const prevCount = prevMessageCountRef.current

    // 检测是否是历史消息加载（从 0 变为多条消息）
    const isHistoryLoad = prevCount === 0 && currentCount > 0
    // 检测是否有新消息添加（用户发送或 AI 回复开始）
    const isNewMessage = currentCount > prevCount && prevCount > 0

    if (isHistoryLoad || isNewMessage) {
      needsScrollRef.current = true
    }

    prevMessageCountRef.current = currentCount
  }, [messages])

  // 检测工具调用变化，标记需要滚动
  useEffect(() => {
    const currentCount = toolOrder.length
    const prevCount = prevToolCountRef.current

    // 检测是否有新工具调用
    if (currentCount > prevCount) {
      needsScrollRef.current = true
    }

    prevToolCountRef.current = currentCount
  }, [toolOrder])

  // 当需要滚动且有消息时，执行滚动（在渲染后）
  useEffect(() => {
    if (needsScrollRef.current && streamItems.length > 0) {
      // 立即标记为已处理，避免后续操作触发重复滚动
      needsScrollRef.current = false

      // 使用多次延迟确保滚动成功（Markdown 渲染需要时间）
      const tryScroll = () => scrollToBottom()

      // 立即尝试一次
      tryScroll()

      // 延迟多次尝试
      const timer1 = setTimeout(tryScroll, 100)
      const timer2 = setTimeout(tryScroll, 300)
      const timer3 = setTimeout(tryScroll, 600)
      const timer4 = setTimeout(tryScroll, 1000)

      return () => {
        clearTimeout(timer1)
        clearTimeout(timer2)
        clearTimeout(timer3)
        clearTimeout(timer4)
      }
    }
  }, [streamItems.length, scrollToBottom])

  // 流式响应时平滑滚动
  useEffect(() => {
    if (isStreaming) {
      scrollToBottom()
    }
  }, [streamItems, isStreaming, scrollToBottom])

  // 切换聊天时清空工具调用记录并重置状态
  useEffect(() => {
    setToolUses(new Map())
    setToolOrder([])
    prevMessageCountRef.current = 0
    prevToolCountRef.current = 0
    needsScrollRef.current = false
  }, [chatId])

  // 滚动到高亮消息
  useEffect(() => {
    if (highlightMessageId && messages.length > 0) {
      // 等待消息渲染完成后滚动
      const timer = setTimeout(() => {
        const messageEl = messageRefs.current.get(highlightMessageId)
        if (messageEl) {
          messageEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
          // 添加高亮动画
          messageEl.classList.add('highlight-flash')
          // 动画结束后清除高亮状态
          setTimeout(() => {
            messageEl.classList.remove('highlight-flash')
            onHighlightComplete?.()
          }, 2000)
        }
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [highlightMessageId, messages, onHighlightComplete])

  // 处理清除历史记录（必须在条件返回之前定义，遵循 Hooks 规则）
  const handleClearHistory = useCallback(() => {
    if (window.confirm('确定要清除所有对话历史吗？这将使 AI 忘记之前的对话内容。')) {
      clearHistory()
      // 同时清除本地工具调用记录
      setToolUses(new Map())
      setToolOrder([])
    }
  }, [clearHistory])

  // 处理发送消息：如果没有 chatId，先创建会话再发送
  const handleSendMessage = useCallback(async (content: string, images?: Array<{ id: string; base64: string; mimeType: string }>) => {
    if (!chatId) {
      // 没有会话，先创建一个
      if (onCreateChat) {
        // 立即设置 ref（同步），防止在 state 更新前的重渲染中闪烁
        isCreatingChatRef.current = true
        // 立即显示本地消息，防止页面闪烁
        setLocalMessage({ content, images })
        setIsCreatingChat(true)

        // 在创建会话之前，设置跳过标志，防止 chatId 变化时 useEffect 清空消息
        prepareForNewChat()

        // 创建会话
        const newChatId = await onCreateChat()
        if (newChatId) {
          // 使用 subscribe 订阅新会话，同时传入待发送的消息
          subscribe(newChatId, { content, images })
          // 延迟发送消息，确保订阅完成
          // 传入 skipLocalMessage: true，因为 subscribe 已经添加了用户消息
          setTimeout(() => {
            sendMessage(content, images, true) // skipLocalMessage = true
            // 清除本地消息状态
            setLocalMessage(null)
            setIsCreatingChat(false)
            isCreatingChatRef.current = false
          }, 50)
        } else {
          // 创建失败，清除本地消息
          setLocalMessage(null)
          setIsCreatingChat(false)
          isCreatingChatRef.current = false
        }
      }
      return
    }
    // 有会话，直接发送
    sendMessage(content, images)
  }, [chatId, onCreateChat, sendMessage, subscribe, prepareForNewChat])

  // 判断是否应该显示消息视图（而不是空状态）
  // 包括：有消息、有本地临时消息、或正在创建会话
  // 同时检查 ref（同步）和 state，确保在任何渲染时机都不会闪烁
  const hasMessages = streamItems.length > 0 || localMessage !== null || isCreatingChat || isCreatingChatRef.current

  // 空状态：输入框居中，现代设计（只有没有消息且没有本地临时消息时才显示）
  if (!hasMessages) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-4">
        <div className="w-full max-w-2xl">
          {/* 欢迎标题 */}
          <div className="mb-10 text-center">
            <h1 className="mb-2 text-3xl font-semibold tracking-tight text-foreground">
              有什么可以帮你的？
            </h1>
            <p className="text-sm text-muted-foreground">
              开始对话，探索 AI 的无限可能
            </p>
          </div>

          {/* 输入框 */}
          <ChatInput
            onSend={handleSendMessage}
            onStop={stopChat}
            disabled={isLoading}
            isLoading={isLoading || isStreaming}
            placeholder={
              isLoading
                ? 'AI 正在思考...'
                : '发送消息...'
            }
          />

          {/* 提示文字 */}
          <p className="mt-4 text-center text-xs text-muted-foreground/60">
            按 Enter 发送，Shift + Enter 换行
          </p>
        </div>
      </div>
    )
  }

  // 有消息：消息在中间区域，输入框固定在底部
  return (
    <div className="relative flex h-full flex-col">
      {/* 顶部操作栏 */}
      <div className="flex items-center justify-end border-b border-border/40 px-4 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClearHistory}
          disabled={isClearing || isLoading || isStreaming}
          className="text-muted-foreground hover:text-destructive"
        >
          {isClearing ? (
            <>
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>清除中...</span>
            </>
          ) : (
            <>
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span>清除历史</span>
            </>
          )}
        </Button>
      </div>

      {/* 消息列表 - 为底部固定输入框留出空间 */}
      <div className="flex-1 overflow-hidden" ref={scrollAreaRef}>
        <ScrollArea className="h-full">
          <div className="mx-auto max-w-4xl px-4 pb-28">
            <div className="flex flex-col pb-4 pt-8">
              {/* 本地临时消息（创建会话过程中显示） */}
              {localMessage && streamItems.length === 0 && (
                <ChatMessage
                  key="local-message"
                  message={{
                    id: 'local-message',
                    role: 'user',
                    content: localMessage.content,
                    timestamp: new Date(),
                    images: localMessage.images,
                  }}
                />
              )}
              {streamItems.map((item) => {
                if (item.type === 'message') {
                  return (
                    <ChatMessage
                      key={item.data.id}
                      ref={(el) => {
                        if (el) {
                          messageRefs.current.set(item.data.id, el)
                        } else {
                          messageRefs.current.delete(item.data.id)
                        }
                      }}
                      message={item.data}
                    />
                  )
                } else {
                  return (
                    <div key={item.data.id} className="flex gap-3 px-4 py-0.5">
                      {/* 占位符，与 AI 头像对齐 */}
                      <div className="h-8 w-8 shrink-0" />
                      <ToolUseCard toolUse={item.data} />
                    </div>
                  )
                }
              })}
              {/* 滚动锚点 */}
              <div ref={messagesEndRef} />
            </div>
          </div>
        </ScrollArea>
      </div>

      {/* 输入框 - 固定在底部 */}
      <div className="absolute bottom-0 left-0 right-0 border-t border-border/40 bg-gradient-to-t from-background to-background/80 px-4 pb-6 pt-4">
        <div className="mx-auto max-w-3xl">
          <ChatInput
            onSend={handleSendMessage}
            onStop={stopChat}
            disabled={isLoading || !isConnected}
            isLoading={isLoading || isStreaming}
            placeholder={
              !isConnected
                ? '正在连接...'
                : isLoading
                  ? 'AI 正在思考...'
                  : '发送消息...'
            }
          />
        </div>
      </div>
    </div>
  )
}
