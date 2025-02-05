const OpenAI = require('openai');
const moment = require('moment-timezone');
const logger = require('../utils/logger');
const { RedisStore } = require('../store/redis-store');
const { ContextManager } = require('../store/context-manager');
const { OPENAI_CONFIG, REDIS_CONFIG } = require('../config/settings');
const { TrackingService } = require('./tracking-service');
const { BusinessHoursService } = require('./business-hours');
const { OrderValidationService } = require('./order-validation-service');
const { NuvemshopService } = require('./nuvemshop');
const { DepartmentService } = require('./department-service');
const { FinancialService } = require('./financial-service');

class OpenAIService {
    /**
     * @param {NuvemshopService} nuvemshopService - Serviço de integração com a Nuvemshop
     * @param {TrackingService} trackingService - Serviço de tracking
     * @param {BusinessHoursService} businessHoursService - Serviço de horário de atendimento
     * @param {OrderValidationService} orderValidationService - Serviço de validação de pedidos
     * @param {FinancialService} financialService - Serviço financeiro
     * @param {DepartmentService} departmentService - Serviço de departamentos
     * @param {Object} whatsappService - Serviço de WhatsApp (injetado para evitar dependência circular)
     */
    constructor(nuvemshopService, trackingService, businessHoursService, orderValidationService, financialService, departmentService, whatsappService) {
        this.client = new OpenAI({
            apiKey: OPENAI_CONFIG.apiKey,
            baseURL: OPENAI_CONFIG.baseUrl
        });
        this.assistantId = OPENAI_CONFIG.assistantId;
        this.redisStore = new RedisStore(); // Redis para controlar runs ativos
        this.contextManager = new ContextManager(this.redisStore);
        
        // Serviços
        this.nuvemshopService = nuvemshopService || new NuvemshopService();
        this.trackingService = trackingService;
        this.businessHoursService = businessHoursService;
        this.orderValidationService = orderValidationService;
        this.financialService = financialService;
        this.departmentService = departmentService;
        this.whatsappService = whatsappService;
        
        // Conecta ao Redis
        this.redisStore.connect().catch(error => {
            console.error('[OpenAI] Erro ao conectar ao Redis:', error);
        });
        
        // Cache de threads em memória
        this.threadCache = new Map(); // Armazena threads ativos
        this.threadLastAccess = new Map(); // Última vez que thread foi acessada
        this.messageQueue = new Map(); // Map para fila de mensagens por thread
        this.processingTimers = new Map(); // Map para controlar timers de processamento
        
        // Rate Limiting - Otimizado para gpt-4
        this.rateLimitConfig = {
            maxRequestsPerMin: 400, // 500 RPM max, mantendo margem de segurança
            maxRequestsPerDay: 9000, // 10000 RPD max
            maxTokensPerMin: 180000, // 200k TPM max
            windowMs: 60 * 1000, // Janela de 1 minuto
            retryAfter: 5 * 1000, // Reduzido para 5 segundos
            maxTokensPerRequest: 4000, // Limite por requisição para evitar exceder TPM
            batchSize: 5, // Número de mensagens para processar em batch
            queueTimeout: 30000, // Tempo máximo para processar fila (30 segundos)
            queueMaxSize: 50 // Tamanho máximo da fila
        };
        
        // Contadores de rate limit
        this.requestCountsPerMin = new Map();
        this.requestCountsPerDay = new Map();
        this.tokenCountsPerMin = new Map();
        this.lastRequestTime = new Map();
        this.dayStartTime = Date.now();

        // Configurações de otimização
        this.MESSAGE_DELAY = 8000; // 8 segundos de delay
        this.THREAD_CACHE_TTL = 30 * 60 * 1000; // 30 minutos de cache
        this.MAX_THREAD_MESSAGES = 10; // Máximo de mensagens por thread
        this.CONTEXT_UPDATE_INTERVAL = 15 * 60 * 1000; // 15 minutos em ms

        // Inicializa limpeza periódica
        setInterval(() => this._cleanupCache(), this.THREAD_CACHE_TTL);
        // Limpa contadores de rate limit periodicamente
        setInterval(() => this._cleanupRateLimits(), this.rateLimitConfig.windowMs);
        
        console.log('[OpenAI] Serviço inicializado:', {
            assistantId: this.assistantId,
            baseUrl: OPENAI_CONFIG.baseUrl,
            timestamp: new Date().toISOString()
        });

        // Define as funções disponíveis para o Assistant
        this.functions = this._getAssistantFunctions();
    }

