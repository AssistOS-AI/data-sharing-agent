FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY web ./web
COPY docs ./docs
COPY skills ./skills
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV HUB_HOST=0.0.0.0 HUB_PORT=8787 HUB_DATA_DIR=/app/data
EXPOSE 8787
CMD ["node", "src/server.mjs"]
