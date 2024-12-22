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
        this.ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
        this.initialized = false;
    }

    async init() {
        if (this.initialized) return true;

        try {
            // Tenta executar ffmpeg -version
            const { execSync } = require('child_process');
            execSync(`${this.ffmpegPath} -version`);
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
        try {
            if (!message || !message.mediaUrl) {
                throw new Error('Mensagem de áudio inválida ou sem URL');
            }

            // Verifica se FFmpeg está disponível
            const ffmpegAvailable = await this.init();
            if (!ffmpegAvailable) {
                throw new Error('FFmpeg não está disponível. Por favor, configure o caminho correto em FFMPEG_PATH.');
            }

            console.log('🎵 Baixando áudio:', {
                messageId: message.messageId,
                url: message.mediaUrl.substring(0, 100),
                timestamp: new Date().toISOString()
            });

            // Baixa o áudio
            const audioBuffer = await this.whatsappClient.downloadMediaMessage(message);
            
            if (!audioBuffer || audioBuffer.length < 100) {
                throw new Error('Download do áudio falhou ou arquivo muito pequeno');
            }

            // Cria diretório temporário se não existir
            const tmpDir = path.join(__dirname, '../../tmp');
            if (!fs.existsSync(tmpDir)) {
                fs.mkdirSync(tmpDir, { recursive: true });
            }

            // Define caminhos dos arquivos
            const inputPath = path.join(tmpDir, `${message.messageId}_input.ogg`);
            const outputPath = path.join(tmpDir, `${message.messageId}_output.wav`);

            // Salva o buffer como arquivo
            fs.writeFileSync(inputPath, audioBuffer);

            console.log('🔄 Convertendo áudio:', {
                messageId: message.messageId,
                input: inputPath,
                output: outputPath,
                timestamp: new Date().toISOString()
            });

            // Converte o áudio
            const { execSync } = require('child_process');
            execSync(`${this.ffmpegPath} -i "${inputPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${outputPath}" -y`);

            // Verifica se o arquivo de saída existe e tem tamanho adequado
            if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 100) {
                throw new Error('Conversão do áudio falhou');
            }

            console.log('🎯 Transcrevendo áudio:', {
                messageId: message.messageId,
                arquivo: outputPath,
                timestamp: new Date().toISOString()
            });

            // Lê o arquivo convertido
            const audioData = fs.readFileSync(outputPath);

            // Transcreve o áudio
            const transcription = await this.groqServices.transcribeAudio(audioData);

            // Limpa os arquivos temporários
            try {
                fs.unlinkSync(inputPath);
                fs.unlinkSync(outputPath);
            } catch (cleanupError) {
                console.warn('⚠️ Erro ao limpar arquivos temporários:', {
                    erro: cleanupError.message,
                    timestamp: new Date().toISOString()
                });
            }

            if (!transcription) {
                throw new Error('Transcrição falhou');
            }

            console.log('✅ Áudio transcrito com sucesso:', {
                messageId: message.messageId,
                tamanho: transcription.length,
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

            // Tenta limpar arquivos temporários em caso de erro
            try {
                const tmpDir = path.join(__dirname, '../../tmp');
                const inputPath = path.join(tmpDir, `${message?.messageId}_input.ogg`);
                const outputPath = path.join(tmpDir, `${message?.messageId}_output.wav`);
                
                if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
                if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            } catch (cleanupError) {
                console.warn('⚠️ Erro ao limpar arquivos temporários:', cleanupError);
            }

            throw error;
        }
    }
}

module.exports = { AudioService };
