const axios = require('axios');
const { WHATSAPP_CONFIG } = require('../config/settings');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { container } = require('./service-container');
const FormData = require('form-data');
const { WhatsAppImageService } = require('./whatsapp-image-service');
const { WhatsAppAudioService } = require('./whatsapp-audio-service');
const { MediaManagerService } = require('./media-manager-service');

class WhatsAppService {
    constructor() {
        this.client = null;
        this.connectionKey = null;
        this.retryCount = 0;
        this.maxRetries = WHATSAPP_CONFIG.retryAttempts || 3;
        this.paymentProofMessages = {};
        this.pendingProofs = new Map(); // Armazena comprovantes aguardando número do pedido
        
        // Registra este serviço no container
        container.register('whatsapp', this);
        
        // Limpa comprovantes antigos a cada hora
        setInterval(() => this._cleanupPendingProofs(), 60 * 60 * 1000);
        
        this._imageService = new WhatsAppImageService();
        this._audioService = new WhatsAppAudioService();
        this._mediaManager = new MediaManagerService(this._audioService, this._imageService);
    }

    /**
     * Obtém o serviço de validação de pedidos
     * @private
     */
    get _orderValidationService() {
        return container.get('orderValidation');
    }

    /**
     * Obtém o serviço de rastreamento
     * @private
     */
    get _trackingService() {
        return container.get('tracking');
    }

