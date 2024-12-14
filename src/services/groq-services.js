const path = require('path');
const fs = require('fs');
const FormData = require('form-data');
const axios = require('axios');
const { spawn } = require('child_process');
const { GROQ_CONFIG } = require('../config/settings');
const { Readable } = require('stream');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

class GroqServices {
    constructor() {
        if (!GROQ_CONFIG || !GROQ_CONFIG.apiKey) {
            throw new Error('GROQ_CONFIG.apiKey é obrigatório');
        }

        this.baseUrl = 'https://api.groq.com/openai/v1';
        this.models = {
            audio: 'whisper-large-v3-turbo',
            vision: 'llama-3.2-90b-vision-preview'
        };

        // Configuração do axios para todas as requisições
        this.axiosInstance = axios.create({
            timeout: 30000, // 30 segundos
            maxContentLength: 25 * 1024 * 1024, // 25MB
            maxBodyLength: 25 * 1024 * 1024, // 25MB
            headers: {
                'Authorization': `Bearer ${GROQ_CONFIG.apiKey}`,
                'Accept': '*/*',
                'User-Agent': 'WhatsApp/2.23.24.82'
            }
        });

        // Configuração do diretório temporário
        this.tempDir = path.join(__dirname, '../../temp');
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
    }

    async processWhatsAppAudio(messageData) {
        try {
            if (!messageData?.message?.audioMessage) {
                throw new Error('Mensagem não contém áudio');
            }

            const audioMessage = messageData.message.audioMessage;
            console.log('🎤 Processando áudio do WhatsApp:', {
                seconds: audioMessage.seconds,
                fileLength: audioMessage.fileLength,
                mimetype: audioMessage.mimetype,
                ptt: audioMessage.ptt,
                mediaKey: audioMessage.mediaKey ? 'presente' : 'ausente',
                url: audioMessage.url ? 'presente' : 'ausente'
            });

            // Validações iniciais
            if (audioMessage.fileLength > 25 * 1024 * 1024) {
                throw new Error('Arquivo de áudio muito grande (máximo 25MB)');
            }

            if (!this._isValidAudioMimeType(audioMessage.mimetype)) {
                throw new Error('Formato de áudio não suportado');
            }

            let audioPath = null;
            try {
                // Descriptografa e baixa o áudio usando Baileys
                const stream = await downloadContentFromMessage(audioMessage, 'audio');
                
                // Salva o stream em um arquivo temporário
                audioPath = path.join(this.tempDir, `audio_${Date.now()}.ogg`);
                const writeStream = fs.createWriteStream(audioPath);
                
                for await (const chunk of stream) {
                    writeStream.write(chunk);
                }
                
                await new Promise((resolve, reject) => {
                    writeStream.on('finish', resolve);
                    writeStream.on('error', reject);
                    writeStream.end();
                });

                console.log('✅ Áudio descriptografado e salvo:', {
                    path: audioPath,
                    size: fs.statSync(audioPath).size
                });

                // Tenta transcrever com retry
                let lastError = null;
                for (let attempt = 1; attempt <= 3; attempt++) {
                    try {
                        // Converte para MP3 antes de enviar
                        const mp3Path = await this._convertToMp3(audioPath);
                        const transcription = await this._transcribeWithGroq(mp3Path);
                        
                        if (!transcription || typeof transcription !== 'string' || transcription.trim().length === 0) {
                            throw new Error('Transcrição vazia ou inválida');
                        }
                        
                        console.log('✅ Transcrição bem sucedida:', transcription);

                        // Limpa o arquivo MP3 temporário
                        if (fs.existsSync(mp3Path)) {
                            fs.unlinkSync(mp3Path);
                            console.log('🗑️ Arquivo MP3 temporário removido:', { path: mp3Path });
                        }

                        return transcription.trim();
                    } catch (error) {
                        lastError = error;
                        console.log(`⚠️ Tentativa ${attempt} falhou:`, error.message);
                        
                        if (attempt === 3) break;
                        
                        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
                    }
                }

                throw lastError || new Error('Falha ao transcrever áudio');

            } finally {
                if (audioPath && fs.existsSync(audioPath)) {
                    this._cleanupTempFile(audioPath);
                }
            }
        } catch (error) {
            console.error('❌ Erro ao processar áudio do WhatsApp:', error);
            if (error.message.includes('muito grande')) {
                return "O áudio é muito grande. Por favor, envie um áudio menor (máximo 25MB).";
            }
            if (error.message.includes('formato')) {
                return "Formato de áudio não suportado. Por favor, envie apenas áudios em formato comum (MP3, OGG, etc).";
            }
            if (error.message.includes('vazia ou inválida')) {
                return "Não foi possível entender o áudio. Por favor, tente gravar novamente com mais clareza.";
            }
            return "Desculpe, não foi possível processar o áudio no momento. Por favor, tente novamente em alguns instantes.";
        }
    }

