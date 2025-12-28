/**
 * 聊天搜索对话框组件
 * 类似 ChatGPT 的搜索弹窗，支持搜索聊天标题和内容
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { Chat } from '@/services/api'

interface SearchResult {
  chat: Chat
  matchType: 'title' | 'content'
  matchedContent?: string
  messageId?: string
}

interface ChatSearchDialogProps {
  isOpen: boolean
  onClose: () => void
  onSelectChat: (chatId: string, messageId?: string) => void
  onCreateChat: () => void
  chats: Chat[]
}

// 按日期分组聊天
function groupChatsByDate(chats: Chat[]): { label: string; chats: Chat[] }[] {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
  const last7Days = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
  const last30Days = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)

  const groups: { label: string; chats: Chat[] }[] = [
    { label: '今天', chats: [] },
    { label: '昨天', chats: [] },
    { label: '前 7 天', chats: [] },
    { label: '前 30 天', chats: [] },
    { label: '更早', chats: [] },
  ]

  for (const chat of chats) {
    const chatDate = new Date(chat.updated_at)
    if (chatDate >= today) {
      groups[0].chats.push(chat)
    } else if (chatDate >= yesterday) {
      groups[1].chats.push(chat)
    } else if (chatDate >= last7Days) {
      groups[2].chats.push(chat)
    } else if (chatDate >= last30Days) {
      groups[3].chats.push(chat)
    } else {
      groups[4].chats.push(chat)
    }
  }

  return groups.filter((g) => g.chats.length > 0)
}

export function ChatSearchDialog({
  isOpen,
  onClose,
  onSelectChat,
  onCreateChat,
  chats,
}: ChatSearchDialogProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  // 打开时聚焦输入框
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100)
    } else {
      setSearchQuery('')
      setSearchResults([])
    }
  }, [isOpen])

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, onClose])

  // ESC 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  // 搜索逻辑
  const performSearch = useCallback(
    async (query: string) => {
      if (!query.trim()) {
        setSearchResults([])
        return
      }

      setIsSearching(true)

      try {
        // 先在本地搜索标题
        const titleMatches: SearchResult[] = chats
          .filter((chat) =>
            chat.title.toLowerCase().includes(query.toLowerCase())
          )
          .map((chat) => ({ chat, matchType: 'title' as const }))

        // 调用后端 API 搜索内容
        const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'
        const response = await fetch(
          `${API_BASE}/api/chats/search?q=${encodeURIComponent(query)}`
        )

        if (response.ok) {
          const contentResults: { chat_id: string; message_id: string; matched_content: string }[] =
            await response.json()

          // 合并结果，去重
          const contentMatches: SearchResult[] = contentResults
            .filter((r) => !titleMatches.some((t) => t.chat.id === r.chat_id))
            .map((r) => {
              const chat = chats.find((c) => c.id === r.chat_id)
              return chat
                ? {
                    chat,
                    matchType: 'content' as const,
                    matchedContent: r.matched_content,
                    messageId: r.message_id,
                  }
                : null
            })
            .filter(Boolean) as SearchResult[]

          setSearchResults([...titleMatches, ...contentMatches])
        } else {
          // 如果 API 失败，只显示标题匹配
          setSearchResults(titleMatches)
        }
      } catch {
        // 网络错误，只显示标题匹配
        const titleMatches: SearchResult[] = chats
          .filter((chat) =>
            chat.title.toLowerCase().includes(query.toLowerCase())
          )
          .map((chat) => ({ chat, matchType: 'title' as const }))
        setSearchResults(titleMatches)
      } finally {
        setIsSearching(false)
      }
    },
    [chats]
  )

  // 防抖搜索
  useEffect(() => {
    const timer = setTimeout(() => {
      performSearch(searchQuery)
    }, 300)

    return () => clearTimeout(timer)
  }, [searchQuery, performSearch])

  const handleSelectChat = (chatId: string, messageId?: string) => {
    onSelectChat(chatId, messageId)
    onClose()
  }

  const handleCreateChat = () => {
    onCreateChat()
    onClose()
  }

  if (!isOpen) return null

  const groupedChats = groupChatsByDate(chats)
  const showSearchResults = searchQuery.trim().length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        ref={dialogRef}
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl"
      >
        {/* 搜索输入框 */}
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <SearchIcon className="h-6 w-6 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索聊天..."
            className="flex-1 bg-transparent text-lg outline-none placeholder:text-muted-foreground"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <XIcon className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* 新聊天按钮 */}
        <div className="border-b border-border px-2 py-2">
          <button
            onClick={handleCreateChat}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-accent"
          >
            <PenIcon className="h-5 w-5 text-muted-foreground" />
            <span>新聊天</span>
          </button>
        </div>

        {/* 聊天列表 */}
        <ScrollArea className="max-h-[60vh]">
          <div className="p-2">
            {isSearching ? (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                搜索中...
              </div>
            ) : showSearchResults ? (
              searchResults.length > 0 ? (
                <div className="space-y-1">
                  {searchResults.map((result) => (
                    <ChatSearchItem
                      key={result.messageId || result.chat.id}
                      chat={result.chat}
                      matchType={result.matchType}
                      matchedContent={result.matchedContent}
                      searchQuery={searchQuery}
                      onClick={() => handleSelectChat(result.chat.id, result.messageId)}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    未找到匹配的聊天
                  </p>
                </div>
              )
            ) : chats.length > 0 ? (
              groupedChats.map((group) => (
                <div key={group.label} className="mb-2">
                  <div className="px-3 py-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      {group.label}
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {group.chats.map((chat) => (
                      <ChatSearchItem
                        key={chat.id}
                        chat={chat}
                        onClick={() => handleSelectChat(chat.id)}
                      />
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <MessageIcon className="mb-3 h-10 w-10 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">暂无聊天</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

interface ChatSearchItemProps {
  chat: Chat
  matchType?: 'title' | 'content'
  matchedContent?: string
  searchQuery?: string
  onClick: () => void
}

function ChatSearchItem({
  chat,
  matchType,
  matchedContent,
  searchQuery,
  onClick,
}: ChatSearchItemProps) {
  // 高亮匹配文本
  const highlightText = (text: string, query: string) => {
    if (!query) return text
    const parts = text.split(new RegExp(`(${query})`, 'gi'))
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase() ? (
        <mark key={i} className="bg-yellow-500/30 text-foreground">
          {part}
        </mark>
      ) : (
        part
      )
    )
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent'
      )}
    >
      <MessageIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          {searchQuery && matchType === 'title'
            ? highlightText(chat.title, searchQuery)
            : chat.title}
        </p>
        {matchType === 'content' && matchedContent && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {searchQuery
              ? highlightText(matchedContent, searchQuery)
              : matchedContent}
          </p>
        )}
      </div>
    </button>
  )
}

// Icons
function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  )
}

function PenIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 20h9" />
      <path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z" />
    </svg>
  )
}

function MessageIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}