    /**
     * Verifica e atualiza o rate limit
     * @private
     * @param {string} threadId - ID da thread
     * @param {number} estimatedTokens - Estimativa de tokens da requisição
     * @returns {Promise<boolean>} - true se pode prosseguir, false se deve esperar
     */
    async _checkRateLimit(threadId, estimatedTokens = 1000) {
        const now = Date.now();
        const windowStart = now - this.rateLimitConfig.windowMs;
        const dayStart = now - (24 * 60 * 60 * 1000);
        
        // Reseta contadores diários se necessário
        if (this.dayStartTime < dayStart) {
            this.requestCountsPerDay.clear();
            this.dayStartTime = now;
        }
        
        // Limpa contadores antigos por minuto
        for (const [id, time] of this.lastRequestTime.entries()) {
            if (time < windowStart) {
                this.requestCountsPerMin.delete(id);
                this.tokenCountsPerMin.delete(id);
                this.lastRequestTime.delete(id);
            }
        }
        
        // Obtém contadores atuais
        const currentMinCount = this.requestCountsPerMin.get(threadId) || 0;
        const currentDayCount = this.requestCountsPerDay.get(threadId) || 0;
        const currentTokenCount = this.tokenCountsPerMin.get(threadId) || 0;
        
        // Verifica limites
        if (currentMinCount >= this.rateLimitConfig.maxRequestsPerMin ||
            currentDayCount >= this.rateLimitConfig.maxRequestsPerDay ||
            currentTokenCount + estimatedTokens > this.rateLimitConfig.maxTokensPerMin) {
            
            logger.warn('RateLimitExceeded', {
                threadId,
                currentMinCount,
                currentDayCount,
                currentTokenCount,
                estimatedTokens,
                timestamp: new Date().toISOString()
            });
            
            // Agenda retry
            await new Promise(resolve => setTimeout(resolve, this.rateLimitConfig.retryAfter));
            return this._checkRateLimit(threadId, estimatedTokens);
        }
        
        // Atualiza contadores
        this.requestCountsPerMin.set(threadId, currentMinCount + 1);
        this.requestCountsPerDay.set(threadId, currentDayCount + 1);
        this.tokenCountsPerMin.set(threadId, currentTokenCount + estimatedTokens);
        this.lastRequestTime.set(threadId, now);
        
        return true;
    }

    /**
     * Limpa contadores de rate limit antigos
     * @private
     */
    _cleanupRateLimits() {
        const now = Date.now();
        const windowStart = now - this.rateLimitConfig.windowMs;
        
        for (const [threadId, time] of this.lastRequestTime.entries()) {
            if (time < windowStart) {
                this.requestCountsPerMin.delete(threadId);
                this.tokenCountsPerMin.delete(threadId);
                this.lastRequestTime.delete(threadId);
            }
        }
    }

    /**
     * Limpa cache de threads inativos
     * @private
     */
    async _cleanupCache() {
        const now = Date.now();
        for (const [threadId, lastAccess] of this.threadLastAccess.entries()) {
            if (now - lastAccess > this.THREAD_CACHE_TTL) {
                // Persiste thread no Redis antes de remover do cache
                const thread = this.threadCache.get(threadId);
                if (thread) {
                    await this._persistThreadToRedis(threadId, thread);
                }
                this.threadCache.delete(threadId);
                this.threadLastAccess.delete(threadId);
                logger.info('ThreadCacheCleanup', {
                    threadId,
                    lastAccess: new Date(lastAccess).toISOString()
                });
            }
        }
    }

    /**
     * Persiste thread no Redis
     * @private
     */
    async _persistThreadToRedis(threadId, thread) {
        try {
            const key = `${REDIS_CONFIG.prefix.openai}thread_meta:${threadId}`;
            await this.redisStore.set(key, thread, REDIS_CONFIG.ttl.openai.threads);
            logger.debug('[OpenAI] Thread persistido no Redis', { threadId });
            return true;
        } catch (error) {
            logger.error('[OpenAI] Erro ao persistir thread no Redis:', error);
            return false;
        }
    }

    /**
     * Recupera thread do cache ou Redis
     * @private
     */
    async _getThread(threadId) {
        // Verifica cache primeiro
        if (this.threadCache.has(threadId)) {
            this.threadLastAccess.set(threadId, Date.now());
            return this.threadCache.get(threadId);
        }

        // Se não está em cache, busca no Redis
        try {
            const key = `${REDIS_CONFIG.prefix.openai}thread_meta:${threadId}`;
            const threadData = await this.redisStore.get(key);
            if (threadData) {
                const thread = JSON.parse(threadData);
                // Adiciona ao cache
                this.threadCache.set(threadId, thread);
                this.threadLastAccess.set(threadId, Date.now());
                return thread;
            }
        } catch (error) {
            logger.error('ErrorGettingThread', {
                threadId,
                error: error.message
            });
        }

        return null;
    }

    /**
     * Obtém o ID da thread para um cliente
     * @private
     * @param {string} customerId - ID do cliente
     * @returns {Promise<string>} ID da thread
     */
    async _getThreadId(customerId) {
        return await this.getOrCreateThreadForCustomer(customerId);
    }

