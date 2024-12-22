const axios = require('axios');
const { WHATSAPP_CONFIG } = require('../config/settings');

class WhatsAppService {
    constructor() {
        this.client = null;
        this.connectionKey = null;
        this.retryCount = 0;
        this.maxRetries = WHATSAPP_CONFIG.retryAttempts || 3;
    }

    async init() {
        try {
            if (!WHATSAPP_CONFIG.token) {
                throw new Error('Token não configurado');
            }

            if (!WHATSAPP_CONFIG.connectionKey) {
                throw new Error('Connection Key não configurada');
            }

            console.log('[WhatsApp] Iniciando cliente...', {
                apiUrl: WHATSAPP_CONFIG.apiUrl,
                connectionKey: WHATSAPP_CONFIG.connectionKey,
                timestamp: new Date().toISOString()
            });

            this.client = await this.createClient();
            this.connectionKey = WHATSAPP_CONFIG.connectionKey;
            this.addInterceptor();

            console.log('[WhatsApp] Cliente inicializado com sucesso:', { 
                connectionKey: this.connectionKey,
                timestamp: new Date().toISOString()
            });

            return this.client;
        } catch (error) {
            console.error('[WhatsApp] Erro ao inicializar cliente:', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
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
    async sendText(to, text) {
        try {
            // Gera um ID único para a mensagem
            const messageId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            console.log(' Enviando mensagem:', {
                para: to,
                texto: text.substring(0, 100),
                messageId,
                timestamp: new Date().toISOString()
            });

            if (!to || !text) {
                console.error('[WhatsApp] Parâmetros inválidos:', { to, text });
                return null;
            }

            // Garante que a mensagem é uma string
            const messageText = String(text);

            // Garante que o cliente está inicializado
            const client = await this.getClient();
            if (!client) {
                throw new Error('Cliente WhatsApp não inicializado');
            }

            console.log('[WhatsApp] Iniciando envio de mensagem:', {
                para: to,
                previewMensagem: messageText.substring(0, 100),
                chaveConexao: this.connectionKey,
                timestamp: new Date().toISOString()
            });

            const endpoint = `${WHATSAPP_CONFIG.endpoints.text}?connectionKey=${this.connectionKey}`;
            console.log('[WhatsApp] Endpoint:', endpoint);

            // Formata o número de telefone se necessário
            const phoneNumber = to.includes('@') ? to.split('@')[0] : to;

            const response = await client.post(endpoint, {
                phoneNumber,
                text: messageText
            });

            console.log('[WhatsApp] Resposta do servidor:', {
                status: response.status,
                messageId: response.data?.messageId,
                error: response.data?.error,
                timestamp: new Date().toISOString()
            });

            await this.delay();
            return response.data;
        } catch (error) {
            console.error('[WhatsApp] Erro ao enviar mensagem:', {
                erro: error.message,
                status: error.response?.status,
                data: error.response?.data,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });

            // Se for erro de conexão, tenta reinicializar o cliente
            if (error.code === 'ECONNREFUSED' || error.response?.status === 403) {
                console.log('[WhatsApp] Tentando reinicializar o cliente...');
                await this.init();
                return this.sendText(to, text); // Tenta enviar novamente
            }

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
            console.log(' Enviando áudio:', {
                para: to,
                url: audioUrl?.substring(0, 100),
                timestamp: new Date().toISOString()
            });

            const response = await this.client.post(
                `message/send-audio?connectionKey=${this.connectionKey}`,
                {
                    number: to,
                    audioUrl: audioUrl
                }
            );

            return response.data;
        } catch (error) {
            console.error(' Erro ao enviar áudio:', error);
            throw error;
        }
    }

    /**
     * Faz download de uma mídia do WhatsApp
     * @param {Object} message - Mensagem contendo a mídia
     * @returns {Promise<Buffer>} Buffer com o conteúdo da mídia
     */
    async downloadMediaMessage(message) {
        try {
            if (!message) {
                throw new Error('Objeto de mensagem inválido');
            }

            const { messageId, mediaUrl } = message;

            if (!mediaUrl) {
                console.error('❌ URL da mídia não fornecida:', {
                    messageId,
                    messageKeys: Object.keys(message),
                    timestamp: new Date().toISOString()
                });
                throw new Error('URL da mídia não fornecida');
            }

            console.log('📥 Baixando mídia:', {
                messageId,
                tipo: message.type,
                url: mediaUrl.substring(0, 100),
                timestamp: new Date().toISOString()
            });

            // Tenta fazer o download com diferentes métodos
            try {
                // Primeiro tenta baixar direto da URL
                const response = await axios.get(mediaUrl, {
                    responseType: 'arraybuffer',
                    headers: {
                        'Authorization': `Bearer ${WHATSAPP_CONFIG.token}`
                    },
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity,
                    timeout: 30000 // 30 segundos
                });

                if (response.status === 200 && response.data) {
                    console.log('✅ Mídia baixada com sucesso:', {
                        messageId,
                        tamanho: response.data.length,
                        timestamp: new Date().toISOString()
                    });
                    return Buffer.from(response.data);
                }

                throw new Error(`Download falhou com status ${response.status}`);

            } catch (downloadError) {
                console.error('❌ Erro no download direto, tentando API:', {
                    erro: downloadError.message,
                    messageId,
                    timestamp: new Date().toISOString()
                });

                // Se falhar, tenta pela API do WhatsApp
                const apiResponse = await this.client.get(
                    `message/download-media?connectionKey=${this.connectionKey}&messageId=${messageId}`,
                    { responseType: 'arraybuffer' }
                );

                if (apiResponse.status === 200 && apiResponse.data) {
                    console.log('✅ Mídia baixada via API:', {
                        messageId,
                        tamanho: apiResponse.data.length,
                        timestamp: new Date().toISOString()
                    });
                    return Buffer.from(apiResponse.data);
                }

                throw new Error(`Download via API falhou com status ${apiResponse.status}`);
            }

        } catch (error) {
            console.error('❌ Erro ao baixar mídia:', {
                erro: error.message,
                messageId: message?.messageId,
                url: message?.mediaUrl?.substring(0, 100),
                timestamp: new Date().toISOString()
            });
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

    async delay(ms) {
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
            const mensagemFinanceiro = `*Nova Notificação - Pedido Internacional*\n\n` +
                `*Pedido:* #${orderId}\n` +
                `*Data:* ${new Date().toLocaleString('pt-BR')}\n` +
                `*Cliente:* ${message.from}\n` +
                `*Protocolo:* ${financialNotification.data.atendimento.protocolo}\n\n` +
                `*Mensagem do Cliente:*\n${message.body}\n\n` +
                `*Ação Necessária:* Verificar taxação e processar pagamento`;

            // Envia para o número do departamento financeiro
            const numeroFinanceiro = process.env.FINANCIAL_DEPT_NUMBER;
            if (numeroFinanceiro) {
                await this.sendText(numeroFinanceiro, mensagemFinanceiro);
            }

            // Registra no console para debug
            console.log(' Notificação enviada ao financeiro:', {
                protocolo: financialNotification.data.atendimento.protocolo,
                pedido: orderId,
                timestamp: new Date().toISOString()
            });

            return true;
        } catch (error) {
            console.error(' Erro ao encaminhar para financeiro:', error);
            throw error;
        }
    }

    async close() {
        try {
            if (this.client) {
                console.log('[WhatsApp] Encerrando conexão...');
                // Limpa qualquer estado pendente
                this.client = null;
                this.connectionKey = null;
                this.retryCount = 0;
            }
        } catch (error) {
            console.error('[WhatsApp] Erro ao encerrar conexão:', error);
            throw error;
        }
    }
}

module.exports = { WhatsAppService };
