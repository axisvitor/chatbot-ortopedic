const { RedisStoreSync } = require('../utils/redis-store-sync');
const logger = require('../utils/logger');
const { REDIS_CONFIG, TRACKING_CONFIG } = require('../config/settings');

class CacheServiceSync {
    constructor() {
        this.redis = new RedisStoreSync();
        this.defaultTTL = TRACKING_CONFIG.cache.ttl.default;
        this.prefix = REDIS_CONFIG.prefix.tracking;
    }

    /**
     * Gera uma chave de cache para um ou mais códigos de rastreio
     */
    _generateKey(trackingNumbers) {
        if (Array.isArray(trackingNumbers)) {
            return `${this.prefix}batch:${trackingNumbers.sort().join(',')}`;
        }
        return `${this.prefix}single:${trackingNumbers}`;
    }

    /**
     * Verifica se o cache está expirado baseado no status
     */
    _shouldRefresh(cachedData) {
        if (!cachedData) return true;

        const now = Date.now();
        const lastUpdate = new Date(cachedData.timestamp).getTime();
        const status = cachedData.data.status?.text;

        // Define TTL baseado no status
        let ttl = this.defaultTTL;
        switch (status) {
            case 'entregue':
            case 'expirado':
                ttl = TRACKING_CONFIG.cache.ttl.status.final;
                break;
            case 'problema':
                ttl = TRACKING_CONFIG.cache.ttl.status.problem;
                break;
            case 'em_transito':
                ttl = TRACKING_CONFIG.cache.ttl.status.transit;
                break;
            case 'postado':
                ttl = TRACKING_CONFIG.cache.ttl.status.posted;
                break;
            default:
                ttl = TRACKING_CONFIG.cache.ttl.status.default;
        }

        return (now - lastUpdate) > (ttl * 1000);
    }

    /**
     * Obtém dados do cache
     */
    async get(trackingNumbers) {
        const key = this._generateKey(trackingNumbers);
        
        try {
            const cached = await this.redis.client.get(key);
            if (!cached) return null;

            const cachedData = JSON.parse(cached);
            
            // Verifica se precisa atualizar
            if (this._shouldRefresh(cachedData)) {
                logger.debug('Cache expirado para:', key);
                return null;
            }

            logger.debug('Cache hit para:', key);
            return cachedData.data;
        } catch (error) {
            logger.error('Erro ao ler cache:', error);
            return null;
        }
    }

    /**
     * Salva dados no cache
     */
    async set(trackingNumbers, data) {
        const key = this._generateKey(trackingNumbers);
        
        try {
            const cacheData = {
                timestamp: new Date().toISOString(),
                data
            };

            // Define TTL baseado no status
            let ttl = this.defaultTTL;
            if (Array.isArray(data)) {
                // Para lotes, usa o menor TTL entre todos os status
                ttl = Math.min(...data.map(item => {
                    return this._getTTLForStatus(item.status?.text);
                }));
            } else {
                ttl = this._getTTLForStatus(data.status?.text);
            }

            await this.redis.client.setex(key, ttl, JSON.stringify(cacheData));
            logger.debug('Cache atualizado para:', key);
        } catch (error) {
            logger.error('Erro ao salvar cache:', error);
        }
    }

    /**
     * Retorna o TTL em segundos baseado no status
     */
    _getTTLForStatus(status) {
        switch (status) {
            case 'entregue':
            case 'expirado':
                return TRACKING_CONFIG.cache.ttl.status.final;
            case 'problema':
                return TRACKING_CONFIG.cache.ttl.status.problem;
            case 'em_transito':
                return TRACKING_CONFIG.cache.ttl.status.transit;
            case 'postado':
                return TRACKING_CONFIG.cache.ttl.status.posted;
            default:
                return TRACKING_CONFIG.cache.ttl.status.default;
        }
    }

    /**
     * Invalida o cache para um ou mais códigos
     */
    async invalidate(trackingNumbers) {
        const key = this._generateKey(trackingNumbers);
        
        try {
            await this.redis.client.del(key);
            logger.debug('Cache invalidado para:', key);
        } catch (error) {
            logger.error('Erro ao invalidar cache:', error);
        }
    }
}

module.exports = { CacheServiceSync };