    async _downloadAudio(url) {
        try {
            console.log('📥 Baixando áudio:', { url });

            const response = await this.axiosInstance({
                url,
                method: 'GET',
                responseType: 'arraybuffer',
                headers: {
                    'User-Agent': 'WhatsApp/2.23.24.82'
                }
            });

            const contentType = response.headers['content-type'] || 'audio/ogg';
            console.log('✅ Download concluído:', {
                contentType: contentType,
                size: response.data.length,
                headers: response.headers
            });

            // Salva como .ogg para manter compatibilidade
            const tempPath = path.join(this.tempDir, `audio_${Date.now()}.ogg`);
            fs.writeFileSync(tempPath, response.data);
            
            // Verifica o header do arquivo
            const header = response.data.slice(0, 16).toString('hex');
            console.log('💾 Áudio salvo:', { 
                path: tempPath,
                contentType: contentType,
                size: response.data.length,
                header: header
            });
            
            return tempPath;
        } catch (error) {
            console.error('❌ Erro ao baixar áudio:', error);
            throw new Error(`Falha ao baixar áudio: ${error.message}`);
        }
    }

    async _convertToMp3(inputPath) {
        try {
            const outputPath = inputPath.replace(/\.[^/.]+$/, '') + '.mp3';
            
            console.log('🔄 Convertendo áudio para MP3:', {
                input: inputPath,
                output: outputPath
            });

            return new Promise((resolve, reject) => {
                const ffmpeg = spawn('ffmpeg', [
                    '-y',                // Sobrescreve arquivo se existir
                    '-i', inputPath,     // Arquivo de entrada
                    '-vn',              // Remove vídeo
                    '-acodec', 'libmp3lame', // Codec MP3
                    '-ar', '16000',     // Taxa de amostragem para Whisper
                    '-ac', '1',         // Mono
                    '-b:a', '64k',      // Bitrate moderado
                    '-f', 'mp3',        // Força formato MP3
                    '-hide_banner',     // Remove banner do ffmpeg
                    '-loglevel', 'error', // Mostra apenas erros
                    outputPath          // Arquivo de saída
                ]);

                let stderr = '';

                ffmpeg.stderr.on('data', (data) => {
                    stderr += data.toString();
                });

                ffmpeg.on('close', (code) => {
                    if (code === 0 && fs.existsSync(outputPath)) {
                        const stats = fs.statSync(outputPath);
                        console.log('✅ Conversão concluída:', { 
                            outputPath,
                            size: stats.size,
                            exists: true
                        });
                        resolve(outputPath);
                    } else {
                        console.error('❌ Erro na conversão:', {
                            code,
                            stderr,
                            outputExists: fs.existsSync(outputPath)
                        });
                        reject(new Error(`Falha na conversão: ${stderr}`));
                    }
                });

                ffmpeg.on('error', (err) => {
                    console.error('❌ Erro ao executar ffmpeg:', err);
                    reject(new Error(`Falha ao executar ffmpeg: ${err.message}`));
                });
            });
        } catch (error) {
            console.error('❌ Erro ao converter áudio:', error);
            throw new Error(`Falha ao converter áudio: ${error.message}`);
        }
    }