    /**
     * Inicializa o serviço WhatsApp
     * @returns {Promise<Object>} Cliente HTTP inicializado
     * @throws {Error} Se falhar a inicialização
     */
    async init() {
        try {
            console.log(' Inicializando WhatsApp Service...');
            
            if (!WHATSAPP_CONFIG.token) {
                throw new Error('Token não configurado');
            }

            if (!WHATSAPP_CONFIG.connectionKey) {
                throw new Error('Connection Key não configurada');
            }

            // Reseta contadores
            this.retryCount = 0;
            this.connectionKey = WHATSAPP_CONFIG.connectionKey;

            // Inicializa cliente HTTP
            this.client = axios.create({
                baseURL: WHATSAPP_CONFIG.apiUrl,
                headers: {
                    'Authorization': `Bearer ${WHATSAPP_CONFIG.token}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            });

            // Adiciona interceptors
            this.addInterceptor();

            console.log(' WhatsApp Service inicializado:', {
                baseUrl: WHATSAPP_CONFIG.apiUrl,
                chaveConexao: this.connectionKey,
                timestamp: new Date().toISOString()
            });

            return this.client;
        } catch (error) {
            console.error(' Erro ao inicializar WhatsApp Service:', {
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
     * @param {string} to - Número do destinatário
     * @param {string} text - Texto da mensagem
     * @returns {Promise<Object>} Resposta do servidor
     */
    async sendText(to, text) {
        try {
            const client = await this.getClient();
            if (!client) {
                throw new Error('Cliente HTTP não inicializado');
            }

            const messageText = String(text);

            console.log(' Enviando mensagem:', {
                para: to,
                texto: messageText,
                messageId: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                timestamp: new Date().toISOString()
            });

            const endpoint = `${WHATSAPP_CONFIG.endpoints.text}?connectionKey=${this.connectionKey}`;
            console.log('[WhatsApp] Iniciando envio de mensagem:', {
                para: to,
                previewMensagem: messageText.slice(0, 100) + (messageText.length > 100 ? '...' : ''),
                chaveConexao: this.connectionKey,
                timestamp: new Date().toISOString()
            });

            console.log('[WhatsApp] Endpoint:', endpoint);

            const phoneNumber = to.includes('@') ? to.split('@')[0] : to;

            const response = await client.post(endpoint, {
                phoneNumber,
                text: messageText
            });

            // Verifica erro de conta
            if (response.data?.error && response.data?.message?.includes('conta')) {
                console.log(' Erro de conta, reinicializando conexão...');
                await this.init();
                return this.sendText(to, text);
            }

            console.log('[WhatsApp] Resposta do servidor:', {
                status: response.status,
                messageId: response.data?.messageId,
                error: response.data?.error,
                timestamp: new Date().toISOString()
            });

            return response.data;
        } catch (error) {
            console.error(' Erro ao enviar mensagem:', {
                para: to,
                erro: error.message,
                status: error.response?.status,
                data: error.response?.data,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });

            // Verifica erro de conta no catch
            if (error.response?.data?.error && error.response?.data?.message?.includes('conta')) {
                console.log(' Erro de conta no catch, reinicializando conexão...');
                await this.init();
                return this.sendText(to, text);
            }

            throw error;
        }
    }

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
            console.log(' Baixando mídia:', {
                messageId: message?.key?.id,
                from: message?.key?.remoteJid,
                type: message?.type,
                hasMessage: !!message?.message,
                messageTypes: message?.message ? Object.keys(message.message) : [],
                timestamp: new Date().toISOString()
            });

            // Extrai a mensagem real considerando todos os casos possíveis
            const realMessage = message?.message?.ephemeralMessage?.message || // Mensagem ephemeral
                              message?.message?.viewOnceMessage?.message ||    // Mensagem "ver uma vez"
                              message?.message?.forwardedMessage ||           // Mensagem encaminhada
                              message?.message;                              // Mensagem normal

            if (!realMessage) {
                throw new Error('Mensagem não contém dados de mídia');
            }

            // Extrai a mídia específica (imagem, áudio, etc)
            const mediaMessage = realMessage.imageMessage ||
                               realMessage.audioMessage ||
                               realMessage.documentMessage ||
                               realMessage.videoMessage;

            if (!mediaMessage) {
                throw new Error('Tipo de mídia não suportado ou não encontrado');
            }

            // Se for "ver uma vez", loga para debug
            if (message?.message?.viewOnceMessage) {
                console.log(' Mensagem do tipo "ver uma vez" detectada');
            }

            // Usa o Baileys para baixar e descriptografar a mídia
            return await downloadMediaMessage(
                { message: realMessage },
                'buffer',
                {},
                {
                    logger: console,
                    reuploadRequest: this.reuploadRequest
                }
            );

        } catch (error) {
            console.error('[WhatsApp] Erro ao baixar mídia:', error);
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
            console.log(' Encaminhando mensagem:', {
                de: message.from,
                para: to,
                tipo: message.type,
                messageId: message.messageId,
                timestamp: new Date().toISOString()
            });

            // Extrai a mensagem real considerando todos os casos possíveis
            const realMessage = message?.message?.ephemeralMessage?.message || // Mensagem ephemeral
                              message?.message?.viewOnceMessage?.message ||    // Mensagem "ver uma vez"
                              message?.message?.forwardedMessage ||           // Mensagem encaminhada
                              message?.message;                              // Mensagem normal

            if (!realMessage) {
                throw new Error('Mensagem não contém dados para encaminhar');
            }

            // Verifica o tipo de mídia
            if (realMessage.imageMessage) {
                // Baixa a imagem
                const buffer = await this.downloadMediaMessage(message);
                
                // Reenvia como nova mensagem
                await this.sendImage(
                    to, 
                    buffer,
                    realMessage.imageMessage.caption || ''
                );
            } else if (realMessage.audioMessage) {
                // Baixa o áudio
                const buffer = await this.downloadMediaMessage(message);
                
                // Reenvia como nova mensagem
                await this.sendAudio(to, buffer);
            } else if (realMessage.documentMessage) {
                // Baixa o documento
                const buffer = await this.downloadMediaMessage(message);
                
                // Reenvia como nova mensagem
                await this.sendDocument(
                    to, 
                    buffer,
                    realMessage.documentMessage.fileName || 'document',
                    realMessage.documentMessage.mimetype
                );
            } else if (realMessage.conversation || realMessage.extendedTextMessage) {
                // Encaminha mensagem de texto
                const text = realMessage.conversation || 
                           realMessage.extendedTextMessage?.text || '';
                
                await this.sendText(to, text);
            } else {
                throw new Error('Tipo de mensagem não suportado para encaminhamento');
            }

            console.log(' Mensagem encaminhada com sucesso');
        } catch (error) {
            console.error('[WhatsApp] Erro ao encaminhar mensagem:', error);
            throw error;
        }
    }

    /**
     * Envia uma imagem por URL
     * @param {string} to - Número do destinatário
     * @param {string} imageUrl - URL da imagem
     * @param {string} caption - Legenda opcional
     * @returns {Promise<Object>} Resposta do servidor
     */
    async sendImageByUrl(to, imageUrl, caption = '') {
        try {
            console.log(' Enviando imagem por URL:', {
                para: to,
                url: imageUrl?.substring(0, 50) + '...',
                temLegenda: !!caption,
                timestamp: new Date().toISOString()
            });

            const response = await axios.post(
                `${WHATSAPP_CONFIG.apiUrl}/message/sendImageUrl?connectionKey=${WHATSAPP_CONFIG.connectionKey}`,
                {
                    phoneNumber: to.replace(/\D/g, ''), // Remove não-dígitos
                    url: imageUrl,
                    caption,
                    delayMessage: '1000'
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${WHATSAPP_CONFIG.token}`
                    }
                }
            );

            return response.data;
        } catch (error) {
            console.error('[WhatsApp] Erro ao enviar imagem por URL:', error);
            throw error;
        }
    }

