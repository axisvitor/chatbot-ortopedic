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
            const pipeline = this.redisStore.pipeline();
            const baseKey = `context:${threadId}`;

            // Salva dados da conversa
            if (context.conversation) {
                pipeline.hset(`${baseKey}:conversation`, context.conversation);
                pipeline.expire(`${baseKey}:conversation`, this.TTL_CONFIG.conversation);
            }

            // Salva dados do pedido
            if (context.order) {
                pipeline.hset(`${baseKey}:order`, context.order);
                pipeline.expire(`${baseKey}:order`, this.TTL_CONFIG.order);
            }

            // Salva metadados
            if (context.metadata) {
                pipeline.hset(`${baseKey}:metadata`, context.metadata);
                pipeline.expire(`${baseKey}:metadata`, this.TTL_CONFIG.metadata);
            }

            // Salva histórico (mantém apenas os últimos 5 itens)
            if (context.history) {
                pipeline.lpush(`${baseKey}:history`, JSON.stringify(context.history));
                pipeline.ltrim(`${baseKey}:history`, 0, 4);
                pipeline.expire(`${baseKey}:history`, this.TTL_CONFIG.history);
            }

            await pipeline.exec();
            logger.info('ContextSaved', { threadId });

        } catch (error) {
            logger.error('ErrorSavingContext', { threadId, error });
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

            // Processa o histórico
            const processedHistory = history ? history.map(item => {
                try {
                    return JSON.parse(item);
                } catch {
                    return item;
                }
            }) : [];

            return {
                conversation: conversation || {},
                order: order || {},
                metadata: metadata || {},
                history: processedHistory
            };
        } catch (error) {
            logger.error('ErrorGettingContext', { threadId, error });
            return this._createInitialContext();
        }
    }

    async updateContext(threadId, updateFn) {
        const lockKey = `lock:${threadId}`;
        try {
            // Tenta adquirir lock por 5 segundos usando o formato correto
            const acquired = await this.redisStore.set(lockKey, 1, {
                EX: 5,
                NX: true
            });
            
            if (!acquired) {
                throw new Error('Contexto bloqueado');
            }

            const currentContext = await this.getContext(threadId);
            const updatedContext = updateFn(currentContext);
            await this.saveContext(threadId, updatedContext);

            return updatedContext;
        } finally {
            await this.redisStore.del(lockKey);
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
