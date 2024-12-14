const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { spawn } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const FormData = require('form-data');

class AudioService {
    constructor(groqServices) {
        this.groqServices = groqServices;
        this.tempDir = path.join(__dirname, '../../temp');
    }

    async processWhatsAppAudio(messageData) {
        try {
            // Log detalhado da mensagem para debug
            console.log('📩 Processando áudio do WhatsApp:', {
                temMensagem: !!messageData,
                temAudio: !!messageData?.audioMessage,
                campos: messageData?.audioMessage ? Object.keys(messageData.audioMessage) : [],
                temBuffer: !!messageData?.audioMessage?.buffer,
                temUrl: !!messageData?.audioMessage?.url,
                tamanhoBuffer: messageData?.audioMessage?.buffer?.length,
                fileLength: messageData?.audioMessage?.fileLength
            });

            const audioMessage = messageData?.audioMessage;
            if (!audioMessage) {
                console.error('❌ Dados do áudio ausentes');
                throw new Error('Dados do áudio ausentes ou inválidos');
            }

            let audioBuffer = audioMessage.buffer;

            // Se não tiver buffer mas tiver URL, tenta baixar
            if (!audioBuffer && audioMessage.url) {
                console.log('🔄 Buffer não encontrado, tentando download da URL...');
                try {
                    const response = await axios.get(audioMessage.url, {
                        responseType: 'arraybuffer',
                        headers: {
                            'Authorization': `Bearer ${process.env.WHATSAPP_API_KEY}`
                        }
                    });
                    audioBuffer = Buffer.from(response.data);
                    console.log('✅ Download concluído:', {
                        tamanhoBuffer: audioBuffer.length
                    });
                } catch (downloadError) {
                    console.error('❌ Erro no download:', downloadError);
                    throw new Error('Falha ao baixar áudio: ' + downloadError.message);
                }
            }

            if (!audioBuffer || !audioBuffer.length) {
                throw new Error('Dados binários do áudio não encontrados');
            }

            // Log detalhado dos campos críticos
            console.log('🎤 Dados do áudio:', {
                mimetype: audioMessage.mimetype,
                fileLength: audioMessage.fileLength,
                seconds: audioMessage.seconds,
                ptt: audioMessage.ptt,
                tamanhoBuffer: audioBuffer.length
            });

            // Verifica o tipo MIME
            if (!this._isValidAudioMimeType(audioMessage.mimetype)) {
                throw new Error(`Formato de áudio não suportado: ${audioMessage.mimetype}`);
            }

            let audioPath = null;
            try {
                // Salva o áudio temporariamente
                if (!fs.existsSync(this.tempDir)) {
                    await fs.mkdir(this.tempDir, { recursive: true });
                }

                audioPath = path.join(this.tempDir, `audio_${Date.now()}.ogg`);
                await fs.writeFile(audioPath, audioBuffer);

                console.log('✅ Áudio salvo temporariamente:', {
                    path: audioPath,
                    tamanho: (await fs.stat(audioPath)).size
                });

                // Converte para MP3
                const mp3Path = await this._convertToMp3(audioPath);
                console.log('✅ Áudio convertido para MP3:', {
                    path: mp3Path,
                    tamanho: (await fs.stat(mp3Path)).size
                });
                
                // Transcreve o áudio
                const transcription = await this._transcribeWithGroq(mp3Path);
                console.log('✅ Transcrição concluída:', transcription);
                
                return transcription;
                
            } finally {
                // Limpa os arquivos temporários
                if (audioPath) {
                    await this._cleanupTempFile(audioPath);
                    await this._cleanupTempFile(audioPath.replace('.ogg', '.mp3'));
                }
            }
        } catch (error) {
            console.error('❌ Erro ao processar áudio:', error);
            throw error;
        }
    }

    async _convertToMp3(inputPath) {
        return new Promise((resolve, reject) => {
            const outputPath = inputPath.replace('.ogg', '.mp3');
            
            console.log('🔄 Iniciando conversão para MP3:', {
                entrada: inputPath,
                saida: outputPath
            });

            const ffmpegProcess = spawn(ffmpeg, [
                '-i', inputPath,
                '-acodec', 'libmp3lame',
                '-q:a', '2',
                outputPath
            ]);

            let stderr = '';

            ffmpegProcess.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            ffmpegProcess.on('close', (code) => {
                if (code === 0) {
                    console.log('✅ Conversão concluída com sucesso');
                    resolve(outputPath);
                } else {
                    console.error('❌ Erro na conversão:', {
                        codigo: code,
                        erro: stderr
                    });
                    reject(new Error(`Falha na conversão do áudio: ${stderr}`));
                }
            });

            ffmpegProcess.on('error', (error) => {
                console.error('❌ Erro ao iniciar ffmpeg:', error);
                reject(error);
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
            const stats = await fs.stat(audioPath);

            // Adiciona o arquivo com o nome e tipo correto
            formData.append('file', fileStream, {
                filename: 'audio.mp3',
                contentType: 'audio/mpeg',
                knownLength: stats.size
            });
            
            return await this.groqServices.transcribeAudio(formData);

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

    async _cleanupTempFile(filePath) {
        try {
            if (filePath && await fs.access(filePath).then(() => true).catch(() => false)) {
                await fs.unlink(filePath);
                console.log('🧹 Arquivo temporário removido:', filePath);
            }
        } catch (error) {
            console.error('❌ Erro ao remover arquivo temporário:', {
                path: filePath,
                error: error.message
            });
        }
    }

    _isValidAudioMimeType(mimetype) {
        const validMimeTypes = [
            'audio/ogg',
            'audio/ogg; codecs=opus',
            'audio/mpeg',
            'audio/mp3',
            'audio/wav',
            'audio/webm',
            'audio/aac'
        ];
        return validMimeTypes.some(validType => 
            mimetype.toLowerCase().startsWith(validType.toLowerCase())
        );
    }
}

module.exports = { AudioService };