    /**
     * Envia uma imagem por arquivo
     * @param {string} to - Número do destinatário
     * @param {Buffer|Stream} file - Buffer ou Stream do arquivo
     * @param {string} caption - Legenda opcional
     * @returns {Promise<Object>} Resposta do servidor
     */
    async sendImageFile(to, file, caption = '') {
        try {
            console.log(' Enviando arquivo de imagem:', {
                para: to,
                tamanho: file.length,
                temLegenda: !!caption,
                timestamp: new Date().toISOString()
            });

            const form = new FormData();
            form.append('phoneNumber', to.replace(/\D/g, '')); // Remove não-dígitos
            form.append('file', file, {
                filename: 'image.jpg',
                contentType: 'image/jpeg'
            });
            if (caption) form.append('caption', caption);
            form.append('delayMessage', '1000');

            const response = await axios.post(
                `${WHATSAPP_CONFIG.apiUrl}/message/sendImage?connectionKey=${WHATSAPP_CONFIG.connectionKey}`,
                form,
                {
                    headers: {
                        ...form.getHeaders(),
                        'Authorization': `Bearer ${WHATSAPP_CONFIG.token}`
                    }
                }
            );

            return response.data;
        } catch (error) {
            console.error('[WhatsApp] Erro ao enviar arquivo de imagem:', error);
            throw error;
        }
    }

    /**
     * Envia uma imagem (detecta automaticamente se é URL ou arquivo)
     * @param {string} to - Número do destinatário
     * @param {string|Buffer} image - URL ou Buffer da imagem
     * @param {string} caption - Legenda opcional
     * @returns {Promise<Object>} Resposta do servidor
     */
    async sendImage(to, image, caption = '') {
        if (typeof image === 'string' && (image.startsWith('http://') || image.startsWith('https://'))) {
            return this.sendImageByUrl(to, image, caption);
        } else {
            return this.sendImageFile(to, image, caption);
        }
    }

    async handleImageMessage(message) {
        try {
            console.log('📸 [WhatsApp] Recebido mensagem com imagem:', {
                messageId: message.key?.id,
                from: message.key?.remoteJid,
                timestamp: new Date().toISOString()
            });

            // Valida se é uma imagem
            if (!message.imageMessage) {
                console.error('❌ [WhatsApp] Mensagem não contém imagem:', {
                    messageId: message.key?.id,
                    tipo: message.type
                });
                throw new Error('Mensagem não contém imagem');
            }

            console.log('🔄 [WhatsApp] Enviando para MediaManager:', {
                messageId: message.key?.id,
                timestamp: new Date().toISOString()
            });

            // Processa a imagem
            const result = await this._mediaManager.processImage(message);

            if (!result.success) {
                console.error('❌ [WhatsApp] Falha no processamento:', {
                    messageId: message.key?.id,
                    erro: result.error,
                    timestamp: new Date().toISOString()
                });
                throw new Error(result.error || 'Erro ao processar imagem');
            }

            console.log('✅ [WhatsApp] Processamento concluído:', {
                messageId: message.key?.id,
                temAnalise: !!result.analysis,
                tamanhoAnalise: result.analysis?.length,
                timestamp: new Date().toISOString()
            });

            // Identifica se é um comprovante de pagamento
            const isPaymentProof = result.analysis.toLowerCase().includes('comprovante de pagamento');
            
            console.log('🔍 [WhatsApp] Análise de tipo:', {
                messageId: message.key?.id,
                isPaymentProof,
                timestamp: new Date().toISOString()
            });

            if (isPaymentProof) {
                await this.handlePaymentProof(message, result.analysis);
            } else {
                await this.sendTextMessage(message.key.remoteJid, 'Desculpe, mas não identifiquei um comprovante de pagamento válido nesta imagem.');
            }

            return result;

        } catch (error) {
            console.error('❌ [WhatsApp] Erro ao processar imagem:', {
                erro: error.message,
                stack: error.stack,
                messageId: message.key?.id,
                timestamp: new Date().toISOString()
            });

            await this.sendTextMessage(
                message.key.remoteJid,
                `Desculpe, ocorreu um erro ao processar sua imagem: ${error.message}`
            );

            throw error;
        }
    }

