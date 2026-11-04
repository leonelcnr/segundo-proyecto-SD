FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY index.js estado.js ./
COPY routes ./routes

# El volumen hereda este dueño, así el proceso puede escribir el log sin ser root
RUN mkdir data && chown node:node data
USER node

EXPOSE 3000
CMD ["node", "index.js"]