    /**
     * Define as funções disponíveis para o Assistant
     * @private
     * @returns {Array} Array de definições de funções
     */
    _getAssistantFunctions() {
        return [
            {
                name: "get_complete_order_info",
                description: "Busca informações completas do pedido incluindo status de rastreio atualizado",
                parameters: {
                    type: "object",
                    required: ["order_number"],
                    properties: {
                        order_number: {
                            type: "string",
                            description: "Número do pedido (ex: #123456)"
                        }
                    }
                }
            },
            {
                name: "get_business_hours",
                description: "Verifica o horário de atendimento atual",
                parameters: {
                    type: "object",
                    properties: {}
                }
            },
            {
                name: "forward_to_financial",
                description: "Encaminha caso para análise do setor financeiro",
                parameters: {
                    type: "object",
                    required: ["message", "userContact"],
                    properties: {
                        message: {
                            type: "string",
                            description: "Mensagem do cliente"
                        },
                        userContact: {
                            type: "string",
                            description: "WhatsApp do cliente"
                        },
                        orderNumber: {
                            type: "string",
                            description: "Número do pedido (opcional)"
                        }
                    }
                }
            },
            {
                name: "forward_to_department",
                description: "Encaminha caso para um departamento específico",
                parameters: {
                    type: "object",
                    required: ["message", "department", "userContact"],
                    properties: {
                        message: {
                            type: "string",
                            description: "Mensagem do cliente"
                        },
                        department: {
                            type: "string",
                            enum: ["support", "sales", "technical", "shipping", "quality"],
                            description: "Departamento destino"
                        },
                        userContact: {
                            type: "string",
                            description: "WhatsApp do cliente"
                        },
                        priority: {
                            type: "string",
                            enum: ["low", "normal", "high", "urgent"],
                            default: "normal",
                            description: "Prioridade do caso"
                        },
                        orderNumber: {
                            type: "string",
                            description: "Número do pedido (opcional)"
                        }
                    }
                }
            },
            {
                name: "request_payment_proof",
                description: "Gerencia solicitações de comprovante de pagamento",
                parameters: {
                    type: "object",
                    required: ["action", "order_number"],
                    properties: {
                        action: {
                            type: "string",
                            enum: ["request", "process", "validate", "cancel"],
                            description: "Ação a ser executada"
                        },
                        order_number: {
                            type: "string",
                            description: "Número do pedido"
                        },
                        image_url: {
                            type: "string",
                            description: "URL da imagem do comprovante (necessário apenas para action='process')"
                        }
                    }
                }
            }
        ];
    }

    /**
     * Verifica se há um run ativo para a thread
     * @param {string} threadId - ID da thread
     * @returns {Promise<boolean>} 
     */
    async hasActiveRun(threadId) {
        try {
            const activeRunData = await this.redisStore.getActiveRun(threadId);
            if (!activeRunData) return false;

            try {
                const data = JSON.parse(activeRunData);
                const now = new Date().getTime();
                
                // Se o run está ativo há mais de 2 minutos, considera inativo
                if (now - data.timestamp > 2 * 60 * 1000) {
                    await this.redisStore.removeActiveRun(threadId);
                    return false;
                }
                
                return true;
            } catch (error) {
                await this.redisStore.removeActiveRun(threadId);
                return false;
            }
        } catch (error) {
            logger.error('ErrorCheckingActiveRun', { threadId, error });
            return false;
        }
    }

    /**
     * Registra um run ativo
     * @param {string} threadId - ID da thread
     * @param {string} runId - ID do run
     */
    async registerActiveRun(threadId, runId) {
        try {
            const data = {
                runId,
                timestamp: new Date().getTime()
            };
            await this.redisStore.setActiveRun(threadId, JSON.stringify(data), 5 * 60); // 5 minutos TTL
        } catch (error) {
            logger.error('ErrorRegisteringActiveRun', { threadId, runId, error });
        }
    }

    /**
     * Remove um run ativo
     * @param {string} threadId - ID da thread
     */
    async removeActiveRun(threadId) {
        try {
            await this.redisStore.removeActiveRun(threadId);
            await this.processQueuedMessages(threadId);
        } catch (error) {
            logger.error('ErrorRemovingActiveRun', { threadId, error });
            console.error('[OpenAI] Erro ao remover run ativo:', error);
        }
    }

