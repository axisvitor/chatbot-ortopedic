const OpenAI = require('openai');
const { RedisStore } = require('../store/redis-store');
const { OPENAI_CONFIG } = require('../config/settings');

class OpenAIService {
    constructor(nuvemshopService, trackingService, businessHoursService, orderValidationService) {
        this.client = new OpenAI({
            apiKey: OPENAI_CONFIG.apiKey
        });
        this.assistantId = OPENAI_CONFIG.assistantId;
        this.redisStore = new RedisStore(); // Redis para controlar runs ativos
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
     * @returns {Promise<boolean>} 
     */
    async hasActiveRun(threadId) {
        const runId = await this.redisStore.getActiveRun(threadId);
        return !!runId;
    }

    /**
     * Registra um run ativo
     * @param {string} threadId - ID da thread
     * @param {string} runId - ID do run
     */
    async registerActiveRun(threadId, runId) {
        await this.redisStore.setActiveRun(threadId, runId);
    }

    /**
     * Remove um run ativo
     * @param {string} threadId - ID da thread
     */
    async removeActiveRun(threadId) {
        await this.redisStore.removeActiveRun(threadId);
        await this.processQueuedMessages(threadId);
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
            if (await this.hasActiveRun(threadId)) {
                console.log('[OpenAI] Run ativo detectado, adicionando mensagem à fila');
                this.queueMessage(threadId, message);
                return null;
            }

            console.log(`[OpenAI] Processando mensagem para thread ${threadId}:`, 
                message.content.length > 100 ? message.content.substring(0, 100) + '...' : message.content);

            await this.addMessage(threadId, message);
            const run = await this.runAssistant(threadId);
            await this.registerActiveRun(threadId, run.id);
            
            try {
                const response = await this.waitForResponse(threadId, run.id);
                return response;
            } finally {
                await this.removeActiveRun(threadId); // Garante remoção do run mesmo em caso de erro
            }
        } catch (error) {
            await this.removeActiveRun(threadId); // Garante remoção do run em caso de erro na criação
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
                const messages = await this.listMessages(threadId);
                if (messages.data && messages.data.length > 0) {
                    return messages.data[0].content[0].text.value;
                }
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
                                message: 'Por favor, me informe o número do pedido que você quer consultar.'
                            });
                            break;
                        }
                        const order = await this.nuvemshopService.getOrderByNumber(parsedArgs.order_number);
                        if (!order) {
                            output = JSON.stringify({
                                error: true,
                                message: `Desculpe, não encontrei nenhum pedido com o número ${parsedArgs.order_number}. Poderia verificar se o número está correto?`
                            });
                        } else {
                            let deliveryStatus = '';
                            if (order.shipping_tracking_number) {
                                try {
                                    const tracking = await this.trackingService.getTrackingStatus(order.shipping_tracking_number);
                                    if (tracking && tracking.status) {
                                        deliveryStatus = `\n📦 Status do Envio: ${order.shipping_status}` +
                                                       `\n📬 Rastreamento: ${order.shipping_tracking_number}` +
                                                       `\n📍 Status: ${tracking.status}` +
                                                       `\n🕒 Última Atualização: ${tracking.last_update}`;

                                        // Adiciona status de entrega se estiver entregue
                                        if (tracking.status.toLowerCase().includes('entregue')) {
                                            deliveryStatus += `\n\n✅ Pedido Entregue` +
                                                            `\n📅 Data de Entrega: ${tracking.last_update}`;
                                        }
                                    } else {
                                        deliveryStatus = `\n📦 Status do Envio: ${order.shipping_status}` +
                                                       `\n📬 Rastreamento: ${order.shipping_tracking_number}`;
                                    }
                                } catch (error) {
                                    console.error('[OpenAI] Erro ao buscar status do rastreio:', error);
                                    deliveryStatus = `\n📦 Status do Envio: ${order.shipping_status}` +
                                                   `\n📬 Rastreamento: ${order.shipping_tracking_number}`;
                                }
                            }

                            // Lista de produtos com tratamento seguro de preço
                            const products = order.products.map(product => {
                                const price = typeof product.price === 'number' ? 
                                    product.price.toFixed(2) : 
                                    String(product.price).replace(/[^\d.,]/g, '');
                                
                                return `▫ ${product.quantity}x ${product.name}` + 
                                       `${product.variant_name ? ` (${product.variant_name})` : ''}` +
                                       ` - R$ ${price}`;
                            }).join('\n');

                            // Formata o valor total com segurança
                            const total = typeof order.total === 'number' ? 
                                order.total.toFixed(2) : 
                                String(order.total).replace(/[^\d.,]/g, '');

                            output = JSON.stringify({
                                error: false,
                                message: `🛍 Detalhes do Pedido #${order.number}\n\n` +
                                        `👤 Cliente: ${order.customer.name}\n` +
                                        `📅 Data: ${new Date(order.created_at).toLocaleString('pt-BR', { 
                                            day: '2-digit',
                                            month: '2-digit',
                                            year: 'numeric',
                                            hour: '2-digit',
                                            minute: '2-digit'
                                        })}\n` +
                                        `📦 Status: ${order.status}\n` +
                                        `💰 Valor Total: R$ ${total}\n\n` +
                                        `Produtos:\n${products}` +
                                        `${deliveryStatus}`
                            });
                        }
                        break;

                    case 'check_tracking':
                        if (!parsedArgs.tracking_code) {
                            output = JSON.stringify({
                                error: true,
                                message: 'Por favor, me informe o código de rastreio que você quer consultar.'
                            });
                            break;
                        }
                        const tracking = await this.trackingService.getTrackingStatus(parsedArgs.tracking_code);
                        if (!tracking) {
                            output = JSON.stringify({
                                error: true,
                                message: `Desculpe, não encontrei informações para o código de rastreio ${parsedArgs.tracking_code}. Poderia verificar se o código está correto?`
                            });
                        } else {
                            const status = tracking.status.toLowerCase();
                            let statusEmoji = '📦';
                            if (status.includes('entregue')) {
                                statusEmoji = '✅';
                            } else if (status.includes('transito') || status.includes('trânsito')) {
                                statusEmoji = '🚚';
                            } else if (status.includes('postado')) {
                                statusEmoji = '📮';
                            }

                            output = JSON.stringify({
                                error: false,
                                message: `📬 Informações de Rastreio: ${tracking.code}\n\n` +
                                        `${statusEmoji} Status: ${tracking.status}\n` +
                                        `📍 Localização: ${tracking.location}\n` +
                                        `🕒 Última Atualização: ${tracking.last_update}\n` +
                                        `${tracking.message ? `\n📝 Observação: ${tracking.message}` : ''}`
                            });
                        }
                        break;

                    case 'get_business_hours':
                        const businessHours = this.businessHoursService.getBusinessHours();
                        const currentStatus = businessHours.isOpen ? '🟢 Estamos Abertos!' : '🔴 Estamos Fechados';
                        
                        // Formata o horário de cada dia
                        const schedule = Object.entries(businessHours.schedule)
                            .map(([day, hours]) => `${day}: ${hours}`)
                            .join('\n');

                        output = JSON.stringify({
                            error: false,
                            message: `${currentStatus}\n\n` +
                                    `⏰ Horário de Atendimento:\n` +
                                    `${schedule}\n\n` +
                                    `🌎 Fuso Horário: ${businessHours.timezone}`
                        });
                        break;

                    case 'extract_order_number':
                        if (!parsedArgs.text) {
                            output = JSON.stringify({
                                error: true,
                                message: 'Não consegui identificar o texto para buscar o número do pedido.'
                            });
                            break;
                        }
                        const orderNumber = await this.orderValidationService.extractOrderNumber(parsedArgs.text);
                        
                        if (!orderNumber) {
                            output = JSON.stringify({
                                error: true,
                                message: '❌ Desculpe, não consegui identificar um número de pedido válido no texto. Poderia me informar o número do pedido diretamente?'
                            });
                            break;
                        }

                        // Busca as informações do pedido
                        const extractedOrder = await this.nuvemshopService.getOrderByNumber(orderNumber);
                        if (!extractedOrder) {
                            output = JSON.stringify({
                                error: true,
                                message: `❌ Encontrei o número #${orderNumber}, mas não consegui localizar este pedido em nossa base. Poderia verificar se o número está correto?`
                            });
                            break;
                        }

                        // Processa o pedido como na função check_order
                        let deliveryStatus = '';
                        if (extractedOrder.shipping_tracking_number) {
                            try {
                                const tracking = await this.trackingService.getTrackingStatus(extractedOrder.shipping_tracking_number);
                                if (tracking && tracking.status) {
                                    deliveryStatus = `\n📦 Status do Envio: ${extractedOrder.shipping_status}` +
                                                   `\n📬 Rastreamento: ${extractedOrder.shipping_tracking_number}` +
                                                   `\n📍 Status: ${tracking.status}` +
                                                   `\n🕒 Última Atualização: ${tracking.last_update}`;

                                    if (tracking.status.toLowerCase().includes('entregue')) {
                                        deliveryStatus += `\n\n✅ Pedido Entregue` +
                                                        `\n📅 Data de Entrega: ${tracking.last_update}`;
                                    }
                                } else {
                                    deliveryStatus = `\n📦 Status do Envio: ${extractedOrder.shipping_status}` +
                                                   `\n📬 Rastreamento: ${extractedOrder.shipping_tracking_number}`;
                                }
                            } catch (error) {
                                console.error('[OpenAI] Erro ao buscar status do rastreio:', error);
                                deliveryStatus = `\n📦 Status do Envio: ${extractedOrder.shipping_status}` +
                                               `\n📬 Rastreamento: ${extractedOrder.shipping_tracking_number}`;
                            }
                        }

                        // Lista de produtos com tratamento seguro de preço
                        const products = extractedOrder.products.map(product => {
                            const price = typeof product.price === 'number' ? 
                                product.price.toFixed(2) : 
                                String(product.price).replace(/[^\d.,]/g, '');
                            
                            return `▫ ${product.quantity}x ${product.name}` + 
                                   `${product.variant_name ? ` (${product.variant_name})` : ''}` +
                                   ` - R$ ${price}`;
                        }).join('\n');

                        // Formata o valor total com segurança
                        const total = typeof extractedOrder.total === 'number' ? 
                            extractedOrder.total.toFixed(2) : 
                            String(extractedOrder.total).replace(/[^\d.,]/g, '');

                        output = JSON.stringify({
                            error: false,
                            message: `🛍 Detalhes do Pedido #${extractedOrder.number}\n\n` +
                                    `👤 Cliente: ${extractedOrder.customer.name}\n` +
                                    `📅 Data: ${new Date(extractedOrder.created_at).toLocaleString('pt-BR', { 
                                        day: '2-digit',
                                        month: '2-digit',
                                        year: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit'
                                    })}\n` +
                                    `📦 Status: ${extractedOrder.status}\n` +
                                    `💰 Valor Total: R$ ${total}\n\n` +
                                    `Produtos:\n${products}` +
                                    `${deliveryStatus}`
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
            // Tenta obter thread existente
            let threadId = await this.redisStore.getThreadForCustomer(customerId);
            
            if (!threadId) {
                // Cria nova thread se não existir
                const thread = await this.createThread();
                threadId = thread.id;
                
                // Salva no Redis com TTL de 60 dias
                await this.redisStore.setThreadForCustomer(customerId, threadId, 5184000); // 60 dias em segundos
                
                console.log('[OpenAI] Nova thread criada:', {
                    customerId,
                    threadId
                });
            } else {
                console.log('[OpenAI] Thread existente recuperada:', {
                    customerId,
                    threadId
                });
            }
            
            return threadId;
        } catch (error) {
            console.error('[OpenAI] Erro ao obter/criar thread:', {
                customerId,
                erro: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Processa uma mensagem do cliente
     * @param {string} customerId - ID do cliente
     * @param {string} message - Mensagem do cliente
     * @returns {Promise<string>} Resposta do assistant
     */
    async processCustomerMessage(customerId, message) {
        try {
            const threadId = await this.getOrCreateThreadForCustomer(customerId);
            
            return await this.addMessageAndRun(threadId, {
                role: 'user',
                content: message
            });
        } catch (error) {
            console.error('[OpenAI] Erro ao processar mensagem:', {
                customerId,
                erro: error.message,
                stack: error.stack
            });
            throw error;
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
}

module.exports = { OpenAIService };
