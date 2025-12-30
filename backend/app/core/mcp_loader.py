"""
MCP 配置加载器
从 JSON 文件动态加载 MCP 服务器配置，支持热更新
"""

import json
import logging
import asyncio
import os
from pathlib import Path
from typing import Any, Callable
from threading import Lock

logger = logging.getLogger(__name__)


class MCPConfig:
    """MCP 配置结果"""

    def __init__(
        self,
        servers: dict[str, dict[str, Any]],
        allowed_tools: list[str],
    ):
        self.servers = servers
        self.allowed_tools = allowed_tools


def load_mcp_servers(config_path: str | Path) -> MCPConfig:
    """
    从 JSON 文件加载 MCP 服务器配置

    JSON 格式示例:
    {
      "mcpServers": {
        "server_name": {
          "type": "stdio",           # stdio 或 http
          "command": "npx",          # stdio 类型需要
          "args": ["-y", "..."],     # stdio 类型需要
          "env": {},                 # 可选环境变量
          "url": "http://...",       # http 类型需要
          "allowedTools": ["tool1", "tool2"]  # 允许的工具列表
        }
      }
    }

    Args:
        config_path: MCP 配置文件路径

    Returns:
        MCPConfig 对象，包含:
        - servers: MCP 服务器配置字典
        - allowed_tools: 允许的 MCP 工具列表 (格式: mcp__server__tool)
    """
    config_path = Path(config_path)

    if not config_path.exists():
        logger.warning(f"MCP 配置文件不存在: {config_path}")
        return MCPConfig(servers={}, allowed_tools=[])

    try:
        with open(config_path, "r", encoding="utf-8") as f:
            config = json.load(f)
    except json.JSONDecodeError as e:
        logger.error(f"MCP 配置文件 JSON 解析错误: {e}")
        return MCPConfig(servers={}, allowed_tools=[])
    except Exception as e:
        logger.error(f"读取 MCP 配置文件失败: {e}")
        return MCPConfig(servers={}, allowed_tools=[])

    mcp_servers_config = config.get("mcpServers", {})

    if not mcp_servers_config:
        logger.info("MCP 配置文件中没有定义服务器")
        return MCPConfig(servers={}, allowed_tools=[])

    mcp_servers: dict[str, dict[str, Any]] = {}
    allowed_tools: list[str] = []

    for server_name, server_config in mcp_servers_config.items():
        # 提取该服务器允许的工具列表
        server_allowed_tools = server_config.get("allowedTools", [])
        for tool_name in server_allowed_tools:
            # 格式化为 mcp__<server_name>__<tool_name>
            # 注意：工具名保持原样，不做转换（包括连字符）
            formatted_tool = f"mcp__{server_name}__{tool_name}"
            allowed_tools.append(formatted_tool)
            logger.debug(f"添加 MCP 工具权限: {formatted_tool}")

        server_type = server_config.get("type", "stdio")

        if server_type == "stdio":
            # stdio 类型 MCP 服务器
            command = server_config.get("command")
            args = server_config.get("args", [])
            env = server_config.get("env", {})

            if not command:
                logger.warning(f"MCP 服务器 '{server_name}' 缺少 command 配置，跳过")
                continue

            mcp_server = {
                "type": "stdio",
                "command": command,
                "args": args,
            }

            if env:
                mcp_server["env"] = env

            mcp_servers[server_name] = mcp_server
            logger.info(f"加载 stdio MCP 服务器: {server_name} ({command})")

        elif server_type == "http" or server_type == "sse":
            # HTTP/SSE 类型 MCP 服务器
            # Claude Agent SDK 支持两种远程服务器类型：
            # - "http": 标准 HTTP 端点
            # - "sse": Server-Sent Events 端点
            url = server_config.get("url")

            if not url:
                logger.warning(f"MCP 服务器 '{server_name}' 缺少 url 配置，跳过")
                continue

            # 保留配置文件中指定的类型（http 或 sse）
            mcp_server = {
                "type": server_type,
                "url": url,
            }

            # 添加 headers（如果有）
            headers = server_config.get("headers", {})
            if headers:
                mcp_server["headers"] = headers

            mcp_servers[server_name] = mcp_server
            logger.info(f"加载 {server_type.upper()} MCP 服务器: {server_name} ({url})")

        else:
            logger.warning(f"MCP 服务器 '{server_name}' 类型 '{server_type}' 不支持，跳过")

    logger.info(f"共加载 {len(mcp_servers)} 个 MCP 服务器，{len(allowed_tools)} 个工具权限")
    if allowed_tools:
        logger.info(f"MCP 工具权限列表: {allowed_tools}")
    return MCPConfig(servers=mcp_servers, allowed_tools=allowed_tools)


