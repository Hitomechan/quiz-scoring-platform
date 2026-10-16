FROM node:20-alpine

LABEL org.opencontainers.image.title="quiz-scoring-platform"
LABEL org.opencontainers.image.description="零依赖在线答题系统（多套试卷 / 二维码 / 自动判分 / 成绩统计）"

WORKDIR /app

# 本项目无任何第三方依赖，直接拷贝源码即可
COPY package.json ./
COPY server.js ./
COPY public ./public

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3210 \
    DATA_DIR=/data

# 数据目录挂载出来，容器重建不丢数据
VOLUME ["/data"]
EXPOSE 3210

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3210/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
