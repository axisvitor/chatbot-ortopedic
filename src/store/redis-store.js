const { createClient } = require('redis');
const { REDIS_CONFIG } = require('../config/settings');

class RedisStore {
    constructor() {
        this.client = createClient({
            socket: {
                host: REDIS_CONFIG.host,
                port: REDIS_CONFIG.port,
                reconnectStrategy: (retries) => {
                    if (retries > 10) {
                        return new Error('Máximo de tentativas de reconexão excedido');
                    }
                    return Math.min(retries * 100, 3000);
                }
            },
            password: REDIS_CONFIG.password,
            database: 0,
            commandsQueueMaxLength: 1000,
            isolationPoolOptions: {
                min: 5,
                max: 20,
                acquireTimeoutMillis: 5000
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

        this.client.on('reconnecting', () => {
            console.log('[Redis] Tentando reconectar ao Redis...');
        });

        this.client.on('end', () => {
            console.log('[Redis] Conexão com Redis encerrada');
        });

        // Conecta automaticamente ao Redis
        this._connect();
    }

    async _connect() {
        try {
            await this.client.connect();
            console.log('[Redis] Conectado com sucesso');
        } catch (error) {
            console.error('[Redis] Erro ao conectar:', error);
            throw error;
        }
    }

    isConnected() {
        return this.client && this.client.isOpen;
    }

    async connect() {
        try {
            if (!this.client.isOpen) {
                await this.client.connect();
            }
            // Verifica se realmente está conectado
            await this.ping();
        } catch (error) {
            console.error('[Redis] Erro ao conectar ao Redis:', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    async disconnect() {
        try {
            if (this.client && this.client.isOpen) {
                await this.client.quit();
            }
        } catch (error) {
            console.error('[Redis] Erro ao desconectar do Redis:', error);
            throw error;
        }
    }

    async ping() {
        try {
            await this.client.ping();
            return true;
        } catch (error) {
            console.error('[Redis] Erro ao fazer ping no Redis:', error);
            return false;
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

    async set(key, value, options = {}) {
        try {
            if (!this.client.isOpen) {
                await this._connect();
            }

            // Se options for número, assume que é TTL
            if (typeof options === 'number') {
                options = { EX: options };
            }

            // Se não for objeto, converte para objeto com as opções padrão
            if (typeof options !== 'object') {
                options = { EX: REDIS_CONFIG.ttl };
            }

            // Garante que o valor seja string
            const stringValue = typeof value === 'object' ? 
                JSON.stringify(value) : String(value);

            const result = await this.client.set(key, stringValue, options);
            return result === 'OK' || result === true;
        } catch (error) {
            console.error('[Redis] Erro ao salvar no cache:', {
                key,
                error: error.message,
                stack: error.stack
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
            if (typeof field === 'object') {
                // Se field for um objeto, usa como hash
                return await this.client.hSet(key, field);
            }
            // Caso contrário, usa field e value
            return await this.client.hSet(key, field, value);
        } catch (error) {
            console.error('[Redis] Erro ao definir hash:', error);
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

    async executeTransaction(callback, maxRetries = 3) {
        let retryCount = 0;
        while (retryCount < maxRetries) {
            try {
                if (!this.client.isOpen) {
                    await this._connect();
                }
                
                const multi = this.client.multi();
                await callback(multi);
                const result = await multi.exec();
                
                if (!result) {
                    throw new Error('Transação falhou - resultado nulo');
                }
                
                return result;
            } catch (error) {
                retryCount++;
                console.error(`[Redis] Erro na transação (tentativa ${retryCount}/${maxRetries}):`, error);
                
                if (error.message.includes('EXECABORT') && retryCount < maxRetries) {
                    console.warn(`[Redis] Retry ${retryCount}/${maxRetries} após EXECABORT`);
                    await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, retryCount)));
                    continue;
                }
                
                if (retryCount === maxRetries) {
                    console.error('[Redis] Máximo de tentativas excedido:', error);
                }
                
                throw error;
            }
        }
    }

    async multi() {
        try {
            return this.client.multi();
        } catch (error) {
            console.error('[Redis] Erro ao criar transação:', error);
            throw error;
        }
    }

    async watch(key) {
        try {
            await this.client.watch(key);
            return true;
        } catch (error) {
            console.error('[Redis] Erro ao observar chave:', error);
            return false;
        }
    }

    async unwatch() {
        try {
            await this.client.unwatch();
            return true;
        } catch (error) {
            console.error('[Redis] Erro ao remover observação:', error);
            return false;
        }
    }

    async pipeline() {
        try {
            return this.client.multi();
        } catch (error) {
            console.error('[Redis] Erro ao criar pipeline:', error);
            throw error;
        }
    }

    async lrange(key, start, stop) {
        try {
            return await this.client.lRange(key, start, stop);
        } catch (error) {
            console.error('[Redis] Erro ao executar LRANGE:', { key, error });
            return [];
        }
    }

    async lpush(key, ...values) {
        try {
            return await this.client.lPush(key, ...values);
        } catch (error) {
            console.error('[Redis] Erro ao executar LPUSH:', { key, error });
            throw error;
        }
    }

    async ltrim(key, start, stop) {
        try {
            return await this.client.lTrim(key, start, stop);
        } catch (error) {
            console.error('[Redis] Erro ao executar LTRIM:', { key, error });
            throw error;
        }
    }
}

module.exports = { RedisStore };
