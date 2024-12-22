const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('@ffmpeg-installer/ffmpeg');
const fs = require('fs').promises;
const fse = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { Queue } = require('../utils/queue');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const crypto = require('crypto');
const stream = require('stream');
const { promisify } = require('util');
const pipeline = promisify(stream.pipeline);

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
            if (!message) {
                throw new Error('Mensagem inválida');
            }

            console.log('🎤 Processando áudio do WhatsApp:', {
                messageId: message.messageId,
                tipo: message.type,
                timestamp: new Date().toISOString()
            });

            // Usa o whatsappClient injetado no construtor
            const audioBuffer = await this.whatsappClient.downloadMediaMessage(message);
            
            if (!audioBuffer || audioBuffer.length === 0) {
                throw new Error('Buffer de áudio vazio ou inválido');
            }

            console.log('📦 Áudio baixado:', {
                messageId: message.messageId,
                tamanho: audioBuffer.length,
                timestamp: new Date().toISOString()
            });

            // Cria diretório temporário se não existir
            const tmpDir = path.join(__dirname, '../../tmp');
            await fse.ensureDir(tmpDir);

            // Salva o áudio e prepara para conversão
            inputPath = path.join(tmpDir, `${message.messageId}_input.ogg`);
            outputPath = path.join(tmpDir, `${message.messageId}_output.wav`);

            await fs.writeFile(inputPath, audioBuffer);

            console.log('🔄 Convertendo áudio:', {
                messageId: message.messageId,
                input: inputPath,
                output: outputPath,
                tamanhoInput: audioBuffer.length,
                timestamp: new Date().toISOString()
            });

            // Converte usando FFmpeg com auto-detecção de formato
            await new Promise((resolve, reject) => {
                ffmpeg()
                    .input(inputPath)
                    .outputOptions([
                        '-ar 16000',
                        '-ac 1',
                        '-c:a pcm_s16le'
                    ])
                    .on('error', (err) => {
                        console.error('❌ Erro FFmpeg:', {
                            erro: err.message,
                            comando: err.command,
                            timestamp: new Date().toISOString()
                        });
                        reject(err);
                    })
                    .on('end', () => {
                        console.log('✅ Conversão concluída');
                        resolve();
                    })
                    .save(outputPath);
            });

            // Verifica se o arquivo de saída é válido
            const outputStats = await fs.stat(outputPath);
            if (!outputStats || outputStats.size < 100) {
                throw new Error('Arquivo de saída inválido após conversão');
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

// Exporta a classe AudioService da mesma forma que o WhatsAppService
module.exports = { AudioService };
