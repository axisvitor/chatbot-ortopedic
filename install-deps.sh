#!/bin/bash

# Instala o ffmpeg
if ! command -v ffmpeg &> /dev/null; then
    echo "Instalando ffmpeg..."
    apt-get update && apt-get install -y ffmpeg
else
    echo "ffmpeg já está instalado"
fi
