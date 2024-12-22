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
     * Aguarda a resposta do assistant
     * @param {string} threadId - ID da thread
     * @param {string} runId - ID do run
     * @returns {Promise<string>} Resposta do assistant
     */
    async waitForResponse(threadId, runId) {
        try {
            // Aguarda até o run completar
            let run;
            do {
                run = await this.client.beta.threads.runs.retrieve(threadId, runId);
                if (run.status === 'failed') {
                    throw new Error('Run falhou: ' + run.last_error?.message);
                }
                if (run.status !== 'completed') {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            } while (run.status !== 'completed');

            // Busca as mensagens após o run completar
            const messages = await this.client.beta.threads.messages.list(threadId);
            const lastMessage = messages.data[0];

            // Retorna o conteúdo da última mensagem
            return lastMessage.content[0].text.value;
        } catch (error) {
            console.error('[OpenAI] Erro ao aguardar resposta:', error);
            throw error;
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
