# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Instalar dependências de build
RUN apt-get update && \
    apt-get install -y \
    python3 \
    make \
    g++ \
    gcc \
    git && \
    rm -rf /var/lib/apt/lists/*

# Copiar package.json e package-lock.json
COPY package*.json ./

# Instalar dependências
RUN npm ci --only=production --legacy-peer-deps

# Copiar o resto dos arquivos
COPY . .

# Production stage
FROM node:20-slim

WORKDIR /app

# Instalar FFmpeg com suporte completo a OPUS
RUN apt-get update && \
    apt-get install -y \
    ffmpeg \
    libopus-dev \
    opus-tools && \
    rm -rf /var/lib/apt/lists/*

# Criar diretórios necessários
RUN mkdir -p /data/logs /data/temp && \
    chown -R node:node /data

# Copiar arquivos do builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/docs ./docs

# Verificar se o FFmpeg tem suporte a OPUS
RUN ffmpeg -formats | grep opus

# Usar usuário não-root
USER node

# Expor a porta que a aplicação usa
EXPOSE 3000

# Configurar volumes
VOLUME ["/data/logs", "/data/temp"]

# Healthcheck
HEALTHCHECK --interval=45s --timeout=30s --start-period=120s --retries=5 \
    CMD curl -f http://localhost:3000/health || exit 1

# Comando para iniciar a aplicação
CMD ["npm", "start"]
