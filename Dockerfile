FROM oven/bun:1.3-alpine

WORKDIR /app

# 安装依赖
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# 复制源码
COPY src ./src
COPY tsconfig.json ./

# 创建数据目录
RUN mkdir -p /data

# 设置环境变量
ENV DB_PATH=/data/mailbox.db
ENV HOST=0.0.0.0
ENV HTTP_PORT=5000
ENV SMTP_PORT=25

# 暴露端口
EXPOSE 5000 25

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/health || exit 1

# 启动服务
CMD ["bun", "run", "src/index.ts"]
