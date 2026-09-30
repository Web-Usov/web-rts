# Production web build. Build context is the repository root.
FROM node:22-bookworm-slim AS build

WORKDIR /app

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN corepack enable

COPY . .

RUN corepack install && pnpm install --frozen-lockfile

# Empty URL keeps LAN hostname resolution in the browser bundle.
ARG VITE_GAME_SERVER_URL=
ARG VITE_GAME_SERVER_PORT=2567
ENV VITE_GAME_SERVER_URL=$VITE_GAME_SERVER_URL
ENV VITE_GAME_SERVER_PORT=$VITE_GAME_SERVER_PORT
ENV TURBO_TELEMETRY_DISABLED=1

RUN pnpm exec turbo run build --filter=@web-rts/web

FROM nginx:1.27-alpine

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
