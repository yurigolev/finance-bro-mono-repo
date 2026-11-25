FROM node:24-alpine AS manifests
WORKDIR /app
COPY package.json package-lock.json ./
COPY services/core/package.json ./services/core/
COPY services/bot/package.json ./services/bot/
COPY services/input/package.json ./services/input/

FROM manifests AS build
RUN npm ci
COPY tsconfig*.json ./
COPY packages ./packages

FROM build AS tools
COPY services ./services
COPY test ./test
USER node

FROM build AS core-build
COPY services/core ./services/core
RUN npm exec -- tsc -p services/core/tsconfig.build.json

FROM build AS bot-build
COPY services/bot ./services/bot
RUN npm exec -- tsc -p services/bot/tsconfig.build.json

FROM build AS input-build
COPY services/input ./services/input
RUN npm exec -- tsc -p services/input/tsconfig.build.json

FROM manifests AS core-runtime
ENV NODE_ENV=production
RUN npm ci --omit=dev --workspace @financebro/core
COPY --from=core-build /app/dist ./dist
USER node
CMD ["node", "dist/services/core/main.js"]

FROM manifests AS bot-runtime
ENV NODE_ENV=production
RUN npm ci --omit=dev --workspace @financebro/bot
COPY --from=bot-build /app/dist ./dist
USER node
CMD ["node", "dist/services/bot/main.js"]

FROM manifests AS input-runtime
ENV NODE_ENV=production
RUN npm ci --omit=dev --workspace @financebro/input \
    && apk add --no-cache ffmpeg
COPY --from=input-build /app/dist ./dist
USER node
CMD ["node", "dist/services/input/main.js"]

FROM bot-runtime AS app
