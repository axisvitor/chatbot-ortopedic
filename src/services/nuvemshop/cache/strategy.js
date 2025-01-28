const logger = require('../../../utils/logger');

class CacheStrategy {
    constructor(redisStore, config = {}) {
        this.redisStore = redisStore;
        this.config = {
            prefix: 'nuvemshop:',
            ttl: {
                orders: 300,      // 5 minutos
                products: 3600,   // 1 hora
                customers: 3600,  // 1 hora
                categories: 3600  // 1 hora
            },
            ...config
        };
    }

    /**
     * Gera chave de cache
     * @private
     */
    _generateKey(type, ...parts) {
        return `${this.config.prefix}${type}:${parts.join(':')}`;
    }

    /**
     * Obtém item do cache
     * @param {string} type Tipo do item
     * @param {string} id ID do item
     * @returns {Promise<Object>} Item do cache
     */
    async get(type, id) {
        try {
            const key = this._generateKey(type, id);
            const cached = await this.redisStore.get(key);

            if (cached) {
                logger.debug('CacheHit', {
                    type,
                    id,
                    key,
                    timestamp: new Date().toISOString()
                });
                return JSON.parse(cached);
            }

            logger.debug('CacheMiss', {
                type,
                id,
                key,
                timestamp: new Date().toISOString()
            });
            return null;

        } catch (error) {
            logger.error('CacheGetError', {
                type,
                id,
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            return null;
        }
    }

    /**
     * Salva item no cache
     * @param {string} type Tipo do item
     * @param {string} id ID do item
     * @param {Object} data Dados para cache
     * @returns {Promise<boolean>} Se salvou com sucesso
     */
    async set(type, id, data) {
        try {
            const key = this._generateKey(type, id);
            const ttl = this.config.ttl[type] || 300;

            await this.redisStore.set(key, JSON.stringify(data), ttl);

            logger.debug('CacheSet', {
                type,
                id,
                key,
                ttl,
                timestamp: new Date().toISOString()
            });

            return true;

        } catch (error) {
            logger.error('CacheSetError', {
                type,
                id,
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            return false;
        }
    }

    /**
     * Remove item do cache
     * @param {string} type Tipo do item
     * @param {string} id ID do item
     * @returns {Promise<boolean>} Se removeu com sucesso
     */
    async del(type, id) {
        try {
            const key = this._generateKey(type, id);
            await this.redisStore.del(key);

            logger.debug('CacheDelete', {
                type,
                id,
                key,
                timestamp: new Date().toISOString()
            });

            return true;

        } catch (error) {
            logger.error('CacheDeleteError', {
                type,
                id,
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            return false;
        }
    }

    /**
     * Limpa cache por tipo
     * @param {string} type Tipo do item
     * @returns {Promise<boolean>} Se limpou com sucesso
     */
    async clear(type) {
        try {
            const pattern = this._generateKey(type, '*');
            const keys = await this.redisStore.keys(pattern);

            if (keys.length > 0) {
                await this.redisStore.del(keys);
            }

            logger.info('CacheClear', {
                type,
                pattern,
                keysRemoved: keys.length,
                timestamp: new Date().toISOString()
            });

            return true;

        } catch (error) {
            logger.error('CacheClearError', {
                type,
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            return false;
        }
    }

    /**
     * Busca múltiplos itens no cache
     * @param {string} type Tipo dos itens
     * @param {Array<string>} ids IDs dos itens
     * @returns {Promise<Object>} Mapa de itens encontrados
     */
    async mget(type, ids) {
        try {
            const keys = ids.map(id => this._generateKey(type, id));
            const results = await this.redisStore.mget(keys);

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
            logger.error('CacheMultiGetError', {
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
     * @param {string} type Tipo dos itens
     * @param {Object} items Mapa de itens para salvar
     * @returns {Promise<boolean>} Se salvou com sucesso
     */
    async mset(type, items) {
        try {
            const ttl = this.config.ttl[type] || 300;
            const operations = [];

            for (const [id, data] of Object.entries(items)) {
                const key = this._generateKey(type, id);
                operations.push(['set', key, JSON.stringify(data), ttl]);
            }

            await this.redisStore.multi(operations).exec();

            logger.debug('CacheMultiSet', {
                type,
                itemCount: Object.keys(items).length,
                ttl,
                timestamp: new Date().toISOString()
            });

            return true;

        } catch (error) {
            logger.error('CacheMultiSetError', {
                type,
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            return false;
        }
    }
}

module.exports = { CacheStrategy };
