/**
 * 工具调用卡片组件
 * 简洁现代的设计风格
 */

import { useState } from 'react'
import { cn } from '@/lib/utils'
import {
  ChevronDown,
  ChevronRight,
  Terminal,
  FileText,
  FileEdit,
  Search,
  Globe,
  Download,
  ListTodo,
  Check,
  X,
  Loader2,
  Wrench,
  Code2,
} from 'lucide-react'

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

interface ToolUseCardProps {
  toolUse: ToolUseInfo
  className?: string
}

// 工具图标映射
const toolIcons: Record<string, React.ReactNode> = {
  Bash: <Terminal className="h-3 w-3" />,
  Read: <FileText className="h-3 w-3" />,
  Write: <FileEdit className="h-3 w-3" />,
  Edit: <Code2 className="h-3 w-3" />,
  Glob: <Search className="h-3 w-3" />,
  Grep: <Search className="h-3 w-3" />,
  WebSearch: <Globe className="h-3 w-3" />,
  WebFetch: <Download className="h-3 w-3" />,
  Task: <ListTodo className="h-3 w-3" />,
  TodoWrite: <ListTodo className="h-3 w-3" />,
}

function formatToolInput(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'Bash':
      return (input.command as string) || ''
    case 'Read':
    case 'Write':
    case 'Edit': {
      const path = (input.file_path as string) || ''
      // 只显示文件名
      return path.split('/').pop() || path
    }
    case 'Glob':
      return (input.pattern as string) || ''
    case 'Grep':
      return (input.pattern as string) || ''
    case 'WebSearch':
      return (input.query as string) || ''
    case 'WebFetch': {
      const url = (input.url as string) || ''
      try {
        return new URL(url).hostname
      } catch {
        return url.slice(0, 30)
      }
    }
    default:
      return ''
  }
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + '…'
}

export function ToolUseCard({ toolUse, className }: ToolUseCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const icon = toolIcons[toolUse.toolName] || <Wrench className="h-3 w-3" />
  const inputPreview = formatToolInput(toolUse.toolName, toolUse.toolInput)
  const hasResult = toolUse.result !== undefined
  const isError = toolUse.result?.isError
  const resultContent = toolUse.result?.content

  return (
    <div className={cn('group', className)}>
      {/* 主卡片 - 更低调的设计，融入消息流 */}
      <div
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs transition-all',
          'text-muted-foreground/70',
          hasResult && resultContent && 'cursor-pointer hover:text-muted-foreground'
        )}
        onClick={() => hasResult && resultContent && setIsExpanded(!isExpanded)}
      >
        {/* 状态指示器 */}
        <span className={cn(
          'flex-shrink-0',
          hasResult ? (isError ? 'text-red-400' : 'text-emerald-400') : 'text-blue-400'
        )}>
          {hasResult ? (
            isError ? <X className="h-3 w-3" /> : <Check className="h-3 w-3" />
          ) : (
            <Loader2 className="h-3 w-3 animate-spin" />
          )}
        </span>

        {/* 工具图标和名称 */}
        <span className="flex items-center gap-1">
          {icon}
          <span className="font-medium">{toolUse.toolName}</span>
        </span>

        {/* 输入预览 */}
        {inputPreview && (
          <>
            <span className="opacity-50">·</span>
            <code className="max-w-[200px] truncate opacity-70">
              {truncateText(inputPreview, 40)}
            </code>
          </>
        )}

        {/* 展开指示 */}
        {hasResult && resultContent && (
          <span className="opacity-50 transition-opacity group-hover:opacity-100">
            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </span>
        )}
      </div>

      {/* 展开的结果内容 */}
      {isExpanded && resultContent && (
        <div className="mt-1 max-w-2xl overflow-hidden">
          <pre
            className={cn(
              'max-h-96 overflow-auto rounded-md border border-border/30 p-2 text-xs',
              'bg-muted/10 text-muted-foreground/80 whitespace-pre-wrap break-all',
              isError && 'border-red-500/20 text-red-500/80'
            )}
          >
            {resultContent.length > 2000
              ? resultContent.slice(0, 2000) + '\n... (truncated)'
              : resultContent}
          </pre>
        </div>
      )}
    </div>
  )
}
