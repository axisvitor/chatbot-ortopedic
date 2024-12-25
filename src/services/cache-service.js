const { RedisStore } = require('../store/redis-store');
const { NUVEMSHOP_CONFIG } = require('../config/settings');

class CacheService {
    constructor() {
        this.redisStore = new RedisStore();
        this.config = NUVEMSHOP_CONFIG.cache;
    }

    generateKey(prefix, ...parts) {
        return `${this.config.prefix}${prefix}:${parts.join(':')}`;
    }

    async get(key) {
        try {
            const value = await this.redisStore.get(key);
            return value ? JSON.parse(value) : null;
        } catch (error) {
            console.error('[Cache] Erro ao buscar do cache:', {
                key,
                error: error.message
            });
            return null;
        }
    }

    async set(key, value, ttl = this.config.ttl.default) {
        try {
            const serialized = JSON.stringify(value);
            return await this.redisStore.set(key, serialized, ttl);
        } catch (error) {
            console.error('[Cache] Erro ao salvar no cache:', {
                key,
                error: error.message
            });
            return false;
        }
    }

    async delete(key) {
        try {
            return await this.redisStore.del(key);
        } catch (error) {
            console.error('[Cache] Erro ao deletar do cache:', {
                key,
                error: error.message
            });
            return false;
        }
    }

    async getTTL(key) {
        try {
            return await this.redisStore.ttl(key);
        } catch (error) {
            console.error('[Cache] Erro ao buscar TTL:', {
                key,
                error: error.message
            });
            return -1;
        }
    }

    async exists(key) {
        try {
            return await this.redisStore.exists(key);
        } catch (error) {
            console.error('[Cache] Erro ao verificar existência:', {
                key,
                error: error.message
            });
            return false;
        }
    }
}

module.exports = { CacheService };