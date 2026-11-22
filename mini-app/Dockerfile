FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY nuxt.config.ts tsconfig.json ./
COPY app ./app
COPY shared ./shared
RUN npm run generate

FROM nginx:stable-alpine
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/.output/public /usr/share/nginx/html
