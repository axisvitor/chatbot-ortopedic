const OpenAI = require('openai');

class OpenAIService {
    constructor(config) {
        if (!config?.apiKey) {
            throw new Error('OpenAI API Key is required');
        }
        this.openai = new OpenAI({
            apiKey: config.apiKey
        });
        this.beta = this.openai.beta;
    }

    /**
     * Cria um novo thread
     * @returns {Promise<Object>} Thread criado
     */
    async createThread() {
        try {
            return await this.beta.threads.create();
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
            return await this.beta.threads.messages.create(threadId, message);
        } catch (error) {
            console.error('[OpenAI] Erro ao adicionar mensagem:', error);
            throw error;
        }
    }

    /**
     * Executa o assistant em um thread
     * @param {string} threadId - ID do thread
     * @param {string} assistantId - ID do assistant
     * @returns {Promise<Object>} Run criado
     */
    async runAssistant(threadId, assistantId) {
        try {
            return await this.beta.threads.runs.create(threadId, {
                assistant_id: assistantId
            });
        } catch (error) {
            console.error('[OpenAI] Erro ao executar assistant:', error);
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
            return await this.beta.threads.runs.retrieve(threadId, runId);
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
            return await this.beta.threads.messages.list(threadId);
        } catch (error) {
            console.error('[OpenAI] Erro ao listar mensagens:', error);
            throw error;
        }
    }
}

module.exports = { OpenAIService };
