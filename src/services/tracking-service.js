'use strict';

const https = require('https');
const { TRACKING_CONFIG, REDIS_CONFIG } = require('../config/settings');
const { RedisStore } = require('../store/redis-store');
const { NuvemshopService } = require('./nuvemshop');

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
            ttl: REDIS_CONFIG.ttl.tracking,
            prefix: REDIS_CONFIG.prefix.tracking
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
        return `${REDIS_CONFIG.prefix.tracking}${trackingNumber}`;
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
            
            // Limpa e simplifica os dados antes de logar
            const cleanedData = this._cleanTrackingData(response);
            
            // Log apenas dos dados relevantes
            console.log('📦 [Tracking] Dados do rastreamento:', {
                trackingNumber,
                status: cleanedData?.status,
                latestEvent: cleanedData?.latest_event
            });

            if (!cleanedData) {
                throw new Error('Dados de rastreamento não encontrados ou inválidos');
            }

            return cleanedData;
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
            // Tenta obter do cache primeiro (apenas se não forçar atualização)
            if (!forceRefresh) {
                const cached = await this._getFromCache(trackingNumber);
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
                await this._saveToCache(trackingNumber, JSON.stringify(safeTrackingData));
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
        if (!trackingData || (!trackingData.status?.current && typeof trackingData.status !== 'string')) {
            return false;
        }

        const statusText = typeof trackingData.status === 'string' 
            ? trackingData.status 
            : trackingData.status.current;

        if (!statusText) return false;

        const taxationTerms = [
            'taxa',
            'imposto',
            'tributação',
            'alfândega',
            'customs',
            'taxation',
            'tax'
        ];

        return taxationTerms.some(term => 
            statusText.toLowerCase().includes(term)
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
            if (!trackInfo) {
                return 'Desculpe, não foi possível obter informações de rastreamento no momento.';
            }

            // Emoji baseado no status
            const statusEmoji = this.STATUS_EMOJIS[trackInfo.status] || '📦';
            const statusText = this._translateStatus(trackInfo.status);

            // Formata a data do último evento
            const eventDate = trackInfo.time 
                ? new Date(trackInfo.time).toLocaleString('pt-BR', {
                    timeZone: 'America/Sao_Paulo',
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })
                : 'Data não disponível';

            // Monta a mensagem com todas as informações
            let message = `${statusEmoji} *Status da Encomenda*\n\n`;
            
            // Status principal
            message += `📍 *Status:* ${statusText}\n`;
            message += `🕒 *Última Atualização:* ${eventDate}\n`;

            // Sub-status e Stage
            if (trackInfo.sub_status) {
                message += `📝 *Detalhe:* ${this._translateSubStatus(trackInfo.sub_status)}\n`;
            }
            
            if (trackInfo.stage) {
                message += `📌 *Situação:* ${this._translateStage(trackInfo.stage)}\n`;
            }

            // Local atual
            if (trackInfo.location) {
                message += `📍 *Local:* ${trackInfo.location}\n`;
            }

            // Eventos recentes
            if (trackInfo.events?.length > 0) {
                message += '\n📋 *Últimos eventos:*\n';
                trackInfo.events.forEach(event => {
                    const date = event.time 
                        ? new Date(event.time).toLocaleString('pt-BR', {
                            timeZone: 'America/Sao_Paulo',
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit'
                          })
                        : 'Data não disponível';
                    
                    message += `\n• ${date}`;
                    if (event.stage) {
                        message += ` - ${this._translateStage(event.stage)}`;
                    }
                    if (event.location) {
                        message += `\n  📍 ${event.location}`;
                    }
                });
            }

            return message;

        } catch (error) {
            console.error('❌ [Tracking] Erro ao formatar resposta:', error);
            return 'Desculpe, ocorreu um erro ao formatar as informações de rastreamento.';
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

    /**
     * Atualiza o status do pedido na Nuvemshop quando entregue
     * @private
     */
    async _updateNuvemshopOrderStatus(trackingNumber) {
        try {
            // Busca o pedido associado ao código de rastreio
            const order = await this.nuvemshopService.findOrderByTrackingNumber(trackingNumber);
            
            if (!order) {
                console.warn(`[Tracking] Pedido não encontrado para o código de rastreio: ${trackingNumber}`);
                return;
            }

            // Atualiza o status do pedido para "entregue"
            await this.nuvemshopService.updateOrderStatus(order.id, 'delivered');
            
            console.log(`[Tracking] Status do pedido ${order.number} atualizado para entregue na Nuvemshop`);
        } catch (error) {
            console.error('[Tracking] Erro ao atualizar status do pedido na Nuvemshop:', error);
            // Não propaga o erro para não interromper o fluxo principal
        }
    }

    /**
     * Busca pacotes com taxas pendentes na alfândega
     * @returns {Promise<Array>} Lista de pacotes com taxas pendentes
     */
    async getPackagesWithPendingCustoms() {
        try {
            console.log('[Tracking] Buscando pacotes com taxas pendentes...');

            // Busca status de todos os pacotes cadastrados
            const data = [{
                "num": "ALL" // Busca todos os pacotes cadastrados
            }];

            const response = await this._makeRequest(this.config.paths.status, data);
            
            if (!response || response.code !== 0 || !response.data || !response.data.accepted) {
                throw new Error('Resposta inválida da API');
            }

            const pendingPackages = [];

            // Filtra apenas os pacotes retidos na alfândega
            response.data.accepted.forEach(item => {
                if (item.track_info && this._checkForTaxation(item.track_info)) {
                    pendingPackages.push({
                        trackingNumber: item.number,
                        status: item.track_info.latest_status?.status || 'Unknown'
                    });
                }
            });

            console.log('[Tracking] Busca de pacotes com taxas concluída:', {
                total: pendingPackages.length
            });

            return pendingPackages;

        } catch (error) {
            console.error('[Tracking] Erro ao buscar pacotes com taxas:', error);
            throw error;
        }
    }

    /**
     * Limpa e simplifica os dados de rastreamento
     * @private
     * @param {Object} response - Resposta completa da API
     * @returns {Object} Dados limpos e simplificados
     */
    _cleanTrackingData(response) {
        if (!response?.data?.accepted?.[0]?.track_info) {
            return null;
        }

        const info = response.data.accepted[0].track_info;
        const latestStatus = info.latest_status || {};
        const latestEvent = info.latest_event || {};

        return {
            status: latestStatus.status || 'Unknown',
            sub_status: latestStatus.sub_status,
            stage: latestEvent.stage,
            time: latestEvent.time_iso,
            location: latestEvent.location || 'Local não informado',
            description: latestEvent.description,
            events: (info.milestone || [])
                .slice(0, 3)
                .map(event => ({
                    time: event.time_iso,
                    stage: event.stage,
                    location: event.location || 'Local não informado'
                }))
        };
    }

    /**
     * Obtém informações de rastreamento do cache
     * @private
     */
    async _getFromCache(trackingNumber) {
        try {
            const key = this._getCacheKey(trackingNumber);
            const cached = await this.redisStore.get(key);
            return cached;
        } catch (error) {
            console.error('[Tracking] Erro ao buscar do cache:', error);
            return null;
        }
    }

    /**
     * Salva informações de rastreamento no cache
     * @private
     */
    async _saveToCache(trackingNumber, data) {
        try {
            const key = this._getCacheKey(trackingNumber);
            await this.redisStore.set(key, data, REDIS_CONFIG.ttl.tracking);
            console.log('[Tracking] Dados salvos em cache:', { trackingNumber });
        } catch (error) {
            console.error('[Tracking] Erro ao salvar no cache:', error);
        }
    }

    /**
     * Registra horário da última atualização
     * @private
     */
    async _updateLastCheck(trackingNumber) {
        try {
            const key = `${REDIS_CONFIG.prefix.tracking}last_check:${trackingNumber}`;
            await this.redisStore.set(key, Date.now(), REDIS_CONFIG.ttl.tracking);
        } catch (error) {
            console.error('[Tracking] Erro ao atualizar último check:', error);
        }
    }

    /**
     * Obtém horário da última atualização
     * @private
     */
    async _getLastCheck(trackingNumber) {
        try {
            const key = `${REDIS_CONFIG.prefix.tracking}last_check:${trackingNumber}`;
            return await this.redisStore.get(key) || 0;
        } catch (error) {
            console.error('[Tracking] Erro ao obter último check:', error);
            return 0;
        }
    }

    /**
     * Registra tempo de espera
     * @private
     */
    async _setWaitingSince(trackingNumber) {
        try {
            const key = `${REDIS_CONFIG.prefix.waiting_since}${trackingNumber}`;
            await this.redisStore.set(key, Date.now(), REDIS_CONFIG.ttl.tracking);
        } catch (error) {
            console.error('[Tracking] Erro ao registrar tempo de espera:', error);
        }
    }

    /**
     * Obtém tempo de espera
     * @private
     */
    async _getWaitingSince(trackingNumber) {
        try {
            const key = `${REDIS_CONFIG.prefix.waiting_since}${trackingNumber}`;
            return await this.redisStore.get(key) || 0;
        } catch (error) {
            console.error('[Tracking] Erro ao obter tempo de espera:', error);
            return 0;
        }
    }
}

module.exports = { TrackingService };
