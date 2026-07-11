FROM node:22-alpine AS build
WORKDIR /app
COPY package.json tsconfig.json tsconfig.node.json vite.config.ts index.html ./
COPY src ./src
RUN npm install && npm run build

FROM httpd:2.4-alpine
COPY --from=build /app/dist/ /usr/local/apache2/htdocs/
EXPOSE 80
