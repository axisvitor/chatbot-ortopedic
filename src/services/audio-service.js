const axios = require('axios');
const FormData = require('form-data');
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

            // Download do áudio da URL
            console.log('📥 Baixando áudio...', {
                url: messageData.audioMessage.url,
                mimetype: mimeType,
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

            // Prepara o FormData com o áudio
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