    async _transcribeWithGroq(audioPath) {
        try {
            console.log('🎯 Preparando transcrição com Groq:', { path: audioPath });
            
            if (!fs.existsSync(audioPath)) {
                throw new Error(`Arquivo de áudio não encontrado: ${audioPath}`);
            }

            const formData = new FormData();
            
            // Lê o arquivo como stream
            const fileStream = fs.createReadStream(audioPath);
            const stats = fs.statSync(audioPath);

            // Adiciona o arquivo com o nome e tipo correto
            formData.append('file', fileStream, {
                filename: 'audio.mp3',
                contentType: 'audio/mpeg',
                knownLength: stats.size
            });
            
            formData.append('model', this.models.audio);
            formData.append('language', 'pt');
            formData.append('response_format', 'json');

            console.log('📤 Enviando request para Groq:', {
                model: this.models.audio,
                fileSize: stats.size,
                filename: 'audio.mp3',
                contentType: 'audio/mpeg'
            });

            const response = await this.axiosInstance.post(
                `${this.baseUrl}/audio/transcriptions`,
                formData,
                {
                    headers: {
                        ...formData.getHeaders(),
                        'Accept': 'application/json'
                    },
                    maxBodyLength: Infinity,
                    maxContentLength: Infinity
                }
            );

            if (response.data && response.data.text) {
                return response.data.text.trim();
            } else {
                throw new Error('Formato de resposta inválido');
            }
        } catch (error) {
            console.error('❌ Erro na transcrição com Groq:', {
                message: error.message,
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data,
                headers: error.response?.headers,
                config: {
                    url: error.config?.url,
                    method: error.config?.method,
                    headers: error.config?.headers
                }
            });
            throw error;
        }
    }

    _cleanupTempFile(filePath) {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log('🗑️ Arquivo temporário removido:', { path: filePath });
            }
        } catch (error) {
            console.error('⚠️ Erro ao remover arquivo temporário:', error);
        }
    }

    _isValidAudioMimeType(mimetype) {
        if (!mimetype) return false;

        // Limpa o mimetype removendo parâmetros adicionais
        const cleanMimeType = mimetype.split(';')[0].trim().toLowerCase();
        
        const validTypes = [
            'audio/opus',
            'audio/ogg',
            'audio/mpeg',
            'audio/mp3',
            'audio/wav',
            'audio/x-m4a',
            'audio/aac',
            'audio/mp4',
            'audio/webm',
            'audio/amr',
            'audio/x-wav'
        ];

        // Verifica se o formato base é suportado
        const isSupported = validTypes.includes(cleanMimeType);
        
        // Se for audio/ogg com codec opus, também é suportado
        const isOggOpus = cleanMimeType === 'audio/ogg' && mimetype.toLowerCase().includes('codecs=opus');
        
        // Se for audio/webm com codec opus, também é suportado
        const isWebmOpus = cleanMimeType === 'audio/webm' && mimetype.toLowerCase().includes('codecs=opus');
        
        return isSupported || isOggOpus || isWebmOpus;
    }

    async analyzeImage(imageUrl) {
        try {
            console.log('🖼️ Analisando imagem:', { url: imageUrl });
            
            const response = await this.axiosInstance.post(
                `${this.baseUrl}/chat/completions`,
                {
                    model: this.models.vision,
                    messages: [
                        {
                            role: "user",
                            content: [
                                {
                                    type: "text",
                                    text: "Analise este comprovante de pagamento e extraia as seguintes informações:\n" +
                                          "1. Valor da transação\n" +
                                          "2. Banco ou instituição financeira\n" +
                                          "3. Tipo de transação (PIX, TED, DOC, etc)\n" +
                                          "4. Data e hora da transação\n" +
                                          "5. Nome do beneficiário (se disponível)\n" +
                                          "6. Outros detalhes relevantes\n\n" +
                                          "Forneça uma análise detalhada e organizada."
                                },
                                {
                                    type: "image_url",
                                    image_url: imageUrl
                                }
                            ]
                        }
                    ],
                    temperature: 0.5,
                    max_tokens: 1024
                }
            );

            console.log('✅ Análise do comprovante concluída com sucesso');
            return response.data.choices[0].message.content;
        } catch (error) {
            console.error('❌ Erro ao analisar comprovante:', error);
            if (error.response?.status === 413) {
                return "A imagem é muito grande. Por favor, envie uma imagem menor (máximo 50MB).";
            }
            if (error.response?.status === 415) {
                return "Formato de imagem não suportado. Por favor, envie apenas imagens JPG ou PNG.";
            }
            return "Desculpe, não foi possível analisar o comprovante no momento. Por favor, tente novamente em alguns instantes.";
        }
    }
}

module.exports = { GroqServices };
