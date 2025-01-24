const { RedisStore } = require('../store/redis-store');
const { NUVEMSHOP_CONFIG } = require('../config/settings');
const logger = require('../utils/logger');

class CacheService {
    constructor() {
        this.redisStore = new RedisStore();
        this.config = NUVEMSHOP_CONFIG.cache;
        this.operationCount = 0;
        this.lastResetTime = Date.now();
        this.MAX_OPS_PER_SECOND = 1000;

        // Conecta ao Redis
        this.redisStore.connect().catch(error => {
            logger.error('RedisConnectionError', {
                service: 'CacheService',
                error: error.message
            });
        });
    }

    generateKey(prefix, ...parts) {
        return `${this.config.prefix}${prefix}:${parts.join(':')}`;
    }

    async _checkRateLimit() {
        const now = Date.now();
        if (now - this.lastResetTime >= 1000) {
            this.operationCount = 0;
            this.lastResetTime = now;
        }

        if (this.operationCount >= this.MAX_OPS_PER_SECOND) {
            logger.warn('CacheRateLimitExceeded', {
                operationCount: this.operationCount,
                timeWindow: now - this.lastResetTime
            });
            throw new Error('Rate limit exceeded');
        }

        this.operationCount++;
    }

    async get(key) {
        try {
            await this._checkRateLimit();
            const startTime = process.hrtime();
            
            const value = await this.redisStore.get(key);
            const result = value ? JSON.parse(value) : null;
            
            const [seconds, nanoseconds] = process.hrtime(startTime);
            const duration = seconds + nanoseconds / 1e9;
            
            logger.info('CacheGet', {
                key,
                found: !!result,
                duration
            });
            
            return result;
        } catch (error) {
            logger.error('CacheGetError', {
                key,
                error: error.message,
                stack: error.stack
            });
            return null;
        }
    }

    async set(key, value, ttl = this.config.ttl.default) {
        try {
            await this._checkRateLimit();
            const startTime = process.hrtime();
            
            const serialized = JSON.stringify(value);
            const result = await this.redisStore.set(key, serialized, ttl);
            
            const [seconds, nanoseconds] = process.hrtime(startTime);
            const duration = seconds + nanoseconds / 1e9;
            
            logger.info('CacheSet', {
                key,
                ttl,
                size: serialized.length,
                duration
            });
            
            return result;
        } catch (error) {
            logger.error('CacheSetError', {
                key,
                error: error.message,
                stack: error.stack
            });
            return false;
        }
    }

    async delete(key) {
        try {
            await this._checkRateLimit();
            const startTime = process.hrtime();
            
            const result = await this.redisStore.del(key);
            
            const [seconds, nanoseconds] = process.hrtime(startTime);
            const duration = seconds + nanoseconds / 1e9;
            
            logger.info('CacheDelete', {
                key,
                success: result === 1,
                duration
            });
            
            return result === 1;
        } catch (error) {
            logger.error('CacheDeleteError', {
                key,
                error: error.message,
                stack: error.stack
            });
            return false;
        }
    }

    async getTTL(key) {
        try {
            await this._checkRateLimit();
            const startTime = process.hrtime();
            
            const ttl = await this.redisStore.ttl(key);
            
            const [seconds, nanoseconds] = process.hrtime(startTime);
            const duration = seconds + nanoseconds / 1e9;
            
            logger.info('CacheGetTTL', {
                key,
                ttl,
                duration
            });
            
            return ttl;
        } catch (error) {
            logger.error('CacheGetTTLError', {
                key,
                error: error.message,
                stack: error.stack
            });
            return -1;
        }
    }

    async exists(key) {
        try {
            await this._checkRateLimit();
            const startTime = process.hrtime();
            
            const exists = await this.redisStore.exists(key);
            
            const [seconds, nanoseconds] = process.hrtime(startTime);
            const duration = seconds + nanoseconds / 1e9;
            
            logger.info('CacheExists', {
                key,
                exists,
                duration
            });
            
            return exists;
        } catch (error) {
            logger.error('CacheExistsError', {
                key,
                error: error.message,
                stack: error.stack
            });
            return false;
        }
    }

    async getOrSet(key, fallbackFn, ttl = this.config.ttl.default) {
        try {
            let value = await this.get(key);
            
            if (!value) {
                logger.info('CacheMiss', { key });
                value = await fallbackFn();
                
                if (value) {
                    await this.set(key, value, ttl);
                }
            } else {
                logger.info('CacheHit', { key });
            }
            
            return value;
        } catch (error) {
            logger.error('CacheGetOrSetError', {
                key,
                error: error.message,
                stack: error.stack
            });
            return await fallbackFn();
        }
    }
}

module.exports = { CacheService };