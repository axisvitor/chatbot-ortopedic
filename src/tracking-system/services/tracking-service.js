const axios = require('axios');
const logger = require('../utils/logger');
const { CacheService } = require('./cache-service');
const { TRACKING_CONFIG } = require('../../config/settings');

class TrackingService {
    constructor() {
        this.config = TRACKING_CONFIG;
        this.cache = new CacheService();
        
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

            const result = {
                status: trackInfo.latest_status?.status || 'Unknown',
                lastUpdate: trackInfo.latest_event?.time_iso,
                location: trackInfo.latest_event?.location,
                description: trackInfo.latest_event?.description,
                events: trackInfo.tracking?.providers?.[0]?.events?.map(event => ({
                    date: event.time_iso,
                    status: event.description,
                    location: `${event.address?.city || ''}, ${event.location}`.trim(),
                })) || []
            };

            // Salva no cache
            await this.cache.set(`tracking:${trackingNumber}`, result, 3600); // 1 hora
            
            return result;
            
        } catch (error) {
            logger.error(`[Tracking] Erro ao consultar status:`, {
                trackingNumber,
                error: error.message
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
}

module.exports = { TrackingService };
