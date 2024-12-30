const OpenAI = require('openai');
const { OPENAI_CONFIG } = require('../config/settings');

class OpenAIService {
    constructor(nuvemshopService, trackingService, businessHoursService, orderValidationService) {
        this.client = new OpenAI({
            apiKey: OPENAI_CONFIG.apiKey
        });
        this.assistantId = OPENAI_CONFIG.assistantId;
        this.activeRuns = new Map(); // Map para controlar runs ativos
        this.messageQueue = new Map(); // Map para fila de mensagens por thread
        this.processingTimers = new Map(); // Map para controlar timers de processamento
        this.MESSAGE_DELAY = 8000; // 8 segundos de delay

        // Serviços injetados
        this.nuvemshopService = nuvemshopService;
        this.trackingService = trackingService;
        this.businessHoursService = businessHoursService;
        this.orderValidationService = orderValidationService;

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
            }
        ];
    }

    /**
     * Verifica se há um run ativo para a thread
     * @param {string} threadId - ID da thread
     * @returns {boolean} 
     */
    hasActiveRun(threadId) {
        return this.activeRuns.has(threadId);
    }

    /**
     * Registra um run ativo
     * @param {string} threadId - ID da thread
     * @param {string} runId - ID do run
     */
    registerActiveRun(threadId, runId) {
        this.activeRuns.set(threadId, runId);
    }

    /**
     * Remove um run ativo
     * @param {string} threadId - ID da thread
     */
    removeActiveRun(threadId) {
        this.activeRuns.delete(threadId);
        this.processQueuedMessages(threadId);
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
            // Se houver múltiplas mensagens, vamos combiná-las
            if (messages.length > 1) {
                console.log(`[OpenAI] Processando ${messages.length} mensagens agrupadas para thread ${threadId}`);
                const combinedContent = messages.map(m => m.content).join('\n');
                const combinedMessage = {
                    ...messages[0],
                    content: combinedContent
                };
                await this.addMessageAndRun(threadId, combinedMessage);
            } else {
                await this.addMessageAndRun(threadId, messages[0]);
            }

            // Limpa a fila após processamento
            this.messageQueue.delete(threadId);
        } catch (error) {
            console.error('[OpenAI] Erro ao processar mensagens da fila:', error);
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
            if (this.hasActiveRun(threadId)) {
                console.log('[OpenAI] Run ativo detectado, adicionando mensagem à fila');
                this.queueMessage(threadId, message);
                return null;
            }

            console.log(`[OpenAI] Processando mensagem para thread ${threadId}:`, 
                message.content.length > 100 ? message.content.substring(0, 100) + '...' : message.content);

            await this.addMessage(threadId, message);
            const run = await this.runAssistant(threadId);
            this.registerActiveRun(threadId, run.id);
            
            const response = await this.waitForResponse(threadId, run.id);
            this.removeActiveRun(threadId);
            
            return response;
        } catch (error) {
            this.removeActiveRun(threadId);
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
            await this.client.beta.threads.messages.create(threadId, {
                role: message.role,
                content: message.content
            });
        } catch (error) {
            console.error(' Erro ao adicionar mensagem:', error);
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
            console.error(' Erro ao executar assistant:', error);
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
            let run;
            do {
                run = await this.client.beta.threads.runs.retrieve(threadId, runId);
                console.log('[OpenAI] Status do run:', run.status);
                
                if (run.status === 'failed') {
                    this.removeActiveRun(threadId);
                    throw new Error('Run falhou: ' + run.last_error?.message);
                }

                if (run.status === 'requires_action') {
                    console.log('[OpenAI] Ação requerida, processando tool calls...');
                    const toolOutputs = await this.handleToolCalls(run, threadId);
                    
                    run = await this.client.beta.threads.runs.submitToolOutputs(
                        threadId,
                        runId,
                        { tool_outputs: toolOutputs }
                    );
                    continue;
                }

                if (run.status !== 'completed') {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            } while (run.status !== 'completed');

            if (run.status === 'completed') {
                const messages = await this.listMessages(threadId);
                return messages.data[0]?.content[0]?.text?.value || '';
            }

            throw new Error(`Run failed with status: ${run.status}`);
        } catch (error) {
            console.error('[OpenAI] Erro ao aguardar resposta:', error);
            throw error;
        }
    }

    async handleToolCalls(run, threadId) {
        if (!run?.required_action?.submit_tool_outputs?.tool_calls) {
            console.warn('[OpenAI] Nenhuma tool call encontrada');
            return [];
        }

        const toolCalls = run.required_action.submit_tool_outputs.tool_calls;
        console.log('[OpenAI] Processando tool calls:', toolCalls.map(t => t.function.name));
        
        const toolOutputs = [];

        for (const toolCall of toolCalls) {
            const { name, arguments: args } = toolCall.function;
            console.log(`[OpenAI] Executando função ${name} com args:`, args);
            
            let parsedArgs;
            try {
                parsedArgs = JSON.parse(args);
            } catch (error) {
                console.error('[OpenAI] Erro ao parsear argumentos:', error);
                continue;
            }

            let output;
            try {
                switch (name) {
                    case 'check_order':
                        if (!parsedArgs.order_number) {
                            output = JSON.stringify({
                                error: true,
                                message: 'Número do pedido não fornecido'
                            });
                            break;
                        }
                        const order = await this.nuvemshopService.getOrderByNumber(parsedArgs.order_number);
                        if (!order) {
                            output = JSON.stringify({
                                error: true,
                                message: 'Pedido não encontrado'
                            });
                        } else {
                            // Se tiver código de rastreio, busca o status
                            let trackingStatus = null;
                            if (order.shipping_tracking_number) {
                                try {
                                    trackingStatus = await this.trackingService.getTrackingStatus(order.shipping_tracking_number);
                                } catch (error) {
                                    console.error('[OpenAI] Erro ao buscar status do rastreio:', error);
                                }
                            }

                            output = JSON.stringify({
                                error: false,
                                order: {
                                    number: order.number,
                                    status: order.status,
                                    created_at: order.created_at,
                                    total: order.total,
                                    shipping_status: order.shipping_status,
                                    tracking_number: order.shipping_tracking_number,
                                    tracking_url: order.shipping_tracking_url,
                                    tracking_status: trackingStatus ? {
                                        code: trackingStatus.code,
                                        status: trackingStatus.status,
                                        last_update: trackingStatus.last_update,
                                        location: trackingStatus.location,
                                        message: trackingStatus.message
                                    } : null
                                }
                            });
                        }
                        break;

                    case 'check_tracking':
                        if (!parsedArgs.tracking_code) {
                            output = JSON.stringify({
                                error: true,
                                message: 'Código de rastreio não fornecido'
                            });
                            break;
                        }
                        const tracking = await this.trackingService.getTrackingStatus(parsedArgs.tracking_code);
                        if (!tracking) {
                            output = JSON.stringify({
                                error: true,
                                message: 'Rastreamento não encontrado'
                            });
                        } else {
                            output = JSON.stringify({
                                error: false,
                                tracking: {
                                    code: tracking.code,
                                    status: tracking.status,
                                    last_update: tracking.last_update,
                                    location: tracking.location,
                                    message: tracking.message
                                },
                                message: 'Rastreamento encontrado com sucesso'
                            });
                        }
                        break;

                    case 'get_business_hours':
                        const businessHours = this.businessHoursService.getBusinessHours();
                        output = JSON.stringify({
                            error: false,
                            hours: {
                                current_status: businessHours.isOpen ? 'Aberto' : 'Fechado',
                                schedule: businessHours.schedule,
                                timezone: businessHours.timezone
                            }
                        });
                        break;

                    case 'extract_order_number':
                        if (!parsedArgs.text) {
                            output = JSON.stringify({
                                error: true,
                                message: 'Texto não fornecido'
                            });
                            break;
                        }
                        const orderNumber = await this.orderValidationService.extractOrderNumber(parsedArgs.text);
                        output = JSON.stringify({
                            error: !orderNumber,
                            order_number: orderNumber || null,
                            message: orderNumber ? null : 'Número de pedido não encontrado no texto'
                        });
                        break;

                    default:
                        console.warn('[OpenAI] Função desconhecida:', name);
                        output = JSON.stringify({
                            error: true,
                            message: 'Função não implementada'
                        });
                }

                console.log(`[OpenAI] Resultado da função ${name}:`, output);
                toolOutputs.push({
                    tool_call_id: toolCall.id,
                    output
                });
            } catch (error) {
                console.error(`[OpenAI] Erro ao executar função ${name}:`, error);
                toolOutputs.push({
                    tool_call_id: toolCall.id,
                    output: JSON.stringify({
                        error: true,
                        message: `Erro ao executar ${name}: ${error.message}`
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
        const runId = this.activeRuns.get(threadId);
        if (!runId) return;

        try {
            await this.client.beta.threads.runs.cancel(threadId, runId);
            this.removeActiveRun(threadId);
        } catch (error) {
            console.error(' Erro ao cancelar run:', error);
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
}

module.exports = { OpenAIService };
