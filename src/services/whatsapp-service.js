const axios = require('axios');
const { WHATSAPP_CONFIG } = require('../config/settings');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const FormData = require('form-data');
const { OpenAIService } = require('./openai-service');

class WhatsAppService {
    constructor(orderValidationService = null) {
        this.client = null;
        this.connectionKey = null;
        this.retryCount = 0;
        this.maxRetries = WHATSAPP_CONFIG.retryAttempts || 3;
        this.paymentProofMessages = {};
        this.pendingProofs = new Map(); // Armazena comprovantes aguardando número do pedido
        this.orderValidationService = orderValidationService;
        this.openaiService = null; // Armazena a instância do OpenAIService
        
        // Limpa comprovantes antigos a cada hora
        setInterval(() => this._cleanupPendingProofs(), 60 * 60 * 1000);
    }

    /**
     * Obtém o serviço de validação de pedidos
     * @private
     */
    get _orderValidationService() {
        return this.orderValidationService;
    }

    /**
     * Obtém o serviço de rastreamento
     * @private
     */
    get _trackingService() {
        return null;
    }

    /**
     * Obtém o serviço de imagem
     * @private
     */
    get _imageService() {
        return null;
    }

    /**
     * Obtém o serviço de áudio
     * @private
     */
    get _audioService() {
        return null;
    }

    /**
     * Obtém o serviço de gerenciamento de mídia
     * @private
     */
    get _mediaManager() {
        return null;
    }

    /**
     * Obtém o serviço de OpenAI
     * @private
     */
    get _openaiService() {
        if (!this.openaiService) {
            console.error('❌ [WhatsApp] OpenAIService não foi configurado');
            throw new Error('OpenAIService não configurado');
        }
        return this.openaiService;
    }

    /**
     * Define o serviço OpenAI após inicialização
     * @param {Object} service Instância do OpenAIService
     */
    setOpenAIService(service) {
        console.log('🔄 [WhatsApp] Configurando OpenAIService...');
        if (!service) {
            console.error('❌ [WhatsApp] Tentativa de configurar OpenAIService com valor nulo');
            throw new Error('OpenAIService não pode ser nulo');
        }
        this.openaiService = service;
        console.log('✅ [WhatsApp] OpenAIService configurado com sucesso');
    }

    /**
     * Inicializa o serviço WhatsApp
     * @returns {Promise<Object>} Cliente HTTP inicializado
     * @throws {Error} Se falhar a inicialização
     */
    async init() {
        try {
            // Verifica credenciais primeiro
            if (!WHATSAPP_CONFIG.token || !WHATSAPP_CONFIG.connectionKey || !WHATSAPP_CONFIG.apiUrl) {
                throw new Error('Credenciais do WhatsApp não configuradas');
            }

            // Obtém a connection key
            this.connectionKey = WHATSAPP_CONFIG.connectionKey;

            // Cria o cliente HTTP
            const client = axios.create({
                baseURL: `${WHATSAPP_CONFIG.apiUrl}`,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Authorization': `Bearer ${WHATSAPP_CONFIG.token}`
                },
                timeout: WHATSAPP_CONFIG.connectionTimeout || 30000,
                params: {
                    connectionKey: this.connectionKey
                }
            });

            // Atribui o cliente à instância
            this.client = client;

            // Adiciona interceptors
            this.addInterceptor();

            // Verifica se está realmente conectado fazendo uma requisição direta
            console.log('[WhatsApp] Verificando conexão inicial...');
            try {
                const endpoint = `${WHATSAPP_CONFIG.endpoints.connection.path}?connectionKey=${this.connectionKey}`;
                console.log('[WhatsApp] Endpoint de conexão:', endpoint);
                
                const result = await this.client.get(endpoint);
                console.log('[WhatsApp] Resposta da API:', {
                    status: result.status,
                    data: result.data,
                    headers: result.headers
                });
                
                if (!result.data || result.data.error) {
                    throw new Error('API retornou erro: ' + JSON.stringify(result.data));
                }
                
                console.log('[WhatsApp] Serviço inicializado com sucesso');
                return this.client;
            } catch (error) {
                console.error('[WhatsApp] Erro ao verificar conexão:', {
                    status: error.response?.status,
                    data: error.response?.data,
                    message: error.message
                });
                throw new Error('Não foi possível conectar ao WhatsApp: ' + error.message);
            }
        } catch (error) {
            console.error('[WhatsApp] Erro ao inicializar serviço:', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            this.client = null;
            this.connectionKey = null;
            throw error;
        }
    }

