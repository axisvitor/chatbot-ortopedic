const axios = require('axios');
const FormData = require('form-data');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { GROQ_CONFIG } = require('../config/settings');

class AudioService {
    constructor(groqServices) {
        if (!groqServices) {
            throw new Error('GroqServices é obrigatório');
        }
        this.groqServices = groqServices;
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
            const allowedMimes = ['audio/ogg', 'audio/mpeg', 'audio/mp4'];
            if (!allowedMimes.includes(mimeType)) {
                throw new Error(`Tipo de áudio não suportado: ${mimeType}`);
            }

            // Download e descriptografia do áudio usando Baileys
            console.log('📥 Baixando e descriptografando áudio...', {
                mimetype: mimeType,
                seconds: messageData.audioMessage.seconds,
                fileLength: messageData.audioMessage.fileLength
            });
            
            const stream = await downloadContentFromMessage(messageData.audioMessage, 'audio');
            
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
                contentType: mimeType
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
