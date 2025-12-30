/**
 * 全局 WebSocket 连接状态 Hook
 */

import { useState, useEffect } from 'react'

// 动态获取 WebSocket URL：优先使用环境变量，否则基于当前页面 host 自动推断
function getWsUrl(): string {
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL
  }
  // 根据当前页面协议和 host 自动构建 WebSocket URL
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}`
}

const WS_URL = getWsUrl()

// 连接状态管理器（单例）
class ConnectionManager {
  private ws: WebSocket | null = null
  private listeners: Set<(connected: boolean) => void> = new Set()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private isConnecting = false
  private _isConnected = false

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return
    if (this.ws?.readyState === WebSocket.CONNECTING) return
    if (this.isConnecting) return

    this.isConnecting = true
    const ws = new WebSocket(`${WS_URL}/ws/chat`)

    ws.onopen = () => {
      this.isConnecting = false
      this._isConnected = true
      this.notifyListeners(true)
    }

    ws.onerror = () => {
      this.isConnecting = false
      this._isConnected = false
      this.notifyListeners(false)
    }

    ws.onclose = () => {
      this.isConnecting = false
      this._isConnected = false
      this.ws = null
      this.notifyListeners(false)
      this.scheduleReconnect()
    }

    this.ws = ws
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return
    if (this.listeners.size === 0) return

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.listeners.size > 0) {
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

  addListener(listener: (connected: boolean) => void) {
    this.listeners.add(listener)
    // 立即通知当前状态
    listener(this._isConnected)
    // 如果是第一个监听器，建立连接
    if (this.listeners.size === 1) {
      this.connect()
    }
  }

  removeListener(listener: (connected: boolean) => void) {
    this.listeners.delete(listener)
    setTimeout(() => {
      if (this.listeners.size === 0) {
        this.disconnect()
      }
    }, 100)
  }

  private notifyListeners(connected: boolean) {
    this.listeners.forEach((listener) => listener(connected))
  }

  get isConnected() {
    return this._isConnected
  }
}

// 全局单例
const connectionManager = new ConnectionManager()

export function useConnection() {
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    const handleStatus = (connected: boolean) => {
      setIsConnected(connected)
    }

    connectionManager.addListener(handleStatus)

    return () => {
      connectionManager.removeListener(handleStatus)
    }
  }, [])

  return { isConnected }
}
