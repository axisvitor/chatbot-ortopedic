const moment = require('moment');
const logger = require('../utils/logger');

/**
 * Gerencia o contexto das conversas, salvando e recuperando dados do Redis
 * com suporte a TTL, locks e transações.
 */
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

    _createInitialContext() {
        return {
            conversation: {
                lastMessage: null,
                interactionCount: 0,
                lastUpdate: new Date().toISOString()
            },
            metadata: {},
            order: {},
            history: []
        };
    }

    _validateContext(context) {
        // Garante que o contexto tem a estrutura básica
        if (!context) {
            return this._createInitialContext();
        }

        return {
            conversation: {
                lastMessage: context.conversation?.lastMessage || null,
                interactionCount: parseInt(context.conversation?.interactionCount || 0, 10),
                lastUpdate: context.conversation?.lastUpdate || new Date().toISOString()
            },
            metadata: context.metadata || {},
            order: context.order || {},
            history: Array.isArray(context.history) ? context.history : []
        };
    }

    async saveContext(threadId, context) {
        if (!threadId) {
            throw new Error('ThreadId é obrigatório');
        }

        try {
            const baseKey = `context:${threadId}`;
            const validatedContext = this._validateContext(context);
            
            // Prepara os dados para salvar
            const prepareObjectForRedis = (obj) => {
                if (!obj) return {};
                return Object.entries(obj).reduce((acc, [key, value]) => {
                    try {
                        // Garante que números e booleanos são convertidos para string
                        if (typeof value === 'number' || typeof value === 'boolean') {
                            acc[key] = String(value);
                        } 
                        // Objetos e arrays são convertidos para JSON
                        else if (typeof value === 'object') {
                            acc[key] = JSON.stringify(value);
                        }
                        // Strings permanecem como estão
                        else {
                            acc[key] = value;
                        }
                    } catch (error) {
                        logger.warn('ErrorStringifyingValue', { 
                            threadId, 
                            key, 
                            error: error.message,
                            value: typeof value 
                        });
                        acc[key] = String(value);
                    }
                    return acc;
                }, {});
            };

            // Executa a transação com retry
            await this.redisStore.executeTransaction(async (multi) => {
                // Salva dados da conversa
                if (validatedContext.conversation) {
                    const conversationData = prepareObjectForRedis(validatedContext.conversation);
                    if (Object.keys(conversationData).length > 0) {
                        await multi.hSet(`${baseKey}:conversation`, conversationData);
                        await multi.expire(`${baseKey}:conversation`, this.TTL_CONFIG.conversation);
                    }
                }

                // Salva dados do pedido
                if (validatedContext.order) {
                    const orderData = prepareObjectForRedis(validatedContext.order);
                    if (Object.keys(orderData).length > 0) {
                        await multi.hSet(`${baseKey}:order`, orderData);
                        await multi.expire(`${baseKey}:order`, this.TTL_CONFIG.order);
                    }
                }

                // Salva metadados
                if (validatedContext.metadata) {
                    const metadataData = prepareObjectForRedis(validatedContext.metadata);
                    if (Object.keys(metadataData).length > 0) {
                        await multi.hSet(`${baseKey}:metadata`, metadataData);
                        await multi.expire(`${baseKey}:metadata`, this.TTL_CONFIG.metadata);
                    }
                }

                // Salva histórico (mantém apenas os últimos 5 itens)
                if (validatedContext.history && Array.isArray(validatedContext.history)) {
                    const historyJson = JSON.stringify(validatedContext.history);
                    await multi.lPush(`${baseKey}:history`, historyJson);
                    await multi.lTrim(`${baseKey}:history`, 0, 4);
                    await multi.expire(`${baseKey}:history`, this.TTL_CONFIG.history);
                }
            });

            logger.info('ContextSaved', { 
                threadId,
                timestamp: new Date().toISOString(),
                contextSize: JSON.stringify(validatedContext).length,
                hasConversation: !!validatedContext.conversation,
                hasOrder: !!validatedContext.order,
                hasMetadata: !!validatedContext.metadata,
                hasHistory: Array.isArray(validatedContext.history)
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
        if (!threadId) {
            throw new Error('ThreadId é obrigatório');
        }

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
}

module.exports = { ContextManager };