    /**
     * Inicializa o serviço do WhatsApp
     * @returns {Promise<boolean>} true se inicializado com sucesso
     * @throws {Error} Se houver erro na inicialização
     */
    async initialize() {
        try {
            // Debug das configurações
            console.log('[WhatsAppService] Iniciando serviço...');

            // Verifica se as configurações necessárias estão presentes
            if (!WHATSAPP_CONFIG.apiUrl || !WHATSAPP_CONFIG.token) {
                throw new Error('Configurações do WhatsApp não definidas');
            }

            // Inicializa o cliente e verifica conexão
            await this.init();
            
            console.log('[WhatsAppService] Serviço inicializado com sucesso');
            return true;
        } catch (error) {
            console.error('[WhatsAppService] Erro ao inicializar:', error);
            throw error;
        }
    }

    /**
     * Verifica se o serviço está conectado
     * @returns {Promise<boolean>}
     */
    async isConnected() {
        try {
            // Verifica se as credenciais estão configuradas
            if (!WHATSAPP_CONFIG.token || !WHATSAPP_CONFIG.connectionKey || !WHATSAPP_CONFIG.apiUrl) {
                console.error('[WhatsApp] Credenciais não configuradas');
                return false;
            }

            // Verifica se o cliente está inicializado
            if (!this.client) {
                console.error('[WhatsApp] Cliente não inicializado');
                return false;
            }

            // Tenta fazer uma requisição simples para verificar conexão
            const endpoint = `${WHATSAPP_CONFIG.endpoints.connection.path}?connectionKey=${this.connectionKey}`;
            const result = await this.client.get(endpoint);
            
            return !result.data?.error;
        } catch (error) {
            console.error('[WhatsApp] Erro ao verificar conexão:', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            return false;
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
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            timeout: 10000
        });
    }

    /**
     * Valida e formata um número de telefone
     * @private
     * @param {string} number - Número de telefone
     * @returns {string} Número formatado
     * @throws {Error} Se o número for inválido
     */
    _validatePhoneNumber(number) {
        if (!number) {
            throw new Error('O número de telefone é obrigatório');
        }

        // Remove todos os caracteres não numéricos
        const cleaned = String(number).replace(/\D/g, '');
        
        // Valida o formato (DDI + DDD + Número)
        // DDI: 1-3 dígitos
        // DDD: 2 dígitos
        // Número: 8-9 dígitos
        if (!/^[1-9]\d{1,2}[1-9]\d{8,9}$/.test(cleaned)) {
            throw new Error('Número de telefone inválido. Use o formato: DDI DDD NÚMERO');
        }

        // Garante que o número comece com o código do país (55 para Brasil)
        if (!cleaned.startsWith('55')) {
            throw new Error('O número deve começar com 55 (Brasil)');
        }
        
        return cleaned;
    }

    /**
     * Trata erros específicos da API
     * @private
     * @param {Error} error - Erro original
     * @throws {Error} Erro tratado
     */
    _handleApiError(error) {
        if (error.response?.data?.error) {
            switch(error.response.status) {
                case 401:
                    throw new Error('Token inválido ou expirado');
                case 415:
                    throw new Error('Content-Type inválido. Certifique-se de enviar application/json');
                case 429:
                    throw new Error('Limite de requisições excedido');
                default:
                    throw new Error(error.response.data.message || 'Erro desconhecido');
            }
        }
        throw error;
    }

