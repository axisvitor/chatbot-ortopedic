'use strict';

const https = require('https');
const { TRACKING_CONFIG } = require('../config/settings');
const { RedisStore } = require('../store/redis-store');
const { NuvemshopService } = require('./nuvemshop-service');

class TrackingService {
    constructor(whatsAppService = null) {
        // Verifica se as configurações obrigatórias estão presentes
        if (!TRACKING_CONFIG || !TRACKING_CONFIG.apiKey) {
            console.error('❌ [Tracking] Configuração inválida:', { 
                hasConfig: !!TRACKING_CONFIG,
                hasApiKey: !!TRACKING_CONFIG?.apiKey
            });
            throw new Error('Configuração do serviço de rastreamento inválida');
        }

        this.config = {
            apiKey: TRACKING_CONFIG.apiKey,
            endpoint: TRACKING_CONFIG.endpoint || 'api.17track.net',
            paths: {
                register: TRACKING_CONFIG.paths?.register || '/track/v2.2/register',
                status: TRACKING_CONFIG.paths?.status || '/track/v2.2/gettrackinfo'
            },
            updateInterval: TRACKING_CONFIG.updateInterval || 3600000,
            carriers: TRACKING_CONFIG.carriers || ['correios', 'jadlog', 'fedex', 'dhl']
        };

        // Status padrão com emojis
        this.STATUS_EMOJIS = {
            'InTransit': '📫',
            'Delivered': '✅',
            'Pickup': '🚚',
            'CustomsHold': '📦',
            'NotFound': '❓',
            'Exception': '⚠️',
            'Expired': '⏰'
        };

        this.redisStore = new RedisStore();
        this.nuvemshopService = new NuvemshopService();
        this.whatsAppService = whatsAppService;
        
        // Configurações de retry
        this.retryConfig = {
            maxAttempts: 3,
            initialDelay: 1000,
            maxDelay: 5000
        };

        // Configurações de cache
        this.cacheConfig = {
            ttl: 30 * 60, // 30 minutos
            prefix: 'tracking:'
        };

        console.log('✅ [Tracking] Serviço inicializado com sucesso:', {
            endpoint: this.config.endpoint,
            paths: this.config.paths
        });
    }

    /**
     * Obtém o serviço WhatsApp
     * @private
     */
    get _whatsAppService() {
        return this.whatsAppService;
    }

    /**
     * Gera uma chave única para o cache do rastreamento
     * @private
     */
    _getCacheKey(trackingNumber) {
        return `${this.cacheConfig.prefix}${trackingNumber}`;
    }

    /**
     * Implementa exponential backoff para retry
     * @private
     */
    async _retryWithBackoff(operation, attempt = 1) {
        try {
            return await operation();
        } catch (error) {
            if (attempt >= this.retryConfig.maxAttempts) {
                throw error;
            }

            const delay = Math.min(
                this.retryConfig.initialDelay * Math.pow(2, attempt - 1),
                this.retryConfig.maxDelay
            );

            console.log(`🔄 [Tracking] Tentativa ${attempt} falhou, tentando novamente em ${delay}ms`, {
                error: error.message
            });

            await new Promise(resolve => setTimeout(resolve, delay));
            return this._retryWithBackoff(operation, attempt + 1);
        }
    }

