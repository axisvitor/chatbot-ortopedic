const axios = require('axios');
const { WHATSAPP_CONFIG } = require('../config/settings');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { GroqServices } = require('./groq-services');

class WhatsAppService {
    constructor() {
        this.client = null;
        this.connectionKey = null;
        this.retryCount = 0;
        this.maxRetries = WHATSAPP_CONFIG.retryAttempts || 3;
        this.paymentProofMessages = {};
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
     * Faz download de uma mídia do WhatsApp usando Baileys
     * @param {Object} message - Mensagem contendo a mídia
     * @returns {Promise<Buffer>} Buffer com o conteúdo da mídia já descriptografado
     */
    async downloadMediaMessage(message) {
        try {
            if (!message) {
                throw new Error('Objeto de mensagem inválido');
            }

            console.log('📥 Baixando mídia:', {
                messageId: message.messageId,
                tipo: message.type,
                timestamp: new Date().toISOString()
            });

            // Usa o Baileys para baixar e descriptografar a mídia
            const buffer = await downloadMediaMessage(
                message,
                'buffer',
                {},
                {
                    logger: console,
                    reuploadRequest: async (media) => {
                        const { mediaUrl } = media;
                        // Baixa a mídia com o token de autorização
                        const response = await axios.get(mediaUrl, {
                            responseType: 'arraybuffer',
                            headers: {
                                'Authorization': `Bearer ${WHATSAPP_CONFIG.token}`
                            }
                        });
                        return response.data;
                    },
                }
            );

            if (!buffer || buffer.length === 0) {
                throw new Error('Download resultou em buffer vazio');
            }

            console.log('✅ Mídia baixada com sucesso:', {
                messageId: message.messageId,
                tamanho: buffer.length,
                timestamp: new Date().toISOString()
            });

            return buffer;

        } catch (error) {
            console.error('❌ Erro ao baixar mídia:', {
                erro: error.message,
                messageId: message?.messageId,
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

    /**
     * Encaminha uma mensagem para outro número
     * @param {Object} message - Mensagem original
     * @param {string} to - Número de destino
     * @returns {Promise<void>}
     */
    async forwardMessage(message, to) {
        try {
            if (!message || !to) {
                throw new Error('Mensagem e destino são obrigatórios');
            }

            // Log do encaminhamento
            console.log('🔄 Encaminhando mensagem:', {
                messageId: message.messageId,
                from: message.from,
                to,
                type: message.type,
                timestamp: new Date().toISOString()
            });

            // Encaminha a mensagem
            await this.client.forwardMessage(to, message);

            console.log('✅ Mensagem encaminhada com sucesso:', {
                messageId: message.messageId,
                to,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('❌ Erro ao encaminhar mensagem:', {
                erro: error.message,
                stack: error.stack,
                messageId: message?.messageId,
                to,
                timestamp: new Date().toISOString()
            });
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

    async handleImageMessage(message) {
        try {
            console.log('🖼️ Mensagem de imagem recebida:', {
                messageId: message.messageId,
                from: message.from,
                type: message.type,
                hasMessage: !!message.message,
                hasImageMessage: !!message.message?.imageMessage,
                timestamp: new Date().toISOString()
            });

            // Baixa a imagem
            const buffer = await this.downloadMediaMessage(message);

            // Processa a imagem com o Groq
            const groqService = new GroqServices();
            const result = await groqService.processImage(buffer, message);

            // Se for um comprovante, pede o número do pedido
            if (result.isPaymentProof) {
                await this.sendText(
                    message.from, 
                    '✅ Recebi seu comprovante! Para que eu possa encaminhar para nossa equipe financeira, ' + 
                    'por favor me informe o número do seu pedido.'
                );
                
                // Armazena temporariamente a mensagem do comprovante
                this.paymentProofMessages = this.paymentProofMessages || {};
                this.paymentProofMessages[message.from] = message;
                
                return;
            }

            // Se não for um comprovante, continua com o fluxo normal
            console.log('🔍 Análise da imagem:', {
                messageId: message.messageId,
                tipo: result.type,
                isPaymentProof: result.isPaymentProof,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ Erro ao processar mensagem de imagem:', error);
            throw error;
        }
    }

    async handleOrderNumber(message) {
        try {
            // Verifica se tem um comprovante pendente para este número
            if (!this.paymentProofMessages || !this.paymentProofMessages[message.from]) {
                return false;
            }

            // Extrai o número do pedido da mensagem
            const orderNumber = message.body.trim();

            // Valida se é um número de pedido válido (você pode adicionar mais validações aqui)
            if (!orderNumber) {
                await this.sendText(
                    message.from,
                    '❌ Por favor, me envie um número de pedido válido.'
                );
                return true;
            }

            // Recupera a mensagem do comprovante
            const proofMessage = this.paymentProofMessages[message.from];

            // Encaminha para o financeiro com o número do pedido
            await this.forwardToFinancial(proofMessage, orderNumber);
            
            // Confirma para o cliente
            await this.sendText(
                message.from,
                `✅ Seu comprovante foi encaminhado para nossa equipe financeira junto com o número do pedido #${orderNumber}. Em breve retornaremos com uma confirmação.`
            );

            // Limpa o comprovante da memória
            delete this.paymentProofMessages[message.from];
            return true;

        } catch (error) {
            console.error('❌ Erro ao processar número do pedido:', error);
            throw error;
        }
    }
}

module.exports = { WhatsAppService };
