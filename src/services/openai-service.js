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
            apiKey: OPENAI_CONFIG.apiKey
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
            return await this.redisStore.get(`run:${threadId}:active`) === 'true';
        } catch (error) {
            logger.error('ErrorCheckingActiveRun', { threadId, error });
            console.error('[OpenAI] Erro ao verificar run ativo:', error);
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
            await this.redisStore.set(`run:${threadId}:active`, 'true');
        } catch (error) {
            logger.error('ErrorRegisteringActiveRun', { threadId, runId, error });
            console.error('[OpenAI] Erro ao registrar run ativo:', error);
        }
    }

    /**
     * Remove um run ativo
     * @param {string} threadId - ID da thread
     */
    async removeActiveRun(threadId) {
        try {
            await this.redisStore.set(`run:${threadId}:active`, 'false');
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
        if (!this.messageQueue.has(threadId)) return;
        
        const messages = this.messageQueue.get(threadId);
        if (messages.length === 0) return;

        // Remove o timer
        if (this.processingTimers.has(threadId)) {
            clearTimeout(this.processingTimers.get(threadId));
            this.processingTimers.delete(threadId);
        }

        try {
            let response;
            // Se houver múltiplas mensagens, vamos combiná-las
            if (messages.length > 1) {
                logger.info('ProcessingMultipleMessages', { threadId, messageCount: messages.length });
                console.log(`[OpenAI] Processando ${messages.length} mensagens agrupadas para thread ${threadId}`);
                const combinedContent = messages.map(m => m.content).join('\n');
                const combinedMessage = {
                    ...messages[0],
                    content: combinedContent
                };
                response = await this.addMessageAndRun(threadId, combinedMessage);
            } else {
                response = await this.addMessageAndRun(threadId, messages[0]);
            }

            // Limpa a fila após processamento
            this.messageQueue.delete(threadId);

            return response;
        } catch (error) {
            logger.error('ErrorProcessingQueuedMessages', { threadId, error });
            console.error('[OpenAI] Erro ao processar mensagens da fila:', error);
            throw error;
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
            console.error(' Erro ao criar thread:', error);
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
            logger.info('StartingMessageProcessing', { threadId });
            console.log('[OpenAI] Iniciando processamento:', { threadId });

            // Verifica se já existe um run ativo
            const activeRun = await this.redisStore.getAssistantRun(threadId);
            if (activeRun) {
                logger.info('ActiveRunFound', { threadId, runId: activeRun.id });
                console.log('[OpenAI] Run ativo encontrado:', { threadId, runId: activeRun.id });
                return 'Aguarde um momento, ainda estou processando sua mensagem anterior...';
            }

            // Adiciona a mensagem à thread
            await this.addMessage(threadId, message);

            // Cria um run com o assistente
            const run = await this.client.beta.threads.runs.create(threadId, {
                assistant_id: this.assistantId
            });

            // Salva o run no Redis
            await this.redisStore.setAssistantRun(threadId, {
                id: run.id,
                status: run.status,
                createdAt: new Date().toISOString()
            });

            logger.info('RunCreated', { threadId, runId: run.id });
            console.log('[OpenAI] Run criado:', { threadId, runId: run.id });

            // Aguarda a conclusão do run
            const response = await this.waitForRunCompletion(threadId, run.id);
            
            // Remove o run do Redis após a conclusão
            await this.redisStore.removeAssistantRun(threadId);
            
            if (!response) {
                throw new Error('Tempo limite excedido aguardando resposta do assistente');
            }

            // Obtém as mensagens após o processamento
            const messages = await this.listMessages(threadId);
            
            // Retorna a última mensagem do assistente
            const assistantMessages = messages.data.filter(msg => msg.role === 'assistant');
            if (assistantMessages.length === 0) {
                throw new Error('Nenhuma resposta do assistente encontrada');
            }

            const lastMessage = assistantMessages[0];
            logger.info('AssistantResponse', { threadId, messageId: lastMessage.id });
            console.log('[OpenAI] Resposta do assistente:', {
                threadId,
                messageId: lastMessage.id,
                content: lastMessage.content
            });

            if (lastMessage.content && lastMessage.content[0] && lastMessage.content[0].text && typeof lastMessage.content[0].text.value === 'string') {
                logger.info('AssistantResponseExtracted', { threadId, response: lastMessage.content[0].text.value });
                console.log('[OpenAI] Resposta extraída:', lastMessage.content[0].text.value);
                return lastMessage.content[0].text.value;
            }
            logger.error('ErrorExtractingAssistantResponse', { threadId, error: 'Unexpected message structure' });
            console.error('[OpenAI] Estrutura da mensagem inesperada:', messages.data[0]);
            throw new Error('Não foi possível extrair a resposta da mensagem');

        } catch (error) {
            logger.error('ErrorProcessingMessage', { threadId, error });
            // Remove o run do Redis em caso de erro
            await this.redisStore.removeAssistantRun(threadId);
            console.error('[OpenAI] Erro ao processar mensagem:', error);
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
                        output = await this.nuvemshopService.getOrderDetails(parsedArgs.order_number);
                        if (!output) {
                            output = { error: true, message: 'Pedido não encontrado' };
                        }
                        break;

                    case 'check_tracking':
                        const trackingInfo = await this.trackingService.getTrackingInfo(parsedArgs.tracking_code);
                        output = {
                            status: trackingInfo.status,
                            lastUpdate: trackingInfo.lastUpdate,
                            location: trackingInfo.location,
                            delivered: trackingInfo.delivered,
                            events: trackingInfo.events?.slice(0, 3) // Limita a 3 eventos mais recentes
                        };
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
                                await this.redisStore.set(`waiting_order:${threadId}`, 'payment_proof');
                                await this.redisStore.set(`pending_order:${threadId}`, parsedArgs.order_number);
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
                                await this.redisStore.del(`waiting_order:${threadId}`);
                                await this.redisStore.del(`pending_order:${threadId}`);
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
                    output: JSON.stringify(output)
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
            const runId = await this.redisStore.getActiveRun(threadId);
            if (runId) {
                await this.client.beta.threads.runs.cancel(threadId, runId);
                logger.info('RunCanceled', { threadId, runId });
                console.log(`[OpenAI] Run ${runId} cancelado para thread ${threadId}`);
            }
        } catch (error) {
            logger.error('ErrorCancelingRun', { threadId, error });
            console.error('[OpenAI] Erro ao cancelar run:', error);
        } finally {
            await this.removeActiveRun(threadId); // Garante remoção do run mesmo se o cancelamento falhar
        }
    }

    /**
     * Deleta um thread do OpenAI
     * @param {string} threadId - ID do thread para deletar
     */
    async deleteThread(threadId) {
        try {
            await this.client.beta.threads.del(threadId);
            logger.info('ThreadDeleted', { threadId });
            console.log('[OpenAI] Thread deletado com sucesso:', threadId);
        } catch (error) {
            logger.error('ErrorDeletingThread', { threadId, error });
            console.error('[OpenAI] Erro ao deletar thread:', error);
            // Não lança erro pois o thread pode não existir
        }
    }

    /**
     * Obtém ou cria uma thread para o cliente
     * @param {string} customerId - ID do cliente
     * @returns {Promise<string>} ID da thread
     */
    async getOrCreateThreadForCustomer(customerId) {
        try {
            // Busca thread existente
            const threadKey = `customer_thread:${customerId}`;
            let threadId = await this.redisStore.get(threadKey);

            if (threadId) {
                // Verifica se a thread ainda existe na OpenAI
                try {
                    await this.client.beta.threads.retrieve(threadId);
                    return threadId;
                } catch (error) {
                    logger.warn('ThreadNotFound', { customerId, threadId });
                    await this.redisStore.del(threadKey);
                    threadId = null;
                }
            }

            // Cria nova thread
            const thread = await this.client.beta.threads.create();
            threadId = thread.id;

            // Salva mapeamento cliente -> thread
            await this.redisStore.set(threadKey, threadId, 30 * 24 * 60 * 60); // 30 dias

            // Inicializa metadados da thread
            await this.redisStore.set(`thread_metadata:${threadId}`, JSON.stringify({
                customerId,
                createdAt: new Date().toISOString(),
                lastActivity: new Date().toISOString(),
                messageCount: 0
            }), 30 * 24 * 60 * 60);

            logger.info('ThreadCreated', { customerId, threadId });
            return threadId;

        } catch (error) {
            logger.error('ErrorCreatingThread', { customerId, error });
            throw error;
        }
    }

    async processCustomerMessage(customerId, message) {
        try {
            logger.info('ProcessingCustomerMessage', { customerId });

            const threadId = await this.getOrCreateThreadForCustomer(customerId);
            if (!threadId) {
                throw new Error('Não foi possível criar/recuperar thread');
            }

            // Verifica se já tem um run ativo
            if (await this.hasActiveRun(threadId)) {
                this.queueMessage(threadId, message);
                return "⏳ Aguarde um momento enquanto processo sua mensagem anterior...";
            }

            // Adiciona a mensagem e executa o assistant
            const response = await this.addMessageAndRun(threadId, message);
            
            // Atualiza contexto se necessário
            if (response && await this._shouldUpdateContext(threadId)) {
                await this._saveContextToRedis(threadId, response);
            }

            return response;
        } catch (error) {
            logger.error('ErrorProcessingCustomerMessage', { customerId, error });
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
            const waiting = await this.redisStore.get(`waiting_order:${threadId}`);

            if (waiting === 'payment_proof') {
                logger.info('WaitingForPaymentProof', { threadId });
                
                if (!images?.length) {
                    return '❌ Não recebi nenhuma imagem. Por favor, envie uma foto do comprovante.';
                }

                let orderNumber = message ? 
                    await this.orderValidationService.extractOrderNumber(message) :
                    await this.redisStore.get(`pending_order:${threadId}`);

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
                return "⏳ Aguarde um momento enquanto processo sua mensagem anterior...";
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
                console.log('[OpenAI] Iniciando reset de thread:', { threadId });

                // Remove o run ativo se houver
                await this.removeActiveRun(threadId);
                
                try {
                    // Deleta a thread antiga
                    await this.client.beta.threads.del(threadId);
                    logger.info('OldThreadDeleted', { threadId });
                } catch (error) {
                    // Log error but continue with reset
                    logger.error('ErrorDeletingOldThread', { threadId, error: error.message });
                    console.error('[OpenAI] Erro ao deletar thread antiga:', error);
                }

                // Limpa dados do Redis
                try {
                    // Usa o método deleteThreadData que limpa todos os dados relacionados à thread
                    await this.redisStore.deleteThreadData(threadId);
                    
                    // Limpa todos os dados relacionados a esta thread
                    await Promise.all([
                        // Cache de rastreamento relacionado à thread
                        this.redisStore.delPattern(`tracking:thread:${threadId}:*`),
                        // Cache de pedidos relacionados à thread
                        this.redisStore.delPattern(`order:thread:${threadId}:*`),
                        // Cache de produtos relacionados à thread
                        this.redisStore.delPattern(`product:thread:${threadId}:*`),
                        // Cache de pagamentos relacionados à thread
                        this.redisStore.delPattern(`payment:thread:${threadId}:*`),
                        // Cache do OpenAI para a thread
                        this.redisStore.delPattern(`openai:thread:${threadId}:*`),
                        // Cache de contexto da thread
                        this.redisStore.delPattern(`context:thread:${threadId}:*`),
                        // Pedidos em espera da thread
                        this.redisStore.delPattern(`waiting_order:${threadId}`),
                        // Pedidos pendentes da thread
                        this.redisStore.delPattern(`pending_order:${threadId}`),
                        // Mapeamento cliente-thread para esta thread
                        this.redisStore.delPattern(`customer_thread:*:${threadId}`)
                    ]);
                    
                    logger.info('RedisDataCleared', { threadId });
                } catch (error) {
                    logger.error('ErrorClearingRedisData', { threadId, error });
                }
                
                // Cria uma nova thread
                const newThread = await this.client.beta.threads.create();
                logger.info('NewThreadCreated', { oldThreadId: threadId, newThreadId: newThread.id });
                
                // Atualiza metadados da thread
                await this.redisStore.setThreadMetadata(newThread.id, {
                    createdAt: new Date().toISOString(),
                    lastActivity: new Date().toISOString(),
                    messageCount: 0
                });
                
                return {
                    threadId: newThread.id,
                    message: 'Conversa reiniciada com sucesso! Como posso ajudar?'
                };
            }
            
            return null;
        } catch (error) {
            logger.error('ErrorHandlingCommand', { threadId, command, error });
            console.error('[OpenAI] Erro ao processar comando:', error);
            
            // Tenta recuperar em caso de erro
            try {
                const newThread = await this.client.beta.threads.create();
                logger.info('RecoveryThreadCreated', { oldThreadId: threadId, newThreadId: newThread.id });
                return {
                    threadId: newThread.id,
                    message: 'Houve um problema, mas consegui criar uma nova conversa. Como posso ajudar?'
                };
            } catch (recoveryError) {
                logger.error('ErrorInRecoveryAttempt', { threadId, error: recoveryError });
                throw error; // Throw original error if recovery fails
            }
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
                contentType: Array.isArray(message.content) ? 'array' : typeof message.content,
                contentLength: Array.isArray(message.content) ? 
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
            const run = await this.client.beta.threads.runs.create(threadId, {
                assistant_id: this.assistantId,
                tools: this.functions.map(f => ({
                    type: "function",
                    function: {
                        name: f.name,
                        description: f.description,
                        parameters: f.parameters
                    }
                }))
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
            const waiting = await this.redisStore.get(`waiting_order:${threadId}`);
            const pendingOrder = await this.redisStore.get(`pending_order:${threadId}`);
            
            if (!waiting || waiting !== 'payment_proof') {
                return 'Não há solicitação de comprovante pendente. Por favor, primeiro me informe o número do pedido.';
            }

            if (pendingOrder && orderNumber && pendingOrder !== orderNumber) {
                return `❌ O número do pedido informado (#${orderNumber}) é diferente do pedido pendente (#${pendingOrder}). Por favor, confirme o número correto do pedido.`;
            }

            if (!image) {
                return '❌ Não recebi nenhuma imagem. Por favor, envie uma foto clara do comprovante de pagamento.';
            }

            // Validar o pedido
            const order = await this.nuvemshopService.getOrderByNumber(orderNumber);
            if (!order) {
                return `❌ Não encontrei o pedido #${orderNumber}. Por favor, verifique se o número está correto.`;
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
            await this.redisStore.del(`pending_proof:${threadId}`);

            return '✅ Comprovante recebido! Nosso time financeiro irá analisar e confirmar o pagamento em breve.';
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
            const contextKey = `context:thread:${threadId}`;
            const lastUpdateKey = `context:update:${threadId}`;
            const contextData = {
                lastMessage: context,
                timestamp: Date.now(),
                metadata: {
                    lastOrderNumber: await this.redisStore.get(`pending_order:${threadId}`),
                    lastTrackingCode: await this.redisStore.get(`tracking:${threadId}`),
                    waitingFor: await this.redisStore.get(`waiting_order:${threadId}`),
                    lastToolCalls: await this.redisStore.get(`tool_calls:${threadId}`)
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
            const contextKey = `context:thread:${threadId}`;
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
            const lastUpdateKey = `context:update:${threadId}`;
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
