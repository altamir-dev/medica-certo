FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci --no-audit --no-fund
COPY web ./web
COPY server ./server
RUN npm run build -w web

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci --omit=dev --workspace=server --include-workspace-root --no-audit --no-fund \
  && npm cache clean --force
COPY server ./server
COPY --from=build /app/web/dist ./web/dist
RUN mkdir -p /app/data/med-photos && chown -R node:node /app
USER node
EXPOSE 8080
# Node 22 só expõe Temporal com esta flag; a grade de doses depende dela.
# wget do Alpine devolve o corpo mesmo em 503 — o grep exige "status":"ok".
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD wget -qO- http://127.0.0.1:8080/api/health | grep -q '"status":"ok"'
CMD ["node", "--harmony-temporal", "server/index.mjs"]
