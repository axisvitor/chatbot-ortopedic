const axios = require('axios');
const { WHATSAPP_CONFIG } = require('../config/settings');

class WhatsAppService {
    constructor() {
        this.client = null;
        this.connectionKey = null;
        this.retryCount = 0;
        this.maxRetries = WHATSAPP_CONFIG.retryAttempts || 3;
        this.init();
    }

    async init() {
        try {
            if (!WHATSAPP_CONFIG.token) {
                throw new Error('Token não configurado');
            }

            this.client = await this.createClient();
            this.connectionKey = WHATSAPP_CONFIG.connectionKey;
            this.addInterceptor();
            
            console.log('[WhatsApp] Cliente inicializado com sucesso:', { connectionKey: this.connectionKey });
        } catch (error) {
            console.error('[WhatsApp] Erro ao inicializar cliente:', error);
            throw error;
        }
    }

    async getClient() {
        if (!this.client) {
            await this.init();
        }
        return this.client;
    }

    async createClient() {
        return axios.create({
            baseURL: WHATSAPP_CONFIG.apiUrl,
            headers: {
                'Authorization': `Bearer ${WHATSAPP_CONFIG.token}`,
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });
    }

    addInterceptor() {
        this.client.interceptors.response.use(
            response => response,
            async error => {
                console.error('[WhatsApp] Erro na requisição:', {
                    status: error.response?.status,
                    data: error.response?.data,
                    message: error.message
                });

                // Se for erro 403 (Forbidden), tenta reconectar
                if (error.response?.status === 403 && this.retryCount < this.maxRetries) {
                    this.retryCount++;
                    console.log(`[WhatsApp] Tentativa ${this.retryCount} de reconexão...`);
                    
                    try {
                        // Aguarda 1 segundo antes de tentar novamente
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        
                        // Reinicializa o cliente
                        await this.init();
                        
                        // Tenta a requisição novamente
                        const config = error.config;
                        config.headers['Authorization'] = `Bearer ${WHATSAPP_CONFIG.token}`;
                        return this.client(config);
                    } catch (retryError) {
                        console.error('[WhatsApp] Erro na tentativa de reconexão:', retryError);
                        return Promise.reject(retryError);
                    }
                }

                // Se excedeu o número de tentativas ou não é erro 403
                this.retryCount = 0;
                return Promise.reject(error);
            }
        );
    }

    /**
     * Envia uma mensagem de texto
     */
    async sendText(to, message) {
        try {
            console.log('[WhatsApp] Enviando mensagem:', {
                to,
                messagePreview: message.substring(0, 100),
                connectionKey: this.connectionKey
            });

            const endpoint = `${WHATSAPP_CONFIG.endpoints.text}?connectionKey=${this.connectionKey}`;
            const response = await this.client.post(endpoint, {
                phoneNumber: to,
                text: message
            });

            console.log('[WhatsApp] Mensagem enviada com sucesso:', {
                messageId: response.data.messageId,
                error: response.data.error
            });

            await this.delay();
            return response.data;
        } catch (error) {
            console.error('[WhatsApp] Erro ao enviar mensagem:', error.message);
            throw error;
        }
    }

    /**
     * Envia uma imagem
     */
    async sendImage(to, image, caption = '') {
        try {
            const isBase64 = this._isBase64(image);
            const endpoint = isBase64 ? 'message/sendImageBase64' : 'message/sendImageUrl';
            
            const payload = {
                phoneNumber: to,
                caption: caption || (typeof image === 'object' ? image.caption : ''),
            };

            if (isBase64) {
                payload.base64Image = typeof image === 'object' ? image.base64 : image;
            } else {
                payload.url = typeof image === 'object' ? image.url : image;
            }

            const response = await this.client.post(`${endpoint}?connectionKey=${this.connectionKey}`, payload);
            await this.delay();
            return response.data;
        } catch (error) {
            console.error('[WhatsApp] Erro ao enviar imagem:', error.message);
            throw error;
        }
    }

    /**
     * Envia um áudio
     */
    async sendAudio(to, audioUrl) {
        try {
            const response = await this.client.post(`${WHATSAPP_CONFIG.endpoints.audio}?connectionKey=${this.connectionKey}`, {
                phoneNumber: to,
                audio: audioUrl
            });

            await this.delay();
            return response.data;
        } catch (error) {
            console.error('[WhatsApp] Erro ao enviar áudio:', error.message);
            throw error;
        }
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

    async delay() {
        return new Promise(resolve => setTimeout(resolve, WHATSAPP_CONFIG.messageDelay));
    }

    async forwardToFinancial(message, orderId = null) {
        try {
            const financialNotification = {
                type: 'financial_forward',
                priority: 'alta',
                status: 'pendente',
                data: {
                    pedido: {
                        numero: orderId,
                        data: new Date().toISOString(),
                        origem: 'internacional'
                    },
                    cliente: {
                        telefone: message.from,
                        mensagem_original: message.body
                    },
                    atendimento: {
                        protocolo: `FIN-${new Date().getTime()}`,
                        data_encaminhamento: new Date().toISOString(),
                        canal: 'whatsapp'
                    }
                }
            };

            // Envia para o número do departamento financeiro
            const mensagemFinanceiro = `🔔 *Nova Notificação - Pedido Internacional*\n\n` +
                `📦 *Pedido:* #${orderId}\n` +
                `🕒 *Data:* ${new Date().toLocaleString('pt-BR')}\n` +
                `📱 *Cliente:* ${message.from}\n` +
                `🔑 *Protocolo:* ${financialNotification.data.atendimento.protocolo}\n\n` +
                `💬 *Mensagem do Cliente:*\n${message.body}\n\n` +
                `⚠️ *Ação Necessária:* Verificar taxação e processar pagamento`;

            // Envia para o número do departamento financeiro
            const numeroFinanceiro = process.env.FINANCIAL_DEPT_NUMBER;
            if (numeroFinanceiro) {
                await this.sendText(numeroFinanceiro, mensagemFinanceiro);
            }

            // Registra no console para debug
            console.log('📧 Notificação enviada ao financeiro:', {
                protocolo: financialNotification.data.atendimento.protocolo,
                pedido: orderId,
                timestamp: new Date().toISOString()
            });

            return true;
        } catch (error) {
            console.error('❌ Erro ao encaminhar para financeiro:', error);
            throw error;
        }
    }
}

module.exports = { WhatsAppService };
