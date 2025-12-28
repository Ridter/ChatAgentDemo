"""应用配置模块"""
import os
import sys
import logging
from pathlib import Path
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()


# SIGINT 错误过滤器 - 抑制 Ctrl+C 时 SDK 内部的错误日志
class SigintErrorFilter(logging.Filter):
    """过滤 SIGINT (Ctrl+C) 导致的 SDK 内部错误日志"""

    def filter(self, record: logging.LogRecord) -> bool:
        # 检查是否是由 SIGINT (exit code -2) 引起的错误
        if record.levelno >= logging.ERROR:
            msg = record.getMessage()
            # 过滤 SDK query.py 中的 "Fatal error in message reader" 错误
            # 过滤 SDK subprocess_cli.py 中的 "Command failed with exit code -2" 错误
            if "exit code -2" in msg or "exit code: -2" in msg:
                return False  # 不记录此日志
        return True


# 自定义彩色日志格式化器
class ColoredFormatter(logging.Formatter):
    """带颜色的日志格式化器"""

    # ANSI 颜色代码
    COLORS = {
        'DEBUG': '\033[36m',     # 青色
        'INFO': '\033[32m',      # 绿色
        'WARNING': '\033[33m',   # 黄色
        'ERROR': '\033[31m',     # 红色
        'CRITICAL': '\033[35m',  # 紫色
    }
    RESET = '\033[0m'
    BOLD = '\033[1m'
    DIM = '\033[2m'

    def format(self, record):
        # 获取颜色
        color = self.COLORS.get(record.levelname, self.RESET)

        # 格式化时间
        time_str = self.formatTime(record, '%H:%M:%S')

        # 简化模块名（只取最后一部分）
        module = record.name.split('.')[-1] if '.' in record.name else record.name
        if module == 'root':
            module = 'app'

        # 构建日志消息
        level_icon = {
            'DEBUG': '🔍',
            'INFO': '✨',
            'WARNING': '⚠️ ',
            'ERROR': '❌',
            'CRITICAL': '💀',
        }.get(record.levelname, '•')

        # 格式: 时间 | 图标 级别 | 模块 | 消息
        formatted = (
            f"{self.DIM}{time_str}{self.RESET} "
            f"{color}{level_icon} {record.levelname:<7}{self.RESET} "
            f"{self.DIM}│{self.RESET} {color}{record.getMessage()}{self.RESET}"
        )

        return formatted


# 配置日志
def setup_logging():
    """配置日志系统"""
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)

    # 清除已有的处理器
    root_logger.handlers.clear()

    # 创建控制台处理器
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.INFO)

    # 使用彩色格式化器
    console_handler.setFormatter(ColoredFormatter())

    root_logger.addHandler(console_handler)

    # 降低第三方库的日志级别
    logging.getLogger('uvicorn.access').setLevel(logging.WARNING)
    logging.getLogger('httpx').setLevel(logging.WARNING)
    logging.getLogger('httpcore').setLevel(logging.WARNING)

    # 为 Claude SDK 内部 logger 添加 SIGINT 错误过滤器
    # 这样 Ctrl+C 时不会显示 "Fatal error in message reader" 等错误
    sigint_filter = SigintErrorFilter()
    logging.getLogger('claude_agent_sdk._internal.query').addFilter(sigint_filter)
    logging.getLogger('claude_agent_sdk._internal.transport.subprocess_cli').addFilter(sigint_filter)


setup_logging()


# 获取 logger
def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)


def enable_debug_mode():
    """启用调试模式，将日志级别设为 DEBUG"""
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.DEBUG)
    for handler in root_logger.handlers:
        handler.setLevel(logging.DEBUG)


# 项目根目录
BASE_DIR = Path(__file__).resolve().parent.parent

# 数据目录
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

# 数据库配置
DATABASE_PATH = DATA_DIR / "chat.db"

# MCP 服务器配置文件路径
MCP_CONFIG_PATH = DATA_DIR / "mcp_servers.json"

# 服务器配置
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "3001"))

# Claude Agent SDK 配置
SYSTEM_PROMPT = """你是一个友好、专业的 AI 助手。你可以帮助用户完成各种任务，包括：
- 回答问题
- 编写和编辑文本
- 编程和调试
- 分析和研究
- 创意任务

请简洁但全面地回答问题。"""

ALLOWED_TOOLS = [
    # 基础工具
    "Bash",
    "Read",
    "Write",
    "Edit",
    "Glob",
    "Grep",
    "WebSearch",
    "WebFetch",
    # MCP 工具权限从 mcp_servers.json 动态加载
]

MAX_TURNS = 100

# 权限模式：自动接受编辑操作
PERMISSION_MODE = "acceptEdits"
