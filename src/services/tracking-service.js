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

            // Valida a resposta
            if (!response || response.code !== 0 || !response.data || !response.data.accepted) {
                throw new Error('Resposta inválida da API');
            }

            // Pega o primeiro item aceito
            const trackInfo = response.data.accepted[0];
            if (!trackInfo || !trackInfo.track_info) {
                throw new Error('Dados de rastreamento não encontrados');
            }

            // Extrai as informações relevantes
            const trackingData = {
                status: trackInfo.track_info.latest_status?.status || 'Unknown',
                sub_status: trackInfo.track_info.latest_status?.sub_status,
                last_event: {
                    time: trackInfo.track_info.latest_event?.time_iso,
                    time_utc: trackInfo.track_info.latest_event?.time_utc,
                    stage: trackInfo.track_info.latest_event?.key_stage
                },
                carrier: {
                    name: trackInfo.track_info.carrier?.name,
                    country: trackInfo.track_info.carrier?.country
                },
                events: trackInfo.track_info.milestone || []
            };

            console.log('✅ [Tracking] Dados processados:', {
                trackingNumber,
                status: trackingData.status,
                lastEvent: trackingData.last_event
            });

            return trackingData;

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
            // Tenta obter do cache primeiro (apenas se não forçar atualização)
            if (!forceRefresh) {
                const cached = await this.redisStore.get(this._getCacheKey(trackingNumber));
                if (cached) {
                    const parsedCache = JSON.parse(cached);
                    // Verifica se o cache tem dados válidos
                    if (parsedCache && parsedCache.status) {
                        console.log(`[Tracking][${transactionId}] Dados encontrados em cache`, {
                            trackingNumber,
                            status: parsedCache.status
                        });
                        return parsedCache;
                    }
                    console.log(`[Tracking][${transactionId}] Cache inválido, atualizando...`, {
                        trackingNumber
                    });
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

            // Log dos dados recebidos
            console.log(`[Tracking][${transactionId}] Dados recebidos da API:`, {
                trackingNumber,
                data: trackingData
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

            // Atualiza cache apenas se tiver dados válidos
            if (safeTrackingData && safeTrackingData.status) {
                await this.redisStore.set(
                    this._getCacheKey(trackingNumber),
                    JSON.stringify(safeTrackingData),
                    this.cacheConfig.ttl
                );
            }

            // Se o status indica entrega, atualiza Nuvemshop
            if (safeTrackingData.status?.toLowerCase() === 'delivered') {
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
            if (!trackInfo || !trackInfo.status) {
                return 'Desculpe, não foi possível obter informações de rastreamento no momento.';
            }

            // Emoji baseado no status
            const statusEmoji = this.STATUS_EMOJIS[trackInfo.status] || '📦';

            // Formata a data do último evento
            const lastEventDate = trackInfo.last_event?.time 
                ? new Date(trackInfo.last_event.time).toLocaleString('pt-BR', {
                    timeZone: 'America/Sao_Paulo',
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })
                : 'Data não disponível';

            // Status principal
            let message = `${statusEmoji} *Status da Encomenda*\n\n`;
            message += `📍 *Status:* ${this._translateStatus(trackInfo.status)}\n`;
            message += `🕒 *Última Atualização:* ${lastEventDate}\n`;

            // Adiciona detalhes do sub-status se disponível
            if (trackInfo.sub_status) {
                message += `📝 *Detalhe:* ${this._translateSubStatus(trackInfo.sub_status)}\n`;
            }

            // Adiciona local do último evento se disponível
            if (trackInfo.last_event?.stage) {
                message += `📌 *Situação:* ${this._translateStage(trackInfo.last_event.stage)}\n`;
            }

            // Adiciona eventos recentes se disponíveis
            if (trackInfo.events && trackInfo.events.length > 0) {
                message += '\n📋 *Últimos eventos:*\n';
                const recentEvents = trackInfo.events.slice(0, 3); // Mostra apenas os 3 eventos mais recentes
                recentEvents.forEach(event => {
                    const eventDate = event.time_iso 
                        ? new Date(event.time_iso).toLocaleString('pt-BR', {
                            timeZone: 'America/Sao_Paulo',
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit'
                          })
                        : 'Data não disponível';
                    message += `\n• ${eventDate}: ${this._translateStage(event.key_stage) || 'Status não disponível'}`;
                });
            }

            return message;
        } catch (error) {
            console.error('❌ [Tracking] Erro ao formatar resposta:', {
                error: error.message,
                trackInfo
            });
            return 'Desculpe, houve um erro ao formatar as informações de rastreamento.';
        }
    }

    _translateStatus(status) {
        const statusMap = {
            'InfoReceived': 'Informação recebida',
            'InTransit': 'Em trânsito',
            'OutForDelivery': 'Saiu para entrega',
            'Delivered': 'Entregue',
            'Exception': 'Exceção',
            'Expired': 'Expirado',
            'Pending': 'Pendente'
        };
        return statusMap[status] || status;
    }

    _translateSubStatus(subStatus) {
        const subStatusMap = {
            'InTransit_PickedUp': 'Objeto coletado',
            'InTransit_Arrival': 'Chegou na unidade',
            'InTransit_Departure': 'Saiu da unidade',
            'Exception_Other': 'Problema na entrega',
            'Delivered_Signed': 'Entregue e assinado'
        };
        return subStatusMap[subStatus] || subStatus;
    }

    _translateStage(stage) {
        const stageMap = {
            'InfoReceived': 'Informação recebida',
            'PickedUp': 'Coletado',
            'Departure': 'Saiu da unidade',
            'Arrival': 'Chegou na unidade',
            'OutForDelivery': 'Saiu para entrega',
            'Delivered': 'Entregue',
            'Returning': 'Retornando',
            'Returned': 'Retornado'
        };
        return stageMap[stage] || stage;
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
