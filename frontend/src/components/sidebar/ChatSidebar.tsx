/**
 * 聊天侧边栏组件
 * 支持折叠/展开、拖拽调整宽度
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { useConnection } from '@/hooks/useConnection'
import { useTheme } from '@/hooks/useTheme'
import { ChatSearchDialog } from './ChatSearchDialog'
import type { Chat } from '@/services/api'

interface ChatSidebarProps {
  chats: Chat[]
  currentChatId: string | null
  isLoading: boolean
  onSelectChat: (chatId: string) => void
  onNewChat: () => void
  onDeleteChat: (chatId: string) => void
  onUpdateTitle: (chatId: string, title: string) => Promise<boolean>
}

const MIN_WIDTH = 180
const MAX_WIDTH = 400
const DEFAULT_WIDTH = 220

export function ChatSidebar({
  chats,
  currentChatId,
  isLoading,
  onSelectChat,
  onNewChat,
  onDeleteChat,
  onUpdateTitle,
}: ChatSidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem('sidebar-width')
    const savedWidth = saved ? parseInt(saved, 10) : DEFAULT_WIDTH
    // 重置为默认值
    if (savedWidth !== DEFAULT_WIDTH) {
      localStorage.setItem('sidebar-width', DEFAULT_WIDTH.toString())
      return DEFAULT_WIDTH
    }
    return savedWidth
  })
  const [isResizing, setIsResizing] = useState(false)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const sidebarRef = useRef<HTMLDivElement>(null)
  const { isConnected } = useConnection()
  const { isDark, toggleTheme } = useTheme()

  useEffect(() => {
    if (!isCollapsed) {
      localStorage.setItem('sidebar-width', width.toString())
    }
  }, [width, isCollapsed])

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return
      const newWidth = e.clientX
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setWidth(newWidth)
      }
    }

    const handleMouseUp = () => setIsResizing(false)

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing])

  const toggleCollapse = useCallback(() => setIsCollapsed((prev) => !prev), [])

  return (
    <>
      {/* 折叠时的迷你工具栏 */}
      {isCollapsed && (
        <div className="flex h-full w-14 flex-col bg-sidebar text-sidebar-foreground">
          {/* 顶部功能按钮 */}
          <div className="flex flex-col items-center gap-1 p-2">
            {/* 展开/折叠按钮 */}
            <button
              onClick={toggleCollapse}
              className="group/btn relative flex h-10 w-10 items-center justify-center rounded-xl border border-sidebar-border bg-sidebar-accent/50 transition-colors hover:bg-sidebar-accent"
              title="打开边栏"
            >
              <SidebarOpenIcon className="h-5 w-5" />
              {/* 悬停提示 */}
              <span className="pointer-events-none absolute left-full ml-2 whitespace-nowrap rounded-md bg-popover px-2 py-1 text-xs text-popover-foreground opacity-0 shadow-md transition-opacity group-hover/btn:opacity-100">
                打开边栏
              </span>
            </button>

            {/* 新建聊天 */}
            <button
              onClick={onNewChat}
              disabled={isLoading}
              className="group/btn relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors hover:bg-sidebar-accent disabled:opacity-50"
              title="新聊天"
            >
              <PenIcon className="h-5 w-5" />
              <span className="pointer-events-none absolute left-full ml-2 whitespace-nowrap rounded-md bg-popover px-2 py-1 text-xs text-popover-foreground opacity-0 shadow-md transition-opacity group-hover/btn:opacity-100">
                新聊天
              </span>
            </button>

            {/* 搜索聊天 */}
            <button
              onClick={() => setIsSearchOpen(true)}
              className="group/btn relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors hover:bg-sidebar-accent"
              title="搜索聊天"
            >
              <SearchIcon className="h-5 w-5" />
              <span className="pointer-events-none absolute left-full ml-2 whitespace-nowrap rounded-md bg-popover px-2 py-1 text-xs text-popover-foreground opacity-0 shadow-md transition-opacity group-hover/btn:opacity-100">
                搜索聊天
              </span>
            </button>
          </div>

          {/* 聊天列表 - 显示首字符 */}
          <div className="flex-1 overflow-y-auto px-2 py-1">
            {chats.map((chat) => {
              const firstChar = chat.title.trim().charAt(0).toUpperCase() || '?'
              return (
                <button
                  key={chat.id}
                  onClick={() => onSelectChat(chat.id)}
                  className={cn(
                    'group/btn relative mb-1 flex h-10 w-10 items-center justify-center rounded-xl text-sm font-medium transition-colors',
                    chat.id === currentChatId
                      ? 'bg-sidebar-accent text-sidebar-foreground'
                      : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                  )}
                  title={chat.title}
                >
                  {firstChar}
                  <span className="pointer-events-none absolute left-full ml-2 max-w-48 truncate whitespace-nowrap rounded-md bg-popover px-2 py-1 text-xs text-popover-foreground opacity-0 shadow-md transition-opacity group-hover/btn:opacity-100">
                    {chat.title}
                  </span>
                </button>
              )
            })}
          </div>

          {/* 底部状态 */}
          <div className="flex flex-col items-center gap-1 border-t border-sidebar-border p-2">
            <div
              className="group/btn relative flex h-8 w-8 items-center justify-center"
              title={isConnected ? '已连接' : '未连接'}
            >
              <span
                className={cn(
                  'h-2.5 w-2.5 rounded-full',
                  isConnected ? 'bg-green-500' : 'bg-red-500'
                )}
              />
              <span className="pointer-events-none absolute left-full ml-2 whitespace-nowrap rounded-md bg-popover px-2 py-1 text-xs text-popover-foreground opacity-0 shadow-md transition-opacity group-hover/btn:opacity-100">
                {isConnected ? '已连接' : '未连接'}
              </span>
            </div>
            <button
              onClick={toggleTheme}
              className="group/btn relative flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
              title={isDark ? '切换到亮色模式' : '切换到暗色模式'}
            >
              {isDark ? <SunIcon className="h-5 w-5" /> : <MoonIcon className="h-5 w-5" />}
              <span className="pointer-events-none absolute left-full ml-2 whitespace-nowrap rounded-md bg-popover px-2 py-1 text-xs text-popover-foreground opacity-0 shadow-md transition-opacity group-hover/btn:opacity-100">
                {isDark ? '亮色模式' : '暗色模式'}
              </span>
            </button>
          </div>
        </div>
      )}

      <div
        ref={sidebarRef}
        className={cn(
          'group/sidebar relative flex h-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-300 ease-in-out',
          isCollapsed ? 'w-0 overflow-hidden border-r-0' : ''
        )}
        style={{ width: isCollapsed ? 0 : width }}
      >
        <div className="flex h-full flex-col" style={{ width: width }}>
          {/* 第一行：Logo + 折叠按钮 */}
          <div className="flex items-center justify-between p-2">
            {/* 左侧：Logo */}
            <div className="flex h-10 items-center px-1">
              <span className="text-lg font-black italic tracking-tighter">ChatAgent</span>
            </div>

            {/* 右侧：折叠按钮 */}
            <button
              onClick={toggleCollapse}
              className="flex h-10 w-10 items-center justify-center rounded-xl transition-colors hover:bg-sidebar-accent"
              title="关闭边栏"
            >
              <SidebarCloseIcon className="h-5 w-5" />
            </button>
          </div>

          {/* 第二行：新聊天 */}
          <div className="px-2">
            <button
              onClick={onNewChat}
              disabled={isLoading}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-sidebar-accent disabled:opacity-50"
            >
              <PenIcon className="h-5 w-5" />
              <span>新聊天</span>
            </button>
          </div>

          {/* 第三行：搜索聊天 */}
          <div className="px-2">
            <button
              onClick={() => setIsSearchOpen(true)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-sidebar-accent"
            >
              <SearchIcon className="h-5 w-5" />
              <span>搜索聊天</span>
            </button>
          </div>

          {/* 聊天列表 */}
          <div className="flex-1 overflow-y-auto px-2 pb-2">
            {chats.length > 0 && (
              <div className="mb-1 px-3 py-2">
                <span className="text-xs font-medium text-muted-foreground">你的聊天</span>
              </div>
            )}

            {isLoading && chats.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                加载中...
              </div>
            ) : chats.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <MessageIcon className="mb-3 h-10 w-10 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">暂无聊天</p>
              </div>
            ) : (
              <div className="space-y-0.5">
                {chats.map((chat) => (
                  <ChatItem
                    key={chat.id}
                    chat={chat}
                    isActive={chat.id === currentChatId}
                    onSelect={() => onSelectChat(chat.id)}
                    onDelete={() => onDeleteChat(chat.id)}
                    onUpdateTitle={(title) => onUpdateTitle(chat.id, title)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* 底部状态栏 */}
          <div className="border-t border-sidebar-border p-2">
            <div className="flex items-center justify-between px-2 py-1.5">
              {/* 连接状态 */}
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'h-2 w-2 rounded-full',
                    isConnected ? 'bg-green-500' : 'bg-red-500'
                  )}
                />
                <span className="text-xs text-muted-foreground">
                  {isConnected ? '已连接' : '未连接'}
                </span>
              </div>

              {/* 主题切换 */}
              <button
                onClick={toggleTheme}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                title={isDark ? '切换到亮色模式' : '切换到暗色模式'}
              >
                {isDark ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>

        {/* 拖拽手柄 */}
        {!isCollapsed && (
          <div
            className={cn(
              'absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize opacity-0 transition-opacity hover:opacity-100 group-hover/sidebar:opacity-50',
              isResizing && 'opacity-100 bg-primary'
            )}
            onMouseDown={startResizing}
          >
            <div className="absolute inset-y-0 -left-1 -right-1" />
          </div>
        )}
      </div>

      {/* 搜索对话框 */}
      <ChatSearchDialog
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSelectChat={onSelectChat}
        onCreateChat={onNewChat}
        chats={chats}
      />
    </>
  )
}

interface ChatItemProps {
  chat: Chat
  isActive: boolean
  onSelect: () => void
  onDelete: () => void
  onUpdateTitle: (title: string) => Promise<boolean>
}

function ChatItem({ chat, isActive, onSelect, onDelete, onUpdateTitle }: ChatItemProps) {
  const [showActions, setShowActions] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(chat.title)
  const inputRef = useRef<HTMLInputElement>(null)

  // 进入编辑模式时聚焦输入框
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    setEditTitle(chat.title)
    setIsEditing(true)
  }

  const handleSaveTitle = async () => {
    const trimmedTitle = editTitle.trim()
    if (trimmedTitle && trimmedTitle !== chat.title) {
      await onUpdateTitle(trimmedTitle)
    }
    setIsEditing(false)
  }

  const handleCancelEdit = () => {
    setEditTitle(chat.title)
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSaveTitle()
    } else if (e.key === 'Escape') {
      handleCancelEdit()
    }
  }

  return (
    <div
      className={cn(
        'group relative flex cursor-pointer items-center rounded-lg px-3 py-2 transition-colors',
        isActive ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/50'
      )}
      onClick={isEditing ? undefined : onSelect}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <MessageIcon className="mr-2.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={handleSaveTitle}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-transparent text-sm outline-none ring-1 ring-primary rounded px-1"
          />
        ) : (
          <p className="truncate text-sm">{chat.title}</p>
        )}
      </div>

      {!isEditing && showActions && (
        <div
          className="absolute right-1 flex items-center gap-0.5"
        >
          <div className={cn(
            'absolute right-full h-full w-8 bg-gradient-to-l to-transparent',
            isActive ? 'from-sidebar-accent' : 'from-sidebar'
          )} />

          <button
            onClick={handleStartEdit}
            className="relative rounded p-1.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
            title="编辑标题"
          >
            <EditIcon className="h-4 w-4" />
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            className="relative rounded p-1.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-destructive"
            title="删除"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  )
}

function PenIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 20h9" />
      <path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z" />
    </svg>
  )
}

function MessageIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  )
}

function EditIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  )
}

function SunIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  )
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  )
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}

function SidebarOpenIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
      <path d="m14 9 3 3-3 3" />
    </svg>
  )
}

function SidebarCloseIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
      <path d="m16 15-3-3 3-3" />
    </svg>
  )
}
