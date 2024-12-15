const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const os = require('os');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const { promisify } = require('util');
const { GROQ_CONFIG } = require('../config/settings');

// Configura o caminho do ffmpeg
ffmpeg.setFfmpegPath(ffmpegPath);

class AudioService {
    constructor(groqServices) {
        if (!groqServices) {
            throw new Error('GroqServices é obrigatório');
        }
        this.groqServices = groqServices;
    }

    /**
     * Converte áudio para formato compatível usando ffmpeg
     * @param {Buffer} inputBuffer - Buffer do áudio original
     * @returns {Promise<Buffer>} Buffer do áudio convertido
     */
    async convertAudio(inputBuffer) {
        const tempDir = os.tmpdir();
        const inputPath = path.join(tempDir, `input-${Date.now()}.ogg`);
        const outputPath = path.join(tempDir, `output-${Date.now()}.mp3`);

        try {
            // Salva o buffer em um arquivo temporário
            await fs.promises.writeFile(inputPath, inputBuffer);

            // Converte para MP3 usando ffmpeg
            await new Promise((resolve, reject) => {
                ffmpeg(inputPath)
                    .toFormat('mp3')
                    .audioChannels(1)
                    .audioFrequency(16000)
                    .on('error', reject)
                    .on('end', resolve)
                    .save(outputPath);
            });

            // Lê o arquivo convertido
            const convertedBuffer = await fs.promises.readFile(outputPath);

            // Limpa arquivos temporários
            await Promise.all([
                fs.promises.unlink(inputPath),
                fs.promises.unlink(outputPath)
            ]);

            return convertedBuffer;
        } catch (error) {
            console.error('❌ Erro ao converter áudio:', error);
            throw new Error(`Falha ao converter áudio: ${error.message}`);
        }
    }

    /**
     * Processa um áudio do WhatsApp
     * @param {Object} messageData - Dados da mensagem do WhatsApp
     * @returns {Promise<string>} Texto transcrito
     */
    async processWhatsAppAudio(messageData) {
        try {
            console.log('📝 Estrutura da mensagem recebida:', JSON.stringify(messageData, null, 2));

            // Verifica se é uma mensagem de áudio válida
            if (!messageData?.audioMessage) {
                throw new Error('Mensagem de áudio não encontrada');
            }

            // Validação do tipo MIME
            const mimeType = messageData.audioMessage.mimetype;
            const allowedMimes = ['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/opus'];
            const baseMimeType = mimeType.split(';')[0].trim();
            
            if (!allowedMimes.includes(baseMimeType) && !mimeType.startsWith('audio/')) {
                throw new Error(`Tipo de áudio não suportado: ${mimeType}`);
            }

            // Download do áudio da URL
            console.log('📥 Baixando áudio...', {
                url: messageData.audioMessage.url,
                mimetype: messageData.audioMessage.mimetype,
                seconds: messageData.audioMessage.seconds,
                fileLength: messageData.audioMessage.fileLength
            });
            
            const response = await axios({
                method: 'GET',
                url: messageData.audioMessage.url,
                responseType: 'arraybuffer',
                timeout: 30000,
                maxContentLength: 10 * 1024 * 1024 // 10MB
            });

            const buffer = Buffer.from(response.data);

            if (!buffer.length) {
                console.error('❌ Buffer vazio após download');
                throw new Error('Download do áudio falhou');
            }

            console.log('✅ Áudio baixado:', {
                tamanhoBuffer: buffer.length,
                primeirosBytes: buffer.slice(0, 16).toString('hex')
            });

            // Converte o áudio para MP3
            console.log('🔄 Convertendo áudio para MP3...');
            const convertedBuffer = await this.convertAudio(buffer);

            // Prepara o FormData com o áudio convertido
            const formData = new FormData();
            formData.append('file', convertedBuffer, {
                filename: 'audio.mp3',
                contentType: 'audio/mpeg'
            });
            formData.append('model', GROQ_CONFIG.models.audio);
            formData.append('language', GROQ_CONFIG.audioConfig.language);
            formData.append('response_format', GROQ_CONFIG.audioConfig.response_format);
            formData.append('temperature', GROQ_CONFIG.audioConfig.temperature);

            // Transcreve o áudio usando GroqServices
            const transcription = await this.groqServices.transcribeAudio(formData);
            
            console.log('✅ Áudio transcrito com sucesso:', {
                length: transcription.length,
                preview: transcription.substring(0, 100)
            });

            return transcription;

        } catch (error) {
            console.error('❌ Erro ao processar áudio:', {
                message: error.message,
                stack: error.stack,
                messageData: JSON.stringify(messageData, null, 2)
            });
            throw error;
        }
    }
}

module.exports = { AudioService };
