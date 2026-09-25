# syntax=docker/dockerfile:1
ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-slim AS base

ENV HOME=/app
WORKDIR /app

RUN apt-get update -qq \
  && apt-get install --no-install-recommends -y ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
RUN npx livekit-agents download-files
COPY . .
RUN npm prune --omit=dev

FROM base
ARG UID=10001
RUN adduser --disabled-password --gecos "" --home "/app" --shell "/sbin/nologin" --uid "${UID}" appuser
COPY --from=build --chown=appuser:appuser /app /app
USER appuser
ENV NODE_ENV=production
CMD ["npm", "start"]
