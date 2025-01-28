const { NUVEMSHOP_CONFIG } = require('../../../config/settings');
const logger = require('../../../utils/logger');

class NuvemshopCache {
    constructor(cacheService) {
        this.cacheService = cacheService;
        this.config = NUVEMSHOP_CONFIG.cache;
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
    async getCachedData(cacheKey, fetchFunction, ttl) {
        try {
            // Tenta obter do cache
            const cachedData = await this.cacheService.get(cacheKey);
            if (cachedData) {
                logger.debug('CacheHit', {
                    key: cacheKey,
                    timestamp: new Date().toISOString()
                });
                return JSON.parse(cachedData);
            }

            // Se não estiver no cache, busca da API
            logger.debug('CacheMiss', {
                key: cacheKey,
                timestamp: new Date().toISOString()
            });
            const data = await fetchFunction();
            
            // Armazena no cache
            await this.cacheService.set(cacheKey, JSON.stringify(data), ttl);
            
            return data;
        } catch (error) {
            logger.error('ErroCacheData', {
                erro: error.message,
                stack: error.stack,
                cacheKey: cacheKey,
                timestamp: new Date().toISOString()
            });
            throw error;
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
                logger.info('CacheInvalidado', {
                    prefix,
                    keysRemovidas: keys.length,
                    timestamp: new Date().toISOString()
                });
            }
        } catch (error) {
            logger.error('ErroInvalidarCache', {
                erro: error.message,
                stack: error.stack,
                prefix: prefix,
                timestamp: new Date().toISOString()
            });
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
            const results = await this.cacheService.mget(keys);

            const items = {};
            results.forEach((result, index) => {
                if (result) {
                    items[ids[index]] = JSON.parse(result);
                }
            });

            logger.debug('CacheMultiGet', {
                type,
                requested: ids.length,
                found: Object.keys(items).length,
                timestamp: new Date().toISOString()
            });

            return items;
        } catch (error) {
            logger.error('ErroCacheMultiGet', {
                type,
                ids,
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
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
            const ttl = this.config.ttl[type] || 300;
            const operations = [];

            for (const [id, data] of Object.entries(items)) {
                const key = this.generateCacheKey(type, id);
                operations.push(['set', key, JSON.stringify(data), ttl]);
            }

            await this.cacheService.multi(operations).exec();

            logger.debug('CacheMultiSet', {
                type,
                itemCount: Object.keys(items).length,
                ttl,
                timestamp: new Date().toISOString()
            });

            return true;
        } catch (error) {
            logger.error('ErroCacheMultiSet', {
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
