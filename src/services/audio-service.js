const fs = require('fs').promises;
const path = require('path');
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
            console.log('📩 Mensagem de áudio recebida:', {
                temMensagem: !!messageData?.message,
                temAudio: !!messageData?.message?.audioMessage,
                campos: messageData?.message?.audioMessage ? Object.keys(messageData.message.audioMessage) : []
            });

            const audioMessage = messageData?.message?.audioMessage;
            if (!audioMessage) {
                throw new Error('Dados do áudio ausentes ou inválidos');
            }

            // Log detalhado dos campos críticos
            console.log('🎤 Campos do áudio:', {
                mimetype: audioMessage.mimetype,
                fileLength: audioMessage.fileLength,
                seconds: audioMessage.seconds,
                ptt: audioMessage.ptt,
                mediaKey: audioMessage.mediaKey ? 'presente' : 'ausente',
                fileEncSha256: audioMessage.fileEncSha256 ? 'presente' : 'ausente',
                fileSha256: audioMessage.fileSha256 ? 'presente' : 'ausente'
            });

            // Verifica campos obrigatórios
            const camposObrigatorios = ['mediaKey', 'fileEncSha256', 'fileSha256', 'mimetype'];
            const camposFaltantes = camposObrigatorios.filter(campo => !audioMessage[campo]);
            
            if (camposFaltantes.length > 0) {
                throw new Error(`Campos obrigatórios ausentes: ${camposFaltantes.join(', ')}`);
            }

            // Verifica o tipo MIME
            if (!this._isValidAudioMimeType(audioMessage.mimetype)) {
                throw new Error(`Formato de áudio não suportado: ${audioMessage.mimetype}`);
            }

            let audioPath = null;
            try {
                // Download e processamento do áudio
                console.log('🔐 Iniciando descriptografia do áudio...');
                const stream = await downloadContentFromMessage(audioMessage, 'audio');
                
                if (!stream) {
                    throw new Error('Stream de áudio não gerado');
                }

                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }

                // Salva o áudio temporariamente
                if (!fs.existsSync(this.tempDir)) {
                    await fs.mkdir(this.tempDir, { recursive: true });
                }

                audioPath = path.join(this.tempDir, `audio_${Date.now()}.ogg`);
                await fs.writeFile(audioPath, buffer);

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
                        saida: outputPath
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
            if (await fs.access(filePath).then(() => true).catch(() => false)) {
                await fs.unlink(filePath);
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
}

module.exports = { AudioService };