class MCPConfigManager:
    """
    MCP 配置管理器（单例）

    负责管理 MCP 配置的加载和热更新，提供统一的配置访问接口。
    支持文件监控，当配置文件变化时自动重新加载。
    """

    _instance: "MCPConfigManager | None" = None
    _lock = Lock()

    def __new__(cls) -> "MCPConfigManager":
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance._initialized = False
            return cls._instance

    def __init__(self):
        if self._initialized:
            return

        self._config: MCPConfig | None = None
        self._config_path: Path | None = None
        self._last_mtime: float = 0
        self._config_lock = Lock()
        self._watch_task: asyncio.Task | None = None
        self._stop_watching = False
        self._is_watching = False  # 是否正在监控文件变化
        self._on_reload_callbacks: list[Callable[[MCPConfig], None]] = []
        self._initialized = True

    def initialize(self, config_path: str | Path) -> MCPConfig:
        """
        初始化配置管理器

        Args:
            config_path: MCP 配置文件路径

        Returns:
            MCPConfig 对象
        """
        self._config_path = Path(config_path)
        self._load_config()
        return self._config

    def _load_config(self) -> None:
        """加载配置文件"""
        with self._config_lock:
            if self._config_path is None:
                logger.warning("MCP 配置路径未设置")
                self._config = MCPConfig(servers={}, allowed_tools=[])
                return

            self._config = load_mcp_servers(self._config_path)

            # 更新文件修改时间
            if self._config_path.exists():
                self._last_mtime = os.path.getmtime(self._config_path)

    def _check_and_reload(self) -> bool:
        """
        检查配置文件是否变化，如果变化则重新加载

        Returns:
            是否重新加载了配置
        """
        if self._config_path is None or not self._config_path.exists():
            return False

        current_mtime = os.path.getmtime(self._config_path)
        if current_mtime > self._last_mtime:
            logger.info(f"检测到 MCP 配置文件变化，重新加载...")
            old_config = self._config
            self._load_config()

            # 通知所有回调
            for callback in self._on_reload_callbacks:
                try:
                    callback(self._config)
                except Exception as e:
                    logger.error(f"MCP 配置重载回调执行失败: {e}")

            # 记录配置变化
            if old_config:
                old_servers = set(old_config.servers.keys())
                new_servers = set(self._config.servers.keys())
                added = new_servers - old_servers
                removed = old_servers - new_servers
                if added:
                    logger.info(f"新增 MCP 服务器: {added}")
                if removed:
                    logger.info(f"移除 MCP 服务器: {removed}")

                # 记录工具权限变化
                old_tools = set(old_config.allowed_tools)
                new_tools = set(self._config.allowed_tools)
                added_tools = new_tools - old_tools
                removed_tools = old_tools - new_tools
                if added_tools:
                    logger.info(f"新增 MCP 工具权限: {added_tools}")
                if removed_tools:
                    logger.info(f"移除 MCP 工具权限: {removed_tools}")

            return True
        return False

    @property
    def config(self) -> MCPConfig:
        """获取当前配置"""
        if self._config is None:
            return MCPConfig(servers={}, allowed_tools=[])
        return self._config

    def get_config(self) -> MCPConfig:
        """
        获取当前配置

        如果启用了文件监控（start_watching），直接返回缓存的配置。
        否则会检查文件是否变化并按需重新加载。

        Returns:
            MCPConfig 对象
        """
        # 如果正在监控文件变化，由监控循环负责更新，这里直接返回缓存
        if not self._is_watching:
            self._check_and_reload()
        return self.config

    def on_reload(self, callback: Callable[[MCPConfig], None]) -> None:
        """
        注册配置重载回调

        Args:
            callback: 配置重载时调用的回调函数
        """
        self._on_reload_callbacks.append(callback)

    def remove_reload_callback(self, callback: Callable[[MCPConfig], None]) -> None:
        """
        移除配置重载回调

        Args:
            callback: 要移除的回调函数
        """
        if callback in self._on_reload_callbacks:
            self._on_reload_callbacks.remove(callback)

    async def start_watching(self, interval: float = 2.0) -> None:
        """
        启动文件监控

        Args:
            interval: 检查间隔（秒）
        """
        if self._watch_task is not None and not self._watch_task.done():
            logger.warning("文件监控已在运行")
            return

        self._stop_watching = False
        self._is_watching = True
        self._watch_task = asyncio.create_task(self._watch_loop(interval))
        logger.info(f"MCP 配置文件监控已启动，检查间隔: {interval}秒")

    async def _watch_loop(self, interval: float) -> None:
        """文件监控循环"""
        while not self._stop_watching:
            try:
                self._check_and_reload()
            except Exception as e:
                logger.error(f"检查 MCP 配置文件时出错: {e}")

            await asyncio.sleep(interval)

    async def stop_watching(self) -> None:
        """停止文件监控"""
        self._stop_watching = True
        self._is_watching = False
        if self._watch_task is not None:
            self._watch_task.cancel()
            try:
                await self._watch_task
            except asyncio.CancelledError:
                pass
            self._watch_task = None
        logger.info("MCP 配置文件监控已停止")

    def reload(self) -> MCPConfig:
        """
        手动重新加载配置

        Returns:
            MCPConfig 对象
        """
        logger.info("手动重新加载 MCP 配置...")
        self._load_config()

        # 通知所有回调
        for callback in self._on_reload_callbacks:
            try:
                callback(self._config)
            except Exception as e:
                logger.error(f"MCP 配置重载回调执行失败: {e}")

        return self._config


# 全局单例实例
mcp_config_manager = MCPConfigManager()
