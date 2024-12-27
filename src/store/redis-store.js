const { createClient } = require('redis');
const { REDIS_CONFIG } = require('../config/settings');

class RedisStore {
    constructor() {
        this.client = createClient({
            socket: {
                host: process.env.REDIS_HOST,
                port: process.env.REDIS_PORT
            },
            password: process.env.REDIS_PASSWORD
        });

        this.client.on('error', (err) => {
            console.error('[Redis] Erro no Redis:', {
                erro: err.message,
                stack: err.stack,
                timestamp: new Date().toISOString()
            });
        });

        this.client.on('connect', () => {
            console.log('[Redis] Redis conectado com sucesso');
        });

        // Conecta ao Redis
        (async () => {
            try {
                await this.client.connect();
            } catch (error) {
                console.error('[Redis] Erro ao conectar ao Redis:', error);
            }
        })();
    }

    async get(key) {
        try {
            const value = await this.client.get(key);
            return value;
        } catch (error) {
            console.error('[Redis] Erro ao buscar do cache:', {
                key,
                error: error.message
            });
            return null;
        }
    }

    async set(key, value, ttl = REDIS_CONFIG.ttl) {
        try {
            await this.client.set(key, value, {
                EX: ttl
            });
            return true;
        } catch (error) {
            console.error('[Redis] Erro ao salvar no cache:', {
                key,
                error: error.message
            });
            return false;
        }
    }

    async del(key) {
        try {
            await this.client.del(key);
            return true;
        } catch (error) {
            console.error('[Redis] Erro ao deletar do cache:', {
                key,
                error: error.message
            });
            return false;
        }
    }

    async keys(pattern) {
        try {
            return await this.client.keys(pattern);
        } catch (error) {
            console.error('[Redis] Erro ao buscar chaves:', {
                pattern,
                error: error.message
            });
            return [];
        }
    }

    async exists(key) {
        try {
            return await this.client.exists(key);
        } catch (error) {
            console.error('[Redis] Erro ao verificar existência:', {
                key,
                error: error.message
            });
            return false;
        }
    }

    async ttl(key) {
        try {
            return await this.client.ttl(key);
        } catch (error) {
            console.error('[Redis] Erro ao buscar TTL:', {
                key,
                error: error.message
            });
            return -1;
        }
    }

    async expire(key, ttl) {
        try {
            return await this.client.expire(key, ttl);
        } catch (error) {
            console.error('[Redis] Erro ao definir TTL:', {
                key,
                ttl,
                error: error.message
            });
            return false;
        }
    }

    async incr(key) {
        try {
            return await this.client.incr(key);
        } catch (error) {
            console.error('[Redis] Erro ao incrementar:', {
                key,
                error: error.message
            });
            return 0;
        }
    }

    async decr(key) {
        try {
            return await this.client.decr(key);
        } catch (error) {
            console.error('[Redis] Erro ao decrementar:', {
                key,
                error: error.message
            });
            return 0;
        }
    }

    async hget(key, field) {
        try {
            return await this.client.hGet(key, field);
        } catch (error) {
            console.error('[Redis] Erro ao buscar hash:', {
                key,
                field,
                error: error.message
            });
            return null;
        }
    }

    async hset(key, field, value) {
        try {
            await this.client.hSet(key, field, value);
            return true;
        } catch (error) {
            console.error('[Redis] Erro ao salvar hash:', {
                key,
                field,
                error: error.message
            });
            return false;
        }
    }

    async hdel(key, field) {
        try {
            await this.client.hDel(key, field);
            return true;
        } catch (error) {
            console.error('[Redis] Erro ao deletar hash:', {
                key,
                field,
                error: error.message
            });
            return false;
        }
    }

    async hgetall(key) {
        try {
            return await this.client.hGetAll(key);
        } catch (error) {
            console.error('[Redis] Erro ao buscar todos os campos do hash:', {
                key,
                error: error.message
            });
            return {};
        }
    }

    async deletePattern(pattern) {
        try {
            const keys = await this.client.keys(pattern);
            if (keys.length > 0) {
                await this.client.del(keys);
            }
            return true;
        } catch (error) {
            console.error('[Redis] Erro ao deletar padrão:', {
                pattern,
                error: error.message
            });
            return false;
        }
    }
}

module.exports = { RedisStore };
