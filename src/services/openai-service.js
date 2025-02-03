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
        
        // Rate Limiting - Otimizado para gpt-4o-mini
        this.rateLimitConfig = {
            maxRequestsPerMin: 400, // 500 RPM max, mantendo margem de segurança
            maxRequestsPerDay: 9000, // 10000 RPD max
            maxTokensPerMin: 180000, // 200k TPM max
            windowMs: 60 * 1000, // Janela de 1 minuto
            retryAfter: 5 * 1000, // Reduzido para 5 segundos
            maxTokensPerRequest: 4000, // Limite por requisição para evitar exceder TPM
            batchSize: 5 // Número de mensagens para processar em batch
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
        
        // Define as funções disponíveis para o Assistant
        this.functions = this._getAssistantFunctions();

        console.log('[OpenAI] Serviço inicializado:', {
            assistantId: this.assistantId,
            baseUrl: OPENAI_CONFIG.baseUrl,
            timestamp: new Date().toISOString()
        });
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

    _getAssistantFunctions() {
        return [
            {
                name: "check_order",
                description: "Verifica informações básicas de pedidos como status, pagamento e produtos. NÃO atualiza automaticamente o status de rastreio.",
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
                name: "check_tracking",
                description: "Busca status atualizado de entrega diretamente na transportadora. Use em conjunto com check_order quando precisar de status atualizado.",
                parameters: {
                    type: "object",
                    required: ["tracking_code"],
                    properties: {
                        tracking_code: {
                            type: "string",
                            description: "Código de rastreio (ex: NM123456789BR)"
                        }
                    }
                }
            },
            {
                name: "extract_order_number",
                description: "Identifica números de pedido no texto do cliente. Use antes de check_order para validar números.",
                parameters: {
                    type: "object",
                    required: ["text"],
                    properties: {
                        text: {
                            type: "string",
                            description: "Texto do cliente para extrair número do pedido"
                        }
                    }
                }
            },
            {
                name: "get_business_hours",
                description: "Retorna informações sobre horário de atendimento e disponibilidade",
                parameters: {
                    type: "object",
                    properties: {}
                }
            },
            {
                name: "forward_to_department",
                description: "Encaminha casos para outros departamentos da Loja Ortopedic",
                parameters: {
                    type: "object",
                    required: ["message", "department", "userContact"],
                    properties: {
                        message: {
                            type: "string",
                            description: "Mensagem original do cliente"
                        },
                        department: {
                            type: "string",
                            enum: ["support", "sales", "technical", "shipping", "quality"],
                            description: "Departamento para encaminhamento"
                        },
                        userContact: {
                            type: "string",
                            description: "Contato do cliente (WhatsApp)"
                        },
                        priority: {
                            type: "string",
                            enum: ["low", "normal", "high", "urgent"],
                            default: "normal",
                            description: "Nível de urgência do caso"
                        },
                        reason: {
                            type: "string",
                            description: "Motivo do encaminhamento"
                        },
                        orderNumber: {
                            type: "string",
                            description: "Número do pedido (se disponível)"
                        },
                        trackingCode: {
                            type: "string",
                            description: "Código de rastreio (se disponível)"
                        }
                    }
                }
            },
            {
                name: "request_payment_proof",
                description: "Gerencia todo o fluxo de solicitação e processamento de comprovantes de pagamento",
                parameters: {
                    type: "object",
                    required: ["action", "order_number"],
                    properties: {
                        action: {
                            type: "string",
                            enum: ["request", "validate", "process", "cancel"],
                            description: "Ação a ser executada"
                        },
                        order_number: {
                            type: "string",
                            description: "Número do pedido"
                        },
                        status: {
                            type: "string",
                            enum: ["pending", "processing", "approved", "rejected"],
                            description: "Status do comprovante"
                        },
                        image_url: {
                            type: "string",
                            description: "URL da imagem do comprovante (apenas para action=process)"
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
     */
    async queueMessage(threadId, message) {
        // Valida mensagem antes de enfileirar
        if (!message || (!message.text && !message.content)) {
            throw new Error('Mensagem inválida para enfileiramento');
        }

        const queue = this.messageQueue.get(threadId) || [];
        queue.push({
            text: message.text || message.content,
            timestamp: Date.now()
        });
        this.messageQueue.set(threadId, queue);

        logger.info('MessageQueued', {
            threadId,
            queueLength: queue.length,
            messageText: message.text || message.content
        });
    }

    /**
     * Processa todas as mensagens acumuladas na fila
     * @param {string} threadId - ID da thread
     */
    async processQueuedMessages(threadId) {
        try {
            const messages = this.messageQueue.get(threadId) || [];
            if (!messages.length) return null;

            // Processa mensagens em batch
            const batches = [];
            for (let i = 0; i < messages.length; i += this.rateLimitConfig.batchSize) {
                batches.push(messages.slice(i, i + this.rateLimitConfig.batchSize));
            }

            const responses = [];
            for (const batch of batches) {
                const response = await this._processBatch(threadId, batch);
                if (response) responses.push(response);
            }

            // Limpa a fila após processamento
            this.messageQueue.delete(threadId);
            this.processingTimers.delete(threadId);

            return responses.join('\n');
        } catch (error) {
            logger.error('ErrorProcessingQueuedMessages', {
                threadId,
                error: error.message,
                stack: error.stack
            });
            
            // Limpa estado em caso de erro
            this.messageQueue.delete(threadId);
            this.processingTimers.delete(threadId);
            await this.removeActiveRun(threadId);
            
            throw error;
        }
    }

    /**
     * Processa mensagens em batch para otimizar uso da API
     * @private
     * @param {string} threadId - ID da thread
     * @param {Array} messages - Array de mensagens para processar
     * @returns {Promise<Array>} - Array com respostas processadas
     */
    async _processBatch(threadId, messages) {
        // Estima tokens total do batch
        const estimatedTokens = messages.reduce((total, msg) => {
            return total + (msg.text.length * 1.3); // Estimativa rough de tokens
        }, 0);

        // Verifica rate limit para o batch
        await this._checkRateLimit(threadId, estimatedTokens);

        // Consolida mensagens do batch
        const consolidatedMessage = messages
            .map(msg => msg.text)
            .join('\n---\n');

        // Adiciona mensagem consolidada
        const message = await this.addMessage(threadId, {
            role: 'user',
            content: consolidatedMessage
        });

        // Executa o assistant
        logger.info('RunningAssistant', {
            threadId,
            messageId: message.id,
            timestamp: new Date().toISOString()
        });

        const response = await this.runAssistant(threadId);
        await this.registerActiveRun(threadId, response.id);
        const result = await this.waitForResponse(threadId, response.id);
        await this.removeActiveRun(threadId);

        return result;
    }

    /**
     * Processa mensagem do cliente
     * @param {Object} messageData - Dados da mensagem
     * @returns {Promise<Object>} Resposta do processamento
     */
    async processMessage(messageData) {
        try {
            console.log('🤖 [Assistant] Iniciando processamento:', {
                customerId: messageData.customerId,
                messageId: messageData.messageId,
                messageLength: messageData.messageText?.length,
                timestamp: new Date().toISOString()
            });

            const threadId = await this._getThreadId(messageData.customerId);
            
            console.log('🧵 [Assistant] Thread identificada:', {
                threadId,
                isNew: !this.threadCache.has(threadId),
                timestamp: new Date().toISOString()
            });

            // Adiciona a mensagem ao thread
            const message = await this.client.beta.threads.messages.create(threadId, {
                role: 'user',
                content: messageData.messageText
            });

            console.log('💬 [Assistant] Mensagem adicionada ao thread:', {
                messageId: message.id,
                threadId,
                timestamp: new Date().toISOString()
            });

            // Executa o assistant
            const run = await this.client.beta.threads.runs.create(threadId, {
                assistant_id: this.assistantId
            });

            console.log('🚀 [Assistant] Run iniciado:', {
                runId: run.id,
                threadId,
                status: run.status,
                timestamp: new Date().toISOString()
            });

            // Aguarda a conclusão
            const response = await this._waitForResponse(run, threadId);

            console.log('✅ [Assistant] Resposta gerada:', {
                runId: run.id,
                threadId,
                responseLength: response?.length,
                timestamp: new Date().toISOString()
            });

            return response;
        } catch (error) {
            console.error('❌ [Assistant] Erro ao processar mensagem:', {
                erro: error.message,
                stack: error.stack,
                customerId: messageData.customerId,
                messageId: messageData.messageId,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Processa uma mensagem do cliente para gerar uma resposta personalizada
     * @param {string} customerId - ID do cliente
     * @param {string} message - Mensagem do cliente
     * @returns {Promise<string>} Resposta personalizada
     */
    async processCustomerMessage(customerId, message) {
        const threadId = await this._getThreadId(customerId);
        const response = await this.addMessageAndRun(threadId, message);
        return response;
    }

    async addMessageAndRun(threadId, message) {
        try {
            // Valida parâmetros
            if (!threadId || !message) {
                throw new Error('ThreadId e message são obrigatórios');
            }

            if (!message.messageText && !message.content) {
                throw new Error('Mensagem não pode estar vazia');
            }

            // Adiciona a mensagem à thread
            await this.client.beta.threads.messages.create(
                threadId,
                { 
                    role: 'user', 
                    content: message.messageText || message.content 
                }
            );

            // Cancela qualquer run ativo anterior
            await this.cancelActiveRun(threadId);

            // Executa o assistant e aguarda criação do run
            const run = await this.runAssistant(threadId);
            
            // Verifica se o run foi criado corretamente
            if (!run || !run.id) {
                throw new Error('Run não foi criado corretamente');
            }

            // Aguarda o registro ser confirmado
            const hasRun = await this.hasActiveRun(threadId);
            if (!hasRun) {
                throw new Error('Falha ao registrar run ativo');
            }

            return run;

        } catch (error) {
            logger.error('ErrorAddingMessageAndRun', {
                error: {
                    message: error.message,
                    stack: error.stack
                },
                threadId,
                timestamp: new Date().toISOString()
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

    async runAssistant(threadId) {
        try {
            if (!threadId) {
                throw new Error('ThreadId é obrigatório');
            }

            // Inicia o run
            const run = await this.client.beta.threads.runs.create(
                threadId,
                { assistant_id: this.assistantId }
            );

            if (!run || !run.id) {
                console.error('❌ [OpenAI] Falha ao criar run');
                throw new Error('Run não foi criado corretamente');
            }

            console.log('✨ [OpenAI] Run criado com sucesso:', {
                threadId,
                runId: run.id
            });

            // Registra o run ativo e aguarda o registro
            await this.registerActiveRun(threadId, run.id);

            // Verifica se o registro foi bem sucedido
            const hasRun = await this.hasActiveRun(threadId);
            if (!hasRun) {
                console.error('❌ [OpenAI] Falha ao registrar run ativo');
                throw new Error('Falha ao registrar run ativo');
            }

            return run;
        } catch (error) {
            console.error('❌ [OpenAI] Erro ao executar assistant:', {
                threadId,
                erro: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    async handleToolCalls(run, threadId) {
        if (!run?.required_action?.submit_tool_outputs?.tool_calls) {
            logger.warn('NoToolCalls', { threadId });
            return [];
        }

        const toolCalls = run.required_action.submit_tool_outputs.tool_calls;
        logger.info('ProcessingToolCalls', { threadId, tools: toolCalls.map(t => t.function.name) });
        
        const toolOutputs = [];

        for (const toolCall of toolCalls) {
            const { id, function: { name, arguments: args } } = toolCall;
            logger.info('ExecutingTool', { threadId, tool: name, args });
            
            let parsedArgs;
            try {
                parsedArgs = JSON.parse(args);
            } catch (error) {
                logger.error('ErrorParsingToolArguments', { threadId, tool: name, error });
                continue;
            }

            // Verifica se já temos resultado em cache
            const cachedResult = await this._getCachedToolResult(threadId, name, parsedArgs);
            if (cachedResult) {
                toolOutputs.push({
                    tool_call_id: id,
                    output: JSON.stringify(cachedResult)
                });
                continue;
            }

            let output;
            try {
                switch (name) {
                    case 'check_order':
                        try {
                            output = await this._checkOrder(parsedArgs, threadId);
                        } catch (error) {
                            logger.error('ErrorCheckingOrder', {
                                error: error.message,
                                orderNumber: parsedArgs.order_number
                            });
                            output = { 
                                error: true, 
                                message: 'Desculpe, ocorreu um erro ao consultar o pedido. Por favor, tente novamente em alguns instantes.' 
                            };
                        }
                        break;

                    case 'check_tracking':
                        try {
                            // Se o código vier como placeholder e tivermos um pedido no contexto
                            if (parsedArgs.tracking_code.includes('[código') || parsedArgs.tracking_code.includes('código]')) {
                                if (context.order?.shipping_tracking_number) {
                                    parsedArgs.tracking_code = context.order.shipping_tracking_number;
                                } else {
                                    output = { 
                                        error: true, 
                                        message: 'Não encontrei um código de rastreio válido. Por favor, forneça o código de rastreio do seu pedido.' 
                                    };
                                    break;
                                }
                            }
                            
                            // Limpa o código de rastreio
                            const cleanTrackingCode = parsedArgs.tracking_code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
                            
                            if (!cleanTrackingCode || cleanTrackingCode.length < 8) {
                                output = { 
                                    error: true, 
                                    message: 'O código de rastreio fornecido parece ser inválido. Por favor, verifique e tente novamente.' 
                                };
                                break;
                            }

                            // Busca informações de rastreio
                            const trackingInfo = await this.trackingService.getTrackingStatus(cleanTrackingCode);
                            
                            if (!trackingInfo) {
                                output = { 
                                    error: true, 
                                    message: 'Não foi possível encontrar informações para este código de rastreio. Verifique se o código está correto ou tente novamente mais tarde.' 
                                };
                                break;
                            }

                            // Formata a data da última atualização
                            const lastUpdate = trackingInfo.lastUpdate ? 
                                moment(trackingInfo.lastUpdate).format('DD/MM/YYYY HH:mm') : 
                                'Não disponível';

                            // Pega o emoji apropriado para o status
                            const statusEmoji = TrackingService.STATUS_EMOJIS[trackingInfo.status.toLowerCase()] || '📦';
                            
                            // Monta a mensagem formatada
                            const formattedMessage = [
                                `📦 Rastreamento: ${cleanTrackingCode}`,
                                '',
                                `${statusEmoji} Status: ${trackingInfo.status}`,
                                `📍 Local: ${trackingInfo.location || 'Não disponível'}`,
                                `🕒 Última Atualização: ${lastUpdate}`,
                                `📝 Descrição: ${trackingInfo.description || 'Sem descrição disponível'}`,
                                '',
                                '📋 Histórico:'
                            ];

                            // Adiciona histórico de eventos se disponível
                            if (trackingInfo.events && trackingInfo.events.length > 0) {
                                trackingInfo.events.slice(0, 3).forEach(event => {
                                    const eventDate = moment(event.date).format('DD/MM/YYYY HH:mm');
                                    formattedMessage.push(
                                        `▫️ ${eventDate}`,
                                        `  ${event.status}`,
                                        `  📍 ${event.location}`,
                                        ''
                                    );
                                });
                            } else {
                                formattedMessage.push('Nenhum histórico disponível');
                            }

                            output = {
                                success: true,
                                tracking_code: cleanTrackingCode,
                                status: trackingInfo.status,
                                last_update: lastUpdate,
                                location: trackingInfo.location,
                                events: trackingInfo.events,
                                message: formattedMessage.join('\n')
                            };
                            
                        } catch (error) {
                            console.error('[OpenAI] Erro ao consultar rastreamento:', error);
                            output = { 
                                error: true, 
                                message: 'Erro ao consultar rastreamento',
                                details: error.message
                            };
                        }
                        break;

                    case 'get_business_hours':
                        try {
                            const businessHours = await this.businessHoursService.getBusinessHours();
                            const isHoliday = await this.businessHoursService.isHoliday();
                            
                            // Monta a mensagem de status atual
                            const statusMessage = businessHours.isOpen ? 
                                '🟢 Estamos em horário de atendimento!' : 
                                '🔴 Estamos fora do horário de atendimento.';

                            // Monta a mensagem com os horários
                            const scheduleLines = ['📅 Nossos horários de atendimento:'];
                            
                            for (const [day, hours] of Object.entries(businessHours.schedule)) {
                                const emoji = hours === 'Fechado' ? '❌' : '✅';
                                scheduleLines.push(`${emoji} ${day}: ${hours}`);
                            }

                            // Adiciona informação de feriado se for o caso
                            const holidayMessage = isHoliday ? 
                                '\n⚠️ Hoje é feriado, não teremos atendimento.' : '';

                            // Monta a mensagem completa
                            const message = [
                                statusMessage,
                                holidayMessage,
                                '',
                                ...scheduleLines,
                                '',
                                `⏰ Horário de Brasília (${businessHours.timezone})`
                            ].join('\n');

                            output = {
                                success: true,
                                isOpen: businessHours.isOpen,
                                isHoliday,
                                schedule: businessHours.schedule,
                                timezone: businessHours.timezone,
                                message
                            };

                        } catch (error) {
                            logger.error('ErrorGettingBusinessHours', {
                                error: error.message,
                                stack: error.stack
                            });
                            output = {
                                error: true,
                                message: 'Desculpe, ocorreu um erro ao consultar nosso horário de atendimento. Por favor, tente novamente em alguns instantes.'
                            };
                        }
                        break;

                    case 'extract_order_number':
                        try {
                            const { text } = parsedArgs;
                            if (!text) {
                                output = {
                                    error: true,
                                    message: 'Por favor, forneça o texto para extrair o número do pedido.'
                                };
                                break;
                            }

                            // Tenta extrair o número do pedido usando o OrderValidationService
                            const result = await this.orderValidationService.extractOrderNumber(text);
                            
                            if (result.error) {
                                output = {
                                    error: true,
                                    message: result.error
                                };
                                break;
                            }

                            if (!result.orderNumber) {
                                let message = 'Não consegui identificar um número de pedido válido no texto.';
                                if (result.details?.suggestions?.length > 0) {
                                    message += '\n\nVocê quis dizer um destes números?\n';
                                    result.details.suggestions.forEach(suggestion => {
                                        message += `- #${suggestion}\n`;
                                    });
                                } else {
                                    message += '\n\nUm número de pedido válido deve ter pelo menos 4 dígitos.';
                                }

                                output = {
                                    error: true,
                                    message
                                };
                                break;
                            }

                            output = {
                                success: true,
                                orderNumber: result.orderNumber,
                                isImage: result.isImage || false,
                                details: result.details || null,
                                message: `Número do pedido encontrado: #${result.orderNumber}`
                            };

                        } catch (error) {
                            logger.error('ErrorExtractingOrderNumber', {
                                error: error.message,
                                stack: error.stack
                            });
                            output = {
                                error: true,
                                message: 'Desculpe, ocorreu um erro ao tentar extrair o número do pedido. Por favor, tente novamente.'
                            };
                        }
                        break;

                    case 'request_payment_proof':
                        try {
                            const { orderNumber } = parsedArgs;
                            if (!orderNumber) {
                                output = {
                                    error: true,
                                    message: 'Por favor, forneça o número do pedido para solicitar o comprovante.'
                                };
                                break;
                            }

                            // Busca o pedido na Nuvemshop
                            const order = await this.nuvemshopService.getOrderByNumber(orderNumber);
                            if (!order) {
                                output = {
                                    error: true,
                                    message: `Pedido #${orderNumber} não encontrado. Por favor, verifique o número e tente novamente.`
                                };
                                break;
                            }

                            // Verifica status do pedido
                            if (order.payment_status === 'paid') {
                                output = {
                                    error: true,
                                    message: `O pedido #${orderNumber} já está marcado como pago. Não é necessário enviar comprovante.`
                                };
                                break;
                            }

                            if (order.status === 'cancelled') {
                                output = {
                                    error: true,
                                    message: `O pedido #${orderNumber} está cancelado. Se deseja reativá-lo, por favor entre em contato com nosso suporte.`
                                };
                                break;
                            }

                            // Formata a mensagem de solicitação
                            const paymentMethods = order.payment_details?.map(p => p.method)?.join(', ') || 'Pix';
                            const totalAmount = new Intl.NumberFormat('pt-BR', { 
                                style: 'currency', 
                                currency: 'BRL' 
                            }).format(order.total);

                            const message = [
                                `📝 Instruções para envio do comprovante do pedido #${orderNumber}:`,
                                '',
                                `💰 Valor total: ${totalAmount}`,
                                `💳 Forma de pagamento: ${paymentMethods}`,
                                '',
                                '📱 Como enviar:',
                                '1. Tire um print ou foto clara do comprovante',
                                '2. Envie a imagem aqui mesmo neste chat',
                                '',
                                '⚠️ Importante:',
                                '• A imagem deve mostrar claramente o valor e a data',
                                '• O comprovante deve ser do valor total do pedido',
                                '• Envie apenas uma imagem por vez',
                                '',
                                '✅ Assim que recebermos, nossa equipe irá analisar e confirmar o pagamento.'
                            ].join('\n');

                            output = {
                                success: true,
                                orderNumber,
                                paymentMethods,
                                totalAmount: order.total,
                                message
                            };

                        } catch (error) {
                            logger.error('ErrorRequestingPaymentProof', {
                                error: error.message,
                                stack: error.stack,
                                orderNumber: parsedArgs.orderNumber
                            });
                            output = {
                                error: true,
                                message: 'Desculpe, ocorreu um erro ao processar sua solicitação. Por favor, tente novamente em alguns instantes.'
                            };
                        }
                        break;

                    case 'forward_to_department':
                        try {
                            const { message: userMessage, department, userContact, priority, reason } = parsedArgs;
                            
                            // Validações básicas
                            if (!userMessage) {
                                output = {
                                    error: true,
                                    message: 'É necessário fornecer a mensagem para encaminhar ao departamento.'
                                };
                                break;
                            }

                            if (!department) {
                                output = {
                                    error: true,
                                    message: 'É necessário especificar o departamento.'
                                };
                                break;
                            }

                            if (!userContact) {
                                output = {
                                    error: true,
                                    message: 'É necessário fornecer o contato do usuário.'
                                };
                                break;
                            }

                            // Normaliza o departamento
                            const validDepartments = [
                                'support',
                                'sales',
                                'technical',
                                'shipping',
                                'quality'
                            ];

                            const normalizedDepartment = department.toLowerCase();
                            if (!validDepartments.includes(normalizedDepartment)) {
                                output = {
                                    error: true,
                                    message: `Departamento inválido. Use um dos seguintes: ${validDepartments.join(', ')}`
                                };
                                break;
                            }

                            // Normaliza a prioridade
                            const normalizedPriority = priority?.toLowerCase() || 'normal';
                            if (!['low', 'normal', 'high', 'urgent'].includes(normalizedPriority)) {
                                output = {
                                    error: true,
                                    message: 'Prioridade inválida. Use: low, normal, high ou urgent.'
                                };
                                break;
                            }

                            // Prepara os dados para encaminhamento
                            const caseData = {
                                timestamp: moment().format(),
                                department: normalizedDepartment,
                                contact: {
                                    phone: userContact,
                                    type: 'whatsapp'
                                },
                                message: userMessage,
                                priority: normalizedPriority,
                                reason: reason || 'general',
                                source: 'chatbot',
                                withinBusinessHours: this.businessHoursService.isWithinBusinessHours(),
                                metadata: {
                                    threadId: threadId || null,
                                    aiConfidence: parsedArgs.confidence || 1.0
                                }
                            };

                            // Encaminha para o departamento
                            await this.departmentService.forwardCase(caseData);

                            // Prepara resposta para o usuário
                            const departmentNames = {
                                support: 'Suporte',
                                sales: 'Vendas',
                                technical: 'Técnico',
                                shipping: 'Logística',
                                quality: 'Qualidade'
                            };

                            const responses = {
                                support: '✅ Recebemos sua solicitação! Nossa equipe de suporte foi notificada e está pronta para te ajudar da melhor forma possível.',
                                sales: '✅ Ótimo! Nossa equipe de vendas foi notificada e irá te auxiliar com todas as informações necessárias.',
                                technical: '✅ Entendi! Nossa equipe técnica especializada foi notificada e irá analisar sua solicitação com todo cuidado.',
                                shipping: '✅ Recebemos seu contato! Nossa equipe de logística foi notificada e irá cuidar da sua solicitação com prioridade.',
                                quality: '✅ Agradecemos seu contato! Nossa equipe de qualidade foi notificada e irá analisar sua solicitação detalhadamente.'
                            };

                            // Adiciona tempo de resposta estimado baseado na prioridade
                            const slaMessages = {
                                urgent: 'Pode ficar tranquilo(a), sua solicitação receberá prioridade máxima de nossa equipe. 🚀',
                                high: 'Sua solicitação será tratada com prioridade por nossa equipe especializada. ⭐',
                                normal: 'Nossa equipe retornará o contato em até 24 horas úteis para te ajudar. 📅',
                                low: 'Nossa equipe retornará o contato em até 48 horas úteis para auxiliar você. 📅'
                            };

                            // Monta a mensagem completa
                            const responseMessage = [
                                responses[normalizedDepartment],
                                '',
                                slaMessages[normalizedPriority],
                                '',
                                '💫 Fique tranquilo(a)! Nossa equipe está comprometida em resolver sua solicitação da melhor forma possível.',
                                '🤝 Estamos aqui para ajudar e garantir sua satisfação.'
                            ].join('\n');

                            output = {
                                success: true,
                                caseId: caseData.id,
                                department: departmentNames[normalizedDepartment],
                                priority: normalizedPriority,
                                message: responseMessage
                            };

                        } catch (error) {
                            logger.error('ErrorForwardingToDepartment', {
                                error: error.message,
                                stack: error.stack,
                                args: parsedArgs
                            });
                            output = {
                                error: true,
                                message: 'Desculpe, ocorreu um erro ao encaminhar sua mensagem. Por favor, tente novamente em alguns instantes.'
                            };
                        }
                        break;

                    default:
                        throw new Error(`Função desconhecida: ${name}`);
                }

                if (output !== undefined) {
                    // Armazena resultado no cache
                    await this._cacheToolResult(threadId, name, parsedArgs, output);
                    
                    toolOutputs.push({
                        tool_call_id: id,
                        output: JSON.stringify(output)
                    });
                }
            } catch (error) {
                logger.error('ErrorExecutingTool', { 
                    threadId, 
                    tool: name, 
                    error: error.message,
                    stack: error.stack 
                });
            }
        }

        if (toolOutputs.length > 0) {
            try {
                await this.client.beta.threads.runs.submitToolOutputs(
                    threadId,
                    run.id,
                    { tool_outputs: toolOutputs }
                );
                logger.info('ToolOutputsSubmitted', { 
                    threadId,
                    runId: run.id,
                    outputCount: toolOutputs.length
                });
            } catch (error) {
                logger.error('ErrorSubmittingToolOutputs', {
                    threadId,
                    runId: run.id,
                    error: error.message,
                    stack: error.stack
                });
                throw error;
            }
        }

        return toolOutputs;
    }

    /**
     * Aguarda a resposta do assistant com retry e timeout
     * @private
     * @param {string} run - Objeto de run
     * @param {string} threadId - ID da thread
     * @returns {Promise<string>} Resposta do assistant
     */
    async _waitForResponse(run, threadId) {
        let attempts = 0;
        let toolCallCount = 0;
        const toolCallHistory = new Set();

        while (attempts < 8) {
            try {
                attempts++;
                const runStatus = await this.client.beta.threads.runs.retrieve(threadId, run.id);

                if (runStatus.status === 'completed') {
                    return runStatus;
                }

                if (runStatus.status === 'requires_action') {
                    const toolCalls = runStatus.required_action.submit_tool_outputs.tool_calls;
                    
                    // Verifica chamadas repetidas
                    for (const call of toolCalls) {
                        const callKey = `${call.function.name}:${call.function.arguments}`;
                        if (toolCallHistory.has(callKey)) {
                            logger.warn('ChamadaRepetidaDetectada', {
                                threadId,
                                runId: run.id,
                                toolName: call.function.name
                            });
                            continue;
                        }
                        toolCallHistory.add(callKey);
                        toolCallCount++;
                    }

                    // Verifica limite de chamadas
                    if (toolCallCount > 5) {
                        throw new Error('Número máximo de chamadas de ferramentas excedido');
                    }

                    // Processa chamadas de ferramentas
                    const outputs = await this._processToolCalls(runStatus.required_action.submit_tool_outputs.tool_calls, threadId);
                    
                    if (outputs && outputs.length > 0) {
                        await this.client.beta.threads.runs.submitToolOutputs(
                            threadId,
                            run.id,
                            { tool_outputs: outputs }
                        );
                    }
                }

                if (runStatus.status === 'failed') {
                    throw new Error(`Run falhou: ${runStatus.last_error?.message || 'Erro desconhecido'}`);
                }

                // Espera antes da próxima tentativa
                await new Promise(resolve => setTimeout(resolve, 1500));

            } catch (error) {
                logger.warn('ErroAguardandoResposta', {
                    threadId,
                    runId: run.id,
                    attempt: attempts,
                    error: error.message
                });

                if (attempts >= 8) {
                    throw new Error(`Erro ao aguardar resposta após ${attempts} tentativas: ${error.message}`);
                }

                // Espera antes de tentar novamente
                await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
            }
        }
    }

    /**
     * Processa chamadas de ferramentas
     * @private
     * @param {Array} toolCalls - Array de chamadas de ferramentas
     * @param {string} threadId - ID da thread
     * @returns {Promise<Array>} - Array de respostas das chamadas de ferramentas
     */
    async _processToolCalls(toolCalls, threadId) {
        try {
            const outputs = [];
            const processedCalls = new Set();

            for (const toolCall of toolCalls) {
                const { name, arguments: args } = toolCall.function;
                const callKey = `${name}:${args}`;

                // Evita processar a mesma chamada duas vezes
                if (processedCalls.has(callKey)) {
                    continue;
                }
                processedCalls.add(callKey);

                // Verifica cache
                const cachedResult = await this._getCachedToolResult(threadId, name, JSON.parse(args));
                if (cachedResult) {
                    outputs.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify(cachedResult)
                    });
                    continue;
                }

                // Processa chamada
                const result = await this._executeToolCall(name, JSON.parse(args), threadId);
                
                if (result) {
                    outputs.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify(result)
                    });
                    
                    // Cache do resultado
                    await this._cacheToolResult(threadId, name, JSON.parse(args), result);
                }
            }

            return outputs;

        } catch (error) {
            logger.error('ErrorProcessingToolCalls', {
                error: error.message,
                threadId
            });
            throw error;
        }
    }

    /**
     * Adiciona mensagem e executa o assistant
     * @param {string} threadId - ID da thread
     * @param {string|Object} message - Mensagem para adicionar
     * @returns {Promise<string>} Resposta do assistant
     */
    async addMessageAndRun(threadId, message) {
        try {
            // Valida parâmetros
            if (!threadId || !message) {
                throw new Error('ThreadId e message são obrigatórios');
            }

            if (!message.messageText && !message.content) {
                throw new Error('Mensagem não pode estar vazia');
            }

            // Adiciona a mensagem à thread
            await this.client.beta.threads.messages.create(
                threadId,
                { 
                    role: 'user', 
                    content: message.messageText || message.content 
                }
            );

            // Cancela qualquer run ativo anterior
            await this.cancelActiveRun(threadId);

            // Executa o assistant e aguarda criação do run
            const run = await this.runAssistant(threadId);
            
            // Verifica se o run foi criado corretamente
            if (!run || !run.id) {
                throw new Error('Run não foi criado corretamente');
            }

            // Aguarda o registro ser confirmado
            const hasRun = await this.hasActiveRun(threadId);
            if (!hasRun) {
                throw new Error('Falha ao registrar run ativo');
            }

            return run;

        } catch (error) {
            logger.error('ErrorAddingMessageAndRun', {
                error: {
                    message: error.message,
                    stack: error.stack
                },
                threadId,
                timestamp: new Date().toISOString()
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
                return ` Não encontrei o pedido #${orderNumber}. Por favor, verifique se o número está correto.`;
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
}

module.exports = { OpenAIService };
