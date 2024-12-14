const axios = require('axios');
const FormData = require('form-data');

class AudioService {
    constructor(groqServices) {
        this.groqServices = groqServices;
    }

    async processWhatsAppAudio(messageData) {
        try {
            const audioMessage = messageData?.audioMessage;
            if (!audioMessage?.url) {
                throw new Error('URL do áudio não encontrada');
            }

            // Download do áudio
            const response = await axios.get(audioMessage.url, {
                responseType: 'arraybuffer',
                headers: {
                    'Authorization': `Bearer ${process.env.WHATSAPP_API_KEY}`
                }
            });

            // Prepara o FormData com o áudio
            const formData = new FormData();
            formData.append('file', Buffer.from(response.data), {
                filename: 'audio.ogg',
                contentType: audioMessage.mimetype || 'audio/ogg; codecs=opus'
            });
            formData.append('model', 'whisper-large-v3-turbo');
            formData.append('language', 'pt');
            formData.append('response_format', 'json');
            formData.append('temperature', 0.0);

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
