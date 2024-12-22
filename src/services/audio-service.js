const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { Queue } = require('../utils/queue');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

class AudioService {
    constructor(groqServices, whatsappClient) {
        this.groqServices = groqServices;
        this.whatsappClient = whatsappClient;
        this.ffmpegPath = process.env.FFMPEG_PATH || ffmpegStatic;
        this.initialized = false;
        ffmpeg.setFfmpegPath(this.ffmpegPath);
    }

    async init() {
        if (this.initialized) return true;

        try {
            const { execSync } = require('child_process');
            execSync(`"${this.ffmpegPath}" -version`);
            this.initialized = true;
            console.log('✅ FFmpeg disponível:', {
                path: this.ffmpegPath,
                timestamp: new Date().toISOString()
            });
            return true;
        } catch (error) {
            console.error('❌ FFmpeg não disponível:', {
                path: this.ffmpegPath,
                erro: error.message,
                timestamp: new Date().toISOString()
            });
            return false;
        }
    }

    async processWhatsAppAudio(message) {
        let inputPath = null;
        let outputPath = null;

        try {
            if (!message || !message.mediaUrl) {
                throw new Error('Mensagem de áudio inválida ou sem URL');
            }

            const ffmpegAvailable = await this.init();
            if (!ffmpegAvailable) {
                return {
                    error: true,
                    message: 'Desculpe, o processamento de áudio está temporariamente indisponível. Por favor, envie sua mensagem em texto.'
                };
            }

            console.log('🎵 Baixando áudio:', {
                messageId: message.messageId,
                url: message.mediaUrl.substring(0, 100),
                timestamp: new Date().toISOString()
            });

            const audioBuffer = await this.whatsappClient.downloadMediaMessage(message);
            
            if (!audioBuffer || audioBuffer.length < 100) {
                throw new Error('Download do áudio falhou ou arquivo muito pequeno');
            }

            const tmpDir = path.join(__dirname, '../../tmp');
            await fs.mkdir(tmpDir, { recursive: true });

            inputPath = path.join(tmpDir, `${message.messageId}_input.ogg`);
            outputPath = path.join(tmpDir, `${message.messageId}_output.wav`);

            await fs.writeFile(inputPath, audioBuffer);

            console.log('🔄 Convertendo áudio:', {
                messageId: message.messageId,
                input: inputPath,
                output: outputPath,
                timestamp: new Date().toISOString()
            });

            // Usa fluent-ffmpeg para converter
            await new Promise((resolve, reject) => {
                ffmpeg()
                    .input(inputPath)
                    .outputOptions([
                        '-ar 16000',
                        '-ac 1',
                        '-c:a pcm_s16le'
                    ])
                    .on('error', (err) => {
                        console.error('❌ Erro na conversão do áudio:', err);
                        reject(err);
                    })
                    .on('end', () => {
                        console.log('✅ Conversão concluída');
                        resolve();
                    })
                    .save(outputPath);
            });

            if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 100) {
                throw new Error('Conversão do áudio falhou');
            }

            console.log('🎯 Transcrevendo áudio:', {
                messageId: message.messageId,
                arquivo: outputPath,
                timestamp: new Date().toISOString()
            });

            const audioData = await fs.readFile(outputPath);
            const transcription = await this.groqServices.transcribeAudio(audioData);

            // Limpa os arquivos temporários
            try {
                await fs.unlink(inputPath);
                await fs.unlink(outputPath);
            } catch (cleanupError) {
                console.error('⚠️ Erro ao limpar arquivos temporários:', {
                    erro: cleanupError.message,
                    timestamp: new Date().toISOString()
                });
            }

            if (!transcription) {
                throw new Error('Transcrição falhou');
            }

            console.log('✅ Áudio processado:', {
                messageId: message.messageId,
                transcriptionLength: transcription.length,
                preview: transcription.substring(0, 100),
                timestamp: new Date().toISOString()
            });

            return transcription;

        } catch (error) {
            console.error('❌ Erro ao processar áudio:', {
                erro: error.message,
                stack: error.stack,
                messageId: message?.messageId,
                timestamp: new Date().toISOString()
            });

            // Limpa arquivos temporários em caso de erro
            if (inputPath || outputPath) {
                try {
                    if (inputPath && fs.existsSync(inputPath)) await fs.unlink(inputPath);
                    if (outputPath && fs.existsSync(outputPath)) await fs.unlink(outputPath);
                } catch (cleanupError) {
                    console.error('⚠️ Erro ao limpar arquivos temporários:', cleanupError);
                }
            }

            return {
                error: true,
                message: 'Desculpe, não consegui processar sua mensagem de voz. Por favor, tente enviar como texto.'
            };
        }
    }
}

module.exports = { AudioService };
