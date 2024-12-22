const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const fs = require('fs').promises;
const fse = require('fs-extra');
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
        this.hasOpusSupport = false;
        this.opusDetectionAttempts = 0;
        
        // Configura o fluent-ffmpeg para usar o caminho correto
        ffmpeg.setFfmpegPath(this.ffmpegPath);
    }

    async init() {
        if (this.initialized) return true;

        try {
            // Tenta executar ffmpeg -version
            const { stdout } = await execAsync(`"${this.ffmpegPath}" -version`);
            
            // Verifica suporte a OPUS de forma mais robusta
            const { stdout: formats } = await execAsync(`"${this.ffmpegPath}" -formats`);
            const { stdout: codecs } = await execAsync(`"${this.ffmpegPath}" -codecs`);
            
            // Verifica tanto o formato quanto o codec
            this.hasOpusSupport = formats.toLowerCase().includes('opus') && 
                                codecs.toLowerCase().includes('opus');
            
            this.initialized = true;
            console.log('✅ FFmpeg disponível:', {
                path: this.ffmpegPath,
                version: stdout.split('\n')[0],
                opusSupport: this.hasOpusSupport,
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
            await fse.ensureDir(tmpDir);

            // Tenta diferentes abordagens para processar o áudio
            const attempts = [
                { ext: '.opus', format: 'opus' },
                { ext: '.ogg', format: 'ogg' },
                { ext: '.webm', format: 'webm' }
            ];

            let success = false;
            let error = null;

            for (const attempt of attempts) {
                try {
                    inputPath = path.join(tmpDir, `${message.messageId}_input${attempt.ext}`);
                    outputPath = path.join(tmpDir, `${message.messageId}_output.wav`);

                    await fs.writeFile(inputPath, audioBuffer);

                    console.log('🔄 Tentando converter áudio:', {
                        messageId: message.messageId,
                        input: inputPath,
                        format: attempt.format,
                        timestamp: new Date().toISOString()
                    });

                    await new Promise((resolve, reject) => {
                        ffmpeg()
                            .input(inputPath)
                            .inputOptions([`-f ${attempt.format}`])
                            .outputOptions([
                                '-ar 16000',
                                '-ac 1',
                                '-c:a pcm_s16le'
                            ])
                            .on('error', reject)
                            .on('end', resolve)
                            .save(outputPath);
                    });

                    // Verifica se o arquivo de saída é válido
                    const outputStats = await fs.stat(outputPath);
                    if (outputStats && outputStats.size >= 100) {
                        success = true;
                        break;
                    }
                } catch (attemptError) {
                    error = attemptError;
                    console.log(`⚠️ Tentativa com ${attempt.format} falhou:`, attemptError.message);
                    
                    // Limpa arquivos desta tentativa
                    try {
                        if (fse.existsSync(inputPath)) await fs.unlink(inputPath);
                        if (fse.existsSync(outputPath)) await fs.unlink(outputPath);
                    } catch (cleanupError) {
                        console.error('⚠️ Erro ao limpar arquivos temporários:', cleanupError);
                    }
                }
            }

            if (!success) {
                throw error || new Error('Todas as tentativas de conversão falharam');
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
                if (fse.existsSync(inputPath)) await fs.unlink(inputPath);
                if (fse.existsSync(outputPath)) await fs.unlink(outputPath);
            } catch (cleanupError) {
                console.error('⚠️ Erro ao limpar arquivos temporários:', cleanupError);
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
            try {
                if (inputPath && fse.existsSync(inputPath)) await fs.unlink(inputPath);
                if (outputPath && fse.existsSync(outputPath)) await fs.unlink(outputPath);
            } catch (cleanupError) {
                console.error('⚠️ Erro ao limpar arquivos temporários:', cleanupError);
            }

            return {
                error: true,
                message: 'Desculpe, não consegui processar sua mensagem de voz. Por favor, tente enviar como texto.'
            };
        }
    }
}

// Exporta a classe AudioService
module.exports = AudioService;
