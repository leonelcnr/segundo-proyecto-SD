# Etapa 1: compila la página React
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Etapa 2: el servidor, con la página ya compilada
FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
# .dockerignore deja afuera node_modules, data, .env y el código de web/
COPY . .
COPY --from=web /web/dist ./web/dist

# El volumen hereda este dueño, así el proceso puede escribir el log sin ser root
RUN mkdir data && chown node:node data
USER node

EXPOSE 3000
CMD ["node", "index.js"]