    /**
     * Adiciona mensagem à fila e agenda processamento
     * @param {string} threadId - ID da thread
     * @param {Object} message - Mensagem a ser adicionada
     * @param {string} customerId - ID do cliente
     */
    async queueMessage(threadId, message, customerId) {
        try {
            // Verifica tamanho da fila
            const currentQueue = this.messageQueue.get(threadId) || [];
            if (currentQueue.length >= this.rateLimitConfig.queueMaxSize) {
                throw new Error('Fila de mensagens cheia. Tente novamente mais tarde.');
            }

            // Adiciona à fila
            if (!this.messageQueue.has(threadId)) {
                this.messageQueue.set(threadId, []);
            }
            this.messageQueue.get(threadId).push({ message, customerId });

            logger.info('📥 [OpenAI] Mensagem enfileirada:', {
                threadId,
                queueSize: this.messageQueue.get(threadId).length,
                customerId
            });

            // Se não houver timer, cria um
            if (!this.processingTimers.has(threadId)) {
                const timer = setTimeout(async () => {
                    try {
                        await this.processQueuedMessages(threadId);
                    } catch (error) {
                        logger.error('❌ [OpenAI] Erro ao processar fila:', {
                            threadId,
                            error: error.message
                        });
                    }
                }, this.MESSAGE_DELAY);

                this.processingTimers.set(threadId, timer);
            }

            return { queued: true };
        } catch (error) {
            logger.error('❌ [OpenAI] Erro ao enfileirar mensagem:', {
                threadId,
                customerId,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Processa todas as mensagens acumuladas na fila
     * @param {string} threadId - ID da thread
     */
    async processQueuedMessages(threadId) {
        try {
            // Remove o timer
            clearTimeout(this.processingTimers.get(threadId));
            this.processingTimers.delete(threadId);

            // Pega todas as mensagens da fila
            const messages = this.messageQueue.get(threadId) || [];
            this.messageQueue.delete(threadId);

            if (messages.length === 0) {
                return;
            }

            logger.info('📨 [OpenAI] Processando mensagens enfileiradas:', {
                threadId,
                messageCount: messages.length
            });

            // Processa em batch
            const batchSize = this.rateLimitConfig.batchSize;
            for (let i = 0; i < messages.length; i += batchSize) {
                const batch = messages.slice(i, i + batchSize);
                
                // Consolida mensagens do batch
                const consolidatedMessage = batch
                    .map(item => item.message.content || item.message)
                    .join('\n---\n');

                // Adiciona mensagem consolidada
                await this.addMessageAndRun(threadId, {
                    role: 'user',
                    content: consolidatedMessage
                }, batch[0].customerId);

                // Aguarda o delay entre batches
                if (i + batchSize < messages.length) {
                    await new Promise(resolve => setTimeout(resolve, this.MESSAGE_DELAY));
                }
            }
        } catch (error) {
            logger.error('❌ [OpenAI] Erro ao processar mensagens enfileiradas:', {
                threadId,
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Adiciona mensagem e executa o assistant
     * @param {string} threadId - ID da thread
     * @param {Object} message - Mensagem para adicionar
     * @param {string} customerId - ID do cliente
     */
    async addMessageAndRun(threadId, message, customerId) {
        try {
            // Verifica se há um run ativo usando Redis
            const activeRun = await this.redisStore.getActiveRun(threadId);
            
            if (activeRun) {
                logger.warn('🔄 [OpenAI] Run ativo detectado, enfileirando mensagem:', {
                    threadId,
                    customerId,
                    activeRun
                });
                return this.queueMessage(threadId, message, customerId);
            }

            // Registra o run como ativo no Redis
            await this.redisStore.setActiveRun(threadId, 'pending', 30); // TTL de 30 segundos

            // Adiciona a mensagem à thread
            const messageResponse = await this.client.beta.threads.messages.create(
                threadId,
                {
                    role: 'user',
                    content: message.content || message
                }
            );

            logger.info('✉️ [OpenAI] Mensagem adicionada:', {
                threadId,
                messageId: messageResponse.id,
                customerId
            });

            // Cria novo run
            const run = await this.client.beta.threads.runs.create(
                threadId,
                { assistant_id: this.assistantId }
            );

            // Atualiza o ID do run ativo no Redis
            await this.redisStore.setActiveRun(threadId, run.id, 30);

            logger.info('▶️ [OpenAI] Run iniciado:', {
                threadId,
                runId: run.id,
                customerId
            });

            // Aguarda a conclusão e retorna a resposta
            const response = await this._waitForResponse(run, threadId);
            return response;

        } catch (error) {
            // Remove o run ativo em caso de erro
            await this.redisStore.removeActiveRun(threadId);

            logger.error('❌ [OpenAI] Erro ao adicionar mensagem e criar run:', {
                threadId,
                customerId,
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Cancela um run ativo
     * @param {string} threadId - ID do thread
     * @returns {Promise<void>}
     */
    async cancelActiveRun(threadId) {
        try {
            const activeRun = await this.redisStore.getActiveRun(threadId);
            if (!activeRun) return;

            try {
                await this.client.beta.threads.runs.cancel(threadId, activeRun);
                logger.info('ActiveRunCanceled', { threadId, runId: activeRun });
                
                // Aguarda um momento para garantir que o run foi cancelado
                await new Promise(resolve => setTimeout(resolve, 1000));

                // Verifica se o run foi realmente cancelado
                const run = await this.client.beta.threads.runs.retrieve(threadId, activeRun);
                if (run.status !== 'cancelled') {
                    logger.warn('RunNotCancelled', { threadId, runId: activeRun, status: run.status });
                    // Tenta cancelar novamente
                    await this.client.beta.threads.runs.cancel(threadId, activeRun);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

                await this.removeActiveRun(threadId);
            } catch (error) {
                // Ignora erro se o run não existir mais
                if (!error.message.includes('No run found')) {
                    logger.error('ErrorCancelingRun', { threadId, runId: activeRun, error: error.message });
                }
                // Mesmo com erro, tenta remover o run
                await this.removeActiveRun(threadId);
            }
        } catch (error) {
            logger.error('ErrorInCancelActiveRun', { threadId, error });
        }
    }

    async checkRunStatus(threadId, runId) {
        try {
            console.log('🔍 [OpenAI] Verificando status do run...', { threadId, runId });

            // Verifica se os parâmetros são válidos
            if (!threadId || !runId) {
                console.error('❌ [OpenAI] ThreadId ou RunId inválidos');
                throw new Error('ThreadId e RunId são obrigatórios');
            }

            // Busca o status do run
            const run = await this.client.beta.threads.runs.retrieve(threadId, runId);

            if (!run) {
                console.error('❌ [OpenAI] Run não encontrado');
                throw new Error('Run não encontrado');
            }

            // Atualiza o status no Redis
            await this._setRunStatus(threadId, run.status);

            // Log do status atual
            console.log('ℹ️ [OpenAI] Status atual:', {
                threadId,
                runId,
                status: run.status,
                startTime: run.started_at,
                model: run.model
            });

            return run;
        } catch (error) {
            console.error('❌ [OpenAI] Erro ao verificar status:', {
                threadId,
                runId,
                erro: error.message,
                stack: error.stack
            });

            // Se o erro for de autenticação ou API, loga separadamente
            if (error.status === 401) {
                console.error('🔑 [OpenAI] Erro de autenticação. Verifique a API key');
            } else if (error.status === 429) {
                console.error('⚠️ [OpenAI] Rate limit excedido');
            }

            throw error;
        }
    }

    async _setRunStatus(threadId, status) {
        try {
            const key = `run:${threadId}`;
            await this.redisStore.set(key, status, 300); // TTL de 5 minutos
            return true;
        } catch (error) {
            logger.error('[OpenAI] Erro ao definir status do run:', error);
            return false;
        }
    }

    async _getRunStatus(threadId) {
        try {
            const key = `run:${threadId}`;
            return await this.redisStore.get(key) || false;
        } catch (error) {
            logger.error('[OpenAI] Erro ao obter status do run:', error);
            return false;
        }
    }

    async _saveCustomerThread(customerId, threadId) {
        try {
            const key = `customer_thread:${customerId}`;
            await this.redisStore.set(key, threadId, 300); // TTL de 5 minutos
            return true;
        } catch (error) {
            logger.error('[OpenAI] Erro ao salvar thread do cliente:', error);
            return false;
        }
    }

    async _getCustomerThread(customerId) {
        try {
            const key = `customer_thread:${customerId}`;
            return await this.redisStore.get(key);
        } catch (error) {
            logger.error('[OpenAI] Erro ao obter thread do cliente:', error);
            return null;
        }
    }

    async deleteThread(customerId) {
        try {
            // Busca thread existente usando o prefixo correto
            const threadKey = `${REDIS_CONFIG.prefix.openai}thread_meta:${customerId}`;
            let existingThreadId = await this.redisStore.getThreadForCustomer(customerId);
            let shouldCreateNewThread = false;

            logger.info('CheckingExistingThread', { 
                customerId, 
                threadId: existingThreadId, 
                hasExistingThread: !!existingThreadId 
            });

            if (existingThreadId) {
                // Verifica se a thread ainda existe na OpenAI e se não foi resetada
                try {
                    // Tenta recuperar a thread na OpenAI
                    const openaiThread = await this.client.beta.threads.retrieve(existingThreadId);
                    logger.info('OpenAIThreadFound', { 
                        customerId, 
                        threadId: existingThreadId,
                        openaiThreadId: openaiThread.id
                    });
                    
                    // Verifica se a thread foi resetada ou deletada
                    const metadata = await this.redisStore.get(`${REDIS_CONFIG.prefix.openai}thread_meta:${existingThreadId}`);
                    logger.info('ThreadMetadataCheck', {
                        customerId,
                        threadId: existingThreadId,
                        hasMetadata: !!metadata
                    });

                    if (!metadata) {
                        logger.info('ThreadWasReset', { customerId, threadId: existingThreadId });
                        shouldCreateNewThread = true;
                    }

                    // Verifica se há mensagens na thread
                    const messages = await this.client.beta.threads.messages.list(existingThreadId);
                    logger.info('ThreadMessagesCheck', {
                        customerId,
                        threadId: existingThreadId,
                        messageCount: messages?.data?.length || 0
                    });

                    if (!messages || messages.data.length === 0) {
                        logger.info('ThreadIsEmpty', { customerId, threadId: existingThreadId });
                        shouldCreateNewThread = true;
                    }
                } catch (error) {
                    logger.warn('ThreadNotFound', { 
                        customerId, 
                        threadId: existingThreadId, 
                        error: error.message,
                        stack: error.stack
                    });
                    shouldCreateNewThread = true;
                }

                if (shouldCreateNewThread) {
                    logger.info('CleaningOldThread', { 
                        customerId, 
                        threadId: existingThreadId,
                        reason: 'Thread inválida ou resetada'
                    });
                    // Remove o mapeamento antigo
                    await this.redisStore.del(`${REDIS_CONFIG.prefix.openai}customer_threads:${customerId}`);
                    existingThreadId = null;
                }
            }

            if (!existingThreadId || shouldCreateNewThread) {
                logger.info('CreatingNewThread', { 
                    customerId,
                    reason: !existingThreadId ? 'Sem thread existente' : 'Thread antiga inválida'
                });

                // Cria nova thread
                const thread = await this.client.beta.threads.create();
                existingThreadId = thread.id;

                logger.info('NewThreadCreated', {
                    customerId,
                    threadId: existingThreadId,
                    openaiThreadId: thread.id
                });

                // Salva mapeamento cliente -> thread
                await this.redisStore.setThreadForCustomer(customerId, existingThreadId);

                // Inicializa metadados da thread
                const metadata = {
                    customerId,
                    createdAt: new Date().toISOString(),
                    lastActivity: new Date().toISOString(),
                    messageCount: 0,
                    isNew: true
                };

                await this.redisStore.set(
                    `${REDIS_CONFIG.prefix.openai}thread_meta:${existingThreadId}`, 
                    JSON.stringify(metadata), 
                    30 * 24 * 60 * 60 // 30 dias TTL
                );

                logger.info('ThreadMetadataSaved', {
                    customerId,
                    threadId: existingThreadId,
                    metadata
                });
            }

            return existingThreadId;

        } catch (error) {
            logger.error('ErrorCreatingThread', { 
                customerId, 
                error: error.message,
                stack: error.stack 
            });
            return null;
        }
    }

    /**
     * Obtém ou cria uma thread para um cliente
     * @param {string} customerId - ID do cliente
     * @returns {Promise<string>} ID da thread
     */
    async getOrCreateThreadForCustomer(customerId) {
        try {
            // Tenta obter uma thread existente do Redis
            const threadId = await this.redisStore.get(`${REDIS_CONFIG.prefix.openai}customer_threads:${customerId}`);
            if (threadId) {
                return threadId;
            }

            // Se não existir, cria uma nova thread
            const thread = await this.client.beta.threads.create();
            
            // Salva a thread no Redis
            await this.redisStore.set(`${REDIS_CONFIG.prefix.openai}customer_threads:${customerId}`, thread.id);
            
            return thread.id;
        } catch (error) {
            logger.error('ErrorGetOrCreateThread', { 
                error: {
                    message: error.message,
                    stack: error.stack
                },
                customerId,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Processa um comprovante de pagamento
     * @param {string} threadId - ID da thread
     * @param {Object} image - Objeto contendo dados da imagem
     * @param {string} orderNumber - Número do pedido
     * @returns {Promise<string>} Resultado do processamento
     */
    async processPaymentProof(threadId, image, orderNumber) {
        try {
            logger.info('ProcessingPaymentProof', { threadId, orderNumber, hasImage: !!image });
            console.log('[OpenAI] Processando comprovante:', {
                threadId,
                orderNumber,
                hasImage: !!image
            });

            // Validar se há solicitação pendente
            const waiting = await this.redisStore.get(`openai:waiting_order:${threadId}`);
            const pendingOrder = await this.redisStore.get(`openai:pending_order:${threadId}`);
            
            if (!waiting || waiting !== 'payment_proof') {
                return 'Não há solicitação de comprovante pendente. Por favor, primeiro me informe o número do pedido.';
            }

            if (pendingOrder && orderNumber && pendingOrder !== orderNumber) {
                return ` O número do pedido informado (#${orderNumber}) é diferente do pedido pendente (#${pendingOrder}). Por favor, confirme o número correto do pedido.`;
            }

            if (!image) {
                return ' Não recebi nenhuma imagem. Por favor, envie uma foto clara do comprovante de pagamento.';
            }

            // Validar o pedido
            const order = await this.nuvemshopService.getOrderByNumber(orderNumber);
            if (!order) {
                return ` Não encontrei o pedido #${orderNumber}. Por favor, verifique o número e tente novamente.`;
            }

            // Processar o comprovante
            const result = await this.nuvemshopService.processPaymentProof({
                orderId: order.id,
                orderNumber: orderNumber,
                image: image,
                threadId: threadId,
                timestamp: new Date().toISOString()
            });

            // Limpar o comprovante pendente após processamento
            await this.redisStore.del(`openai:pending_proof:${threadId}`);

            return ' Comprovante recebido! Nosso time irá analisar e confirmar o pagamento em breve.';
        } catch (error) {
            logger.error('ErrorProcessingPaymentProof', { threadId, orderNumber, error });
            throw error;
        }
    }

    /**
     * Salva contexto da conversa no Redis
     * @private
     */
    async _saveContextToRedis(threadId, context) {
        try {
            const key = `${REDIS_CONFIG.prefix.openai}context:thread:${threadId}`;
            const lastUpdateKey = `${REDIS_CONFIG.prefix.openai}context:update:${threadId}`;
            const contextData = {
                lastMessage: context,
                timestamp: Date.now(),
                metadata: {
                    lastOrderNumber: await this.redisStore.get(`openai:pending_order:${threadId}`),
                    lastTrackingCode: await this.redisStore.get(`openai:tracking:${threadId}`),
                    waitingFor: await this.redisStore.get(`openai:waiting_order:${threadId}`),
                    lastToolCalls: await this.redisStore.get(`openai:tool_calls:${threadId}`)
                }
            };

            await Promise.all([
                this.redisStore.set(key, JSON.stringify(contextData), 24 * 60 * 60), // 24 horas
                this.redisStore.set(lastUpdateKey, Date.now().toString(), 24 * 60 * 60)
            ]);

            logger.info('ContextSaved', { threadId });
        } catch (error) {
            logger.error('ErrorSavingContext', { threadId, error });
        }
    }

    /**
     * Recupera contexto da conversa do Redis
     * @private
     */
    async _getContextFromRedis(threadId) {
        try {
            const key = `${REDIS_CONFIG.prefix.context}${threadId}:history`;
            const context = await this.redisStore.get(key);
            return context || [];
        } catch (error) {
            logger.error('ErrorGettingContext', { threadId, error });
            return [];
        }
    }

    /**
     * Verifica se precisa atualizar o contexto
     * @private
     */
    async _shouldUpdateContext(threadId) {
        try {
            const lastUpdateKey = `${REDIS_CONFIG.prefix.openai}context:update:${threadId}`;
            const lastUpdate = await this.redisStore.get(lastUpdateKey);
            
            if (!lastUpdate) {
                return true;
            }

            // Atualiza a cada 15 minutos
            return (Date.now() - parseInt(lastUpdate)) > this.CONTEXT_UPDATE_INTERVAL;
        } catch (error) {
            logger.error('ErrorCheckingContextUpdate', { threadId, error });
            return true;
        }
    }

    getCurrentCustomerId() {
        return this.currentCustomerId;
    }

    /**
     * Define o serviço WhatsApp após inicialização
     * @param {Object} whatsappService - Serviço de WhatsApp
     */
    setWhatsAppService(whatsappService) {
        this.whatsappService = whatsappService;
    }

    /**
     * Define o serviço de Departamentos após inicialização
     * @param {Object} departmentService - Serviço de Departamentos
     */
    setDepartmentService(departmentService) {
        this.departmentService = departmentService;
    }

    /**
     * Define o serviço Financeiro após inicialização
     * @param {Object} financialService - Serviço Financeiro
     */
    setFinancialService(financialService) {
        this.financialService = financialService;
    }

    async _cacheToolResult(threadId, toolName, args, result) {
        try {
            const context = await this.contextManager.getContext(threadId);
            
            // Inicializa a estrutura de cache de ferramentas se não existir
            if (!context.metadata.toolResults) {
                context.metadata.toolResults = {};
            }

            const cacheKey = `${toolName}:${JSON.stringify(args)}`;
            context.metadata.toolResults[cacheKey] = {
                result,
                timestamp: Date.now()
            };

            await this.contextManager.updateContext(threadId, context);
            logger.info('ToolResultCached', { threadId, toolName, args });
        } catch (error) {
            logger.error('ErrorCachingToolResult', { 
                threadId, 
                toolName, 
                error: error.message 
            });
        }
    }

    async _getCachedToolResult(threadId, toolName, args) {
        try {
            const context = await this.contextManager.getContext(threadId);
            if (!context.metadata.toolResults) {
                return null;
            }

            const cacheKey = `${toolName}:${JSON.stringify(args)}`;
            const cached = context.metadata.toolResults[cacheKey];

            if (!cached) {
                return null;
            }

            // Verifica se o cache ainda é válido (5 minutos)
            const cacheAge = Date.now() - cached.timestamp;
            if (cacheAge > 5 * 60 * 1000) { // 5 minutos em milissegundos
                return null;
            }

            logger.info('ToolResultFromCache', { threadId, toolName, args });
            return cached.result;
        } catch (error) {
            logger.error('ErrorGettingCachedToolResult', { 
                threadId, 
                toolName, 
                error: error.message 
            });
            return null;
        }
    }

    async _checkOrder(args, threadId) {
        try {
            const orderNumber = args.order_number.replace(/[^\d]/g, '');
            
            // Busca o pedido
            const order = await this.nuvemshopService.getOrderByNumber(orderNumber);
            
            if (!order) {
                return {
                    found: false,
                    message: `Pedido ${orderNumber} não encontrado.`
                };
            }

            // Formata a resposta
            const response = {
                found: true,
                id: order.id,
                numeroLimpo: orderNumber,
                numeroOriginal: args.order_number,
                status: order.status,
                rastreio: order.shipping_tracking_number || null
            };

            // Salva no contexto
            if (threadId) {
                const context = await this.contextManager.getContext(threadId);
                if (context) {
                    context.order = {
                        ...response,
                        lastCheck: Date.now()
                    };
                    await this.contextManager.updateContext(threadId, context);
                }
            }

            return response;

        } catch (error) {
            logger.error('ErrorCheckingOrder', { 
                error: error.message,
                orderNumber: args.order_number
            });
            
            return {
                found: false,
                error: true,
                message: 'Erro ao consultar pedido'
            };
        }
    }

    /**
     * Executa uma chamada de ferramenta
     * @private
     * @param {string} name - Nome da ferramenta
     * @param {Object} args - Argumentos da ferramenta
     * @param {string} threadId - ID da thread
     * @returns {Promise<Object>} - Resultado da execução
     */
    async _executeToolCall(name, args, threadId) {
        try {
            logger.info('ExecutingTool', {
                threadId,
                toolName: name,
                args: JSON.stringify(args)
            });

            let result;

            switch (name) {
                case 'check_order':
                    result = await this._checkOrder(args, threadId);
                    break;

                case 'track_order':
                    result = await this._trackOrder(args, threadId);
                    break;

                case 'check_business_hours':
                    result = await this._checkBusinessHours(args);
                    break;

                case 'forward_to_department':
                    result = await this._forwardToDepartment(args, threadId);
                    break;

                case 'forward_to_financial':
                    result = await this._forwardToFinancial(args, threadId);
                    break;

                case 'get_complete_order_info':
                    result = await this._getCompleteOrderInfo(args, threadId);
                    break;

                default:
                    logger.warn('UnknownTool', {
                        threadId,
                        toolName: name
                    });
                    return null;
            }

            logger.info('ToolExecuted', {
                threadId,
                toolName: name,
                success: !!result
            });

            return result;

        } catch (error) {
            logger.error('ErrorExecutingTool', {
                error: error.message,
                threadId,
                toolName: name
            });
            throw error;
        }
    }

    /**
     * Busca informações completas do pedido incluindo rastreio
     * @private
     * @param {Object} args - Argumentos da função
     * @param {string} threadId - ID da thread
     * @returns {Promise<Object>} Informações completas do pedido
     */
    async _getCompleteOrderInfo(args, threadId) {
        try {
            const orderNumber = args.order_number?.trim();
            if (!orderNumber) {
                return {
                    error: true,
                    message: 'Por favor, forneça o número do pedido.'
                };
            }

            // Busca o pedido na Nuvemshop
            const order = await this.nuvemshopService.getOrderByNumber(orderNumber);
            if (!order) {
                return {
                    error: true,
                    message: `Pedido #${orderNumber} não encontrado. Por favor, verifique o número e tente novamente.`
                };
            }

            // Formata os produtos
            const products = order.products.map(p => {
                const variations = p.variant_values ? ` (${p.variant_values.join(', ')})` : '';
                return `▫ ${p.quantity}x ${p.name}${variations} - R$ ${p.price}`;
            }).join('\n');

            // Formata o valor total
            const total = new Intl.NumberFormat('pt-BR', {
                style: 'currency',
                currency: 'BRL'
            }).format(order.total);

            // Monta a resposta base do pedido
            let response = {
                success: true,
                orderNumber: order.number,
                orderInfo: {
                    customer: order.customer.name,
                    date: new Date(order.created_at).toLocaleDateString('pt-BR'),
                    status: order.status,
                    paymentStatus: order.payment_status,
                    total: total,
                    products: products
                }
            };

            // Se tiver código de rastreio, busca informações de entrega
            if (order.shipping_tracking_number) {
                try {
                    const trackingInfo = await this.trackingService.getTrackingStatus(order.shipping_tracking_number);
                    if (trackingInfo) {
                        const lastUpdate = trackingInfo.lastUpdate ? 
                            moment(trackingInfo.lastUpdate).format('DD/MM/YYYY HH:mm') : 
                            'Não disponível';

                        response.tracking = {
                            code: order.shipping_tracking_number,
                            status: trackingInfo.status,
                            location: trackingInfo.location || 'Não disponível',
                            lastUpdate: lastUpdate,
                            description: trackingInfo.description || 'Sem descrição disponível'
                        };

                        // Adiciona os últimos 3 eventos se disponíveis
                        if (trackingInfo.events?.length > 0) {
                            response.tracking.events = trackingInfo.events.slice(0, 3).map(event => ({
                                date: moment(event.date).format('DD/MM/YYYY HH:mm'),
                                status: event.status,
                                location: event.location
                            }));
                        }
                    }
                } catch (error) {
                    logger.error('ErrorTrackingLookup', {
                        error: error.message,
                        orderNumber,
                        trackingCode: order.shipping_tracking_number
                    });
                    // Não falha se o rastreio der erro, apenas indica que não está disponível
                    response.tracking = {
                        code: order.shipping_tracking_number,
                        status: 'Não disponível no momento',
                        error: 'Não foi possível obter informações de rastreio'
                    };
                }
            }

            // Formata a mensagem final
            let message = [
                `🛍 Pedido #${order.number}`,
                '',
                `👤 Cliente: ${response.orderInfo.customer}`,
                `📅 Data: ${response.orderInfo.date}`,
                `📦 Status: ${response.orderInfo.status}`,
                `💰 Valor Total: ${response.orderInfo.total}`,
                '',
                'Produtos:',
                response.orderInfo.products
            ];

            // Adiciona informações de rastreio se disponíveis
            if (response.tracking) {
                message.push(
                    '',
                    '📦 Informações de Entrega',
                    `🔍 Status: ${response.tracking.status}`,
                    `📍 Local: ${response.tracking.location}`,
                    `🕒 Última Atualização: ${response.tracking.lastUpdate}`
                );

                if (response.tracking.events) {
                    message.push(
                        '',
                        '📋 Histórico:'
                    );
                    response.tracking.events.forEach(event => {
                        message.push(
                            `▫️ ${event.date}`,
                            `  ${event.status}`,
                            `  📍 ${event.location}`,
                            ''
                        );
                    });
                }
            }

            response.message = message.join('\n');
            return response;

        } catch (error) {
            logger.error('ErrorGettingOrderInfo', {
                error: error.message,
                stack: error.stack,
                threadId,
                orderNumber: args.order_number
            });
            return {
                error: true,
                message: 'Desculpe, ocorreu um erro ao buscar as informações do pedido. Por favor, tente novamente em alguns instantes.'
            };
        }
    }

    /**
     * Processa mensagem do cliente
     * @param {Object} messageData - Dados da mensagem
     * @returns {Promise<Object>} Resposta do processamento
     */
    async processMessage(messageData) {
        try {
            logger.info('🤖 [Assistant] Iniciando processamento:', {
                customerId: messageData.customerId,
                messageId: messageData.messageId,
                messageLength: messageData.messageText?.length,
                timestamp: new Date().toISOString()
            });

            const threadId = await this._getThreadId(messageData.customerId);
            
            logger.info('🧵 [Assistant] Thread identificada:', {
                threadId,
                isNew: !this.threadCache.has(threadId),
                timestamp: new Date().toISOString()
            });

            // Verifica se há um run ativo
            const activeRun = await this.redisStore.getActiveRun(threadId);
            if (activeRun) {
                logger.info('⏳ [Assistant] Run ativo detectado, enfileirando mensagem:', {
                    threadId,
                    customerId: messageData.customerId,
                    activeRun
                });
                return this.queueMessage(threadId, {
                    content: messageData.messageText
                }, messageData.customerId);
            }

            // Adiciona a mensagem e cria um novo run
            const response = await this.addMessageAndRun(
                threadId, 
                { content: messageData.messageText },
                messageData.customerId
            );

            logger.info('✅ [Assistant] Resposta gerada:', {
                threadId,
                responseLength: response?.length,
                timestamp: new Date().toISOString()
            });

            return response;
        } catch (error) {
            logger.error('❌ [Assistant] Erro ao processar mensagem:', {
                erro: error.message,
                stack: error.stack,
                customerId: messageData.customerId,
                messageId: messageData.messageId,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }
}

module.exports = { OpenAIService };
