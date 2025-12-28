import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { Check, Copy, Code, Eye, Loader2 } from 'lucide-react'

// 懒加载 ReactMarkdown 组件
const LazyReactMarkdown = lazy(() => import('react-markdown'))

// 动态加载所有 markdown 插件的 hook
function useMarkdownPlugins() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [plugins, setPlugins] = useState<{
    remarkPlugins: any[]
    rehypePlugins: any[]
    loaded: boolean
  }>({
    remarkPlugins: [],
    rehypePlugins: [],
    loaded: false,
  })

  useEffect(() => {
    Promise.all([
      import('remark-gfm'),
      import('remark-math'),
      import('remark-emoji'),
      import('rehype-highlight'),
      import('rehype-raw'),
      import('rehype-katex'),
      import('katex/dist/katex.min.css'),
    ]).then(([remarkGfm, remarkMath, remarkEmoji, rehypeHighlight, rehypeRaw, rehypeKatex]) => {
      setPlugins({
        remarkPlugins: [remarkGfm.default, remarkMath.default, remarkEmoji.default],
        rehypePlugins: [rehypeHighlight.default, rehypeKatex.default, rehypeRaw.default],
        loaded: true,
      })
    })
  }, [])

  return plugins
}

// 检测全局是否为暗色模式
// 与 useTheme hook 保持一致：通过检查 html 元素是否有 dark 类来判断
function useIsDarkMode() {
  const checkIsDark = () => {
    if (typeof window === 'undefined') return true
    // 直接检查 html 元素是否有 dark 类（与 useTheme hook 的逻辑一致）
    return document.documentElement.classList.contains('dark')
  }

  const [isDark, setIsDark] = useState(checkIsDark)

  useEffect(() => {
    // 监听 class 变化
    const observer = new MutationObserver(() => {
      setIsDark(checkIsDark())
    })

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })

    return () => {
      observer.disconnect()
    }
  }, [])

  return isDark
}

interface MarkdownRendererProps {
  content: string
  isStreaming?: boolean  // 是否正在流式传输
}

export function MarkdownRenderer({ content, isStreaming }: MarkdownRendererProps) {
  const isDark = useIsDarkMode()
  const { remarkPlugins, rehypePlugins, loaded } = useMarkdownPlugins()
  const [showRaw, setShowRaw] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="markdown-content relative">
      {/* 工具栏 - 右上角 */}
      <div className="absolute right-0 top-0 flex items-center gap-1 z-10">
        <button
          onClick={() => setShowRaw(!showRaw)}
          className={`p-1.5 rounded transition-colors ${
            showRaw
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
          }`}
          title={showRaw ? '查看渲染' : '查看原始内容'}
        >
          {showRaw ? <Eye className="h-4 w-4" /> : <Code className="h-4 w-4" />}
        </button>
        <button
          onClick={handleCopy}
          className="p-1.5 rounded bg-gray-700 hover:bg-gray-600 transition-colors"
          title="复制原始内容"
        >
          {copied ? (
            <Check className="h-4 w-4 text-green-400" />
          ) : (
            <Copy className="h-4 w-4 text-gray-300" />
          )}
        </button>
      </div>

      {/* 原始内容或渲染内容 */}
      {showRaw ? (
        <pre
          className={`overflow-x-auto rounded-lg p-4 pt-10 text-sm whitespace-pre-wrap break-words ${
            isDark ? 'bg-[#0d1117] text-gray-300' : 'bg-[#f6f8fa] text-gray-800'
          }`}
        >
          {content}
        </pre>
      ) : !loaded ? (
        <div className="flex items-center gap-2 text-muted-foreground py-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">加载中...</span>
        </div>
      ) : (
        <Suspense
          fallback={
            <div className="flex items-center gap-2 text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">加载中...</span>
            </div>
          }
        >
          <LazyReactMarkdown
            remarkPlugins={remarkPlugins}
            rehypePlugins={rehypePlugins}
            components={{
            // 代码块
            pre({ children }) {
              // 检查是否是 mermaid 代码块
              const codeElement = children as React.ReactElement<{
                className?: string
                children?: React.ReactNode
              }>
              const className = codeElement?.props?.className || ''
              const isMermaid = className.includes('language-mermaid')

              if (isMermaid) {
                const code = extractText(codeElement)
                // 使用 isDark 作为 key 的一部分，确保主题切换时重新渲染
                return <MermaidBlock key={`mermaid-${isDark}`} code={code} isStreaming={isStreaming} />
              }

              return <CodeBlock>{children}</CodeBlock>
            },
            // 内联代码
            code({ className, children, ...props }) {
              const isInline = !className
              if (isInline) {
                return (
                  <code
                    className="rounded bg-black/20 px-1.5 py-0.5 text-sm font-mono"
                    {...props}
                  >
                    {children}
                  </code>
                )
              }
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              )
            },
            // 图片
            img({ src, alt }) {
              return (
                <img
                  src={src}
                  alt={alt || ''}
                  className="max-w-full h-auto rounded-lg my-2"
                  loading="lazy"
                />
              )
            },
            // 链接
            a({ href, children }) {
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 underline"
                >
                  {children}
                </a>
              )
            },
            // 列表
            ul({ children }) {
              return (
                <ul className="list-disc list-inside my-2 space-y-1">
                  {children}
                </ul>
              )
            },
            ol({ children }) {
              return (
                <ol className="list-decimal list-inside my-2 space-y-1">
                  {children}
                </ol>
              )
            },
            // 段落
            p({ children }) {
              return <p className="my-2 leading-relaxed">{children}</p>
            },
            // 标题
            h1({ children }) {
              return <h1 className="text-xl font-bold my-3">{children}</h1>
            },
            h2({ children }) {
              return <h2 className="text-lg font-bold my-2">{children}</h2>
            },
            h3({ children }) {
              return <h3 className="text-base font-bold my-2">{children}</h3>
            },
            // 引用块
            blockquote({ children }) {
              return (
                <blockquote className="border-l-4 border-gray-500 pl-4 my-2 italic opacity-90">
                  {children}
                </blockquote>
              )
            },
            // 表格
            table({ children }) {
              return (
                <div className="overflow-x-auto my-2">
                  <table className="min-w-full border-collapse border border-gray-600">
                    {children}
                  </table>
                </div>
              )
            },
            th({ children }) {
              return (
                <th className="border border-gray-600 px-3 py-1 bg-black/20 font-semibold">
                  {children}
                </th>
              )
            },
            td({ children }) {
              return (
                <td className="border border-gray-600 px-3 py-1">{children}</td>
              )
            },
            // 水平线
            hr() {
              return <hr className="my-4 border-gray-600" />
            },
          }}
        >
          {content}
        </LazyReactMarkdown>
        </Suspense>
      )}
    </div>
  )
}

