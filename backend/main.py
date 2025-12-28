"""
ChatAgent Backend - FastAPI + Claude Agent SDK
支持 REST API + WebSocket 实时通信的对话应用
"""

import argparse
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.config import HOST, PORT, get_logger, enable_debug_mode
from app.models.database import init_db
from app.api.routes import router as api_router
from app.api.websocket import router as ws_router
from app.core.session_manager import session_manager

logger = get_logger(__name__)

# 前端构建目录
FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    # 启动时检查 API Key
    if not os.getenv("ANTHROPIC_API_KEY"):
        logger.warning("ANTHROPIC_API_KEY 未设置，请在 .env 文件中配置")

    # 初始化数据库
    await init_db()
    logger.info("数据库初始化完成")

    yield

    # 关闭时清理所有会话
    await session_manager.close_all()
    logger.info("所有会话已关闭")


app = FastAPI(
    title="ChatAgent API",
    description="基于 Claude Agent SDK 的对话应用后端",
    version="0.2.0",
    lifespan=lifespan,
)

# CORS 配置 - 允许前端访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(api_router)
app.include_router(ws_router)

# 静态文件服务 - 加载编译后的前端
if FRONTEND_DIST.exists():
    # 挂载静态资源目录
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="static_assets")
    logger.info(f"已挂载前端静态资源: {FRONTEND_DIST}")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        """提供前端 SPA 页面"""
        # 尝试返回请求的文件
        file_path = FRONTEND_DIST / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        # 其他路由返回 index.html（支持前端路由）
        return FileResponse(FRONTEND_DIST / "index.html")
else:
    logger.warning(f"前端构建目录不存在: {FRONTEND_DIST}，请先运行 pnpm build")

    @app.get("/")
    async def root():
        """健康检查"""
        return {"status": "ok", "message": "ChatAgent API is running", "version": "0.2.0"}


if __name__ == "__main__":
    import uvicorn

    parser = argparse.ArgumentParser(description="ChatAgent Backend Server")
    parser.add_argument("-d", "--debug", action="store_true", help="启用调试模式，输出详细日志")
    parser.add_argument("--host", default=HOST, help=f"服务器地址 (默认: {HOST})")
    parser.add_argument("--port", type=int, default=PORT, help=f"服务器端口 (默认: {PORT})")
    args = parser.parse_args()

    # 设置调试模式
    if args.debug:
        enable_debug_mode()
        logger.info("调试模式已启用")

    uvicorn.run(app, host=args.host, port=args.port)