    async registerTracking(trackingNumber) {
        console.log('[17Track] Iniciando registro de rastreio:', {
            trackingNumber,
            apiKeyLength: this.config.apiKey?.length,
            hasApiKey: !!this.config.apiKey
        });

        const data = JSON.stringify([
            { "number": trackingNumber }
        ]);

        const options = {
            hostname: this.config.endpoint,
            path: this.config.paths.register,
            method: 'POST',
            headers: {
                '17token': this.config.apiKey,
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        };

        console.log('[17Track] Configuração da requisição:', {
            endpoint: options.hostname,
            path: options.path,
            method: options.method,
            requestData: JSON.parse(data)
        });

        return await this._makeRequest(options, data);
    }

    async getTrackingStatus(trackingNumber) {
        try {
            console.log('🔍 [Tracking] Consultando status:', { trackingNumber });

            const data = [{
                number: trackingNumber
            }];

            const response = await this._makeRequest(this.config.paths.status, data);
            
            // Log detalhado da resposta
            console.log('📦 [Tracking] Resposta completa da API:', {
                code: response?.code,
                message: response?.message,
                responseData: JSON.stringify(response, null, 2)
            });

            // Se não tiver dados, lança erro
            if (!response || !response.data || !response.data[0]) {
                console.error('❌ [Tracking] Dados inválidos:', { response });
                throw new Error('Dados de rastreamento não disponíveis');
            }

            // Extrai dados do primeiro item
            const trackData = response.data[0];
            console.log('📝 [Tracking] Dados extraídos:', { trackData });

            // Monta objeto de retorno com validações
            const trackingInfo = {
                status: trackData.track_info?.latest_status?.status || trackData.track_info?.status || trackData.status,
                location: trackData.track_info?.latest_event?.location || trackData.track_info?.location,
                timestamp: trackData.track_info?.latest_event?.timestamp || trackData.track_info?.timestamp,
                events: trackData.track_info?.events || trackData.events || []
            };

            // Log do objeto final
            console.log('✅ [Tracking] Informações processadas:', { trackingInfo });

            return trackingInfo;
        } catch (error) {
            console.error('❌ [Tracking] Erro ao consultar status:', {
                trackingNumber,
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    async getTrackingInfo(trackingNumber, forceRefresh = false) {
        const transactionId = `trk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        console.log(`[Tracking][${transactionId}] Iniciando consulta de rastreamento`, {
            trackingNumber,
            forceRefresh
        });

        try {
            // Tenta obter do cache primeiro
            if (!forceRefresh) {
                const cached = await this.redisStore.get(this._getCacheKey(trackingNumber));
                if (cached) {
                    console.log(`[Tracking][${transactionId}] Dados encontrados em cache`, {
                        trackingNumber
                    });
                    return JSON.parse(cached);
                }
            }

            // Consulta API de rastreamento com retry
            console.log(`[Tracking][${transactionId}] Consultando API com retry`, {
                trackingNumber,
                maxAttempts: this.retryConfig.maxAttempts
            });

            const trackingData = await this._retryWithBackoff(async () => {
                const status = await this.getTrackingStatus(trackingNumber);
                if (!status) {
                    throw new Error('Dados de rastreamento não disponíveis');
                }
                return status;
            });

            // Verifica se há eventos de taxação
            const hasTaxation = this._checkForTaxation(trackingData);
            if (hasTaxation) {
                console.log(`[Tracking][${transactionId}] Detectado evento de taxação`, { 
                    trackingNumber,
                    status: trackingData.status 
                });
                await this._handleTaxationEvent(trackingNumber, trackingData);
            }

            // Remove informações sensíveis de taxação antes de cachear
            const safeTrackingData = this._removeTaxationInfo(trackingData);

            // Atualiza cache
            await this.redisStore.set(
                this._getCacheKey(trackingNumber),
                JSON.stringify(safeTrackingData),
                this.cacheConfig.ttl
            );

            // Se o status indica entrega, atualiza Nuvemshop
            if (safeTrackingData.package_status?.toLowerCase() === 'delivered') {
                await this._updateNuvemshopOrderStatus(trackingNumber);
            }

            console.log(`[Tracking][${transactionId}] Consulta finalizada com sucesso`, {
                trackingNumber,
                status: safeTrackingData.status,
                hasTaxation
            });

            return safeTrackingData;

        } catch (error) {
            console.error(`[Tracking][${transactionId}] Erro ao consultar rastreamento`, {
                trackingNumber,
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Registra um número para rastreamento
     * @private
     */
    async _registerTracking(trackingNumber) {
        const data = [{
            number: trackingNumber
        }];

        return this._makeRequest(this.config.paths.register, data);
    }
    /**
     * Verifica se há eventos de taxação nos dados de rastreamento
     * @private
     */
    _checkForTaxation(trackingData) {
        if (!trackingData || !trackingData.status) {
            return false;
        }

        const taxationTerms = [
            'taxa a pagar',
            'aguardando pagamento',
            'pagamento de taxas',
            'tributos',
            'imposto',
            'darf'
        ];

        return taxationTerms.some(term => 
            trackingData.status.toLowerCase().includes(term)
        );
    }

    /**
     * Remove informações sensíveis de taxação dos dados de rastreamento
     * @private
     */
    _removeTaxationInfo(trackingData) {
        if (!trackingData || !trackingData.status) {
            return trackingData;
        }

        const taxationTerms = [
            'taxa',
            'imposto',
            'darf',
            'tributo',
            'pagamento',
            'recolhimento'
        ];

        const hasTaxationTerm = taxationTerms.some(term => 
            trackingData.status.toLowerCase().includes(term)
        );

        if (hasTaxationTerm) {
            return {
                ...trackingData,
                status: 'Em processamento na unidade'
            };
        }

        return trackingData;
    }

    /**
     * Processa e notifica eventos de taxação
     * @private
     */
    async _handleTaxationEvent(trackingNumber, trackingData) {
        try {
            // Verifica se já notificou recentemente
            const cacheKey = `tax_notification:${trackingNumber}`;
            const lastNotification = await this.redisStore.get(cacheKey);
            
            if (lastNotification) {
                console.log('[Tracking] Notificação de taxação já enviada recentemente', {
                    trackingNumber,
                    lastNotification: new Date(lastNotification).toISOString()
                });
                return;
            }

            // Busca informações do pedido
            const orderInfo = await this.nuvemshopService.findOrderByTracking(trackingNumber);

            const taxationEvent = trackingData.status;

            // Monta mensagem para o financeiro
            const message = `*🚨 Pedido Taxado - Ação Necessária*\n\n` +
                `*Pedido:* #${orderInfo?.number || 'N/A'}\n` +
                `*Rastreamento:* ${trackingNumber}\n` +
                `*Status:* ${taxationEvent}\n` +
                `*Data:* ${new Date().toLocaleString('pt-BR')}\n` +
                `*Local:* Não informado\n\n` +
                `*Ação Necessária:* Verificar valor da taxa e providenciar pagamento`;

            // Envia notificação via WhatsApp
            const whatsapp = this._whatsAppService;
            await whatsapp.forwardToFinancial({ 
                body: message,
                from: 'SISTEMA'
            }, orderInfo?.number);

            // Guarda no cache que já notificou (24 horas)
            await this.redisStore.set(cacheKey, new Date().toISOString(), 24 * 60 * 60);

            console.log('[Tracking] Notificação de taxação enviada com sucesso', {
                trackingNumber,
                orderNumber: orderInfo?.number
            });
        } catch (error) {
            console.error('[Tracking] Erro ao processar evento de taxação', {
                trackingNumber,
                error: error.message
            });
            // Não propaga o erro para não interromper o fluxo principal
        }
    }

    async processTrackingRequest(trackingNumber, from) {
        try {
            // Remove placeholder se presente
            if (trackingNumber.includes('[código de rastreio do pedido')) {
                console.warn('⚠️ [Tracking] Recebido placeholder ao invés do código real:', trackingNumber);
                return null;
            }

            // Remove espaços e caracteres especiais
            const cleanTrackingNumber = trackingNumber.trim().replace(/[^a-zA-Z0-9]/g, '');
            
            console.log('🔍 [Tracking] Processando rastreamento:', {
                original: trackingNumber,
                limpo: cleanTrackingNumber,
                from
            });

            const trackInfo = await this.getTrackingInfo(cleanTrackingNumber);
            return this._formatTrackingResponse(trackInfo, from);
        } catch (error) {
            console.error('❌ [Tracking] Erro ao processar rastreamento:', {
                trackingNumber,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Formata a resposta com os eventos de rastreamento
     * @private
     */
    async _formatTrackingResponse(trackInfo, from) {
        try {
            // Formata a resposta com os eventos disponíveis
            let response = `📦 *Status do Rastreamento*\n\n`;
            response += `*Código:* ${trackInfo.codigo}\n`;
            
            // Verifica se está em tributação para encaminhar ao financeiro
            const isCustomsHold = trackInfo.status?.toLowerCase().includes('tributação') || 
                                trackInfo.status?.toLowerCase().includes('taxa') || 
                                trackInfo.status?.toLowerCase().includes('imposto');
            
            // Se estiver em tributação, encaminha para o financeiro
            if (isCustomsHold) {
                try {
                    // Busca informações do pedido
                    const orderInfo = await this.nuvemshopService.findOrderByTracking(trackInfo.codigo);

                    const taxationEvent = trackInfo.status;

                    // Monta mensagem para o financeiro
                    const message = `*🚨 Pedido Taxado - Ação Necessária*\n\n` +
                        `*Pedido:* #${orderInfo?.number || 'N/A'}\n` +
                        `*Rastreamento:* ${trackInfo.codigo}\n` +
                        `*Status:* ${taxationEvent}\n` +
                        `*Data:* ${new Date().toLocaleString('pt-BR')}\n` +
                        `*Local:* Não informado\n\n` +
                        `*Ação Necessária:* Verificar valor da taxa e providenciar pagamento`;

                    // Envia notificação via WhatsApp
                    const whatsapp = this._whatsAppService;
                    await whatsapp.forwardToFinancial({ 
                        body: message,
                        from: 'SISTEMA'
                    }, orderInfo?.number);

                    console.log('💰 Notificação enviada ao financeiro:', {
                        rastreio: trackInfo.codigo,
                        pedido: orderInfo?.number,
                        cliente: orderInfo?.customerName,
                        telefone: orderInfo?.customerPhone,
                        timestamp: new Date().toISOString()
                    });
                } catch (error) {
                    console.error('❌ Erro ao notificar financeiro:', error);
                }
            }

            // Define o status com emoji
            let status = trackInfo.status;
            if (isCustomsHold) {
                status = '📦 Em processamento';
            } else {
                const emoji = this.STATUS_EMOJIS[trackInfo.status] || '❓';
                switch (trackInfo.status) {
                    case 'InTransit':
                        status = `${emoji} Em Trânsito`;
                        break;
                    case 'Delivered':
                        status = `${emoji} Entregue`;
                        break;
                    case 'Pickup':
                        status = `${emoji} Coletado`;
                        break;
                    case 'CustomsHold':
                        status = `${emoji} Em processamento`;
                        break;
                    case 'NotFound':
                        status = `${emoji} Não encontrado`;
                        break;
                    case 'Exception':
                        status = `${emoji} Problema na entrega`;
                        break;
                    case 'Expired':
                        status = `${emoji} Expirado`;
                        break;
                    default:
                        status = `${emoji} ${trackInfo.status}`;
                }
            }
            response += `*Status:* ${status}\n`;

            // Adiciona última atualização
            if (trackInfo.atualizacao) {
                const date = new Date(trackInfo.atualizacao);
                response += `*Última Atualização:* ${date.toLocaleString('pt-BR')}\n`;
            }

            // Adiciona os últimos eventos
            if (trackInfo.diasEmTransito) {
                response += `\n_Tempo em trânsito: ${trackInfo.diasEmTransito} dias_\n`;
            }

            return response;

        } catch (error) {
            console.error('[Tracking] Erro ao formatar resposta:', error);
            return 'Desculpe, ocorreu um erro ao formatar as informações do rastreamento.';
        }
    }

    /**
     * Valida se o texto parece ser um código de rastreio
     * @param {string} text - Texto para validar
     * @returns {string|null} Código de rastreio limpo ou null
     */
    validateTrackingNumber(text) {
        if (!text) return null;

        // Remove espaços e caracteres especiais
        const cleanText = text.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

        // Padrões por transportadora
        const carriers = {
            correios: /^[A-Z]{2}[0-9]{9}[A-Z]{2}$/,
            jadlog: /^[0-9]{14}$/,
            fedex: /^[0-9]{12}$/,
            dhl: /^[0-9]{10}$/,
            cainiao: /^LP\d{14}$|^[A-Z]{2}\d{14}$|^[A-Z]{3}\d{12}$/  // Padrões Cainiao: LP00000000000000, XX00000000000000, XXX000000000000
        };

        for (const [carrier, pattern] of Object.entries(carriers)) {
            if (pattern.test(cleanText)) {
                return { code: cleanText, carrier };
            }
        }

        // Padrões genéricos como fallback
        const genericPatterns = [
            /^[A-Z]{2}\d{9}[A-Z]{2}$/,     // Correios: BR123456789BR
            /^[A-Z]{2}\d{12}$/,             // DHL, FedEx: XX123456789012
            /^1Z[A-Z0-9]{16}$/,             // UPS: 1Z999AA1234567890
            /^[A-Z]{3}\d{7}$/,              // TNT: ABC1234567
            /^\d{12,14}$/,                  // Outros: 123456789012
            /^LP\d{14}$/,                   // Cainiao: LP00000000000000
            /^[A-Z]{2}\d{14}$/,             // Cainiao: XX00000000000000
            /^[A-Z]{3}\d{12}$/              // Cainiao: XXX000000000000
        ];

        if (genericPatterns.some(pattern => pattern.test(cleanText))) {
            return { code: cleanText, carrier: 'unknown' };
        }

        return null;
    }

    /**
     * Verifica se o texto contém palavras relacionadas a rastreamento
     * @param {string} text - Texto para verificar
     * @returns {boolean}
     */
    hasTrackingKeywords(text) {
        if (!text) return false;

        const keywords = [
            'rastrear', 'rastreio', 'rastreamento',
            'entrega', 'entregar', 'entregue',
            'código', 'codigo', 'track',
            'correio', 'correios', 'transportadora',
            'pedido', 'encomenda', 'pacote'
        ];

        const normalizedText = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return keywords.some(keyword => normalizedText.includes(keyword));
    }

    async _makeRequest(path, data) {
        const options = {
            hostname: this.config.endpoint,
            path,
            method: 'POST',
            headers: {
                '17token': this.config.apiKey,
                'Content-Type': 'application/json',
                'Content-Length': JSON.stringify(data).length
            }
        };

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let responseData = '';

                // Trata redirecionamentos
                if (res.statusCode === 301 || res.statusCode === 302) {
                    const newLocation = res.headers.location;
                    if (newLocation) {
                        console.log('🔄 [Tracking] Redirecionando para:', newLocation);
                        const newOptions = new URL(newLocation);
                        return this._makeRequest(newOptions.pathname + newOptions.search, data).then(resolve).catch(reject);
                    }
                }

                res.on('data', (chunk) => {
                    responseData += chunk;
                });

                res.on('end', () => {
                    try {
                        // Verifica se é uma resposta HTML
                        if (res.headers['content-type']?.includes('text/html')) {
                            throw new Error('Serviço de rastreamento temporariamente indisponível');
                        }

                        // Parse do JSON
                        const result = JSON.parse(responseData);

                        // Verifica erros no formato da API
                        if (result.code !== 0) {
                            let errorMessage = 'Erro ao consultar rastreamento';
                            
                            // Códigos de erro comuns da 17track
                            switch(result.code) {
                                case 4031:
                                    errorMessage = 'API key inválida';
                                    break;
                                case 4032:
                                    errorMessage = 'Limite de requisições excedido';
                                    break;
                                default:
                                    errorMessage = result.message || 'Erro desconhecido';
                            }
                            
                            throw new Error(errorMessage);
                        }

                        resolve(result);
                    } catch (error) {
                        console.error('❌ [Tracking] Erro ao processar resposta:', {
                            error: error.message,
                            responseData,
                            statusCode: res.statusCode,
                            headers: res.headers
                        });
                        reject(error);
                    }
                });
            });

            req.on('error', (error) => {
                console.error('❌ [Tracking] Erro na requisição:', {
                    error: error.message,
                    options
                });
                reject(error);
            });

            req.write(JSON.stringify(data));
            req.end();
        });
    }
}

module.exports = { TrackingService };
