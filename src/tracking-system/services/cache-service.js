const { RedisStore } = require('../utils/redis-store');
const logger = require('../utils/logger');

class CacheService {
    constructor() {
        this.redis = new RedisStore();
        this.defaultTTL = 30 * 60; // 30 minutos em segundos
        this.prefix = 'cache:17track:';
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
                ttl = 24 * 60 * 60; // 24 horas para status finais
                break;
            case 'problema':
                ttl = 2 * 60 * 60; // 2 horas para status com problema
                break;
            case 'em_transito':
                ttl = 30 * 60; // 30 minutos para em trânsito
                break;
            case 'postado':
                ttl = 15 * 60; // 15 minutos para recém postado
                break;
            default:
                ttl = 5 * 60; // 5 minutos para outros status
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
                return 24 * 60 * 60; // 24 horas
            case 'problema':
                return 2 * 60 * 60; // 2 horas
            case 'em_transito':
                return 30 * 60; // 30 minutos
            case 'postado':
                return 15 * 60; // 15 minutos
            default:
                return 5 * 60; // 5 minutos
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

module.exports = { CacheService };
