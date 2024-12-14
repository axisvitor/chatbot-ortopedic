const axios = require('axios');
const FormData = require('form-data');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const settings = require('../config/settings');

class AudioService {
    constructor(groqServices) {
        this.groqServices = groqServices;
    }

    async processWhatsAppAudio(messageData) {
        try {
            const audioMessage = messageData?.message?.audioMessage;
            if (!audioMessage) {
                throw new Error('Mensagem de áudio não encontrada');
            }

            // Download e descriptografia do áudio usando Baileys
            console.log('📥 Baixando e descriptografando áudio...');
            const stream = await downloadContentFromMessage(audioMessage, 'audio');
            
            if (!stream) {
                console.error('❌ Stream não gerado pelo Baileys');
                throw new Error('Não foi possível iniciar o download do áudio');
            }

            // Converter stream em buffer
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }

            if (!buffer.length) {
                console.error('❌ Buffer vazio após download');
                throw new Error('Download do áudio falhou');
            }

            console.log('✅ Áudio baixado e descriptografado:', {
                tamanhoBuffer: buffer.length,
                primeirosBytes: buffer.slice(0, 16).toString('hex')
            });

            // Prepara o FormData com o áudio descriptografado
            const formData = new FormData();
            formData.append('file', buffer, {
                filename: 'audio.ogg',
                contentType: audioMessage.mimetype || 'audio/ogg; codecs=opus'
            });
            formData.append('model', settings.GROQ_CONFIG.models.audio);
            formData.append('language', settings.GROQ_CONFIG.audioConfig.language);
            formData.append('response_format', settings.GROQ_CONFIG.audioConfig.response_format);
            formData.append('temperature', settings.GROQ_CONFIG.audioConfig.temperature);

            // Transcreve o áudio
            const transcription = await this.groqServices.transcribeAudio(formData);
            return transcription;

        } catch (error) {
            console.error('❌ Erro ao processar áudio:', error);
            throw error;
        }
    }
}

module.exports = { AudioService };
