const OpenAI = require('openai');
const moment = require('moment-timezone');
const logger = require('../utils/logger');
const { RedisStore } = require('../store/redis-store');
const { OPENAI_CONFIG } = require('../config/settings');
const { TrackingService } = require('./tracking-service');
const { BusinessHoursService } = require('./business-hours');
const { OrderValidationService } = require('./order-validation-service');
const { NuvemshopService } = require('./nuvemshop-service');
const { FinancialService } = require('./financial-service');
const { DepartmentService } = require('./department-service'); // Adicionado DepartmentService

class OpenAIService {
    /**
     * @param {NuvemshopService} nuvemshopService - Serviço de integração com a Nuvemshop
     * @param {TrackingService} trackingService - Serviço de tracking
     * @param {BusinessHoursService} businessHoursService - Serviço de horário de atendimento
     * @param {OrderValidationService} orderValidationService - Serviço de validação de pedidos
     * @param {FinancialService} financialService - Serviço financeiro
     * @param {DepartmentService} departmentService - Serviço de departamentos // Adicionado DepartmentService
     * @param {Object} whatsappService - Serviço de WhatsApp (injetado para evitar dependência circular)
     */
    constructor(nuvemshopService, trackingService, businessHoursService, orderValidationService, financialService, departmentService, whatsappService) {
        this.client = new OpenAI({
            apiKey: OPENAI_CONFIG.apiKey,
            baseURL: OPENAI_CONFIG.baseUrl
        });
        this.assistantId = OPENAI_CONFIG.assistantId;
        this.redisStore = new RedisStore(); // Redis para controlar runs ativos
        
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

        // Serviços injetados
        this.nuvemshopService = nuvemshopService;
        this.trackingService = trackingService;
        this.businessHoursService = businessHoursService;
        this.orderValidationService = orderValidationService;
        this.financialService = financialService;
        this.departmentService = departmentService;
        this.whatsappService = whatsappService;

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
            const key = `thread:${threadId}`;
            await this.redisStore.set(key, JSON.stringify(thread));
            logger.info('ThreadPersistedToRedis', { threadId });
        } catch (error) {
            logger.error('ErrorPersistingThread', {
                threadId,
                error: error.message
            });
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
            const key = `thread:${threadId}`;
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
                name: "forward_to_financial",
                description: "Encaminha casos para análise do setor financeiro (pagamento, reembolso, taxação, etc)",
                parameters: {
                    type: "object",
                    required: ["reason", "customer_message", "priority"],
                    properties: {
                        order_number: {
                            type: "string",
                            description: "Número do pedido (se disponível)"
                        },
                        tracking_code: {
                            type: "string",
                            description: "Código de rastreio (se disponível)"
                        },
                        reason: {
                            type: "string",
                            enum: [
                                "payment",           // Problema com pagamento
                                "refund",            // Solicitação de reembolso
                                "taxation",          // Questões de impostos
                                "customs",           // Retenção na alfândega
                                "payment_proof",     // Comprovante de pagamento
                                "other"              // Outros motivos
                            ],
                            description: "Motivo do encaminhamento"
                        },
                        customer_message: {
                            type: "string",
                            description: "Mensagem original do cliente"
                        },
                        priority: {
                            type: "string",
                            enum: ["high", "medium", "low"],
                            description: "Nível de urgência"
                        },
                        additional_info: {
                            type: "string",
                            description: "Informações adicionais relevantes"
                        }
                    }
                }
            },
            {
                name: "forward_to_department",
                description: "Encaminha casos para outros departamentos da Loja Ortopedic",
                parameters: {
                    type: "object",
                    required: ["department", "reason", "customer_message", "priority"],
                    properties: {
                        department: {
                            type: "string",
                            enum: ["support", "technical", "logistics", "commercial"],
                            description: "Departamento para encaminhamento"
                        },
                        order_number: {
                            type: "string",
                            description: "Número do pedido (se disponível)"
                        },
                        tracking_code: {
                            type: "string",
                            description: "Código de rastreio (se disponível)"
                        },
                        reason: {
                            type: "string",
                            description: "Motivo do encaminhamento"
                        },
                        customer_message: {
                            type: "string",
                            description: "Mensagem original do cliente"
                        },
                        priority: {
                            type: "string",
                            enum: ["high", "medium", "low"],
                            description: "Nível de urgência do caso"
                        },
                        additional_info: {
                            type: "string",
                            description: "Informações adicionais relevantes"
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
        const run = await this.runAssistant(threadId);
        await this.registerActiveRun(threadId, run.id);
        const response = await this.waitForResponse(threadId, run.id);
        await this.removeActiveRun(threadId);

        return response;
    }

    /**
     * Processa mensagem do cliente
     * @param {string} customerId ID do cliente
     * @param {Object} message Mensagem a ser processada
     * @returns {Promise<Object>} Resposta do processamento
     */
    async processMessage(customerId, messageText, timestamp) {
        try {
            console.log('[OpenAI] Processando mensagem:', {
                customerId,
                messageText,
                timestamp
            });

            // 1. Obtém ou cria thread
            const threadId = await this.getOrCreateThreadForCustomer(customerId);
            
            // 2. Verifica se é um comando
            if (messageText.startsWith('#')) {
                const handled = await this.handleCommand(customerId, messageText);
                if (handled) return null;
            }

            // 3. Verifica run ativo
            if (await this.hasActiveRun(threadId)) {
                this.queueMessage(threadId, {
                    role: "user",
                    content: messageText
                });
                return "⏳ Aguarde um momento enquanto processo sua mensagem anterior...";
            }

            // 4. Adiciona mensagem e executa
            return await this.addMessageAndRun(threadId, {
                role: "user",
                content: messageText
            });

        } catch (error) {
            logger.error('ErrorProcessingMessage', { customerId, error });
            if (error.code === 'rate_limit_exceeded') {
                return "⏳ Sistema está muito ocupado. Por favor, aguarde alguns segundos e tente novamente.";
            }
            return "Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente.";
        }
    }

    async addMessageAndRun(threadId, message) {
        try {
            // Não processa mensagens vazias
            if (!message.content) {
                logger.warn('EmptyMessage', { threadId });
                return null;
            }

            // Evita processar a mesma mensagem múltiplas vezes
            const lastMessage = await this.getLastMessage(threadId);
            if (lastMessage?.content === message.content) {
                logger.warn('DuplicateMessage', { 
                    threadId,
                    content: message.content 
                });
                return;
            }

            // Adiciona a mensagem
            const createdMessage = await this.client.beta.threads.messages.create(
                threadId,
                message
            );

            logger.info('MessageCreated', { 
                metadata: {
                    messageId: createdMessage.id,
                    threadId,
                    service: 'ortopedic-bot'
                }
            });

            // Executa o assistant e retorna a resposta
            const response = await this.runAssistant(threadId);
            return response;

        } catch (error) {
            logger.error('ErrorAddingMessage', { threadId, error });
            throw error;
        }
    }

    async getLastMessage(threadId) {
        try {
            const messages = await this.client.beta.threads.messages.list(threadId, {
                limit: 1,
                order: 'desc'
            });
            return messages.data[0];
        } catch (error) {
            logger.error('ErrorGettingLastMessage', { threadId, error });
            return null;
        }
    }

    async runAssistant(threadId) {
        try {
            // Cria e aguarda o run
            const run = await this.client.beta.threads.runs.create(threadId, {
                assistant_id: this.assistantId
            });

            // Aguarda a resposta
            const response = await this.waitForResponse(threadId, run.id);
            return response;

        } catch (error) {
            if (error.code === 'rate_limit_exceeded') {
                logger.warn('RateLimitExceeded', { threadId });
                throw error;
            }
            logger.error('ErrorRunningAssistant', { threadId, error });
            throw error;
        }
    }

    /**
     * Envia resposta ao cliente
     * @param {string} customerId ID do cliente
     * @param {string} response Resposta a ser enviada
     */
    async sendResponse(customerId, response) {
        try {
            if (!response) return;

            if (!this.whatsappService) {
                throw new Error('WhatsAppService não inicializado');
            }

            await this.whatsappService.sendText(customerId, response);
        } catch (error) {
            logger.error('ErrorSendingResponse', {
                error: { customerId, error: error.message }
            });
        }
    }

    /**
     * Cria um novo thread
     * @returns {Promise<Object>} Thread criado
     */
    async createThread() {
        try {
            const thread = await this.client.beta.threads.create();
            logger.info('NewThreadCreated', { threadId: thread.id });
            console.log(' Novo thread criado:', {
                threadId: thread.id,
                timestamp: new Date().toISOString()
            });
            return thread;
        } catch (error) {
            logger.error('ErrorCreatingThread', { error });
            console.error('[OpenAI] Erro ao criar thread:', error);
            throw error;
        }
    }

    /**
     * Adiciona uma mensagem ao thread e executa o assistant
     * @param {string} threadId - ID do thread
     * @param {Object} message - Mensagem a ser adicionada
     * @returns {Promise<Object>} Resultado da execução
     */
    async addMessageAndRun(threadId, message) {
        try {
            logger.info('AddingMessage', { 
                metadata: {
                    contentType: typeof message.content,
                    role: message.role,
                    threadId,
                    service: 'ortopedic-bot'
                }
            });

            // Verifica se a mensagem já não é uma resposta do assistant
            if (message.role === 'user' && message.content === this.lastAssistantResponse) {
                logger.warn('SkippingDuplicateMessage', { 
                    threadId,
                    content: message.content 
                });
                return;
            }

            console.log('[OpenAI] Adicionando mensagem:', {
                threadId,
                role: message.role,
                contentType: typeof message.content
            });

            const createdMessage = await this.client.beta.threads.messages.create(
                threadId,
                message
            );

            console.log('[OpenAI] Mensagem adicionada com sucesso:', {
                threadId,
                messageId: createdMessage.id
            });

            logger.info('MessageCreated', { 
                metadata: {
                    messageId: createdMessage.id,
                    threadId,
                    service: 'ortopedic-bot'
                }
            });

            const response = await this.runAssistant(threadId);
            this.lastAssistantResponse = response; // Guarda a última resposta
            return response;
        } catch (error) {
            logger.error('ErrorAddingMessage', { threadId, error });
            throw error;
        }
    }

    /**
     * Verifica o status de um run
     * @param {string} threadId - ID do thread
     * @param {string} runId - ID do run
     * @returns {Promise<Object>} Status do run
     */
    async checkRunStatus(threadId, runId) {
        try {
            return await this.client.beta.threads.runs.retrieve(threadId, runId);
        } catch (error) {
            logger.error('ErrorCheckingRunStatus', { threadId, runId, error });
            console.error('[OpenAI] Erro ao verificar status:', error);
            throw error;
        }
    }

    /**
     * Lista as mensagens de um thread
     * @param {string} threadId - ID do thread
     * @returns {Promise<Object>} Lista de mensagens
     */
    async listMessages(threadId) {
        try {
            return await this.client.beta.threads.messages.list(threadId);
        } catch (error) {
            logger.error('ErrorListingMessages', { threadId, error });
            console.error('[OpenAI] Erro ao listar mensagens:', error);
            throw error;
        }
    }

    /**
     * Aguarda a resposta do assistant
     * @param {string} threadId - ID da thread
     * @param {string} runId - ID do run
     * @returns {Promise<string>} Resposta do assistant
     */
    async waitForResponse(threadId, runId) {
        try {
            let run = await this.checkRunStatus(threadId, runId);
            
            while (run.status === 'queued' || run.status === 'in_progress') {
                await new Promise(resolve => setTimeout(resolve, 1000));
                run = await this.checkRunStatus(threadId, runId);
            }

            if (run.status === 'requires_action') {
                logger.info('RunRequiresAction', { threadId, runId });
                console.log('[OpenAI] Ação requerida, processando tool calls...');
                
                if (run.required_action?.type === 'submit_tool_outputs') {
                    const toolCalls = run.required_action.submit_tool_outputs.tool_calls;
                    logger.info('ProcessingToolCalls', { threadId, tools: toolCalls.map(t => t.function.name) });
                    console.log('[OpenAI] Processando tool calls:', toolCalls.map(t => t.function.name));
                    
                    const toolOutputs = await this.handleToolCalls(run, threadId);
                    
                    await this.client.beta.threads.runs.submitToolOutputs(
                        threadId,
                        runId,
                        { tool_outputs: toolOutputs }
                    );
                    
                    return await this.waitForResponse(threadId, runId);
                }
            }

            if (run.status === 'completed') {
                const messages = await this.client.beta.threads.messages.list(threadId);
                if (messages.data && messages.data.length > 0) {
                    const content = messages.data[0].content[0];
                    if (content && content.text && typeof content.text.value === 'string') {
                        logger.info('AssistantResponse', { threadId, response: content.text.value });
                        console.log('[OpenAI] Resposta extraída:', content.text.value);
                        return content.text.value;
                    }
                    logger.error('ErrorExtractingAssistantResponse', { threadId, error: 'Unexpected message structure' });
                    console.error('[OpenAI] Estrutura da mensagem inesperada:', messages.data[0]);
                    throw new Error('Não foi possível extrair a resposta da mensagem');
                }
                throw new Error('Não foi possível extrair a resposta da mensagem');
            }

            if (run.status === 'failed') {
                logger.error('RunFailed', { threadId, runId, error: run.last_error });
                console.error('[OpenAI] Run falhou:', run.last_error);
                throw new Error(`Run falhou: ${run.last_error?.message || 'Erro desconhecido'}`);
            }

            if (run.status === 'cancelled' || run.status === 'expired') {
                logger.error('RunCancelledOrExpired', { threadId, runId, status: run.status });
                console.error('[OpenAI] Run cancelado ou expirado:', run.status);
                throw new Error(`Run cancelado ou expirado: ${run.status}`);
            }

            throw new Error(`Run terminou com status inesperado: ${run.status}`);
            
        } catch (error) {
            logger.error('ErrorWaitingForResponse', { threadId, runId, error });
            console.error('[OpenAI] Erro ao aguardar resposta:', error);
            await this.removeActiveRun(threadId); // Garante remoção do run em caso de erro
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
        const context = {};

        for (const toolCall of toolCalls) {
            const { name, arguments: args } = toolCall.function;
            logger.info('ExecutingTool', { threadId, tool: name, args });
            
            let parsedArgs;
            try {
                parsedArgs = JSON.parse(args);
            } catch (error) {
                logger.error('ErrorParsingToolArguments', { threadId, tool: name, error });
                continue;
            }

            let output;
            try {
                switch (name) {
                    case 'check_order':
                        output = await this.nuvemshopService.getOrderByNumber(parsedArgs.order_number);
                        if (!output) {
                            output = { error: true, message: 'Pedido não encontrado' };
                        } else {
                            // Salva informações do pedido no contexto
                            context.order = output;
                            // Adiciona tracking_code ao output para facilitar o check_tracking
                            output.tracking_code = output.shipping_tracking_number;
                            
                            // Formata a saída usando o template de pedido
                            const formattedOutput = `🛍️ Detalhes do Pedido #${output.number}\n\n` +
                                `📦 Status: ${output.status}\n` +
                                `💰 Status Pagamento: ${output.payment_status}\n` +
                                `📬 Status Envio: ${output.shipping_status}\n\n` +
                                `Produtos:\n${output.products.map(p => 
                                    `▫️ ${p.quantity}x ${p.name} - R$ ${p.price}`
                                ).join('\n')}`;
                            
                            output = {
                                ...output,
                                shipping_tracking_number: output.shipping_tracking_number,
                                formatted: formattedOutput,
                                message: formattedOutput // Para compatibilidade
                            };
                        }
                        break;

                    case 'check_tracking':
                        // Verifica se é um placeholder
                        if (parsedArgs.tracking_code.includes('[código de rastreio')) {
                            // Tenta usar o código do pedido do contexto
                            if (context.order?.shipping_tracking_number) {
                                parsedArgs.tracking_code = context.order.shipping_tracking_number;
                            } else {
                                output = { error: true, message: 'Código de rastreio inválido' };
                                break;
                            }
                        }
                        
                        // Remove caracteres especiais e espaços
                        const cleanTrackingCode = parsedArgs.tracking_code.trim().replace(/[^a-zA-Z0-9]/g, '');
                        
                        try {
                            // Força atualização do rastreamento
                            const trackingInfo = await this.trackingService.getTrackingInfo(cleanTrackingCode, true);
                            
                            // Formata a saída usando o template de rastreamento
                            const statusEmoji = this.trackingService.STATUS_EMOJIS[trackingInfo.status] || '📦';
                            const formattedTracking = `📦 Status do Rastreamento ${statusEmoji}\n\n` +
                                `🔍 Status: ${trackingInfo.status}\n` +
                                `📝 Detalhes: ${trackingInfo.sub_status || 'N/A'}\n` +
                                `📅 Última Atualização: ${trackingInfo.last_event?.time || 'N/A'}`;
                            
                            output = {
                                ...trackingInfo,
                                tracking_code: cleanTrackingCode,
                                status_emoji: statusEmoji,
                                formatted: formattedTracking,
                                message: formattedTracking // Para compatibilidade
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
                        output = parsedArgs.type === 'full' ? 
                            await this.businessHoursService.getAllHours() :
                            await this.businessHoursService.getCurrentStatus();
                        break;

                    case 'extract_order_number':
                        const orderNumber = await this.orderValidationService.extractOrderNumber(
                            parsedArgs.text,
                            parsedArgs.strict || false
                        );
                        output = { order_number: orderNumber };
                        break;

                    case 'request_payment_proof':
                        switch (parsedArgs.action) {
                            case 'request':
                                await this.redisStore.set(`openai:waiting_order:${threadId}`, 'payment_proof');
                                await this.redisStore.set(`openai:pending_order:${threadId}`, parsedArgs.order_number);
                                output = { status: 'waiting', message: 'Aguardando comprovante' };
                                break;
                            
                            case 'validate':
                                const orderStatus = await this.nuvemshopService.getOrderPaymentStatus(parsedArgs.order_number);
                                output = {
                                    valid: orderStatus === 'paid',
                                    status: orderStatus,
                                    message: orderStatus === 'paid' ? 
                                        'Pagamento confirmado' : 
                                        'Pagamento pendente'
                                };
                                break;

                            case 'cancel':
                                await this.redisStore.del(`openai:waiting_order:${threadId}`);
                                await this.redisStore.del(`openai:pending_order:${threadId}`);
                                output = { status: 'cancelled', message: 'Solicitação cancelada' };
                                break;

                            default:
                                throw new Error(`Ação inválida: ${parsedArgs.action}`);
                        }
                        break;

                    case 'forward_to_financial':
                        const caseData = {
                            reason: parsedArgs.reason,
                            order_number: parsedArgs.order_number,
                            tracking_code: parsedArgs.tracking_code,
                            customer_message: parsedArgs.customer_message,
                            priority: parsedArgs.priority || 'medium',
                            additional_info: parsedArgs.additional_info
                        };
                        
                        const success = await this.financialService.forwardCase(caseData);
                        output = { 
                            status: success ? 'forwarded' : 'error',
                            message: success ? 'Caso encaminhado para análise' : 'Erro ao encaminhar caso',
                            priority: caseData.priority
                        };
                        break;

                    case 'forward_to_department':
                        const departmentData = {
                            department: parsedArgs.department,
                            reason: parsedArgs.reason,
                            order_number: parsedArgs.order_number,
                            tracking_code: parsedArgs.tracking_code,
                            customer_message: parsedArgs.customer_message,
                            priority: parsedArgs.priority || 'medium',
                            additional_info: parsedArgs.additional_info
                        };
                        
                        const deptSuccess = await this.departmentService.forwardCase(departmentData);
                        output = { 
                            status: deptSuccess ? 'forwarded' : 'error',
                            message: deptSuccess ? 'Caso encaminhado para análise' : 'Erro ao encaminhar caso',
                            priority: departmentData.priority,
                            department: parsedArgs.department
                        };
                        break;

                    default:
                        throw new Error(`Função desconhecida: ${name}`);
                }

                toolOutputs.push({
                    tool_call_id: toolCall.id,
                    output: JSON.stringify({
                        ...output,
                        // Garante que a formatação seja incluída na resposta
                        formatted_response: output.formatted || output.message
                    })
                });

            } catch (error) {
                logger.error('ErrorExecutingTool', { 
                    threadId, 
                    tool: name, 
                    error: error.message 
                });

                toolOutputs.push({
                    tool_call_id: toolCall.id,
                    output: JSON.stringify({ 
                        error: true, 
                        message: 'Erro ao processar solicitação'
                    })
                });
            }
        }

        return toolOutputs;
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
            } catch (error) {
                // Ignora erro se o run não existir mais
                if (!error.message.includes('No run found')) {
                    logger.error('ErrorCancelingRun', { threadId, runId: activeRun, error: error.message });
                }
            }

            await this.removeActiveRun(threadId);
        } catch (error) {
            logger.error('ErrorInCancelActiveRun', { threadId, error });
        }
    }

    async deleteThread(threadId) {
        try {
            // Obtém o threadId correto da OpenAI antes de qualquer operação
            const openAIThreadId = await this.redisStore.getThreadForCustomer(threadId);
            if (!openAIThreadId) {
                logger.info('NoThreadFound', { customerId: threadId });
                return true;
            }

            // Usa o threadId correto para operações da OpenAI
            const hasActiveRun = await this.hasActiveRun(openAIThreadId);
            if (hasActiveRun) {
                logger.info('CancelingActiveRun', { threadId: openAIThreadId });
                await this.cancelActiveRun(openAIThreadId);
            }

            await this.removeActiveRun(openAIThreadId);
            if (this.processingTimers.has(openAIThreadId)) {
                clearTimeout(this.processingTimers.get(openAIThreadId));
                this.processingTimers.delete(openAIThreadId);
            }

            this.messageQueue.delete(openAIThreadId);

            // Deleta thread OpenAI
            try {
                const existingThread = await this.client.beta.threads.retrieve(openAIThreadId);
                if (existingThread) {
                    await this.client.beta.threads.del(openAIThreadId);
                    logger.info('OpenAIThreadDeleted', { threadId: openAIThreadId });
                }
            } catch (error) {
                // Log error but continue with reset
                logger.error('ErrorDeletingOpenAIThread', { threadId: openAIThreadId, error });
            }

            // Limpa dados Redis
            try {
                // Limpa todos os dados do usuário e da thread
                if (threadId) {
                    await this.redisStore.deleteUserData(threadId);
                    // Força criação de nova thread removendo o mapeamento customer -> thread
                    await this.redisStore.del(`openai:customer_threads:${threadId}`);
                    logger.info('CustomerDataDeleted', { customerId: threadId });
                }
                await this.redisStore.deleteThreadData(openAIThreadId);
                await this.redisStore.deleteUserContext(openAIThreadId);
                
                // Limpa chaves específicas que podem não ter sido pegas pelos métodos acima
                const specificKeys = [
                    `openai:active_run:${openAIThreadId}`,
                    `openai:context:thread:${openAIThreadId}`,
                    `openai:context:update:${openAIThreadId}`,
                    `openai:pending_order:${openAIThreadId}`,
                    `openai:tracking:${openAIThreadId}`,
                    `openai:waiting_order:${openAIThreadId}`,
                    `openai:tool_calls:${openAIThreadId}`,
                    `openai:thread_meta:${openAIThreadId}`
                ];

                await Promise.all(specificKeys.map(key => this.redisStore.del(key)));
                logger.info('RedisDataCleared', { customerId: threadId, threadId: openAIThreadId });
            } catch (error) {
                logger.error('ErrorClearingRedisData', { customerId: threadId, threadId: openAIThreadId, error });
            }

            logger.info('ThreadResetComplete', { customerId: threadId, threadId: openAIThreadId });
            return true;
        } catch (error) {
            logger.error('ErrorDeletingThread', { threadId, error });
            throw error;
        }
    }

    async getOrCreateThreadForCustomer(customerId) {
        try {
            // Busca thread existente usando o prefixo correto
            const threadKey = `openai:customer_threads:${customerId}`;
            let threadId = await this.redisStore.getThreadForCustomer(customerId);
            let shouldCreateNewThread = false;

            logger.info('CheckingExistingThread', { 
                customerId, 
                threadId, 
                hasExistingThread: !!threadId 
            });

            if (threadId) {
                // Verifica se a thread ainda existe na OpenAI e se não foi resetada
                try {
                    // Tenta recuperar a thread na OpenAI
                    const openaiThread = await this.client.beta.threads.retrieve(threadId);
                    logger.info('OpenAIThreadFound', { 
                        customerId, 
                        threadId,
                        openaiThreadId: openaiThread.id
                    });
                    
                    // Verifica se a thread foi resetada ou deletada
                    const metadata = await this.redisStore.get(`openai:thread_meta:${threadId}`);
                    logger.info('ThreadMetadataCheck', {
                        customerId,
                        threadId,
                        hasMetadata: !!metadata
                    });

                    if (!metadata) {
                        logger.info('ThreadWasReset', { customerId, threadId });
                        shouldCreateNewThread = true;
                    }

                    // Verifica se há mensagens na thread
                    const messages = await this.client.beta.threads.messages.list(threadId);
                    logger.info('ThreadMessagesCheck', {
                        customerId,
                        threadId,
                        messageCount: messages?.data?.length || 0
                    });

                    if (!messages || messages.data.length === 0) {
                        logger.info('ThreadIsEmpty', { customerId, threadId });
                        shouldCreateNewThread = true;
                    }
                } catch (error) {
                    logger.warn('ThreadNotFound', { 
                        customerId, 
                        threadId, 
                        error: error.message,
                        stack: error.stack
                    });
                    shouldCreateNewThread = true;
                }

                if (shouldCreateNewThread) {
                    logger.info('CleaningOldThread', { 
                        customerId, 
                        threadId,
                        reason: 'Thread inválida ou resetada'
                    });
                    // Remove o mapeamento antigo
                    await this.redisStore.del(`openai:customer_threads:${customerId}`);
                    threadId = null;
                }
            }

            if (!threadId || shouldCreateNewThread) {
                logger.info('CreatingNewThread', { 
                    customerId,
                    reason: !threadId ? 'Sem thread existente' : 'Thread antiga inválida'
                });

                // Cria nova thread
                const thread = await this.client.beta.threads.create();
                threadId = thread.id;

                logger.info('NewThreadCreated', {
                    customerId,
                    threadId,
                    openaiThreadId: thread.id
                });

                // Salva mapeamento cliente -> thread
                await this.redisStore.setThreadForCustomer(customerId, threadId);

                // Inicializa metadados da thread
                const metadata = {
                    customerId,
                    createdAt: new Date().toISOString(),
                    lastActivity: new Date().toISOString(),
                    messageCount: 0,
                    isNew: true
                };

                await this.redisStore.set(
                    `openai:thread_meta:${threadId}`, 
                    JSON.stringify(metadata), 
                    30 * 24 * 60 * 60 // 30 dias TTL
                );

                logger.info('ThreadMetadataSaved', {
                    customerId,
                    threadId,
                    metadata
                });
            }

            return threadId;

        } catch (error) {
            logger.error('ErrorCreatingThread', { 
                customerId, 
                error: error.message,
                stack: error.stack 
            });
            return null;
        }
    }

    async processCustomerMessageWithImage(customerId, message, images) {
        try {
            logger.info('ProcessingCustomerMessageWithImage', { 
                customerId, 
                hasMessage: !!message, 
                imageCount: images?.length 
            });

            const threadId = await this.getOrCreateThreadForCustomer(customerId);
            
            // Verifica se já tem um run ativo
            if (await this.hasActiveRun(threadId)) {
                const messageContent = this._formatImageMessage(message, images);
                this.queueMessage(threadId, { role: "user", content: messageContent });
                return "⏳ Aguarde um momento enquanto processo sua mensagem anterior...";
            }

            // Formata a mensagem com as imagens
            const messageContent = this._formatImageMessage(message, images);

            // Adiciona a mensagem e executa o assistant
            return await this.addMessageAndRun(threadId, {
                role: "user",
                content: messageContent
            });

        } catch (error) {
            logger.error('ErrorProcessingCustomerMessageWithImage', { customerId, error });
            if (error.code === 'rate_limit_exceeded') {
                return "⏳ Sistema está muito ocupado. Por favor, aguarde alguns segundos e tente novamente.";
            }
            return "Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente.";
        }
    }

    _formatImageMessage(message, images) {
        const messageContent = [];
        
        if (message) {
            messageContent.push({
                type: "text",
                text: message
            });
        }

        for (const image of images || []) {
            messageContent.push({
                type: "image_url",
                image_url: {
                    url: image.base64 ? 
                        `data:${image.mimetype};base64,${image.base64}` : 
                        image.url
                }
            });
        }

        return messageContent;
    }

    /**
     * Exporta todas as threads para análise
     * @returns {Promise<Array>} Lista de metadados das threads
     */
    async exportThreadsMetadata() {
        try {
            return await this.redisStore.getAllThreadMetadata();
        } catch (error) {
            logger.error('ErrorExportingThreadsMetadata', { error });
            console.error('[OpenAI] Erro ao exportar metadados:', {
                erro: error.message,
                stack: error.stack
            });
            return [];
        }
    }

    async handleCommand(threadId, command) {
        try {
            if (command === '#resetid') {
                logger.info('StartingThreadReset', { threadId });

                // Obtém o threadId correto da OpenAI antes de qualquer operação
                const openAIThreadId = await this.redisStore.getThreadForCustomer(threadId);
                if (!openAIThreadId) {
                    logger.info('NoThreadFound', { customerId: threadId });
                    return true;
                }

                // Usa o threadId correto para operações da OpenAI
                const hasActiveRun = await this.hasActiveRun(openAIThreadId);
                if (hasActiveRun) {
                    logger.info('CancelingActiveRun', { threadId: openAIThreadId });
                    await this.cancelActiveRun(openAIThreadId);
                }

                await this.removeActiveRun(openAIThreadId);
                if (this.processingTimers.has(openAIThreadId)) {
                    clearTimeout(this.processingTimers.get(openAIThreadId));
                    this.processingTimers.delete(openAIThreadId);
                }

                this.messageQueue.delete(openAIThreadId);

                // Deleta thread OpenAI
                try {
                    const existingThread = await this.client.beta.threads.retrieve(openAIThreadId);
                    if (existingThread) {
                        await this.client.beta.threads.del(openAIThreadId);
                        logger.info('OpenAIThreadDeleted', { threadId: openAIThreadId });
                    }
                } catch (error) {
                    // Log error but continue with reset
                    logger.error('ErrorDeletingOpenAIThread', { threadId: openAIThreadId, error });
                }

                // Limpa dados Redis
                try {
                    // Limpa todos os dados do usuário e da thread
                    if (threadId) {
                        await this.redisStore.deleteUserData(threadId);
                        // Força criação de nova thread removendo o mapeamento customer -> thread
                        await this.redisStore.del(`openai:customer_threads:${threadId}`);
                        logger.info('CustomerDataDeleted', { customerId: threadId });
                    }
                    await this.redisStore.deleteThreadData(openAIThreadId);
                    await this.redisStore.deleteUserContext(openAIThreadId);
                    
                    // Limpa chaves específicas que podem não ter sido pegas pelos métodos acima
                    const specificKeys = [
                        `openai:active_run:${openAIThreadId}`,
                        `openai:context:thread:${openAIThreadId}`,
                        `openai:context:update:${openAIThreadId}`,
                        `openai:pending_order:${openAIThreadId}`,
                        `openai:tracking:${openAIThreadId}`,
                        `openai:waiting_order:${openAIThreadId}`,
                        `openai:tool_calls:${openAIThreadId}`,
                        `openai:thread_meta:${openAIThreadId}`
                    ];

                    await Promise.all(specificKeys.map(key => this.redisStore.del(key)));
                    logger.info('RedisDataCleared', { customerId: threadId, threadId: openAIThreadId });
                } catch (error) {
                    logger.error('ErrorClearingRedisData', { customerId: threadId, threadId: openAIThreadId, error });
                }

                logger.info('ThreadResetComplete', { customerId: threadId, threadId: openAIThreadId });
                return true;
            }
            return false;
        } catch (error) {
            logger.error('ErrorHandlingCommand', { threadId, command, error });
            throw error;
        }
    }

    async waitForRunCompletion(threadId, runId, maxAttempts = 60) {
        try {
            logger.info('WaitingForRunCompletion', { threadId, runId });
            console.log('[OpenAI] Aguardando conclusão do run:', { threadId, runId });
            
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                const run = await this.client.beta.threads.runs.retrieve(threadId, runId);
                
                logger.info('RunStatus', { threadId, runId, status: run.status });
                console.log('[OpenAI] Status do run:', { 
                    threadId, 
                    runId, 
                    status: run.status,
                    attempt: attempt + 1 
                });

                if (run.status === 'completed') {
                    return true;
                }

                if (run.status === 'failed' || run.status === 'cancelled' || run.status === 'expired') {
                    throw new Error(`Run falhou com status: ${run.status}`);
                }

                // Espera 1 segundo antes de verificar novamente
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            return false;
        } catch (error) {
            logger.error('ErrorWaitingForRunCompletion', { threadId, runId, error });
            console.error('[OpenAI] Erro ao aguardar conclusão do run:', error);
            throw error;
        }
    }

    /**
     * Adiciona uma mensagem ao thread
     * @param {string} threadId - ID do thread
     * @param {Object} message - Mensagem a ser adicionada
     * @returns {Promise<Object>} Mensagem criada
     */
    async addMessage(threadId, message) {
        try {
            logger.info('AddingMessage', { 
                metadata: {
                    contentType: typeof message.content,
                    role: message.role,
                    threadId,
                    service: 'ortopedic-bot'
                }
            });

            // Valida a mensagem
            if (!message.content) {
                throw new Error('Conteúdo da mensagem não pode ser vazio');
            }

            // Se o conteúdo for uma string, converte para o formato esperado
            let content = message.content;
            if (typeof content === 'string') {
                content = [{ type: 'text', text: content }];
            }

            // Valida o formato do conteúdo
            if (!Array.isArray(content)) {
                throw new Error('Conteúdo da mensagem deve ser uma string ou um array de objetos');
            }

            // Valida cada item do array
            for (let i = 0; i < content.length; i++) {
                const item = content[i];
                if (!item.type || (item.type === 'text' && !item.text)) {
                    throw new Error(`Item ${i} do conteúdo inválido: deve ter type e text`);
                }
            }

            // Cria a mensagem
            const result = await this.client.beta.threads.messages.create(threadId, {
                role: message.role,
                content: content
            });

            logger.info('MessageCreated', { 
                metadata: {
                    messageId: result.id,
                    threadId,
                    service: 'ortopedic-bot'
                }
            });

            return result;

        } catch (error) {
            logger.error('ErrorAddingMessage', { threadId, error });
            throw error;
        }
    }

    /**
     * Executa o assistant em uma thread
     * @param {string} threadId - ID da thread
     * @returns {Promise<Object>} Run criado
     */
    async runAssistant(threadId) {
        try {
            // Busca as últimas mensagens
            const messages = await this.client.beta.threads.messages.list(threadId, {
                limit: 16, // 8 pares de mensagens (usuário + assistente)
                order: 'desc'
            });

            // Mantém apenas as últimas 8 interações
            if (messages.data.length > 16) {
                // Deleta mensagens antigas
                for (let i = 16; i < messages.data.length; i++) {
                    try {
                        await this.client.beta.threads.messages.del(threadId, messages.data[i].id);
                    } catch (error) {
                        logger.warn('ErrorDeletingOldMessage', { 
                            threadId, 
                            messageId: messages.data[i].id, 
                            error: error.message 
                        });
                    }
                }
            }

            // Cria o run com as funções disponíveis
            const run = await this.client.beta.threads.runs.create(threadId, {
                assistant_id: this.assistantId,
                tools: this.functions.map(f => ({
                    type: "function",
                    function: {
                        name: f.name,
                        description: f.description,
                        parameters: f.parameters
                    }
                })),
                model: OPENAI_CONFIG.models.chat
            });

            return run;
        } catch (error) {
            logger.error('ErrorRunningAssistant', { threadId, error });
            console.error('[OpenAI] Erro ao executar assistant:', error);
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
            const result = await this.financialService.processPaymentProof({
                orderId: order.id,
                orderNumber: orderNumber,
                image: image,
                threadId: threadId,
                timestamp: new Date().toISOString()
            });

            // Limpar o comprovante pendente após processamento
            await this.redisStore.del(`openai:pending_proof:${threadId}`);

            return ' Comprovante recebido! Nosso time financeiro irá analisar e confirmar o pagamento em breve.';
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
            const contextKey = `openai:context:thread:${threadId}`;
            const lastUpdateKey = `openai:context:update:${threadId}`;
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
                this.redisStore.set(contextKey, JSON.stringify(contextData), 24 * 60 * 60), // 24 horas
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
            const contextKey = `openai:context:thread:${threadId}`;
            const contextData = await this.redisStore.get(contextKey);
            
            if (!contextData) {
                return null;
            }

            const context = JSON.parse(contextData);
            
            // Verifica se o contexto ainda é válido (24 horas)
            if (Date.now() - context.timestamp > 24 * 60 * 60 * 1000) {
                await this.redisStore.del(contextKey);
                return null;
            }

            return context;
        } catch (error) {
            logger.error('ErrorGettingContext', { threadId, error });
            return null;
        }
    }

    /**
     * Verifica se precisa atualizar o contexto
     * @private
     */
    async _shouldUpdateContext(threadId) {
        try {
            const lastUpdateKey = `openai:context:update:${threadId}`;
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
     * Define o serviço Financeiro após inicialização
     * @param {Object} financialService - Serviço Financeiro
     */
    setFinancialService(financialService) {
        this.financialService = financialService;
    }

    /**
     * Define o serviço de Departamentos após inicialização
     * @param {Object} departmentService - Serviço de Departamentos
     */
    setDepartmentService(departmentService) {
        this.departmentService = departmentService;
    }
}

module.exports = { OpenAIService };
