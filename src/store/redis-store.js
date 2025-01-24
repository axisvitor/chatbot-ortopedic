const { createClient } = require('redis');
const { REDIS_CONFIG } = require('../config/settings');

class RedisStore {
    constructor() {
        this.client = createClient({
            socket: {
                host: REDIS_CONFIG.host,
                port: REDIS_CONFIG.port
            },
            password: REDIS_CONFIG.password,
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
            console.log('[Redis] Chave deletada com sucesso:', {
                key,
                timestamp: new Date().toISOString()
            });
            return true;
        } catch (error) {
            console.error('[Redis] Erro ao deletar do cache:', {
                key,
                error: error.message,
                stack: error.stack
            });
            return false;
        }
    }

    async delPattern(pattern) {
        try {
            const keys = await this.client.keys(pattern);
            if (keys.length > 0) {
                console.log('[Redis] Deletando chaves por padrão:', {
                    pattern,
                    keys,
                    count: keys.length,
                    timestamp: new Date().toISOString()
                });
                await Promise.all(keys.map(key => this.client.del(key)));
            }
            return true;
        } catch (error) {
            console.error('[Redis] Erro ao deletar chaves por padrão:', {
                pattern,
                error: error.message,
                stack: error.stack
            });
            return false;
        }
    }

    async deleteUserData(userId) {
        try {
            const patterns = [
                // Chaves do chat e contexto
                `chat:${userId}*`,
                `history:${userId}*`,
                `context:${userId}*`,
                `state:${userId}*`,
                `queue:${userId}*`,
                
                // Chaves de rastreamento
                `tracking:${userId}*`,
                `tracking:order:${userId}*`,
                `tracking_codes:${userId}*`,
                `last_track17_sync:${userId}*`,
                `last_nuvemshop_sync:${userId}*`,
                `last_17track_push_request:${userId}*`,
                
                // Chaves de pedidos
                `orders:${userId}*`,
                `order:${userId}*`,
                `pending_order:${userId}*`,
                `waiting_order:${userId}*`,
                
                // Chaves de thread e metadados
                `customer_thread:${userId}*`,
                `thread_metadata:${userId}*`,
                
                // Cache do Nuvemshop
                `nuvemshop:cache:${userId}*`,
                `nuvemshop:order:${userId}*`,
                `nuvemshop:product:${userId}*`,
                
                // Cache de mídia e financeiro
                `media:cache:${userId}*`,
                `financial:case:${userId}*`,
                
                // Cache de validação de pedidos
                `order_validation:${userId}*`,
                `order_validation:attempts:${userId}*`,
                `order_validation:proof:${userId}*`
            ];

            console.log('[Redis] Deletando dados do usuário:', {
                userId,
                patterns,
                timestamp: new Date().toISOString()
            });

            await Promise.all(patterns.map(pattern => this.delPattern(pattern)));
            return true;
        } catch (error) {
            console.error('[Redis] Erro ao deletar dados do usuário:', {
                userId,
                error: error.message,
                stack: error.stack
            });
            return false;
        }
    }

    async deleteThreadData(threadId) {
        try {
            const patterns = [
                // Chaves da thread OpenAI
                `run:${threadId}*`,
                `thread:${threadId}*`,
                `messages:${threadId}*`,
                `active_run:${threadId}*`,
                
                // Chaves de estado e contexto
                `state:${threadId}*`,
                `queue:${threadId}*`,
                `context:${threadId}*`,
                `context:thread:${threadId}*`,
                `context:update:${threadId}*`,
                
                // Chaves de pedidos e rastreamento
                `pending_order:${threadId}*`,
                `tracking:${threadId}*`,
                `tracking:order:${threadId}*`,
                `waiting_order:${threadId}*`,
                
                // Chaves de ferramentas e metadados
                `tool_calls:${threadId}*`,
                `thread_metadata:${threadId}*`,
                
                // Cache temporário
                `temp:${threadId}*`,
                `cache:${threadId}*`,
                
                // Chaves de validação
                `validation:${threadId}*`,
                `proof:${threadId}*`
            ];

            console.log('[Redis] Deletando dados da thread:', {
                threadId,
                patterns,
                timestamp: new Date().toISOString()
            });

            await Promise.all(patterns.map(pattern => this.delPattern(pattern)));
            return true;
        } catch (error) {
            console.error('[Redis] Erro ao deletar dados da thread:', {
                threadId,
                error: error.message,
                stack: error.stack
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
            const ttl = 30 * 24 * 60 * 60; // 30 dias em segundos
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
                // Atualiza o TTL para mais 30 dias
                const ttl = 30 * 24 * 60 * 60;
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

    /**
     * Adiciona um ou mais membros a um Set
     * @param {string} key Chave do Set
     * @param {...string} members Membros a serem adicionados
     * @returns {Promise<number>} Número de membros adicionados
     */
    async sadd(key, ...members) {
        try {
            return await this.client.sAdd(key, members);
        } catch (error) {
            console.error('[Redis] Erro ao adicionar ao set:', {
                key,
                members,
                error: error.message
            });
            return 0;
        }
    }

    /**
     * Remove um ou mais membros de um Set
     * @param {string} key Chave do Set
     * @param {...string} members Membros a serem removidos
     * @returns {Promise<number>} Número de membros removidos
     */
    async srem(key, ...members) {
        try {
            return await this.client.sRem(key, members);
        } catch (error) {
            console.error('[Redis] Erro ao remover do set:', {
                key,
                members,
                error: error.message
            });
            return 0;
        }
    }

    /**
     * Lista todos os membros de um Set
     * @param {string} key Chave do Set
     * @returns {Promise<string[]>} Array com os membros do Set
     */
    async smembers(key) {
        try {
            return await this.client.sMembers(key);
        } catch (error) {
            console.error('[Redis] Erro ao listar membros do set:', {
                key,
                error: error.message
            });
            return [];
        }
    }

    /**
     * Verifica se um membro existe em um Set
     * @param {string} key Chave do Set
     * @param {string} member Membro a ser verificado
     * @returns {Promise<boolean>} True se o membro existe
     */
    async sismember(key, member) {
        try {
            return await this.client.sIsMember(key, member);
        } catch (error) {
            console.error('[Redis] Erro ao verificar membro do set:', {
                key,
                member,
                error: error.message
            });
            return false;
        }
    }

    /**
     * Retorna o número de membros em um Set
     * @param {string} key Chave do Set
     * @returns {Promise<number>} Número de membros
     */
    async scard(key) {
        try {
            return await this.client.sCard(key);
        } catch (error) {
            console.error('[Redis] Erro ao contar membros do set:', {
                key,
                error: error.message
            });
            return 0;
        }
    }

    /**
     * Move um membro de um Set para outro
     * @param {string} source Set de origem
     * @param {string} destination Set de destino
     * @param {string} member Membro a ser movido
     * @returns {Promise<boolean>} True se o membro foi movido
     */
    async smove(source, destination, member) {
        try {
            return await this.client.sMove(source, destination, member);
        } catch (error) {
            console.error('[Redis] Erro ao mover membro entre sets:', {
                source,
                destination,
                member,
                error: error.message
            });
            return false;
        }
    }

    async getAssistantThread(customerId) {
        try {
            const key = `assistant:thread:${customerId}`;
            const thread = await this.client.get(key);
            if (thread) {
                return JSON.parse(thread);
            }
            return null;
        } catch (error) {
            console.error('[Redis] Erro ao obter thread do assistant:', error);
            throw error;
        }
    }

    async setAssistantThread(customerId, threadData) {
        try {
            const key = `assistant:thread:${customerId}`;
            await this.client.set(key, JSON.stringify(threadData));
            // Define TTL de 30 dias
            await this.client.expire(key, 30 * 24 * 60 * 60);
        } catch (error) {
            console.error('[Redis] Erro ao salvar thread do assistant:', error);
            throw error;
        }
    }

    async getAssistantRun(threadId) {
        try {
            const key = `assistant:run:${threadId}`;
            const run = await this.client.get(key);
            if (run) {
                return JSON.parse(run);
            }
            return null;
        } catch (error) {
            console.error('[Redis] Erro ao obter run do assistant:', error);
            throw error;
        }
    }

    async setAssistantRun(threadId, runData) {
        try {
            const key = `assistant:run:${threadId}`;
            await this.client.set(key, JSON.stringify(runData));
            // Define TTL de 1 hora
            await this.client.expire(key, 60 * 60);
        } catch (error) {
            console.error('[Redis] Erro ao salvar run do assistant:', error);
            throw error;
        }
    }

    async removeAssistantRun(threadId) {
        try {
            const key = `assistant:run:${threadId}`;
            await this.client.del(key);
        } catch (error) {
            console.error('[Redis] Erro ao remover run do assistant:', error);
            throw error;
        }
    }

    /**
     * Deleta todo o contexto de um usuário
     * @param {string} userId - ID do usuário
     */
    async deleteUserContext(userId) {
        try {
            const keys = await this.client.keys(`*:${userId}*`);
            if (keys.length > 0) {
                await this.client.del(...keys);
                console.log('[Redis] Contexto do usuário deletado:', userId);
            }
        } catch (error) {
            console.error('[Redis] Erro ao deletar contexto do usuário:', error);
            // Não lança erro para manter a consistência com outros métodos de delete
        }
    }
}

module.exports = { RedisStore };
