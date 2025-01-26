const logger = require('../utils/logger');

class ContextManager {
    constructor(redisStore) {
        this.redisStore = redisStore;
        this.TTL_CONFIG = {
            conversation: 7200,    // 2 horas
            order: 86400,         // 24 horas
            metadata: 3600,       // 1 hora
            history: 604800       // 7 dias
        };
    }

    async saveContext(threadId, context) {
        try {
            const baseKey = `context:${threadId}`;
            
            // Prepara os dados para salvar
            const prepareObjectForRedis = (obj) => {
                if (!obj) return {};
                return Object.entries(obj).reduce((acc, [key, value]) => {
                    acc[key] = typeof value === 'object' ? JSON.stringify(value) : value;
                    return acc;
                }, {});
            };

            // Executa a transação com retry
            await this.redisStore.executeTransaction(async (multi) => {
                // Salva dados da conversa
                if (context.conversation) {
                    const conversationData = prepareObjectForRedis(context.conversation);
                    await multi.hSet(`${baseKey}:conversation`, conversationData);
                    await multi.expire(`${baseKey}:conversation`, this.TTL_CONFIG.conversation);
                }

                // Salva dados do pedido
                if (context.order) {
                    const orderData = prepareObjectForRedis(context.order);
                    await multi.hSet(`${baseKey}:order`, orderData);
                    await multi.expire(`${baseKey}:order`, this.TTL_CONFIG.order);
                }

                // Salva metadados
                if (context.metadata) {
                    const metadataData = prepareObjectForRedis(context.metadata);
                    await multi.hSet(`${baseKey}:metadata`, metadataData);
                    await multi.expire(`${baseKey}:metadata`, this.TTL_CONFIG.metadata);
                }

                // Salva histórico (mantém apenas os últimos 5 itens)
                if (context.history && Array.isArray(context.history)) {
                    const historyJson = JSON.stringify(context.history);
                    await multi.lPush(`${baseKey}:history`, historyJson);
                    await multi.lTrim(`${baseKey}:history`, 0, 4);
                    await multi.expire(`${baseKey}:history`, this.TTL_CONFIG.history);
                }
            });

            logger.info('ContextSaved', { 
                threadId,
                timestamp: new Date().toISOString(),
                contextSize: JSON.stringify(context).length
            });

        } catch (error) {
            logger.error('ErrorSavingContext', { 
                threadId, 
                error: {
                    message: error.message,
                    stack: error.stack,
                    code: error.code
                },
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    async getContext(threadId) {
        try {
            const baseKey = `context:${threadId}`;
            const [conversation, order, metadata, history] = await Promise.all([
                this.redisStore.hgetall(`${baseKey}:conversation`),
                this.redisStore.hgetall(`${baseKey}:order`),
                this.redisStore.hgetall(`${baseKey}:metadata`),
                this.redisStore.lrange(`${baseKey}:history`, 0, -1)
            ]);

            // Parse dos dados do Redis
            const parseRedisObject = (obj) => {
                if (!obj) return {};
                return Object.entries(obj).reduce((acc, [key, value]) => {
                    try {
                        acc[key] = JSON.parse(value);
                    } catch {
                        acc[key] = value;
                    }
                    return acc;
                }, {});
            };

            // Parse do histórico
            const parsedHistory = (history || []).map(item => {
                try {
                    return JSON.parse(item);
                } catch {
                    return item;
                }
            });

            return {
                conversation: parseRedisObject(conversation),
                order: parseRedisObject(order),
                metadata: parseRedisObject(metadata),
                history: parsedHistory
            };
        } catch (error) {
            logger.error('ErrorGettingContext', { threadId, error });
            return this._createInitialContext();
        }
    }

    async updateContext(threadId, context) {
        try {
            const lockKey = `lock:${threadId}`;
            const acquired = await this.redisStore.set(lockKey, 1, { 
                EX: 5,  // 5 segundos de TTL
                NX: true // Só define se não existir
            });

            if (!acquired) {
                throw new Error('Não foi possível adquirir o lock');
            }

            try {
                await this.saveContext(threadId, context);
            } finally {
                // Sempre remove o lock, mesmo em caso de erro
                await this.redisStore.del(lockKey);
            }

        } catch (error) {
            logger.error('ErrorUpdatingContext', {
                threadId,
                error: {
                    message: error.message,
                    stack: error.stack,
                    code: error.code
                },
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    _createInitialContext() {
        return {
            conversation: {
                lastMessage: null,
                intent: null,
                waitingFor: null,
                interactionCount: 0
            },
            order: {},
            metadata: {
                lastToolUsed: null,
                lastFunctionResponse: null,
                rateLimitState: {
                    tokensUsed: 0,
                    lastRequest: new Date().toISOString()
                }
            },
            history: []
        };
    }
}

module.exports = { ContextManager };
