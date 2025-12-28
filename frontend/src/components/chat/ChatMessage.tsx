import { useState, forwardRef } from 'react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import type { Message } from '@/hooks/useChat'
import { X } from 'lucide-react'
import { MarkdownRenderer } from './MarkdownRenderer'

interface ChatMessageProps {
  message: Message
}

export const ChatMessage = forwardRef<HTMLDivElement, ChatMessageProps>(
  function ChatMessage({ message }, ref) {
    const isUser = message.role === 'user'
    const [expandedImage, setExpandedImage] = useState<string | null>(null)

    return (
      <>
        <div
          ref={ref}
          className={cn(
            'flex gap-3 p-4 transition-colors duration-300',
            isUser ? 'flex-row-reverse' : 'flex-row'
          )}
        >
        <Avatar className="h-8 w-8 shrink-0">
          <AvatarFallback
            className={cn(
              'text-sm font-medium',
              isUser
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-secondary-foreground'
            )}
          >
            {isUser ? 'U' : 'AI'}
          </AvatarFallback>
        </Avatar>

        <div
          className={cn(
            'rounded-2xl px-4 py-2',
            isUser
              ? 'max-w-[80%] bg-primary text-primary-foreground'
              : 'flex-1 bg-muted text-foreground'
          )}
        >
          {/* 显示图片 */}
          {message.images && message.images.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {message.images.map((img) => {
                const imageSrc = `data:${img.mimeType};base64,${img.base64}`
                return (
                  <img
                    key={img.id}
                    src={imageSrc}
                    alt="用户上传的图片"
                    className="max-h-48 max-w-full cursor-pointer rounded-lg border border-white/20 bg-white object-contain transition-transform hover:scale-[1.02]"
                    onClick={() => setExpandedImage(imageSrc)}
                  />
                )
              })}
            </div>
          )}
          {/* 显示文本内容 */}
          {(message.content || !message.images?.length) && (
            <div className="text-sm leading-relaxed">
              {message.content ? (
                isUser ? (
                  <p className="whitespace-pre-wrap">{message.content}</p>
                ) : (
                  <MarkdownRenderer content={message.content} isStreaming={message.isStreaming} />
                )
              ) : (
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-current" />
                </span>
              )}
            </div>
          )}
        </div>
      </div>

        {/* 图片放大弹窗 */}
        {expandedImage && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
            onClick={() => setExpandedImage(null)}
          >
            <button
              className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
              onClick={() => setExpandedImage(null)}
            >
              <X className="h-6 w-6" />
            </button>
            <img
              src={expandedImage}
              alt="放大查看"
              className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
      </>
    )
  }
)
