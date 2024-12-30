const OpenAI = require('openai');
const { OPENAI_CONFIG } = require('../config/settings');

class OpenAIService {
    constructor() {
        this.client = new OpenAI({
            apiKey: OPENAI_CONFIG.apiKey
        });
        this.assistantId = OPENAI_CONFIG.assistantId;
        this.activeRuns = new Map(); // Map para controlar runs ativos
        this.messageQueue = new Map(); // Map para fila de mensagens por thread
        this.processingTimers = new Map(); // Map para controlar timers de processamento
        this.MESSAGE_DELAY = 8000; // 8 segundos de delay
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
            return await this.client.beta.threads.create();
        } catch (error) {
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
            return await this.client.beta.threads.messages.create(threadId, message);
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
        return await this.client.beta.threads.runs.create(
            threadId,
            { assistant_id: this.assistantId }
        );
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
                if (run.status === 'failed') {
                    this.removeActiveRun(threadId);
                    throw new Error('Run falhou: ' + run.last_error?.message);
                }
                if (run.status !== 'completed') {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            } while (run.status !== 'completed');

            const messages = await this.listMessages(threadId);
            return messages.data[0]?.content[0]?.text?.value || '';
        } catch (error) {
            console.error('[OpenAI] Erro ao aguardar resposta:', error);
            throw error;
        }
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
            console.error('[OpenAI] Erro ao cancelar run:', error);
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
