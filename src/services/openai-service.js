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

class OpenAIService {
    /**
     * @param {NuvemshopService} nuvemshopService - Serviço de integração com a Nuvemshop
     * @param {TrackingService} trackingService - Serviço de tracking
     * @param {BusinessHoursService} businessHoursService - Serviço de horário de atendimento
     * @param {OrderValidationService} orderValidationService - Serviço de validação de pedidos
     * @param {FinancialService} financialService - Serviço financeiro
     */
    constructor(nuvemshopService, trackingService, businessHoursService, orderValidationService, financialService) {
        this.client = new OpenAI({
            apiKey: OPENAI_CONFIG.apiKey,
            baseURL: OPENAI_CONFIG.baseUrl
        });
        this.assistantId = OPENAI_CONFIG.assistantId;
        this.redisStore = new RedisStore(); // Redis para controlar runs ativos
        this.messageQueue = new Map(); // Map para fila de mensagens por thread
        this.processingTimers = new Map(); // Map para controlar timers de processamento
        this.MESSAGE_DELAY = 8000; // 8 segundos de delay
        this.CONTEXT_UPDATE_INTERVAL = 15 * 60 * 1000; // 15 minutos em ms

        // Serviços injetados
        this.nuvemshopService = nuvemshopService || new NuvemshopService();
        this.trackingService = trackingService || new TrackingService();
        this.businessHoursService = businessHoursService || new BusinessHoursService();
        this.orderValidationService = orderValidationService || new OrderValidationService();
        this.financialService = financialService; // Recebe o FinancialService do container

        // Define as funções disponíveis para o Assistant
        this.functions = this._getAssistantFunctions();
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
                            enum: ["payment", "refund", "taxation", "customs", "payment_proof", "other"],
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
    queueMessage(threadId, message) {
        if (!this.messageQueue.has(threadId)) {
            this.messageQueue.set(threadId, []);
        }
        this.messageQueue.get(threadId).push(message);

        // Cancela o timer anterior se existir
        if (this.processingTimers.has(threadId)) {
            clearTimeout(this.processingTimers.get(threadId));
        }

        // Agenda novo processamento
        const timer = setTimeout(() => {
            this.processQueuedMessages(threadId);
        }, this.MESSAGE_DELAY);

        this.processingTimers.set(threadId, timer);
    }

    /**
     * Processa todas as mensagens acumuladas na fila
     * @param {string} threadId - ID da thread
     */
    async processQueuedMessages(threadId) {
        try {
            const queue = this.messageQueue.get(threadId) || [];
            if (queue.length === 0) return;

            logger.info('ProcessingQueuedMessages', { 
                threadId,
                queueLength: queue.length
            });

            // Limpa a fila atual
            this.messageQueue.set(threadId, []);

            // Processa todas as mensagens em sequência
            for (const message of queue) {
                try {
                    await this.addMessageAndRun(threadId, message);
                } catch (error) {
                    logger.error('ErrorProcessingQueuedMessage', { 
                        threadId, 
                        error: error.message,
                        stack: error.stack
                    });
                }
            }

            logger.info('QueueProcessingComplete', { 
                threadId,
                processedCount: queue.length
            });

        } catch (error) {
            logger.error('ErrorProcessingQueuedMessages', { 
                threadId, 
                error: error.message,
                stack: error.stack
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
            logger.info('StartingMessageAndRun', { threadId, messageRole: message.role });

            // Se houver run ativo, coloca na fila e retorna
            if (await this.hasActiveRun(threadId)) {
                logger.info('ActiveRunDetected', { threadId });
                this.queueMessage(threadId, message);
                return "⏳ Aguarde um momento enquanto processo sua mensagem anterior...";
            }

            // Marca como ativo antes de qualquer operação
            await this.registerActiveRun(threadId, 'pending');
            logger.info('RegisteredActiveRun', { threadId });

            try {
                // Adiciona a mensagem
                const addedMessage = await this.addMessage(threadId, message);
                logger.info('MessageAdded', { threadId, messageId: addedMessage.id });

                // Cria o run
                const run = await this.runAssistant(threadId);
                logger.info('RunCreated', { threadId, runId: run.id });

                // Atualiza o ID do run
                await this.registerActiveRun(threadId, run.id);
                logger.info('RunIdUpdated', { threadId, runId: run.id });

                // Aguarda a resposta
                const response = await this.waitForResponse(threadId, run.id);
                logger.info('ResponseReceived', { threadId, runId: run.id });
                
                // Limpa o run ativo
                await this.removeActiveRun(threadId);
                logger.info('ActiveRunRemoved', { threadId });
                
                return response;
            } catch (error) {
                // Remove o status ativo em caso de erro
                await this.removeActiveRun(threadId);
                logger.error('ErrorInMessageProcessing', { 
                    threadId,
                    error: {
                        message: error.message,
                        stack: error.stack,
                        name: error.name,
                        code: error.code
                    }
                });
                throw error;
            }
        } catch (error) {
            logger.error('ErrorInAddMessageAndRun', { 
                threadId,
                error: {
                    message: error.message,
                    stack: error.stack,
                    name: error.name,
                    code: error.code
                }
            });
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
                            type: parsedArgs.case_type,
                            orderNumber: parsedArgs.order_number,
                            priority: parsedArgs.priority || 'medium',
                            details: parsedArgs.details
                        };
                        
                        await this.financialService.createCase(caseData);
                        output = { 
                            status: 'forwarded',
                            message: 'Caso encaminhado para análise',
                            priority: caseData.priority
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
            logger.info('DeletingThread', { threadId });

            // 1. Cancela qualquer run ativo
            try {
                await this.cancelActiveRun(threadId);
            } catch (error) {
                logger.warn('ErrorCancelingActiveRun', { threadId, error: error.message });
            }

            // 2. Remove timers e filas
            if (this.processingTimers.has(threadId)) {
                clearTimeout(this.processingTimers.get(threadId));
                this.processingTimers.delete(threadId);
            }
            this.messageQueue.delete(threadId);

            // 3. Recupera o customerId antes de limpar os dados
            let customerId;
            try {
                const metadata = await this.redisStore.get(`openai:thread_meta:${threadId}`);
                if (metadata) {
                    const parsedMetadata = JSON.parse(metadata);
                    customerId = parsedMetadata.customerId;
                }
            } catch (error) {
                logger.error('ErrorGettingCustomerId', { threadId, error });
            }

            // 4. Deleta thread OpenAI
            try {
                const existingThread = await this.client.beta.threads.retrieve(threadId);
                if (existingThread) {
                    await this.client.beta.threads.del(threadId);
                    logger.info('OpenAIThreadDeleted', { threadId });
                }
            } catch (error) {
                // Log error but continue with reset
                logger.error('ErrorDeletingOpenAIThread', { threadId, error });
            }

            // 5. Limpa dados Redis
            try {
                // Limpa todos os dados do usuário e da thread
                if (customerId) {
                    await this.redisStore.deleteUserData(customerId);
                    // Força criação de nova thread removendo o mapeamento customer -> thread
                    await this.redisStore.del(`openai:customer_threads:${customerId}`);
                    logger.info('CustomerDataDeleted', { customerId });
                }
                await this.redisStore.deleteThreadData(threadId);
                await this.redisStore.deleteUserContext(threadId);
                
                // Limpa chaves específicas que podem não ter sido pegas pelos métodos acima
                const specificKeys = [
                    `openai:active_run:${threadId}`,
                    `openai:context:thread:${threadId}`,
                    `openai:context:update:${threadId}`,
                    `openai:pending_order:${threadId}`,
                    `openai:tracking:${threadId}`,
                    `openai:waiting_order:${threadId}`,
                    `openai:tool_calls:${threadId}`,
                    `openai:thread_meta:${threadId}`
                ];

                await Promise.all(specificKeys.map(key => this.redisStore.del(key)));
                logger.info('RedisDataCleared', { threadId, customerId });
            } catch (error) {
                logger.error('ErrorClearingRedisData', { threadId, error });
            }

            // 6. Verifica se tudo foi limpo
            try {
                const threadExists = await this.client.beta.threads.retrieve(threadId);
                if (threadExists) {
                    logger.error('ThreadStillExists', { threadId });
                    throw new Error('Thread não foi deletada completamente');
                }
            } catch (error) {
                if (!error.message.includes('No thread found')) {
                    throw error;
                }
            }

            logger.info('ThreadResetComplete', { threadId });
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

    async processCustomerMessage(customerId, message) {
        try {
            let messageText = '';
            
            // Log da mensagem original para debug
            logger.debug('ProcessingRawMessage', { 
                customerId, 
                messageType: typeof message,
                hasMessage: !!message,
                messageKeys: message ? Object.keys(message) : [],
                rawMessage: JSON.stringify(message, null, 2)
            });

            // Extrai o texto da mensagem usando a estrutura correta do WhatsApp
            if (typeof message === 'string') {
                messageText = message;
            } else if (message?.message?.extendedTextMessage?.text) {
                messageText = message.message.extendedTextMessage.text;
            } else if (message?.message?.conversation) {
                messageText = message.message.conversation;
            } else if (message?.text) {
                messageText = message.text;
            }

            // Validação e limpeza do texto
            messageText = messageText ? messageText.trim() : '';

            logger.info('ExtractedMessageText', { 
                customerId, 
                messageText,
                messageType: typeof messageText,
                messageLength: messageText.length,
                extractionPath: messageText ? 'Sucesso' : 'Falha'
            });

            if (!messageText) {
                logger.warn('EmptyMessageText', { 
                    customerId,
                    originalMessage: JSON.stringify(message, null, 2)
                });
                return 'Desculpe, não consegui entender sua mensagem. Pode tentar novamente?';
            }

            // 1. Obtém ou cria thread para o cliente
            const threadId = await this.getOrCreateThreadForCustomer(customerId);
            if (!threadId) {
                logger.error('FailedToCreateThread', { customerId });
                return 'Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente.';
            }

            logger.info('ThreadObtained', { customerId, threadId });

            // 2. Prepara a mensagem para o Assistant
            const assistantMessage = {
                role: 'user',
                content: messageText
            };

            // 3. Verifica se há um run ativo
            const hasActiveRun = await this.hasActiveRun(threadId);
            
            if (hasActiveRun) {
                // Se houver run ativo, adiciona à fila e retorna
                logger.info('QueueingMessage', { 
                    customerId, 
                    threadId,
                    messageText,
                    queueLength: (this.messageQueue.get(threadId) || []).length + 1
                });
                
                this.queueMessage(threadId, assistantMessage);
                return null; // Retorna null para não enviar resposta intermediária
            }

            // 4. Se não houver run ativo, processa a mensagem
            logger.info('ProcessingMessageDirectly', { 
                customerId, 
                threadId,
                messageText
            });

            // Adiciona a mensagem e executa o assistant
            const response = await this.addMessageAndRun(threadId, assistantMessage);

            return response || 'Desculpe, não consegui processar sua mensagem. Por favor, tente novamente.';

        } catch (error) {
            logger.error('ErrorProcessingMessage', { 
                customerId, 
                error: error.message,
                stack: error.stack
            });
            return 'Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente.';
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
            const waiting = await this.redisStore.get(`openai:waiting_order:${threadId}`);

            if (waiting === 'payment_proof') {
                logger.info('WaitingForPaymentProof', { threadId });
                
                if (!images?.length) {
                    return ' Não recebi nenhuma imagem. Por favor, envie uma foto do comprovante.';
                }

                let orderNumber = message ? 
                    await this.orderValidationService.extractOrderNumber(message) :
                    await this.redisStore.get(`openai:pending_order:${threadId}`);

                return await this.processPaymentProof(threadId, images[0], orderNumber);
            }

            // Formata a mensagem com as imagens
            const messageContent = [];
            
            if (message) {
                messageContent.push({
                    type: "text",
                    text: message
                });
            }

            for (const image of images) {
                messageContent.push({
                    type: "image_url",
                    image_url: {
                        url: image.base64 ? 
                            `data:${image.mimetype};base64,${image.base64}` : 
                            image.url
                    }
                });
            }

            // Verifica se já tem um run ativo
            if (await this.hasActiveRun(threadId)) {
                this.queueMessage(threadId, { role: "user", content: messageContent });
                return " Aguarde um momento enquanto processo sua mensagem anterior...";
            }

            // Adiciona a mensagem e executa o assistant
            const response = await this.addMessageAndRun(threadId, {
                role: "user",
                content: messageContent
            });

            return response || "Desculpe, não consegui processar sua mensagem. Pode tentar novamente?";
        } catch (error) {
            logger.error('ErrorProcessingCustomerMessageWithImage', { customerId, error });
            return "Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente.";
        }
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

                // 1. Remove run ativo e cancela timers
                await this.removeActiveRun(threadId);
                if (this.processingTimers.has(threadId)) {
                    clearTimeout(this.processingTimers.get(threadId));
                    this.processingTimers.delete(threadId);
                }

                // 2. Limpa fila de mensagens
                this.messageQueue.delete(threadId);

                // 3. Recupera o customerId antes de limpar tudo
                let customerId;
                try {
                    const metadata = await this.redisStore.get(`openai:thread_meta:${threadId}`);
                    if (metadata) {
                        const parsedMetadata = JSON.parse(metadata);
                        customerId = parsedMetadata.customerId;
                    }
                } catch (error) {
                    logger.error('ErrorGettingCustomerId', { threadId, error });
                }

                // 4. Deleta thread OpenAI
                try {
                    const existingThread = await this.client.beta.threads.retrieve(threadId);
                    if (existingThread) {
                        await this.client.beta.threads.del(threadId);
                        logger.info('OpenAIThreadDeleted', { threadId });
                    }
                } catch (error) {
                    // Log error but continue with reset
                    logger.error('ErrorDeletingOpenAIThread', { threadId, error });
                }

                // 5. Limpa dados Redis
                try {
                    // Limpa todos os dados do usuário e da thread
                    if (customerId) {
                        await this.redisStore.deleteUserData(customerId);
                        // Força criação de nova thread removendo o mapeamento customer -> thread
                        await this.redisStore.del(`openai:customer_threads:${customerId}`);
                        logger.info('CustomerDataDeleted', { customerId });
                    }
                    await this.redisStore.deleteThreadData(threadId);
                    await this.redisStore.deleteUserContext(threadId);
                    
                    // Limpa chaves específicas que podem não ter sido pegas pelos métodos acima
                    const specificKeys = [
                        `openai:active_run:${threadId}`,
                        `openai:context:thread:${threadId}`,
                        `openai:context:update:${threadId}`,
                        `openai:pending_order:${threadId}`,
                        `openai:tracking:${threadId}`,
                        `openai:waiting_order:${threadId}`,
                        `openai:tool_calls:${threadId}`,
                        `openai:thread_meta:${threadId}`
                    ];

                    await Promise.all(specificKeys.map(key => this.redisStore.del(key)));
                    logger.info('RedisDataCleared', { threadId, customerId });
                } catch (error) {
                    logger.error('ErrorClearingRedisData', { threadId, error });
                }

                // 6. Verifica se tudo foi limpo
                try {
                    const threadExists = await this.client.beta.threads.retrieve(threadId);
                    if (threadExists) {
                        logger.error('ThreadStillExists', { threadId });
                        throw new Error('Thread não foi deletada completamente');
                    }
                } catch (error) {
                    if (!error.message.includes('No thread found')) {
                        throw error;
                    }
                }

                logger.info('ThreadResetComplete', { threadId });
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
            logger.info('AddingMessage', { threadId, role: message.role, contentType: Array.isArray(message.content) ? 'array' : typeof message.content });
            console.log('[OpenAI] Adicionando mensagem:', {
                threadId,
                role: message.role,
                contentType: Array.isArray(message.content) ? 
                    JSON.stringify(message.content).length : 
                    message.content?.length
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

            logger.info('MessageCreated', { threadId, messageId: result.id });
            console.log('[OpenAI] Mensagem adicionada com sucesso:', {
                threadId,
                messageId: result.id
            });

            return result;

        } catch (error) {
            logger.error('ErrorAddingMessage', { threadId, error });
            console.error('[OpenAI] Erro ao adicionar mensagem:', error);
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
}

module.exports = { OpenAIService };
