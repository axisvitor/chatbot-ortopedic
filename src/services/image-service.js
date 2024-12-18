const axios = require('axios');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const groqServices = require('./groq-services');
const settings = require('../config/settings');

class ImageService {
    constructor(groqServices, whatsappClient) {
        if (!groqServices) {
            throw new Error('GroqServices é obrigatório');
        }
        if (!whatsappClient) {
            throw new Error('WhatsappClient é obrigatório');
        }
        this.groqServices = groqServices;
        this.whatsappClient = whatsappClient;
        this.MAX_RETRIES = 3;
        this.RETRY_DELAY = 1000; // 1 second
    }

    async processWhatsAppImage({ imageMessage, caption = '', from, messageId, businessHours }) {
        try {
            console.log('[ImageService] Processando imagem:', {
                from,
                messageId,
                hasCaption: !!caption,
                mediaId: imageMessage.id,
                mimetype: imageMessage.mimetype,
                fileLength: imageMessage.fileLength
            });

            // Baixa e descriptografa a imagem usando o Baileys
            console.log('📥 Baixando e descriptografando imagem...');
            
            const buffer = await downloadMediaMessage(
                { message: { imageMessage } },
                'buffer',
                {},
                {
                    logger: console,
                    reuploadRequest: async (media) => {
                        console.log('[ImageService] Tentando baixar mídia:', {
                            url: media.url?.substring(0, 50) + '...',
                            headers: media.headers
                        });
                        
                        const response = await axios.get(media.url, {
                            responseType: 'arraybuffer',
                            headers: { Origin: 'https://web.whatsapp.com' }
                        });
                        
                        console.log('[ImageService] Mídia baixada com sucesso:', {
                            contentType: response.headers['content-type'],
                            contentLength: response.data.length
                        });
                        
                        return response.data;
                    }
                }
            );

            console.log('[ImageService] Buffer recebido:', {
                length: buffer?.length,
                isBuffer: Buffer.isBuffer(buffer),
                firstBytes: buffer?.slice(0, 16).toString('hex')
            });

            // Converte para base64
            const base64Image = buffer.toString('base64');
            
            console.log('[ImageService] Imagem convertida para base64:', {
                base64Length: base64Image?.length,
                preview: base64Image?.substring(0, 50) + '...'
            });

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

module.exports = ImageService;
