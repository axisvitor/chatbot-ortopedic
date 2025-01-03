const OpenAI = require('openai');
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
        this.functions = [
            {
                name: "check_order",
                description: "Busca informações de um pedido pelo número",
                parameters: {
                    type: "object",
                    properties: {
                        order_number: {
                            type: "string",
                            description: "Número do pedido a ser consultado"
                        }
                    },
                    required: ["order_number"]
                }
            },
            {
                name: "check_tracking",
                description: "Verifica o status de rastreamento de um pedido",
                parameters: {
                    type: "object",
                    properties: {
                        tracking_code: {
                            type: "string",
                            description: "Código de rastreio para consulta"
                        }
                    },
                    required: ["tracking_code"]
                }
            },
            {
                name: "get_business_hours",
                description: "Retorna informações sobre horário de atendimento",
                parameters: {
                    type: "object",
                    properties: {}
                }
            },
            {
                name: "extract_order_number",
                description: "Tenta extrair um número de pedido do texto do usuário",
                parameters: {
                    type: "object",
                    properties: {
                        text: {
                            type: "string",
                            description: "Texto do usuário para extrair número do pedido"
                        }
                    },
                    required: ["text"]
                }
            },
            {
                name: "request_payment_proof",
                description: "Gerencia solicitações de comprovante de pagamento",
                parameters: {
                    type: "object",
                    properties: {
                        action: {
                            type: "string",
                            description: "Ação a ser executada",
                            enum: ["request", "validate", "cancel", "process"]
                        },
                        order_number: {
                            type: "string",
                            description: "Número do pedido relacionado"
                        },
                        image_url: {
                            type: "string",
                            description: "URL da imagem do comprovante (apenas para action=process)"
                        },
                        status: {
                            type: "string",
                            description: "Status atual do processamento",
                            enum: ["pending", "processing", "approved", "rejected"]
                        }
                    },
                    required: ["action"]
                }
            },
            {
                name: "forward_to_financial",
                description: "Encaminha um caso para análise do setor financeiro",
                parameters: {
                    type: "object",
                    properties: {
                        order_number: {
                            type: "string",
                            description: "Número do pedido relacionado (opcional)"
                        },
                        tracking_code: {
                            type: "string",
                            description: "Código de rastreio relacionado (opcional)"
                        },
                        reason: {
                            type: "string",
                            description: "Motivo do encaminhamento",
                            enum: ["payment_issue", "refund_request", "taxation", "customs", "payment_proof", "other"]
                        },
                        customer_message: {
                            type: "string",
                            description: "Mensagem original do cliente que gerou o encaminhamento"
                        },
                        priority: {
                            type: "string",
                            description: "Prioridade do caso",
                            enum: ["low", "medium", "high", "urgent"],
                            default: "medium"
                        },
                        additional_info: {
                            type: "string",
                            description: "Informações adicionais relevantes para o financeiro"
                        }
                    },
                    required: ["reason", "customer_message"]
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
            console.log(' Novo thread criado:', {
                threadId: thread.id,
                timestamp: new Date().toISOString()
            });
            return thread;
        } catch (error) {
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
            console.log('[OpenAI] Iniciando processamento:', { threadId });

            // Verifica se já existe um run ativo
            const activeRun = await this.redisStore.getAssistantRun(threadId);
            if (activeRun) {
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
            console.log('[OpenAI] Resposta do assistente:', {
                threadId,
                messageId: lastMessage.id,
                content: lastMessage.content
            });

            if (lastMessage.content && lastMessage.content[0] && lastMessage.content[0].text && typeof lastMessage.content[0].text.value === 'string') {
                console.log('[OpenAI] Resposta extraída:', lastMessage.content[0].text.value);
                return lastMessage.content[0].text.value;
            }
            console.error('[OpenAI] Estrutura da mensagem inesperada:', messages.data[0]);
            throw new Error('Não foi possível extrair a resposta da mensagem');

        } catch (error) {
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
                console.log('[OpenAI] Ação requerida, processando tool calls...');
                
                if (run.required_action?.type === 'submit_tool_outputs') {
                    const toolCalls = run.required_action.submit_tool_outputs.tool_calls;
                    console.log('[OpenAI] Processando tool calls:', toolCalls.map(t => `'${t.function.name}'`));
                    
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
                        console.log('[OpenAI] Resposta extraída:', content.text.value);
                        return content.text.value;
                    }
                    console.error('[OpenAI] Estrutura da mensagem inesperada:', messages.data[0]);
                    throw new Error('Não foi possível extrair a resposta da mensagem');
                }
                throw new Error('Não foi possível extrair a resposta da mensagem');
            }

            if (run.status === 'failed') {
                console.error('[OpenAI] Run falhou:', run.last_error);
                throw new Error(`Run falhou: ${run.last_error?.message || 'Erro desconhecido'}`);
            }

            throw new Error(`Run terminou com status inesperado: ${run.status}`);
            
        } catch (error) {
            console.error('[OpenAI] Erro ao aguardar resposta:', error);
            await this.removeActiveRun(threadId); // Garante remoção do run em caso de erro
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
            const runId = await this.redisStore.getActiveRun(threadId);
            if (runId) {
                await this.client.beta.threads.runs.cancel(threadId, runId);
                console.log(`[OpenAI] Run ${runId} cancelado para thread ${threadId}`);
            }
        } catch (error) {
            console.error('[OpenAI] Erro ao cancelar run:', error);
        } finally {
            await this.removeActiveRun(threadId); // Garante remoção do run mesmo se o cancelamento falhar
        }
    }

    /**
     * Deleta um thread existente
     * @param {string} threadId - ID do thread a ser deletado
     * @returns {Promise<boolean>} Sucesso da operação
     */
    async deleteThread(threadId) {
        try {
            if (!threadId) return false;
            await this.client.beta.threads.del(threadId);
            return true;
        } catch (error) {
            console.error('[OpenAI] Erro ao deletar thread:', {
                threadId,
                erro: error.message,
                timestamp: new Date().toISOString()
            });
            return false;
        }
    }

    /**
     * Obtém ou cria uma thread para o cliente
     * @param {string} customerId - ID do cliente
     * @returns {Promise<string>} ID da thread
     */
    async getOrCreateThreadForCustomer(customerId) {
        try {
            // Tenta recuperar thread do Redis
            const threadData = await this.redisStore.getAssistantThread(customerId);
            if (threadData) {
                console.log('[OpenAI] Thread existente recuperada do Redis:', {
                    customerId,
                    threadId: threadData.id
                });
                return threadData.id;
            }

            // Se não existir, cria nova thread
            const thread = await this.client.beta.threads.create();
            
            // Salva no Redis
            await this.redisStore.setAssistantThread(customerId, {
                id: thread.id,
                createdAt: new Date().toISOString()
            });
            
            console.log('[OpenAI] Nova thread criada e salva no Redis:', {
                customerId,
                threadId: thread.id
            });

            return thread.id;
        } catch (error) {
            console.error('[OpenAI] Erro ao obter/criar thread:', error);
            throw error;
        }
    }

    async processCustomerMessage(customerId, message) {
        try {
            console.log('[OpenAI] Processando mensagem do cliente:', {
                customerId,
                messageType: Array.isArray(message.content) ? 'array' : typeof message.content,
                timestamp: new Date().toISOString()
            });

            // Recupera ou cria thread
            const threadId = await this.getOrCreateThreadForCustomer(customerId);
            if (!threadId) {
                throw new Error('Não foi possível criar/recuperar thread');
            }

            // Recupera contexto do Redis
            const savedContext = await this._getContextFromRedis(threadId);
            if (savedContext) {
                // Adiciona contexto à mensagem
                if (typeof message.content === 'string') {
                    message.content = `${savedContext}\n\nNova mensagem do cliente:\n${message.content}`;
                }
            }

            // Adiciona mensagem à fila
            await this.queueMessage(threadId, message);

            // Processa mensagens na fila
            const response = await this.processQueuedMessages(threadId);

            // Salva contexto apenas se passou o intervalo
            if (response && await this._shouldUpdateContext(threadId)) {
                await this._saveContextToRedis(threadId, response);
                console.log('[OpenAI] Contexto atualizado após intervalo:', {
                    threadId,
                    interval: '15 minutos'
                });
            }

            return response;
        } catch (error) {
            console.error('[OpenAI] Erro ao processar mensagem do cliente:', {
                customerId,
                erro: error.message,
                stack: error.stack
            });

            // Retorna mensagem amigável em caso de erro
            return 'Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente em alguns instantes.';
        }
    }

    async processCustomerMessageWithImage(customerId, message, images) {
        try {
            console.log('[OpenAI] Processando mensagem com imagem:', {
                customerId,
                hasMessage: !!message,
                imageCount: images?.length
            });

            const threadId = await this.getOrCreateThreadForCustomer(customerId);

            // Verifica se está aguardando comprovante
            const waiting = await this.redisStore.get(`waiting_order:${threadId}`);
            if (waiting === 'payment_proof') {
                console.log('[OpenAI] Comprovante recebido:', {
                    threadId,
                    hasMessage: !!message
                });

                // Se tiver mensagem, tenta extrair número do pedido
                let orderNumber = null;
                if (message) {
                    try {
                        orderNumber = await this.orderValidationService.extractOrderNumber(message);
                    } catch (error) {
                        console.error('[OpenAI] Erro ao extrair número do pedido:', error);
                    }
                }

                // Se não encontrou no texto, tenta pegar do Redis
                if (!orderNumber) {
                    orderNumber = await this.redisStore.get(`pending_order:${threadId}`);
                }

                // Processa o comprovante
                if (images && images.length > 0) {
                    const result = await this.processPaymentProof(threadId, images[0], orderNumber);
                    return result;
                } else {
                    return '❌ Não recebi nenhuma imagem. Por favor, envie uma foto clara do comprovante de pagamento.';
                }
            }

            // Formata a mensagem com as imagens conforme especificação da OpenAI
            const messageContent = [];

            // Adiciona o texto da mensagem
            if (message) {
                messageContent.push({
                    type: "text",
                    text: message
                });
            }

            // Adiciona as imagens
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

            // Verifica se há um run ativo
            if (await this.hasActiveRun(threadId)) {
                this.queueMessage(threadId, { role: "user", content: messageContent });
                return "Aguarde um momento enquanto processo sua mensagem anterior...";
            }

            // Adiciona a mensagem e executa o assistant
            const response = await this.addMessageAndRun(threadId, {
                role: "user",
                content: messageContent
            });

            return response || "Desculpe, não consegui processar sua mensagem. Pode tentar novamente?";

        } catch (error) {
            console.error('❌ Erro ao processar mensagem com imagem:', error);
            return "Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente em alguns instantes.";
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
                // Remove o run ativo se houver
                await this.removeActiveRun(threadId);
                
                // Deleta a thread antiga
                await this.client.beta.threads.del(threadId);
                
                // Cria uma nova thread
                const newThread = await this.client.beta.threads.create();
                
                return {
                    threadId: newThread.id,
                    message: 'Conversa reiniciada com sucesso! Como posso ajudar?'
                };
            }
            
            return null;
        } catch (error) {
            console.error('[OpenAI] Erro ao processar comando:', error);
            throw error;
        }
    }

    async waitForRunCompletion(threadId, runId, maxAttempts = 60) {
        try {
            console.log('[OpenAI] Aguardando conclusão do run:', { threadId, runId });
            
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                const run = await this.client.beta.threads.runs.retrieve(threadId, runId);
                
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

            console.log('[OpenAI] Mensagem adicionada com sucesso:', {
                threadId,
                messageId: result.id
            });

            return result;

        } catch (error) {
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

            // Limpar o estado no Redis após processamento
            await this.redisStore.del(`waiting_order:${threadId}`);
            await this.redisStore.del(`pending_order:${threadId}`);

            if (result.success) {
                return `✅ Comprovante recebido com sucesso para o pedido #${orderNumber}!\n\n` +
                       `📋 Status: ${result.status}\n` +
                       `⏳ Tempo estimado de análise: ${result.estimatedTime || '24 horas úteis'}\n\n` +
                       `Assim que a análise for concluída, você receberá uma notificação.`;
            } else {
                return `❌ Houve um problema ao processar seu comprovante:\n${result.message}\n\nPor favor, tente novamente.`;
            }

        } catch (error) {
            console.error('[OpenAI] Erro ao processar comprovante:', error);
            
            // Não limpa o Redis em caso de erro para permitir nova tentativa
            return '❌ Ocorreu um erro ao processar seu comprovante. Por favor, tente novamente em alguns instantes.';
        }
    }

    /**
     * Salva contexto da conversa no Redis
     * @private
     */
    async _saveContextToRedis(threadId, context) {
        try {
            const key = `openai:context:${threadId}`;
            await this.redisStore.set(key, JSON.stringify({
                lastUpdate: new Date().toISOString(),
                context: context
            }));
            console.log('[OpenAI] Contexto salvo no Redis:', { threadId });
        } catch (error) {
            console.error('[OpenAI] Erro ao salvar contexto:', error);
        }
    }

    /**
     * Recupera contexto da conversa do Redis
     * @private
     */
    async _getContextFromRedis(threadId) {
        try {
            const key = `openai:context:${threadId}`;
            const data = await this.redisStore.get(key);
            if (data) {
                const parsed = JSON.parse(data);
                console.log('[OpenAI] Contexto recuperado do Redis:', { threadId });
                return parsed.context;
            }
            return null;
        } catch (error) {
            console.error('[OpenAI] Erro ao recuperar contexto:', error);
            return null;
        }
    }

    /**
     * Verifica se precisa atualizar o contexto
     * @private
     */
    async _shouldUpdateContext(threadId) {
        try {
            const key = `openai:context:${threadId}`;
            const data = await this.redisStore.get(key);
            if (!data) return true;

            const parsed = JSON.parse(data);
            const lastUpdate = new Date(parsed.lastUpdate);
            const now = new Date();
            
            return (now - lastUpdate) >= this.CONTEXT_UPDATE_INTERVAL;
        } catch (error) {
            console.error('[OpenAI] Erro ao verificar atualização de contexto:', error);
            return true;
        }
    }
}

module.exports = { OpenAIService };