    /**
     * Processa comprovante de pagamento com número do pedido
     * @param {string} from - Número do remetente
     * @param {Object} order - Dados do pedido validado
     * @returns {Promise<void>}
     */
    async handlePaymentProof(from, order) {
        try {
            // Recupera a mensagem do comprovante (novo ou legado)
            const pendingProof = this.pendingProofs.get(from);
            const proofMessage = pendingProof?.message || this.paymentProofMessages[from];

            if (!proofMessage) {
                console.error(' Mensagem do comprovante não encontrada:', {
                    from,
                    orderNumber: order.number,
                    timestamp: new Date().toISOString()
                });
                return;
            }

            // Encaminha para o financeiro
            const numeroFinanceiro = process.env.FINANCIAL_DEPT_NUMBER;
            if (numeroFinanceiro) {
                await this.forwardMessage(proofMessage, numeroFinanceiro);
                await this.sendText(
                    numeroFinanceiro,
                    ` *Número do Pedido Recebido*\nPedido: #${order.number}\nCliente: ${from}`
                );
            }

            // Confirma para o cliente
            await this.sendText(
                from,
                ` Recebi o número do pedido #${order.number}. Nossa equipe financeira já está com seu comprovante e fará a validação o mais breve possível.`
            );

            // Limpa os comprovantes da memória
            this.pendingProofs.delete(from);
            delete this.paymentProofMessages[from];

            console.log(' Comprovante processado com sucesso:', {
                from,
                orderNumber: order.number,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error(' Erro ao processar comprovante:', error);
            throw error;
        }
    }

    /**
     * Processa número do pedido recebido
     * @param {Object} message - Mensagem recebida
     * @returns {Promise<boolean>} True se for fluxo de comprovante, false para consulta
     */
    async handleOrderNumber(message) {
        try {
            // Verifica se tem comprovante pendente
            const hasPendingProof = this.pendingProofs.get(message.from) || 
                                  this.paymentProofMessages[message.from];

            // Extrai e valida o número do pedido
            const orderNumber = this._orderValidationService.extractOrderNumber(message.body);
            if (!orderNumber) {
                await this.sendText(
                    message.from, 
                    ' Por favor, me envie um número de pedido válido.'
                );
                return hasPendingProof; // Retorna true se tiver comprovante pendente
            }

            // Valida o pedido
            const order = await this._orderValidationService.validateOrderNumber(orderNumber);
            if (!order) {
                await this.sendText(
                    message.from, 
                    ` Não encontrei o pedido #${orderNumber}. Por favor, verifique o número.`
                );
                return hasPendingProof;
            }

            if (hasPendingProof) {
                // Fluxo de comprovante
                await this.handlePaymentProof(message.from, order);
                return true;
            }

            // Se chegou aqui é fluxo de consulta normal
            console.log(' Consulta de pedido:', {
                from: message.from,
                orderNumber: order.number,
                timestamp: new Date().toISOString()
            });
            return false;
        } catch (error) {
            console.error(' Erro ao processar número do pedido:', error);
            throw error;
        }
    }

    /**
     * Verifica se a análise indica um comprovante de pagamento
     * @private
     * @param {string} analysis Análise da imagem
     * @returns {boolean}
     */
    _isPaymentProof(analysis) {
        const keywords = [
            'comprovante',
            'pagamento',
            'transferência',
            'pix',
            'recibo',
            'valor',
            'data',
            'beneficiário'
        ];

        const lowerAnalysis = analysis.toLowerCase();
        const matchCount = keywords.reduce((count, keyword) => {
            return count + (lowerAnalysis.includes(keyword) ? 1 : 0);
        }, 0);

        return matchCount >= 3;
    }

    /**
     * Limpa comprovantes antigos da memória
     * @private
     */
    async _cleanupPendingProofs() {
        try {
            console.log('Iniciando limpeza de comprovantes antigos...');
            const now = Date.now();
            const MAX_AGE = 24 * 60 * 60 * 1000; // 24 horas em milissegundos

            // Limpa proofs pendentes
            for (const [key, proof] of this.pendingProofs.entries()) {
                if (now - proof.timestamp > MAX_AGE) {
                    console.log('Removendo comprovante antigo:', {
                        key,
                        idade: Math.round((now - proof.timestamp) / (60 * 60 * 1000)) + ' horas'
                    });
                    this.pendingProofs.delete(key);
                }
            }

            // Limpa mensagens de comprovante antigas
            for (const [from, message] of Object.entries(this.paymentProofMessages)) {
                if (now - message.timestamp > MAX_AGE) {
                    console.log('Removendo mensagem antiga:', {
                        from,
                        idade: Math.round((now - message.timestamp) / (60 * 60 * 1000)) + ' horas'
                    });
                    delete this.paymentProofMessages[from];
                }
            }

            console.log('Limpeza de comprovantes concluída');
        } catch (error) {
            console.error('Erro ao limpar comprovantes:', error);
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
