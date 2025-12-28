"""
MCP 配置加载器
从 JSON 文件动态加载 MCP 服务器配置
"""

import json
import logging
from pathlib import Path
from typing import Any

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
            formatted_tool = f"mcp__{server_name}__{tool_name}"
            allowed_tools.append(formatted_tool)

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
            url = server_config.get("url")

            if not url:
                logger.warning(f"MCP 服务器 '{server_name}' 缺少 url 配置，跳过")
                continue

            mcp_server = {
                "type": "http",
                "url": url,
            }

            # 添加 headers（如果有）
            headers = server_config.get("headers", {})
            if headers:
                mcp_server["headers"] = headers

            mcp_servers[server_name] = mcp_server
            logger.info(f"加载 HTTP MCP 服务器: {server_name} ({url})")

        else:
            logger.warning(f"MCP 服务器 '{server_name}' 类型 '{server_type}' 不支持，跳过")

    logger.info(f"共加载 {len(mcp_servers)} 个 MCP 服务器，{len(allowed_tools)} 个工具权限")
    return MCPConfig(servers=mcp_servers, allowed_tools=allowed_tools)


def reload_mcp_servers(config_path: str | Path) -> MCPConfig:
    """
    重新加载 MCP 服务器配置（用于热更新）

    Args:
        config_path: MCP 配置文件路径

    Returns:
        MCPConfig 对象
    """
    logger.info("重新加载 MCP 服务器配置...")
    return load_mcp_servers(config_path)
