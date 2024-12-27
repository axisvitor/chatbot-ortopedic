const axios = require('axios');
const { WHATSAPP_CONFIG } = require('../config/settings');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { GroqServices } = require('./groq-services');
const FormData = require('form-data');

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
                console.log('🔄 Erro de conta, reinicializando conexão...');
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
            console.error('❌ Erro ao enviar mensagem:', {
                para: to,
                erro: error.message,
                status: error.response?.status,
                data: error.response?.data,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });

            // Verifica erro de conta no catch
            if (error.response?.data?.error && error.response?.data?.message?.includes('conta')) {
                console.log('🔄 Erro de conta no catch, reinicializando conexão...');
                await this.init();
                return this.sendText(to, text);
            }

            throw error;
        }
    }

    async init() {
        try {
            console.log('🔄 Inicializando WhatsApp Service...');
            
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

            console.log('✅ WhatsApp Service inicializado:', {
                baseUrl: WHATSAPP_CONFIG.apiUrl,
                chaveConexao: this.connectionKey,
                timestamp: new Date().toISOString()
            });

            return true;
        } catch (error) {
            console.error('❌ Erro ao inicializar WhatsApp Service:', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            return false;
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
            console.log('📥 Baixando mídia:', {
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
                console.log('⚠️ Mensagem do tipo "ver uma vez" detectada');
            }

            // Para áudios, usa direto o Baileys
            if (realMessage.audioMessage) {
                return await downloadMediaMessage(
                    { message: realMessage },
                    'buffer',
                    {},
                    {
                        logger: console,
                        reuploadRequest: this.reuploadRequest
                    }
                );
            }

            // Para imagens e outros tipos, usa a API
            // Obtém o ID específico da mídia baseado no tipo
            let mediaId;
            if (realMessage.imageMessage) {
                mediaId = realMessage.imageMessage.mediaKey || realMessage.imageMessage.id;
            } else if (realMessage.videoMessage) {
                mediaId = realMessage.videoMessage.mediaKey || realMessage.videoMessage.id;
            } else if (realMessage.documentMessage) {
                mediaId = realMessage.documentMessage.mediaKey || realMessage.documentMessage.id;
            }

            if (!mediaId) {
                console.log('⚠️ Detalhes da mensagem:', {
                    messageId: message?.key?.id,
                    mediaTypes: Object.keys(realMessage),
                    mediaDetails: mediaMessage,
                    timestamp: new Date().toISOString()
                });
                throw new Error('ID da mídia não encontrado na mensagem');
            }

            // Faz a requisição para obter a URL
            const response = await axios.get(
                `${WHATSAPP_CONFIG.apiUrl}/v1/media/${mediaId}/download`,
                {
                    headers: {
                        'Authorization': `Bearer ${WHATSAPP_CONFIG.token}`
                    }
                }
            );

            if (!response.data?.url) {
                throw new Error('URL da mídia não encontrada na resposta da API');
            }

            // Baixa o conteúdo da URL
            const mediaResponse = await axios.get(response.data.url, {
                responseType: 'arraybuffer'
            });

            if (!mediaResponse.data) {
                throw new Error('Falha ao baixar conteúdo da mídia');
            }

            const mediaBuffer = Buffer.from(mediaResponse.data);

            // Se necessário, descriptografa usando o Baileys
            if (mediaMessage.mediaKey) {
                return await downloadMediaMessage(
                    { message: realMessage },
                    'buffer',
                    { mediaBuffer }, // Passa o buffer já baixado
                    {
                        logger: console,
                        reuploadRequest: this.reuploadRequest
                    }
                );
            }

            // Se não precisar descriptografar, retorna o buffer direto
            return mediaBuffer;

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
            console.log('↪️ Encaminhando mensagem:', {
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

            console.log('✅ Mensagem encaminhada com sucesso');
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
            console.log('🖼️ Enviando imagem por URL:', {
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
            console.log('🖼️ Enviando arquivo de imagem:', {
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
                // Armazena temporariamente a mensagem do comprovante
                this.paymentProofMessages = this.paymentProofMessages || {};
                this.paymentProofMessages[message.from] = message;
                
                // Envia a mensagem para o departamento financeiro imediatamente
                const numeroFinanceiro = process.env.FINANCIAL_DEPT_NUMBER;
                if (numeroFinanceiro) {
                    await this.forwardMessage(message, numeroFinanceiro);
                    await this.sendText(
                        numeroFinanceiro,
                        `⚠️ *Novo Comprovante Recebido*\nCliente: ${message.from}\nData: ${new Date().toLocaleString('pt-BR')}`
                    );
                }

                // Solicita o número do pedido ao cliente
                await this.sendText(
                    message.from, 
                    '✅ Recebi seu comprovante e já encaminhei para nossa equipe financeira! ' + 
                    'Para agilizar o processo, por favor me informe o número do seu pedido.'
                );
                
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

            // Encaminha o número do pedido para o financeiro
            const numeroFinanceiro = process.env.FINANCIAL_DEPT_NUMBER;
            if (numeroFinanceiro) {
                await this.sendText(
                    numeroFinanceiro,
                    `📦 *Número do Pedido Recebido*\nPedido: #${orderNumber}\nCliente: ${message.from}`
                );
            }
            
            // Confirma para o cliente
            await this.sendText(
                message.from,
                `✅ Recebi o número do pedido #${orderNumber}. Nossa equipe financeira já está com seu comprovante e fará a validação o mais breve possível.`
            );

            // Limpa o comprovante da memória
            delete this.paymentProofMessages[message.from];
            return true;

        } catch (error) {
            console.error('❌ Erro ao processar número do pedido:', error);
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
