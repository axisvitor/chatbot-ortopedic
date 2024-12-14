const fs = require('fs');
const fsPromises = require('fs/promises');
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
                // Garante que o diretório temporário existe
                await this._ensureTempDir();

                // Salva o áudio temporariamente
                audioPath = path.join(this.tempDir, `audio_${Date.now()}.ogg`);
                await fsPromises.writeFile(audioPath, audioBuffer);

                console.log('✅ Áudio salvo temporariamente:', {
                    path: audioPath,
                    tamanho: (await fsPromises.stat(audioPath)).size
                });

                // Converte para MP3
                const mp3Path = await this._convertToMp3(audioPath);
                console.log('✅ Áudio convertido para MP3:', {
                    path: mp3Path,
                    tamanho: (await fsPromises.stat(mp3Path)).size
                });
                
                // Transcreve o áudio
                const transcription = await this._transcribeWithGroq(mp3Path);
                console.log('✅ Transcrição concluída:', transcription);
                
                return transcription;
                
            } finally {
                // Limpa os arquivos temporários
                if (audioPath) {
                    await this._cleanupTempFiles(audioPath);
                }
            }
        } catch (error) {
            console.error('❌ Erro ao processar áudio:', error);
            throw error;
        }
    }

    async _ensureTempDir() {
        try {
            if (!fs.existsSync(this.tempDir)) {
                await fsPromises.mkdir(this.tempDir, { recursive: true });
                console.log('✅ Diretório temporário criado:', this.tempDir);
            }
        } catch (error) {
            console.error('❌ Erro ao criar diretório temporário:', error);
            throw error;
        }
    }

    async _cleanupTempFiles(audioPath) {
        try {
            const mp3Path = audioPath.replace('.ogg', '.mp3');
            
            // Remove o arquivo OGG se existir
            if (fs.existsSync(audioPath)) {
                await fsPromises.unlink(audioPath);
                console.log('🗑️ Arquivo OGG removido:', audioPath);
            }
            
            // Remove o arquivo MP3 se existir
            if (fs.existsSync(mp3Path)) {
                await fsPromises.unlink(mp3Path);
                console.log('🗑️ Arquivo MP3 removido:', mp3Path);
            }
        } catch (error) {
            console.error('⚠️ Erro ao limpar arquivos temporários:', error);
            // Não lança o erro para não interromper o fluxo principal
        }
    }

    _isValidAudioMimeType(mimetype) {
        const validMimeTypes = [
            'audio/ogg',
            'audio/ogg; codecs=opus',
            'audio/mpeg',
            'audio/mp3',
            'audio/wav',
            'audio/wave',
            'audio/webm',
            'audio/aac'
        ];
        return validMimeTypes.some(valid => mimetype?.toLowerCase().startsWith(valid));
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

            ffmpegProcess.stderr.on('data', (data) => {
                console.log('🎵 FFmpeg:', data.toString());
            });

            ffmpegProcess.on('close', (code) => {
                if (code === 0) {
                    console.log('✅ Conversão concluída com sucesso');
                    resolve(outputPath);
                } else {
                    console.error('❌ Erro na conversão:', code);
                    reject(new Error(`FFmpeg process exited with code ${code}`));
                }
            });

            ffmpegProcess.on('error', (err) => {
                console.error('❌ Erro no processo FFmpeg:', err);
                reject(err);
            });
        });
    }

    async _transcribeWithGroq(audioPath) {
        try {
            console.log('🎯 Iniciando transcrição com Groq:', audioPath);
            
            // Lê o arquivo MP3
            const audioData = await fsPromises.readFile(audioPath);
            
            // Transcreve usando o Groq
            const formData = new FormData();
            formData.append('file', audioData, {
                filename: 'audio.mp3',
                contentType: 'audio/mpeg',
                knownLength: audioData.length
            });
            const transcription = await this.groqServices.transcribeAudio(formData);
            
            if (!transcription) {
                throw new Error('Transcrição retornou vazia');
            }
            
            return transcription;
        } catch (error) {
            console.error('❌ Erro na transcrição:', error);
            throw error;
        }
    }
}

module.exports = { AudioService };
