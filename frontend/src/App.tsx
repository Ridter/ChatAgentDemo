/**
 * 主应用组件
 */

import { useCallback } from 'react'
import { ChatContainer } from '@/components/chat'
import { ChatSidebar } from '@/components/sidebar/ChatSidebar'
import { useChatList } from '@/hooks/useChatList'

function App() {
  const {
    chats,
    currentChatId,
    highlightMessageId,
    isLoading,
    selectChat,
    clearHighlight,
    createChat,
    deleteChat,
    updateChatTitle,
  } = useChatList()

  // 创建新会话（供 ChatContainer 在发送第一条消息时调用）
  // 不自动选中，由 ChatContainer 在 subscribe 后手动选中
  const createAndSelectChat = useCallback(async () => {
    const newChat = await createChat(undefined, false) // autoSelect = false
    if (newChat) {
      // 延迟选中，让 ChatContainer 有时间先 subscribe
      setTimeout(() => {
        selectChat(newChat.id)
      }, 100)
    }
    return newChat?.id || null
  }, [createChat, selectChat])

  // 新聊天按钮：立即创建会话并选中
  const handleNewChat = useCallback(async () => {
    const newChat = await createChat(undefined, true) // autoSelect = true
    if (newChat) {
      selectChat(newChat.id)
    }
  }, [createChat, selectChat])

  return (
    <div className="flex h-screen bg-background">
      {/* 侧边栏 */}
      <ChatSidebar
        chats={chats}
        currentChatId={currentChatId}
        isLoading={isLoading}
        onSelectChat={selectChat}
        onNewChat={handleNewChat}
        onDeleteChat={deleteChat}
        onUpdateTitle={updateChatTitle}
      />

      {/* 主内容区 */}
      <main className="relative flex-1 overflow-hidden">
        <ChatContainer
          chatId={currentChatId}
          highlightMessageId={highlightMessageId}
          onHighlightComplete={clearHighlight}
          onCreateChat={createAndSelectChat}
        />
      </main>
    </div>
  )
}

export default App