    async sendText(to, text) {
        try {
            const client = await this.getClient();
            if (!client) {
                throw new Error('Cliente HTTP não inicializado');
            }

            const phoneNumber = this._validatePhoneNumber(to);
            
            // Garante que o texto seja uma string válida
            let messageText;
            if (typeof text === 'object') {
                messageText = text.message || JSON.stringify(text);
            } else {
                messageText = String(text || '').trim();
            }

            if (!messageText) {
                throw new Error('O conteúdo da mensagem é obrigatório');
            }

            const messageId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            console.log('[WhatsAppService] sendText - Enviando mensagem:', {
                para: phoneNumber,
                texto: messageText,
                messageId,
                timestamp: new Date().toISOString()
            });

            // Constrói a URL completa
            const endpoint = `${WHATSAPP_CONFIG.apiUrl}/${WHATSAPP_CONFIG.endpoints.text.path}`;

            // Constrói o payload conforme os parâmetros esperados
            const payload = {
                phoneNumber,
                text: messageText,
                delayMessage: Math.floor(WHATSAPP_CONFIG.messageDelay / 1000)
            };

            // Adiciona headers de autenticação
            const config = {
                headers: {
                    'Authorization': `Bearer ${WHATSAPP_CONFIG.token}`,
                    'Connection-Key': WHATSAPP_CONFIG.connectionKey,
                    'Content-Type': 'application/json'
                }
            };

            const response = await this._retryWithExponentialBackoff(async () => {
                const result = await client.post(endpoint, payload, config);
                
                if (result.data?.error && result.data?.message?.includes('conta')) {
                    await this.init();
                    throw new Error('Erro de conta, tentando novamente...');
                }
                
                return result;
            });

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

            this._handleApiError(error);
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
            const phoneNumber = this._validatePhoneNumber(to);
            const config = WHATSAPP_CONFIG.endpoints.image;
            const endpoint = `${config.path}`;
            
            // Prepara o payload
            const payload = {
                [config.params.to]: phoneNumber,
                [config.params.content]: typeof image === 'object' ? image.url || image.base64 : image,
                [config.params.delay]: WHATSAPP_CONFIG.messageDelay / 1000
            };

            // Adiciona caption se fornecido
            if (caption || (typeof image === 'object' && image.caption)) {
                payload[config.params.caption] = caption || image.caption;
            }

            console.log(' Enviando imagem:', {
                para: phoneNumber,
                tipo: this._isBase64(payload[config.params.content]) ? 'base64' : 'url',
                temLegenda: !!payload[config.params.caption],
                timestamp: new Date().toISOString()
            });

            const response = await this._retryWithExponentialBackoff(async () => {
                const result = await this.client.post(endpoint, payload);
                await this.delay();
                return result;
            });

            console.log(' Imagem enviada com sucesso:', {
                messageId: response.data?.messageId,
                timestamp: new Date().toISOString()
            });

            return response.data;
        } catch (error) {
            console.error('[WhatsApp] Erro ao enviar imagem:', {
                erro: error.message,
                para: to,
                timestamp: new Date().toISOString()
            });
            this._handleApiError(error);
        }
    }

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

            // Extrai a mensagem real considerando todos os possíveis caminhos
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
            console.log('🖼️ [WhatsApp] Processando mensagem com imagem:', {
                messageId: message.key?.id,
                from: message.key?.remoteJid,
                hasCaption: !!message.message?.imageMessage?.caption
            });

            // Extrai o remetente
            const from = message.key?.remoteJid?.replace('@s.whatsapp.net', '');
            if (!from) {
                throw new Error('Remetente não encontrado na mensagem');
            }

            // Baixa a imagem
            const buffer = await this.downloadMediaMessage(message);
            const base64Image = buffer.toString('base64');

            // Prepara os dados da imagem para o GPT-4V
            const imageData = {
                text: message.message?.imageMessage?.caption || 'O que você vê nesta imagem?',
                image: {
                    base64: base64Image,
                    mimetype: message.message?.imageMessage?.mimetype || 'image/jpeg'
                }
            };

            // Primeiro analisa a imagem com GPT-4V
            const imageAnalysis = await this._imageService.analyzeWithGPT4V(imageData);
            
            // Envia a análise para o Assistant processar e responder
            const response = await this._openaiService.runAssistant(
                from,
                `[ANÁLISE DA IMAGEM]\n${imageAnalysis}\n\n[CONTEXTO]\n${imageData.text}`
            );

            // Envia a resposta do Assistant
            await this.sendText(from, response);

