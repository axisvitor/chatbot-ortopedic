const OpenAI = require('openai');
const { OPENAI_CONFIG } = require('../config/settings');

class OpenAIService {
    constructor() {
        this.client = new OpenAI({
            apiKey: OPENAI_CONFIG.apiKey
        });
        this.assistantId = OPENAI_CONFIG.assistantId;
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
     * Aguarda a conclusão de um run e retorna a resposta
     * @param {string} threadId - ID do thread
     * @param {string} runId - ID do run
     * @param {number} timeout - Timeout em ms (padrão: 30s)
     * @returns {Promise<string>} Resposta do assistant
     */
    async waitForRun(threadId, runId, timeout = 30000) {
        const startTime = Date.now();
        
        while (true) {
            const status = await this.checkRunStatus(threadId, runId);
            
            if (status.status === 'completed') {
                const messages = await this.listMessages(threadId);
                const assistantMessages = messages.data.filter(msg => 
                    msg.role === 'assistant' && 
                    msg.run_id === runId
                );
                
                if (assistantMessages.length > 0) {
                    return assistantMessages[0].content[0].text.value;
                }
                return null;
            }
            
            if (status.status === 'failed' || status.status === 'cancelled') {
                throw new Error(`Run ${status.status}: ${status.last_error?.message || 'Unknown error'}`);
            }
            
            if (Date.now() - startTime > timeout) {
                throw new Error('Timeout waiting for assistant response');
            }
            
            // Aguarda 1 segundo antes de verificar novamente
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
}

module.exports = { OpenAIService };
