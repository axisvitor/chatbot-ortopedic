const axios = require('axios');
const { WHATSAPP_CONFIG } = require('../config/settings');

class WhatsAppService {
    constructor() {
        this.client = null;
        this.connectionKey = null;
        this.init();
    }

    async init() {
        try {
            if (!WHATSAPP_CONFIG.token) {
                throw new Error('Token não configurado');
            }

            this.connectionKey = WHATSAPP_CONFIG.connectionKey;
            this.client = await this.createClient();
            
            console.log('[WhatsApp] Cliente inicializado com sucesso');
        } catch (error) {
            console.error('[WhatsApp] Erro ao inicializar cliente:', error);
            throw error;
        }
    }

    async createClient() {
        return axios.create({
            baseURL: WHATSAPP_CONFIG.apiUrl,
            headers: {
                'Authorization': `Bearer ${WHATSAPP_CONFIG.token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            timeout: 10000
        });
    }

    async sendMessage(to, message, type = 'text') {
        try {
            const endpoint = this._getEndpoint(type);
            const payload = this._createPayload(to, message, type);

            console.log(`[WhatsApp] Enviando mensagem ${type}:`, {
                to,
                endpoint,
                messagePreview: typeof message === 'string' ? message.substring(0, 100) : '[Conteúdo não textual]'
            });

            const response = await this.client.post(`${endpoint}?connectionKey=${this.connectionKey}`, payload);
            return response.data;
        } catch (error) {
            console.error('[WhatsApp] Erro ao enviar mensagem:', error);
            throw error;
        }
    }

    _getEndpoint(type) {
        const endpoints = {
            text: 'message/send-text',
            imageUrl: 'message/sendImageUrl',
            imageBase64: 'message/sendImageBase64',
        };

        const endpoint = endpoints[type];
        if (!endpoint) {
            throw new Error(`Tipo de mensagem '${type}' não suportado`);
        }

        return endpoint;
    }

    _createPayload(to, message, type) {
        const base = {
            phoneNumber: to,
            delayMessage: String(WHATSAPP_CONFIG.messageDelay || 1000)
        };

        switch (type) {
            case 'text':
                return {
                    ...base,
                    text: message
                };
            case 'imageUrl':
                return {
                    ...base,
                    url: message.url || message,
                    caption: message.caption || ''
                };
            case 'imageBase64':
                return {
                    ...base,
                    base64Image: message.base64 || message,
                    caption: message.caption || ''
                };
            default:
                throw new Error(`Tipo de payload '${type}' não suportado`);
        }
    }

    async sendText(to, message) {
        return this.sendMessage(to, message, 'text');
    }

    async sendImage(to, image, caption = '') {
        const type = this._isBase64(image) ? 'imageBase64' : 'imageUrl';
        const payload = typeof image === 'string' ? 
            { [type === 'imageBase64' ? 'base64' : 'url']: image, caption } : 
            { ...image, caption: caption || image.caption };
            
        return this.sendMessage(to, payload, type);
    }

    _isBase64(str) {
        if (typeof str !== 'string') return false;
        const base64Regex = /^data:image\/(png|jpeg|jpg|gif);base64,/;
        return base64Regex.test(str) || this._isValidBase64(str);
    }

    _isValidBase64(str) {
        try {
            return btoa(atob(str)) === str;
        } catch (err) {
            return false;
        }
    }
}

module.exports = { WhatsAppService };
