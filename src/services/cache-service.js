const { RedisStore } = require('../store/redis-store');
const { NUVEMSHOP_CONFIG } = require('../config/settings');

class CacheService {
    constructor() {
        this.redisStore = new RedisStore();
        this.config = NUVEMSHOP_CONFIG.cache;
    }

    /**
     * Gera uma chave de cache
     * @param {string} prefix - Prefixo da chave
     * @param {string|number} identifier - Identificador único
     * @param {Object} params - Parâmetros adicionais
     * @returns {string} Chave de cache
     */
    generateKey(prefix, identifier = '', params = {}) {
        const paramsString = Object.entries(params)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => `${key}=${value}`)
            .join('&');

        return `${this.config.prefix}${prefix}:${identifier}${paramsString ? `:${paramsString}` : ''}`;
    }

    /**
     * Obtém dados do cache
     * @param {string} key - Chave do cache
     * @returns {Promise<any>} Dados do cache ou null
     */
    async get(key) {
        try {
            const data = await this.redisStore.get(key);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            console.error('[Cache] Erro ao obter dados:', error);
            return null;
        }
    }

    /**
     * Armazena dados no cache
     * @param {string} key - Chave do cache
     * @param {any} data - Dados a serem armazenados
     * @param {number} ttl - Tempo de vida em segundos
     * @returns {Promise<boolean>} Sucesso da operação
     */
    async set(key, data, ttl) {
        try {
            await this.redisStore.set(key, JSON.stringify(data), ttl);
            return true;
        } catch (error) {
            console.error('[Cache] Erro ao armazenar dados:', error);
            return false;
        }
    }

    /**
     * Invalida uma chave específica
     * @param {string} key - Chave a ser invalidada
     * @returns {Promise<boolean>} Sucesso da operação
     */
    async invalidate(key) {
        try {
            await this.redisStore.del(key);
            return true;
        } catch (error) {
            console.error('[Cache] Erro ao invalidar chave:', error);
            return false;
        }
    }

    /**
     * Invalida múltiplas chaves por padrão
     * @param {string} pattern - Padrão de chaves a serem invalidadas
     * @returns {Promise<number>} Número de chaves invalidadas
     */
    async invalidatePattern(pattern) {
        try {
            const keys = await this.redisStore.keys(`${this.config.prefix}${pattern}*`);
            if (keys.length === 0) return 0;

            // Invalida em lotes para evitar sobrecarga
            const batches = this.chunkArray(keys, this.config.invalidation.batchSize);
            let invalidatedCount = 0;

            for (const batch of batches) {
                await Promise.all(batch.map(key => this.invalidate(key)));
                invalidatedCount += batch.length;
            }

            console.log(`[Cache] Invalidadas ${invalidatedCount} chaves com padrão: ${pattern}`);
            return invalidatedCount;
        } catch (error) {
            console.error('[Cache] Erro ao invalidar padrão:', error);
            return 0;
        }
    }

    /**
     * Divide um array em lotes menores
     * @param {Array} array - Array a ser dividido
     * @param {number} size - Tamanho de cada lote
     * @returns {Array} Array de lotes
     */
    chunkArray(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    /**
     * Obtém TTL apropriado baseado no tipo de dado
     * @param {string} type - Tipo de dado
     * @param {Object} context - Contexto adicional
     * @returns {number} TTL em segundos
     */
    getTTL(type, context = {}) {
        const ttl = this.config.ttl;

        switch (type) {
            case 'products':
                return ttl.products;
            case 'orders':
                // Pedidos recentes têm TTL menor
                return context.isRecent ? ttl.orders.recent : ttl.orders.old;
            case 'categories':
                return ttl.categories;
            case 'customers':
                return ttl.customers;
            case 'inventory':
                return ttl.inventory;
            case 'shipping':
                return ttl.shipping;
            case 'payments':
                return ttl.payments;
            default:
                return ttl.default;
        }
    }
}

module.exports = { CacheService }; 