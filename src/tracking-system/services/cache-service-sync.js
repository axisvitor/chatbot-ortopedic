const logger = require('../utils/logger');
const { REDIS_CONFIG } = require('../config/settings');

class CacheServiceSync {
    constructor(redis) {
        this.redis = redis;
        this.defaultTTL = REDIS_CONFIG.ttl.tracking.status;
    }

    /**
     * Gera chave para o cache
     * @private
     */
    _generateKey(trackingNumbers) {
        if (Array.isArray(trackingNumbers)) {
            return `${REDIS_CONFIG.prefix.tracking.batch}${trackingNumbers.sort().join(',')}`;
        }
        return `${REDIS_CONFIG.prefix.tracking.single}${trackingNumbers}`;
    }

    /**
     * Obtém dados do cache
     */
    async get(key) {
        try {
            const data = await this.redis.get(key);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            logger.error('[Cache] Erro ao obter dados do cache:', {
                key,
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            return null;
        }
    }

    /**
     * Define dados no cache
     */
    async set(key, value, ttl = this.defaultTTL) {
        try {
            const data = JSON.stringify({
                data: value,
                timestamp: new Date().toISOString()
            });
            await this.redis.set(key, data, ttl);
        } catch (error) {
            logger.error('[Cache] Erro ao definir dados no cache:', {
                key,
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Remove dados do cache
     */
    async del(key) {
        try {
            await this.redis.del(key);
        } catch (error) {
            logger.error('[Cache] Erro ao remover dados do cache:', {
                key,
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Obtém ou busca dados
     * @param {string} key - Chave do cache
     * @param {Function} fetchFn - Função para buscar dados se não estiver em cache
     * @param {number} ttl - Tempo de vida em segundos
     */
    async getOrFetch(key, fetchFn, ttl = this.defaultTTL) {
        try {
            // Tenta obter do cache
            const cached = await this.get(key);
            if (cached) {
                logger.debug('[Cache] Cache hit:', { key });
                return cached.data;
            }

            // Se não estiver em cache, busca
            logger.debug('[Cache] Cache miss:', { key });
            const data = await fetchFn();
            
            // Salva no cache
            await this.set(key, data, ttl);
            
            return data;
        } catch (error) {
            logger.error('[Cache] Erro ao obter/buscar dados:', {
                key,
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }
}

module.exports = { CacheServiceSync };
