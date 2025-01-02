const { AudioService } = require('./audio-service');
const { GroqServices } = require('./groq-services');

class WhatsAppAudioService extends AudioService {
    constructor() {
        const groqServices = new GroqServices();
        super(groqServices);
    }

    /**
     * Processa áudio do WhatsApp
     * @param {Object} message Mensagem do WhatsApp
     * @returns {Promise<Object>} Resultado do processamento
     */
    async processWhatsAppAudio(message) {
        try {
            console.log('🎤 Processando áudio do WhatsApp:', {
                messageId: message.key?.id,
                from: message.key?.remoteJid,
                timestamp: new Date().toISOString()
            });

            return await super.processWhatsAppAudio(message);
        } catch (error) {
            console.error('❌ Erro ao processar áudio do WhatsApp:', {
                erro: error.message,
                stack: error.stack,
                messageId: message?.key?.id
            });
            throw error;
        }
    }
}

module.exports = { WhatsAppAudioService };
