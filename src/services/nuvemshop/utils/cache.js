const { NUVEMSHOP_CONFIG, REDIS_CONFIG } = require('../../../config/settings');
const logger = require('../../../utils/logger');

class NuvemshopCache {
    constructor(cacheService) {
        this.cacheService = cacheService;
        this.config = {
            ttl: REDIS_CONFIG.ttl.ecommerce,
            prefix: REDIS_CONFIG.prefix.ecommerce
        };
    }

    /**
     * Gera uma chave de cache única
     * @param {string} prefix - Prefixo da chave
     * @param {string|number} identifier - Identificador único
     * @param {Object} params - Parâmetros adicionais
     * @returns {string} Chave de cache
     */
    generateCacheKey(prefix, identifier = '', params = {}) {
        const paramsString = Object.entries(params)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => `${key}=${value}`)
            .join('&');

        return `${this.config.prefix}${prefix}:${identifier}${paramsString ? `:${paramsString}` : ''}`;
    }

    /**
     * Obtém dados do cache ou da API
     * @param {string} cacheKey - Chave do cache
     * @param {Function} fetchFunction - Função para buscar dados da API
     * @param {number} ttl - Tempo de vida do cache em segundos
     * @returns {Promise<any>} Dados do cache ou da API
     */
    async getCachedData(cacheKey, fetchFunction, ttl = this.config.ttl) {
        try {
            // Tenta obter do cache
            const cachedData = await this.cacheService.get(cacheKey);
            if (cachedData) {
                logger.debug('[Nuvemshop] Cache hit', {
                    key: cacheKey,
                    timestamp: new Date().toISOString()
                });
                return JSON.parse(cachedData);
            }

            // Se não estiver no cache, busca da API
            logger.debug('[Nuvemshop] Cache miss', {
                key: cacheKey,
                timestamp: new Date().toISOString()
            });
            const data = await fetchFunction();
            
            // Salva no cache
            if (data) {
                await this.cacheService.set(cacheKey, JSON.stringify(data), ttl);
                logger.debug('[Nuvemshop] Dados salvos em cache', { key: cacheKey });
            }

            return data;
        } catch (error) {
            logger.error('[Nuvemshop] Erro ao obter dados do cache:', error);
            return null;
        }
    }

    /**
     * Invalida cache por prefixo
     * @param {string} prefix - Prefixo das chaves a serem invalidadas
     */
    async invalidateCache(prefix) {
        try {
            const pattern = `${this.config.prefix}${prefix}:*`;
            const keys = await this.cacheService.keys(pattern);
            
            if (keys.length > 0) {
                await Promise.all(keys.map(key => this.cacheService.del(key)));
                logger.info('[Nuvemshop] Cache invalidado', { 
                    prefix,
                    keysRemoved: keys.length 
                });
            }
        } catch (error) {
            logger.error('[Nuvemshop] Erro ao invalidar cache:', error);
        }
    }

    /**
     * Obtém múltiplos itens do cache
     * @param {string} type - Tipo dos itens
     * @param {Array<string>} ids - IDs dos itens
     * @returns {Promise<Object>} Mapa de itens encontrados
     */
    async mget(type, ids) {
        try {
            const keys = ids.map(id => this.generateCacheKey(type, id));
            const results = await Promise.all(keys.map(key => this.cacheService.get(key)));
            
            return results.reduce((acc, result, index) => {
                if (result) {
                    acc[ids[index]] = JSON.parse(result);
                }
                return acc;
            }, {});
        } catch (error) {
            logger.error('[Nuvemshop] Erro ao obter múltiplos itens:', error);
            return {};
        }
    }

    /**
     * Salva múltiplos itens no cache
     * @param {string} type - Tipo dos itens
     * @param {Object} items - Mapa de itens para salvar
     * @returns {Promise<boolean>} Se salvou com sucesso
     */
    async mset(type, items) {
        try {
            const ttl = this.config.ttl;
            const operations = [];

            for (const [id, data] of Object.entries(items)) {
                const key = this.generateCacheKey(type, id);
                operations.push(['set', key, JSON.stringify(data), ttl]);
            }

            await this.cacheService.multi(operations).exec();

            logger.debug('[Nuvemshop] CacheMultiSet', {
                type,
                itemCount: Object.keys(items).length,
                ttl,
                timestamp: new Date().toISOString()
            });

            return true;
        } catch (error) {
            logger.error('[Nuvemshop] ErroCacheMultiSet', {
                type,
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            return false;
        }
    }
}

module.exports = { NuvemshopCache };
