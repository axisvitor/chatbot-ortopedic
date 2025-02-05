const axios = require('axios');
const logger = require('../utils/logger');
const { CacheServiceSync } = require('./cache-service-sync');
const { TRACKING_CONFIG } = require('../../../config/settings');

class TrackingServiceSync {
    // Status emojis para cada estado do rastreamento
    static STATUS_EMOJIS = {
        'not_found': '❓',       // Não encontrado
        'info_received': '📝',   // Informações recebidas
        'in_transit': '🚚',      // Em trânsito
        'pickup': '📦',          // Retirada
        'out_for_delivery': '🚗', // Fora para entrega
        'undelivered': '⚠️',     // Não entregue
        'delivered': '✅',        // Entregue
        'alert': '⚡',           // Alerta (customs, return, etc)
        'expired': '⏰'          // Expirado
    };

    // Mapeamento de status do 17track para nossos status padronizados
    static STATUS_MAPPING = {
        // Não encontrado
        'not_found': ['not_found', 'no_info', 'invalid'],
        
        // Informações recebidas
        'info_received': ['info_received', 'shipping_info_received', 'label_created'],
        
        // Em trânsito
        'in_transit': [
            'in_transit', 
            'transit', 
            'departed_country', 
            'arrived_destination_country',
            'customs_clearance',
            'domestic_transit'
        ],
        
        // Retirada
        'pickup': ['pickup', 'ready_for_pickup', 'arrived_pickup_point'],
        
        // Saiu para entrega
        'out_for_delivery': ['out_for_delivery', 'with_courier', 'delivering'],
        
        // Não entregue
        'undelivered': [
            'delivery_failed',
            'recipient_unavailable',
            'delivery_delayed',
            'address_issue',
            'delivery_attempted'
        ],
        
        // Entregue
        'delivered': ['delivered', 'successful_delivery', 'completed'],
        
        // Alerta (inclui problemas alfandegários)
        'alert': [
            'customs_hold',
            'returned_to_sender',
            'customs_issue',
            'lost',
            'damaged',
            'prohibited_items',
            'restricted_items',
            'tax_payment_required'
        ],
        
        // Expirado
        'expired': ['expired', 'no_updates', 'tracking_expired']
    };

    constructor() {
        this.config = TRACKING_CONFIG;
        this.cache = new CacheServiceSync();
        
        if (!this.config.apiKey) {
            logger.error('API Key do 17track não configurada!');
            throw new Error('TRACK17_API_KEY é obrigatório');
        }
    }

    async getTrackingStatus(trackingNumber) {
        try {
            logger.info(`[Tracking] Consultando status para: ${trackingNumber}`);
            
            // Verifica no cache primeiro
            const cached = await this.cache.get(`tracking:${trackingNumber}`);
            if (cached) {
                logger.info(`[Tracking] Usando dados do cache para ${trackingNumber}`);
                return cached;
            }

            const response = await axios.post(
                `${this.config.endpoint}${this.config.paths.status}`,
                [{
                    number: trackingNumber,
                    carrier: 2151 // Código dos Correios
                }],
                {
                    headers: {
                        '17token': this.config.apiKey,
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (response.data.code !== 0) {
                throw new Error(response.data.data?.errors?.[0]?.message || 'Erro desconhecido');
            }

            const trackInfo = response.data.data?.accepted?.[0]?.track_info;
            if (!trackInfo) {
                throw new Error('Dados de rastreamento não encontrados ou inválidos');
            }

            // Mapeia o status para nosso padrão
            const rawStatus = (trackInfo.latest_status?.status || 'unknown').toLowerCase();
            let normalizedStatus = 'unknown';

            // Encontra o status normalizado
            for (const [status, patterns] of Object.entries(TrackingServiceSync.STATUS_MAPPING)) {
                if (patterns.some(pattern => rawStatus.includes(pattern))) {
                    normalizedStatus = status;
                    break;
                }
            }

            const result = {
                status: normalizedStatus,
                rawStatus: trackInfo.latest_status?.status || 'Unknown',
                lastUpdate: trackInfo.latest_event?.time_iso,
                location: trackInfo.latest_event?.location,
                description: trackInfo.latest_event?.description,
                origin: trackInfo.origin_info?.country || 'BR',
                destination: trackInfo.destination_info?.country || 'BR',
                estimatedDelivery: trackInfo.latest_status?.delivery_time,
                events: trackInfo.tracking?.providers?.[0]?.events?.map(event => ({
                    date: event.time_iso,
                    status: event.description,
                    location: event.location ? 
                        `${event.address?.city ? event.address.city + ', ' : ''}${event.location}`.trim() : 
                        'Local não informado',
                    statusCode: event.status_code
                })) || []
            };

            // Salva no cache por 30 minutos
            await this.cache.set(`tracking:${trackingNumber}`, result, 1800);
            
            return result;
            
        } catch (error) {
            logger.error(`[Tracking] Erro ao consultar status:`, {
                trackingNumber,
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    async getTrackingInfo(trackingNumbers) {
        if (!Array.isArray(trackingNumbers)) {
            trackingNumbers = [trackingNumbers];
        }

        const results = [];
        for (const number of trackingNumbers) {
            try {
                const status = await this._retryWithBackoff(
                    () => this.getTrackingStatus(number),
                    3
                );
                results.push({
                    trackingNumber: number,
                    ...status
                });
            } catch (error) {
                results.push({
                    trackingNumber: number,
                    error: error.message
                });
            }
        }

        return results;
    }

    async _retryWithBackoff(fn, maxRetries = 3) {
        let lastError;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error;
                if (attempt === maxRetries) break;
                
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
                logger.warn(`Tentativa ${attempt} falhou, aguardando ${delay}ms antes de tentar novamente`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        
        throw lastError;
    }

    // Atualiza o status de todos os códigos de rastreio
    async updateAllTrackingStatus() {
        try {
            logger.info('[Tracking] Iniciando atualização em massa dos status de rastreamento');
            
            // Busca todos os códigos de rastreio no cache
            const pattern = `${REDIS_CONFIG.prefix.tracking}*`;
            const keys = await this.cache.getKeys(pattern);
            
            if (!keys || keys.length === 0) {
                logger.info('[Tracking] Nenhum código de rastreio encontrado para atualizar');
                return;
            }

            logger.info(`[Tracking] Atualizando ${keys.length} códigos de rastreio`);
            
            // Processa em lotes de 40 (limite da API)
            const batchSize = 40;
            for (let i = 0; i < keys.length; i += batchSize) {
                const batch = keys.slice(i, i + batchSize);
                const trackingNumbers = [];
                
                // Extrai números de rastreio das chaves
                for (const key of batch) {
                    const trackingNumber = key.split(':').pop();
                    if (trackingNumber) {
                        trackingNumbers.push(trackingNumber);
                    }
                }
                
                // Atualiza o lote
                if (trackingNumbers.length > 0) {
                    await this.getTrackingInfo(trackingNumbers);
                    
                    // Aguarda 1 segundo entre lotes para não sobrecarregar a API
                    if (i + batchSize < keys.length) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }

                logger.info(`[Tracking] Processados ${Math.min(i + batchSize, keys.length)}/${keys.length} códigos`);
            }
            
            logger.info('[Tracking] Atualização em massa concluída com sucesso');
            
        } catch (error) {
            logger.error('[Tracking] Erro ao atualizar status em massa:', error);
            throw error;
        }
    }
}

module.exports = { TrackingServiceSync };