            console.log('✅ [WhatsApp] Imagem processada com sucesso:', {
                messageId: message.key?.id,
                from: from,
                responseLength: response?.length
            });

        } catch (error) {
            console.error('❌ [WhatsApp] Erro ao processar imagem:', {
                erro: error.message,
                stack: error.stack,
                messageId: message.key?.id
            });

            const from = message.key?.remoteJid?.replace('@s.whatsapp.net', '');
            if (from) {
                await this.sendText(
                    from,
                    'Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente em alguns instantes.'
                );
            }
        }
    }

    async handleAudioMessage(message) {
        try {
            console.log('🎵 [WhatsApp] Processando mensagem de áudio:', {
                messageId: message.key?.id,
                from: message.key?.remoteJid
            });

            // Extrai o remetente
            const from = message.key?.remoteJid?.replace('@s.whatsapp.net', '');

            if (!from) {
                throw new Error('Remetente não encontrado na mensagem');
            }

            // Baixa o áudio
            const buffer = await this.downloadMediaMessage(message);

            // Converte áudio para texto usando o AudioService
            const transcription = await this._audioService.transcribeAudio(buffer);
            if (!transcription.success) {
                throw new Error(transcription.error || 'Falha ao transcrever áudio');
            }

            // Processa com o Assistant da OpenAI
            const response = await this._openaiService.processCustomerMessage(
                from,
                `[TRANSCRIÇÃO DE ÁUDIO]\n${transcription.text}`
            );

            // Envia a resposta do Assistant
            await this.sendText(from, response);

            console.log('✅ [WhatsApp] Áudio processado com sucesso:', {
                messageId: message.key?.id,
                from: from,
                responseLength: response?.length
            });

        } catch (error) {
            console.error('❌ [WhatsApp] Erro ao processar áudio:', {
                erro: error.message,
                stack: error.stack,
                messageId: message.key?.id
            });

            const from = message.key?.remoteJid?.replace('@s.whatsapp.net', '');
            if (from) {
                await this.sendText(
                    from,
                    'Desculpe, ocorreu um erro ao processar sua mensagem de áudio. Por favor, tente novamente em alguns instantes.'
                );
            }
        }
    }

    async handleTextMessage(message) {
        try {
            console.log('💬 [WhatsApp] Processando mensagem de texto:', {
                messageId: message.key?.id,
                from: message.key?.remoteJid,
                pushName: message.pushName
            });

            // Extrai o texto da mensagem considerando todos os possíveis caminhos
            const text = message.message?.extendedTextMessage?.text || 
                        message.message?.conversation ||
                        message.message?.text ||
                        message.text || '';

            // Extrai o remetente de forma segura
            const from = message.key?.remoteJid?.replace('@s.whatsapp.net', '');

            if (!text || !from) {
                console.error('❌ [WhatsApp] Dados inválidos:', { text, from });
                throw new Error('Texto ou remetente não encontrado na mensagem');
            }

            console.log('📝 [WhatsApp] Texto extraído:', {
                from,
                pushName: message.pushName,
                text: text.substring(0, 100) // Log apenas os primeiros 100 caracteres
            });

            // Adiciona o nome do usuário ao contexto se disponível
            const contextText = message.pushName ? 
                `[USUÁRIO: ${message.pushName}] ${text}` : 
                text;

            console.log('🤖 [WhatsApp] Chamando OpenAI Assistant...', {
                from,
                contextText: contextText.substring(0, 100)
            });

            // Verifica se o OpenAIService está configurado
            if (!this._openaiService) {
                console.error('❌ [WhatsApp] OpenAIService não está configurado');
                throw new Error('OpenAIService não configurado');
            }

            // Processa a mensagem com o Assistant
            const response = await this._openaiService.runAssistant(from, contextText);

            console.log('✨ [WhatsApp] Resposta do Assistant:', {
                from,
                responseType: typeof response,
                responseLength: response?.length,
                responsePreview: response?.substring(0, 100)
            });

            if (!response || typeof response !== 'string') {
                console.error('❌ [WhatsApp] Resposta inválida do Assistant:', response);
                throw new Error('Resposta inválida do Assistant');
            }

            console.log('📤 [WhatsApp] Enviando resposta...', {
                to: from,
                length: response.length
            });

            await this.sendText(from, response);
            console.log('✅ [WhatsApp] Resposta enviada com sucesso');

        } catch (error) {
            console.error('❌ [WhatsApp] Erro ao processar mensagem de texto:', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });

            // Se for um erro de OpenAI não configurado, tenta enviar mensagem de erro para o usuário
            if (error.message === 'OpenAIService não configurado') {
                try {
                    await this.sendText(message.key.remoteJid.replace('@s.whatsapp.net', ''), 
                        '❌ Desculpe, estou com um problema técnico no momento. Por favor, tente novamente mais tarde.');
                } catch (sendError) {
                    console.error('❌ [WhatsApp] Erro ao enviar mensagem de erro:', sendError);
                }
            }

            throw error;
        }
    }

    async handleOrderNumber(message) {
        try {
            // Verifica se tem comprovante pendente
            const hasPendingProof = this.pendingProofs.get(message.from) || 
                                  this.paymentProofMessages[message.from];

            // Extrai e valida o número do pedido usando a nova função
            const { orderNumber } = await this._orderValidationService.extractOrderNumber(message.body);
            
            if (!orderNumber) {
                await this.sendText(
                    message.from, 
                    'Por favor, me envie um número de pedido válido com 4 ou mais dígitos.'
                );
                return hasPendingProof; // Retorna true se tiver comprovante pendente
            }

            // Valida o pedido - agora orderNumber já vem com #
            const order = await this._orderValidationService.validateOrderNumber(orderNumber);
            if (!order) {
                await this.sendText(
                    message.from, 
                    `Não encontrei o pedido ${orderNumber}. Por favor, verifique o número.`
                );
                return hasPendingProof;
            }

            if (hasPendingProof) {
                // Fluxo de comprovante
                await this.handlePaymentProof(message.from, order);
                return true;
            }

            // Se chegou aqui é fluxo de consulta normal
            console.log('📦 Consulta de pedido:', {
                from: message.from,
                orderNumber: order.number,
                timestamp: new Date().toISOString()
            });
            return false;
        } catch (error) {
            console.error('❌ Erro ao processar número do pedido:', error);
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

    /**
     * Encaminha uma mensagem para um departamento
     * @param {Object} message Mensagem a ser encaminhada
     * @param {string} orderNumber Número do pedido (opcional)
     * @param {string} departmentNumber Número do departamento
     * @returns {Promise<boolean>} Sucesso do encaminhamento
     */
    async forwardToDepartment(message, orderNumber = null, departmentNumber) {
        try {
            if (!departmentNumber) {
                throw new Error('Número do departamento é obrigatório');
            }

            // Formata o número do pedido se existir
            const formattedOrder = orderNumber ? `#${orderNumber}` : '';

            // Envia a mensagem
            await this.sendText({
                to: departmentNumber,
                content: message.body,
                delay: WHATSAPP_CONFIG.messageDelay
            });

            console.log('✅ Mensagem encaminhada:', {
                department: message.department,
                order: formattedOrder,
                from: message.from,
                timestamp: new Date().toISOString()
            });

            return true;
        } catch (error) {
            console.error('❌ Erro ao encaminhar mensagem:', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            return false;
        }
    }

    /**
     * Adiciona interceptors ao cliente HTTP
     * @private
     */
    addInterceptor() {
        if (!this.client) {
            console.error('[WhatsApp] Cliente não inicializado ao adicionar interceptor');
            return;
        }

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
                        config.headers['Connection-Key'] = WHATSAPP_CONFIG.connectionKey;
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
     * Executa uma função com retry exponencial em caso de falha
     * @private
     * @param {Function} fn - Função a ser executada
     * @param {number} maxRetries - Número máximo de tentativas
     * @param {number} initialDelay - Delay inicial em ms
     * @returns {Promise<*>} Resultado da função
     */
    async _retryWithExponentialBackoff(fn, maxRetries = 3, initialDelay = 1000) {
        let retries = 0;
        while (true) {
            try {
                return await fn();
            } catch (error) {
                retries++;
                if (retries >= maxRetries) {
                    throw error;
                }
                const delay = initialDelay * Math.pow(2, retries - 1);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    async sendFinancialNotification(order) {
        try {
            const numeroFinanceiro = process.env.FINANCIAL_DEPT_NUMBER;
            const message = `Novo pedido ${order.number} no valor de R$${order.total} aguardando pagamento da taxa.`;

            await this.sendMessage(numeroFinanceiro, message);

            console.log(' Notificação enviada ao financeiro:', {
                numeroFinanceiro,
                message,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error(' Erro ao enviar notificação ao financeiro:', error);
        }
    }
}

module.exports = { WhatsAppService };