// Mermaid 图表组件
function MermaidBlock({ code, isStreaming }: { code: string; isStreaming?: boolean }) {
  const [showRaw, setShowRaw] = useState(false)
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [isLoading, setIsLoading] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)
  const isDark = useIsDarkMode()

  useEffect(() => {
    // 如果正在流式传输，不渲染（等待流式完成）
    if (isStreaming) {
      setIsLoading(true)
      return
    }

    const renderMermaid = async () => {
      setIsLoading(true)
      try {
        // 动态导入 mermaid（代码分割）
        const mermaid = (await import('mermaid')).default

        // 根据全局主题设置 mermaid 主题
        mermaid.initialize({
          startOnLoad: false,
          theme: isDark ? 'dark' : 'default',
          securityLevel: 'loose',
        })
        const id = `mermaid-${Math.random().toString(36).slice(2, 11)}`
        const { svg } = await mermaid.render(id, code)
        setSvg(svg)
        setError('')
      } catch (err) {
        setError(err instanceof Error ? err.message : '渲染失败')
        setSvg('')
      } finally {
        setIsLoading(false)
      }
    }

    if (!showRaw) {
      renderMermaid()
    }
  }, [code, showRaw, isDark, isStreaming])

  return (
    <div className="relative group my-3">
      {/* 切换按钮 */}
      <div className="absolute right-2 top-2 flex gap-1 z-10">
        <button
          onClick={() => setShowRaw(!showRaw)}
          className={`p-1.5 rounded transition-colors ${
            showRaw
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
          }`}
          title={showRaw ? '查看图表' : '查看代码'}
        >
          {showRaw ? (
            <Eye className="h-4 w-4" />
          ) : (
            <Code className="h-4 w-4" />
          )}
        </button>
        <CopyButton text={code} />
      </div>

      {showRaw ? (
        // 显示原始代码
        <pre
          className={`overflow-x-auto rounded-lg p-4 pt-12 text-sm transition-colors ${
            isDark ? 'bg-[#0d1117]' : 'bg-[#f6f8fa]'
          }`}
        >
          <code className="language-mermaid">{code}</code>
        </pre>
      ) : isLoading ? (
        // 显示加载状态
        <div
          className={`rounded-lg p-4 pt-12 flex items-center justify-center min-h-[200px] transition-colors ${
            isDark ? 'bg-[#0d1117]' : 'bg-white'
          }`}
        >
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">加载 Mermaid 图表...</span>
          </div>
        </div>
      ) : error ? (
        // 显示错误
        <div className="rounded-lg bg-red-900/30 border border-red-500/50 p-4 pt-12">
          <p className="text-red-400 text-sm">Mermaid 渲染错误: {error}</p>
          <pre className="mt-2 text-xs text-gray-400 overflow-x-auto">
            {code}
          </pre>
        </div>
      ) : (
        // 显示渲染的图表
        <div
          ref={containerRef}
          className={`overflow-x-auto rounded-lg p-4 pt-12 flex justify-center transition-colors ${
            isDark ? 'bg-[#0d1117]' : 'bg-white'
          }`}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
    </div>
  )
}

// 复制按钮组件
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleCopy}
      className="p-1.5 rounded bg-gray-700 hover:bg-gray-600 transition-colors"
      title="复制代码"
    >
      {copied ? (
        <Check className="h-4 w-4 text-green-400" />
      ) : (
        <Copy className="h-4 w-4 text-gray-300" />
      )}
    </button>
  )
}

// 代码块组件，带复制按钮
function CodeBlock({ children }: { children: React.ReactNode }) {
  const codeText = extractText(children)
  const isDark = useIsDarkMode()

  return (
    <div className="relative group my-3">
      <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <CopyButton text={codeText} />
      </div>
      <pre
        className={`overflow-x-auto rounded-lg p-4 text-sm transition-colors ${
          isDark ? 'bg-[#0d1117]' : 'bg-[#f6f8fa]'
        }`}
      >
        {children}
      </pre>
    </div>
  )
}

// 递归提取文本内容
function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (!node) return ''

  if (Array.isArray(node)) {
    return node.map(extractText).join('')
  }

  if (typeof node === 'object' && 'props' in node) {
    const element = node as React.ReactElement<{ children?: React.ReactNode }>
    return extractText(element.props.children)
  }

  return ''
}
