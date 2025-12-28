import { useState, useRef, useEffect, type KeyboardEvent, type ClipboardEvent, type ChangeEvent } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { X, Square, ArrowUp, Image } from 'lucide-react'

interface ImageData {
  id: string
  base64: string
  mimeType: string
  preview: string
}

interface ChatInputProps {
  onSend: (message: string, images?: ImageData[]) => void
  onStop?: () => void
  disabled?: boolean
  isLoading?: boolean
  placeholder?: string
}

export function ChatInput({
  onSend,
  onStop,
  disabled = false,
  isLoading = false,
  placeholder = '输入消息...',
}: ChatInputProps) {
  const [input, setInput] = useState('')
  const [images, setImages] = useState<ImageData[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = () => {
    if ((input.trim() || images.length > 0) && !disabled) {
      onSend(input, images.length > 0 ? images : undefined)
      setInput('')
      setImages([])
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
    // ESC 键停止生成
    if (e.key === 'Escape' && isLoading && onStop) {
      e.preventDefault()
      onStop()
    }
  }

  // 全局 ESC 快捷键监听（即使输入框未聚焦也能触发）
  useEffect(() => {
    const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && isLoading && onStop) {
        e.preventDefault()
        onStop()
      }
    }

    if (isLoading) {
      window.addEventListener('keydown', handleGlobalKeyDown)
      return () => window.removeEventListener('keydown', handleGlobalKeyDown)
    }
  }, [isLoading, onStop])

  const processFile = (file: File): Promise<ImageData | null> => {
    return new Promise((resolve) => {
      if (!file.type.startsWith('image/')) {
        resolve(null)
        return
      }

      const reader = new FileReader()
      reader.onload = (e) => {
        const base64 = e.target?.result as string
        resolve({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          base64: base64.split(',')[1], // 移除 data:image/xxx;base64, 前缀
          mimeType: file.type,
          preview: base64,
        })
      }
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(file)
    })
  }

  const handlePaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items
    if (!items) return

    const imageItems: DataTransferItem[] = []
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        imageItems.push(items[i])
      }
    }

    if (imageItems.length > 0) {
      e.preventDefault()
      const newImages: ImageData[] = []

      for (const item of imageItems) {
        const file = item.getAsFile()
        if (file) {
          const imageData = await processFile(file)
          if (imageData) {
            newImages.push(imageData)
          }
        }
      }

      if (newImages.length > 0) {
        setImages((prev) => [...prev, ...newImages])
      }
    }
  }

  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    const newImages: ImageData[] = []
    for (let i = 0; i < files.length; i++) {
      const imageData = await processFile(files[i])
      if (imageData) {
        newImages.push(imageData)
      }
    }

    if (newImages.length > 0) {
      setImages((prev) => [...prev, ...newImages])
    }

    // 重置 input 以允许选择相同文件
    e.target.value = ''
  }

  const removeImage = (id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id))
  }

  const canSend = (input.trim() || images.length > 0) && !disabled

  return (
    <div className="relative">
      {/* 图片预览区域 */}
      {images.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {images.map((img) => (
            <div key={img.id} className="group relative">
              <img
                src={img.preview}
                alt="预览"
                className="h-16 w-16 rounded-xl border border-border/30 object-cover"
              />
              <button
                onClick={() => removeImage(img.id)}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-background opacity-0 transition-opacity group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ChatGPT 风格输入框 */}
      <div className="flex items-end gap-3 rounded-[26px] border border-input bg-background px-4 py-3 shadow-sm">
        {/* 左侧：添加图片按钮 */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          title="上传图片"
        >
          <Image className="h-5 w-5" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />

        {/* 中间：文本输入框 */}
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={placeholder}
          disabled={disabled}
          className="min-h-[32px] max-h-[200px] flex-1 resize-none border-0 bg-transparent dark:bg-transparent p-0 text-xl leading-8 shadow-none placeholder:text-muted-foreground/50 focus-visible:ring-0"
          rows={1}
        />

        {/* 右侧：发送/停止按钮 */}
        {isLoading ? (
          <button
            onClick={onStop}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-colors hover:bg-foreground/90"
            title="停止"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!canSend}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-all hover:bg-foreground/90 disabled:bg-muted-foreground/30 disabled:text-muted-foreground"
            title="发送"
          >
            <ArrowUp className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  )
}
