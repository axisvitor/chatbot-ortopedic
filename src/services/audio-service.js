const ffmpeg = require('fluent-ffmpeg');
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
        this.audioQueue = new Queue();
        this.tempDir = path.join(__dirname, '../../temp');
        this.ffmpegChecked = false;
        this.ffmpegAvailable = false;
        this.ensureTempDir();
    }

    async ensureTempDir() {
        try {
            await fs.access(this.tempDir);
        } catch {
            await fs.mkdir(this.tempDir, { recursive: true });
        }
    }

    async checkFfmpeg() {
        if (this.ffmpegChecked) {
            return this.ffmpegAvailable;
        }

        try {
            await execAsync('ffmpeg -version');
            this.ffmpegAvailable = true;
            console.log('✅ FFmpeg encontrado e disponível');
        } catch (error) {
            this.ffmpegAvailable = false;
            console.error('❌ FFmpeg não encontrado:', error.message);
        }

        this.ffmpegChecked = true;
        return this.ffmpegAvailable;
    }

    async processWhatsAppAudio(message) {
        if (!message || !message.type === 'audio') {
            throw new Error('Mensagem de áudio inválida');
        }

        const audioPath = path.join(this.tempDir, `${uuidv4()}.ogg`);
        const wavPath = path.join(this.tempDir, `${uuidv4()}.wav`);

        try {
            // Verifica se o FFmpeg está disponível
            const ffmpegOk = await this.checkFfmpeg();
            if (!ffmpegOk) {
                throw new Error('FFmpeg não está instalado. Por favor, instale o FFmpeg para processar áudios.');
            }

            console.log('📥 Baixando áudio do WhatsApp...', {
                messageId: message.messageId,
                timestamp: new Date().toISOString()
            });

            // Download do áudio
            const audioBuffer = await this.whatsappClient.downloadMediaMessage(message);
            await fs.writeFile(audioPath, audioBuffer);

            console.log('🔄 Convertendo áudio para WAV...', {
                origem: audioPath,
                destino: wavPath,
                timestamp: new Date().toISOString()
            });

            // Converte para WAV
            await this.convertToWav(audioPath, wavPath);

            console.log('📝 Transcrevendo áudio...', {
                arquivo: wavPath,
                timestamp: new Date().toISOString()
            });

            // Lê o arquivo WAV
            const wavBuffer = await fs.readFile(wavPath);
            
            // Transcreve o áudio
            const transcription = await this.groqServices.transcribeAudio(wavBuffer);

            console.log('✅ Áudio transcrito com sucesso:', {
                transcricao: transcription?.substring(0, 100),
                timestamp: new Date().toISOString()
            });

            return transcription;

        } catch (error) {
            console.error('❌ Erro ao processar áudio:', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        } finally {
            // Limpa os arquivos temporários de forma segura
            try {
                if (await fs.access(audioPath).then(() => true).catch(() => false)) {
                    await fs.unlink(audioPath);
                }
                if (await fs.access(wavPath).then(() => true).catch(() => false)) {
                    await fs.unlink(wavPath);
                }
            } catch (cleanupError) {
                console.error('⚠️ Erro ao limpar arquivos temporários:', cleanupError);
            }
        }
    }

    convertToWav(inputPath, outputPath) {
        return new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .toFormat('wav')
                .on('error', error => {
                    console.error('❌ Erro na conversão do áudio:', error);
                    reject(error);
                })
                .on('end', () => {
                    console.log('✅ Áudio convertido com sucesso');
                    resolve();
                })
                .save(outputPath);
        });
    }

    async cleanupFiles(...files) {
        for (const file of files) {
            try {
                await fs.unlink(file);
                console.log('🧹 Arquivo temporário removido:', file);
            } catch (error) {
                console.error('Erro ao deletar arquivo', file, ':', error);
            }
        }
    }
}

module.exports = AudioService;
