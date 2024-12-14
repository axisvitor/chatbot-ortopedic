const path = require('path');
const fs = require('fs');
const FormData = require('form-data');
const axios = require('axios');
const { spawn } = require('child_process');
const ffmpeg = require('ffmpeg-static');
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
            // Log detalhado da mensagem para debug
            console.log('📩 Mensagem de áudio recebida:', {
                temMensagem: !!messageData?.message,
                temAudio: !!messageData?.message?.audioMessage,
                campos: messageData?.message?.audioMessage ? Object.keys(messageData.message.audioMessage) : []
            });

            if (!messageData?.message?.audioMessage) {
                throw new Error('Mensagem não contém áudio');
            }

            const audioMessage = messageData.message.audioMessage;
            
            // Log detalhado dos campos críticos
            console.log('🎤 Campos do áudio:', {
                url: audioMessage.url ? audioMessage.url.substring(0, 50) + '...' : 'ausente',
                mimetype: audioMessage.mimetype,
                fileLength: audioMessage.fileLength,
                seconds: audioMessage.seconds,
                ptt: audioMessage.ptt,
                mediaKey: audioMessage.mediaKey ? 'presente' : 'ausente',
                fileEncSha256: audioMessage.fileEncSha256 ? 'presente' : 'ausente',
                fileSha256: audioMessage.fileSha256 ? 'presente' : 'ausente',
                directPath: audioMessage.directPath ? 'presente' : 'ausente',
                mediaKeyTimestamp: audioMessage.mediaKeyTimestamp
            });

            // Verifica campos obrigatórios
            const camposObrigatorios = ['url', 'mediaKey', 'fileEncSha256', 'directPath'];
            const camposFaltantes = camposObrigatorios.filter(campo => !audioMessage[campo]);
            
            if (camposFaltantes.length > 0) {
                throw new Error(`Campos obrigatórios ausentes: ${camposFaltantes.join(', ')}`);
            }

            let audioPath = null;
            try {
                // Passa a mensagem de áudio completa para o Baileys
                console.log('🔐 Iniciando descriptografia do áudio...');
                const stream = await downloadContentFromMessage(audioMessage, 'audio');
                
                if (!stream) {
                    throw new Error('Stream de áudio não gerado');
                }

                // Salva o stream em um arquivo temporário
                audioPath = path.join(this.tempDir, `audio_${Date.now()}.ogg`);
                const writeStream = fs.createWriteStream(audioPath);
                
                for await (const chunk of stream) {
                    writeStream.write(chunk);
                }
                
                writeStream.end();
                
                await new Promise((resolve, reject) => {
                    writeStream.on('finish', resolve);
                    writeStream.on('error', reject);
                });

                console.log('✅ Áudio salvo com sucesso:', {
                    path: audioPath,
                    tamanho: fs.statSync(audioPath).size
                });

                // Converte para MP3
                const mp3Path = await this._convertToMp3(audioPath);
                console.log('✅ Áudio convertido para MP3:', {
                    path: mp3Path,
                    tamanho: fs.statSync(mp3Path).size
                });
                
                // Transcreve o áudio
                const transcription = await this._transcribeWithGroq(mp3Path);
                console.log('✅ Transcrição concluída:', transcription);
                
                return transcription;
                
            } finally {
                // Limpa os arquivos temporários
                if (audioPath) {
                    this._cleanupTempFile(audioPath);
                    this._cleanupTempFile(audioPath.replace('.ogg', '.mp3'));
                }
            }
        } catch (error) {
            console.error('❌ Erro ao processar áudio do WhatsApp:', error);
            throw error;
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
        return new Promise((resolve, reject) => {
            console.log('🎵 Iniciando conversão para MP3...');
            const outputPath = inputPath.replace('.ogg', '.mp3');

            // Usando ffmpeg-static em vez do comando do sistema
            const process = spawn(ffmpeg, [
                '-i', inputPath,
                '-acodec', 'libmp3lame',
                '-ar', '44100',
                '-ac', '2',
                '-b:a', '192k',
                outputPath
            ]);

            let errorOutput = '';

            process.stderr.on('data', (data) => {
                errorOutput += data.toString();
                console.log('🔄 FFmpeg progresso:', data.toString());
            });

            process.on('close', (code) => {
                if (code === 0) {
                    console.log('✅ Conversão para MP3 concluída:', {
                        entrada: inputPath,
                        saida: outputPath,
                        tamanhoEntrada: fs.statSync(inputPath).size,
                        tamanhoSaida: fs.statSync(outputPath).size
                    });
                    resolve(outputPath);
                } else {
                    console.error('❌ Erro ao converter áudio:', {
                        codigo: code,
                        erro: errorOutput
                    });
                    reject(new Error(`FFmpeg falhou com código ${code}: ${errorOutput}`));
                }
            });

            process.on('error', (err) => {
                console.error('❌ Erro ao executar FFmpeg:', err);
                reject(err);
            });
        });
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

    async analyzeImage(imagePath) {
        try {
            console.log('🖼️ Analisando imagem:', { path: imagePath });

            // Verificar se o arquivo existe
            if (!fs.existsSync(imagePath)) {
                throw new Error(`Arquivo de imagem não encontrado: ${imagePath}`);
            }

            // Ler o arquivo e converter para base64
            const imageBuffer = await fs.promises.readFile(imagePath);
            const base64Image = imageBuffer.toString('base64');

            // Determinar o tipo MIME baseado na extensão
            const mimeType = path.extname(imagePath).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
            
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
                                    image_url: {
                                        url: `data:${mimeType};base64,${base64Image}`
                                    }
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
            console.error('❌ Erro ao analisar comprovante:', {
                message: error.message,
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data
            });

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
