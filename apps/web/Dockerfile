FROM node:22-alpine AS build

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.8.1 --activate

COPY . .

RUN pnpm install --frozen-lockfile

ARG VITE_GAME_SERVER_URL=
ARG VITE_GAME_SERVER_PORT=2567
ENV VITE_GAME_SERVER_URL=${VITE_GAME_SERVER_URL}
ENV VITE_GAME_SERVER_PORT=${VITE_GAME_SERVER_PORT}

RUN pnpm build

FROM nginx:1.28-alpine

COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
