FROM node:20-slim

WORKDIR /app

# Instalar FFmpeg com suporte completo a OPUS
RUN apt-get update && \
    apt-get install -y \
    ffmpeg \
    libopus-dev \
    opus-tools \
    python3 \
    make \
    g++ \
    gcc \
    git && \
    rm -rf /var/lib/apt/lists/*

# Copiar package.json e package-lock.json (se existir)
COPY package*.json ./

# Instalar dependências
RUN npm install --legacy-peer-deps

# Copiar o resto dos arquivos
COPY . .

# Verificar se o FFmpeg tem suporte a OPUS
RUN ffmpeg -formats | grep opus

# Expor a porta que a aplicação usa
EXPOSE 8080

# Comando para iniciar a aplicação
CMD ["npm", "start"]
