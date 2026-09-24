FROM node:22-slim

WORKDIR /app

# better-sqlite3 使用预编译二进制；如需在镜像内从源码编译，可取消下一行注释
# RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3000
# 容器内数据库文件路径（compose 会把 ./data 挂载到 /app/data）
ENV DB_PATH=/app/data/stage.db

EXPOSE 3000

# 首次启动自动建表、建索引并写入内置区位“后台”，完成数据初始化
CMD ["node", "src/server.js"]
