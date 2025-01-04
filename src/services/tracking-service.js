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
                status: TRACKING_CONFIG.paths?.status || '/track/v2.2/gettracklist'
            },
            updateInterval: TRACKING_CONFIG.updateInterval || 3600000,
            carriers: TRACKING_CONFIG.carriers || ['correios', 'jadlog', 'fedex', 'dhl']
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

            const data = JSON.stringify({
                "numbers": [trackingNumber]
            });

            const options = {
                hostname: this.config.endpoint,
                path: this.config.paths.status,
                method: 'POST',
                headers: {
                    '17token': this.config.apiKey,
                    'Content-Type': 'application/json',
                    'Content-Length': data.length
                }
            };

            const result = await this._makeRequest(options, data);
            
            if (!result || result.code !== 0 || !result.data?.accepted?.length) {
                throw new Error('Não foi possível obter informações de rastreamento');
            }

            const trackInfo = result.data.accepted[0];
            const lastEventTime = trackInfo.latest_event_time ? new Date(trackInfo.latest_event_time) : new Date();
            
            return {
                code: trackingNumber,
                latest_event_info: trackInfo.latest_event_info || 'Status não disponível',
                latest_event_time: trackInfo.latest_event_time || new Date().toISOString(),
                latest_event_location: trackInfo.latest_event_location || 'Localização não disponível',
                package_status: trackInfo.package_status || 'unknown',
                status: trackInfo.latest_event_info || 'Status não disponível',
                location: trackInfo.latest_event_location || 'Localização não disponível',
                last_update: lastEventTime.toLocaleString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                }),
                message: trackInfo.latest_event_message || trackInfo.latest_event_info || 'Status não disponível',
                days_of_transit: trackInfo.days_of_transit
            };
        } catch (error) {
            console.error('❌ [Tracking] Erro ao consultar status:', {
                trackingNumber,
                error: error.message
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
                    status: trackingData.latest_event_info 
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
                status: safeTrackingData.latest_event_info,
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
     * Verifica se há eventos de taxação nos dados de rastreamento
     * @private
     */
    _checkForTaxation(trackingData) {
        if (!trackingData || !trackingData.latest_event_info) {
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
            trackingData.latest_event_info.toLowerCase().includes(term)
        );
    }

    /**
     * Remove informações sensíveis de taxação dos dados de rastreamento
     * @private
     */
    _removeTaxationInfo(trackingData) {
        if (!trackingData || !trackingData.latest_event_info) {
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
            trackingData.latest_event_info.toLowerCase().includes(term)
        );

        if (hasTaxationTerm) {
            return {
                ...trackingData,
                latest_event_info: 'Em processamento na unidade'
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

            const taxationEvent = trackingData.latest_event_info;

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
        const transactionId = `trk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        console.log(`[Tracking][${transactionId}] Processando requisição de rastreamento`, {
            trackingNumber,
            from
        });

        try {
            if (!trackingNumber) {
                throw new Error('Número de rastreamento é obrigatório');
            }

            // Remove espaços e caracteres especiais do número de rastreamento
            trackingNumber = trackingNumber.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

            // Usa o novo método getTrackingInfo que já implementa cache e retry
            const trackingData = await this.getTrackingInfo(trackingNumber);

            // Se não tem dados de rastreamento
            if (!trackingData) {
                const message = 'Não foi possível encontrar informações para este rastreamento no momento. Por favor, tente novamente mais tarde.';
                console.log(`[Tracking][${transactionId}] Rastreamento não encontrado`, {
                    trackingNumber
                });
                return message;
            }

            // Se não tem eventos
            if (!trackingData.status) {
                const message = `📦 *Status do Rastreamento*\n\n*Código:* ${trackingNumber}\n\n_Ainda não há eventos de movimentação registrados._`;
                console.log(`[Tracking][${transactionId}] Sem eventos de movimentação`, {
                    trackingNumber
                });
                return message;
            }

            // Formata a resposta com os eventos
            const formattedResponse = await this._formatTrackingResponse(trackingData, from);
            
            console.log(`[Tracking][${transactionId}] Resposta formatada com sucesso`, {
                trackingNumber,
                responseLength: formattedResponse.length
            });
            
            return formattedResponse;
            
        } catch (error) {
            console.error(`[Tracking][${transactionId}] Erro ao processar rastreamento`, {
                trackingNumber,
                error: error.message,
                stack: error.stack
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
            response += `*Código:* ${trackInfo.code}\n`;
            
            // Verifica se está em tributação para encaminhar ao financeiro
            const isCustomsHold = trackInfo.package_status === 'CustomsHold' || 
                                /tribut|taxa|imposto|aduaneir/i.test(trackInfo.status);
            
            if (isCustomsHold) {
                try {
                    // Busca informações do pedido no Redis
                    const orderKey = `pending_order:${from}`;
                    const orderNumber = await this.redisStore.get(orderKey);
                    let orderInfo = null;
                    
                    if (orderNumber) {
                        orderInfo = await this.nuvemshopService.getOrderByNumber(orderNumber);
                    }
                    
                    // Encaminha para o financeiro
                    const financialMessage = {
                        type: 'tracking_customs',
                        trackingNumber: trackInfo.code,
                        status: trackInfo.package_status,
                        lastUpdate: trackInfo.last_update,
                        originalMessage: trackInfo.status,
                        from: from,
                        orderDetails: orderInfo ? {
                            number: orderInfo.number,
                            customerName: orderInfo.customer?.name || 'Não informado',
                            customerPhone: orderInfo.customer?.phone || from
                        } : {
                            number: 'Não encontrado',
                            customerName: 'Não encontrado',
                            customerPhone: from
                        }
                    };
                    
                    // Formata mensagem para o financeiro
                    const financialNotification = `🚨 *Pedido em Tributação*\n\n` +
                        `📦 Rastreio: ${trackInfo.code}\n` +
                        `🛍️ Pedido: #${financialMessage.orderDetails.number}\n` +
                        `👤 Cliente: ${financialMessage.orderDetails.customerName}\n` +
                        `📱 Telefone: ${financialMessage.orderDetails.customerPhone}\n` +
                        `📅 Atualização: ${new Date(trackInfo.last_update).toLocaleString('pt-BR')}\n` +
                        `📝 Status Original: ${trackInfo.status}`;
                    
                    await this._whatsAppService.forwardToFinancial({ 
                        body: financialNotification,
                        from: 'SISTEMA'
                    }, financialMessage.orderDetails.number);

                    console.log('💰 Notificação enviada ao financeiro:', {
                        rastreio: trackInfo.code,
                        pedido: financialMessage.orderDetails.number,
                        cliente: financialMessage.orderDetails.customerName,
                        telefone: financialMessage.orderDetails.customerPhone,
                        timestamp: new Date().toISOString()
                    });
                } catch (error) {
                    console.error('❌ Erro ao notificar financeiro:', error);
                }
            }
            
            // Adiciona informações do status atual
            if (trackInfo.package_status) {
                let status = '';
                switch(trackInfo.package_status) {
                    case 'InTransit':
                        status = '📫 Em Trânsito';
                        break;
                    case 'Delivered':
                        status = '✅ Entregue';
                        break;
                    case 'Pickup':
                        status = '🚚 Coletado';
                        break;
                    case 'CustomsHold':
                        status = '📦 Em processamento';
                        break;
                    default:
                        status = trackInfo.package_status;
                }
                response += `*Status:* ${status}\n`;
            }

            // Adiciona última atualização
            if (trackInfo.last_update) {
                const date = new Date(trackInfo.last_update);
                response += `*Última Atualização:* ${date.toLocaleString('pt-BR')}\n`;
            }

            // Filtra mensagens de tributação/taxação
            if (trackInfo.status) {
                let situacao = trackInfo.status;
                
                // Lista de termos para filtrar
                const termsToReplace = [
                    /aguardando pagamento de tributos/i,
                    /em processo de tributação/i,
                    /pagamento de tributos/i,
                    /taxa/i,
                    /tribut[oaçã]/i,
                    /imposto/i,
                    /declaração aduaneira/i
                ];
                
                // Substitui termos relacionados à tributação
                if (termsToReplace.some(term => term.test(situacao))) {
                    situacao = 'Em processamento na unidade dos Correios';
                }
                
                response += `*Situação:* ${situacao}\n`;
            }

            // Adiciona tempo em trânsito
            if (trackInfo.days_of_transit) {
                response += `\n_Tempo em trânsito: ${trackInfo.days_of_transit} dias_\n`;
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

        // Padrões comuns de rastreio
        const patterns = [
            /^[A-Z]{2}\d{9}[A-Z]{2}$/,     // Correios: BR123456789BR
            /^[A-Z]{2}\d{12}$/,             // DHL, FedEx: XX123456789012
            /^1Z[A-Z0-9]{16}$/,             // UPS: 1Z999AA1234567890
            /^[A-Z]{3}\d{7}$/,              // TNT: ABC1234567
            /^\d{12,14}$/                    // Outros: 123456789012
        ];

        // Verifica se o texto limpo corresponde a algum padrão
        if (patterns.some(pattern => pattern.test(cleanText))) {
            return cleanText;
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

    async _makeRequest(options, data) {
        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let responseData = '';

                res.on('data', (chunk) => {
                    responseData += chunk;
                });

                res.on('end', () => {
                    try {
                        const result = JSON.parse(responseData);
                        resolve(result);
                    } catch (error) {
                        console.error('❌ [Tracking] Erro ao processar resposta:', {
                            error: error.message,
                            responseData
                        });
                        reject(error);
                    }
                });
            });

            req.on('error', (error) => {
                console.error('❌ [Tracking] Erro na requisição:', {
                    error: error.message
                });
                reject(error);
            });

            // Timeout de 30 segundos
            req.setTimeout(30000, () => {
                console.error('⏱ [Tracking] Timeout na requisição');
                req.destroy();
                reject(new Error('Timeout na requisição de rastreamento'));
            });

            req.write(data);
            req.end();
        });
    }
}

module.exports = { TrackingService };
