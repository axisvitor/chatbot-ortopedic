const { createClient } = require('redis');
const { REDIS_CONFIG } = require('../config/settings');

class RedisStore {
    constructor() {
        this.client = createClient({
            socket: {
                host: process.env.REDIS_HOST,
                port: process.env.REDIS_PORT
            },
            password: process.env.REDIS_PASSWORD,
            retry_strategy: function(options) {
                if (options.error && options.error.code === 'ECONNREFUSED') {
                    console.error('[Redis] Servidor recusou conexão');
                    return new Error('Servidor Redis indisponível');
                }
                if (options.total_retry_time > 1000 * 60 * 60) {
                    return new Error('Tempo máximo de retry excedido');
                }
                if (options.attempt > 10) {
                    return new Error('Máximo de tentativas excedido');
                }
                // Retry com exponential backoff
                return Math.min(options.attempt * 100, 3000);
            }
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
        this.connect();
    }

    async connect() {
        try {
            if (!this.client.isOpen) {
                await this.client.connect();
            }
        } catch (error) {
            console.error('[Redis] Erro ao conectar ao Redis:', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
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

    async ping() {
        try {
            if (!this.client.isOpen) {
                await this.connect();
            }
            const result = await this.client.ping();
            return result === 'PONG';
        } catch (error) {
            console.error('[Redis] Erro ao fazer ping:', error);
            throw error;
        }
    }

    async getActiveRun(threadId) {
        try {
            const key = `openai:active_runs:${threadId}`;
            const value = await this.client.get(key);
            return value;
        } catch (error) {
            console.error('[Redis] Erro ao buscar run ativo:', {
                threadId,
                erro: error.message,
                stack: error.stack
            });
            return null;
        }
    }

    async setActiveRun(threadId, runId, ttl = 3600) {
        try {
            const key = `openai:active_runs:${threadId}`;
            await this.client.set(key, runId, {
                EX: ttl // expira em 1 hora por padrão
            });
            return true;
        } catch (error) {
            console.error('[Redis] Erro ao salvar run ativo:', {
                threadId,
                runId,
                erro: error.message,
                stack: error.stack
            });
            return false;
        }
    }

    async removeActiveRun(threadId) {
        try {
            const key = `openai:active_runs:${threadId}`;
            await this.client.del(key);
            return true;
        } catch (error) {
            console.error('[Redis] Erro ao remover run ativo:', {
                threadId,
                erro: error.message,
                stack: error.stack
            });
            return false;
        }
    }

    async setThreadForCustomer(customerId, threadId) {
        try {
            const key = `openai:customer_threads:${customerId}`;
            const ttl = 60 * 24 * 60 * 60; // 60 dias em segundos
            await this.client.set(key, threadId, {
                EX: ttl
            });
            
            // Armazena também o timestamp de criação para análise
            const metaKey = `openai:thread_meta:${threadId}`;
            const metadata = {
                customerId,
                createdAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + ttl * 1000).toISOString()
            };
            await this.client.set(metaKey, JSON.stringify(metadata), {
                EX: ttl
            });
            
            return true;
        } catch (error) {
            console.error('[Redis] Erro ao salvar thread do cliente:', {
                customerId,
                threadId,
                erro: error.message,
                stack: error.stack
            });
            return false;
        }
    }

    async getThreadForCustomer(customerId) {
        try {
            const key = `openai:customer_threads:${customerId}`;
            const threadId = await this.client.get(key);
            
            if (threadId) {
                // Atualiza o TTL para mais 60 dias
                const ttl = 60 * 24 * 60 * 60;
                await this.client.expire(key, ttl);
                
                // Atualiza também o TTL dos metadados
                const metaKey = `openai:thread_meta:${threadId}`;
                await this.client.expire(metaKey, ttl);
            }
            
            return threadId;
        } catch (error) {
            console.error('[Redis] Erro ao buscar thread do cliente:', {
                customerId,
                erro: error.message,
                stack: error.stack
            });
            return null;
        }
    }

    async getAllThreadMetadata() {
        try {
            const pattern = 'openai:thread_meta:*';
            const keys = await this.client.keys(pattern);
            const metadata = [];
            
            for (const key of keys) {
                const value = await this.client.get(key);
                if (value) {
                    metadata.push(JSON.parse(value));
                }
            }
            
            return metadata;
        } catch (error) {
            console.error('[Redis] Erro ao buscar metadados das threads:', {
                erro: error.message,
                stack: error.stack
            });
            return [];
        }
    }
}

module.exports = { RedisStore };
