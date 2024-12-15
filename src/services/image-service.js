const axios = require('axios');
const groqServices = require('./groq-services');
const settings = require('../config/settings');

class ImageService {
    constructor() {
        this.groqServices = groqServices;
        this.MAX_RETRIES = 3;
        this.RETRY_DELAY = 1000; // 1 second
    }

    async downloadImage(url, retryCount = 0) {
        try {
            const imageResponse = await axios.get(url, {
                responseType: 'arraybuffer',
                headers: {
                    'Authorization': `Bearer ${settings.WHATSAPP_CONFIG.token}`
                },
                maxContentLength: 50 * 1024 * 1024 // 50MB
            });
            return imageResponse.data;
        } catch (error) {
            if (error.response) {
                const status = error.response.status;
                if (status === 404) {
                    throw new Error('Imagem não encontrada ou expirada (mais de 14 dias).');
                } else if (status === 401) {
                    throw new Error('Erro de autenticação ao acessar a imagem.');
                }
            }

            // Retry logic for network errors
            if (retryCount < this.MAX_RETRIES) {
                console.log(`[ImageService] Tentativa ${retryCount + 1} de ${this.MAX_RETRIES} para baixar imagem`);
                await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY));
                return this.downloadImage(url, retryCount + 1);
            }

            throw error;
        }
    }

    async processWhatsAppImage({ imageMessage, caption = '', from, messageId, businessHours }) {
        try {
            console.log('[ImageService] Processando imagem:', {
                from,
                messageId,
                hasCaption: !!caption,
                mediaId: imageMessage.id
            });

            // Download da imagem com retry
            const imageData = await this.downloadImage(imageMessage.url);
            
            // Converte para base64
            const base64Image = Buffer.from(imageData).toString('base64');

            // Analisa a imagem com Groq Vision
            const analysis = await this.groqServices.analyzeImage(base64Image);

            return analysis;

        } catch (error) {
            console.error('[ImageService] Erro ao processar imagem:', error);
            
            // Mensagens de erro mais específicas
            if (error.message.includes('14 dias')) {
                throw new Error('Esta imagem não está mais disponível pois foi enviada há mais de 14 dias.');
            } else if (error.message.includes('autenticação')) {
                throw new Error('Houve um erro de autenticação. Por favor, tente novamente mais tarde.');
            }

            throw new Error('Não foi possível processar sua imagem. Por favor, tente novamente ou envie uma mensagem de texto.');
        }
    }
}

module.exports = new ImageService();
