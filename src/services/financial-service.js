const { RedisStore } = require('../store/redis-store');
const { FINANCIAL_CONFIG, REDIS_CONFIG } = require('../config/settings');
const { WHATSAPP_CONFIG } = require('../config/settings');

class FinancialService {
    constructor(whatsAppService = null) {
        this.redisStore = new RedisStore();
        this.whatsAppService = whatsAppService;
    }

    /**
     * Obtém o serviço WhatsApp
     * @private
     */
    get _whatsAppService() {
        return this.whatsAppService;
    }

    /**
     * Gera uma chave única para o caso financeiro
     * @private
     */
    _getCaseKey(caseId) {
        return `${REDIS_CONFIG.prefix.ecommerce}financial:case:${caseId}`;
    }

    /**
     * Gera uma chave única para a fila de casos
     * @private
     */
    _getQueueKey() {
        return `${REDIS_CONFIG.prefix.ecommerce}financial:queue`;
    }

    /**
     * Encaminha um caso para análise do setor financeiro
     * @param {Object} data Dados do caso
     * @param {string} data.order_number Número do pedido (opcional)
     * @param {string} data.tracking_code Código de rastreio (opcional)
     * @param {string} data.reason Motivo do encaminhamento
     * @param {string} data.customer_message Mensagem do cliente
     * @param {string} data.priority Prioridade do caso
     * @param {string} data.additional_info Informações adicionais
     * @returns {Promise<boolean>} Sucesso do encaminhamento
     */
    async forwardCase(data) {
        try {
            // Valida dados obrigatórios
            if (!data.reason || !data.customer_message) {
                throw new Error('Motivo e mensagem do cliente são obrigatórios');
            }

            // Valida reason
            const validReasons = ['payment', 'refund', 'taxation', 'customs', 'payment_proof', 'other'];
            if (!validReasons.includes(data.reason)) {
                throw new Error('Motivo inválido');
            }

            // Valida prioridade
            const validPriorities = ['high', 'medium', 'low'];
            if (data.priority && !validPriorities.includes(data.priority)) {
                throw new Error('Prioridade inválida');
            }

            // Gera ID único para o caso
            const caseId = `FIN${Date.now()}`;
            const caseKey = this._getCaseKey(caseId);
            const queueKey = this._getQueueKey();

            // Prepara dados do caso
            const caseData = {
                id: caseId,
                ...data,
                status: 'pending',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };

            // Salva caso no Redis
            await this.redisStore.set(caseKey, JSON.stringify(caseData), REDIS_CONFIG.ttl.ecommerce.cases);

            // Adiciona à fila de casos
            await this.redisStore.rpush(queueKey, caseId);

            // Notifica equipe financeira via WhatsApp
            if (this._whatsAppService && WHATSAPP_CONFIG.notifications.financial) {
                await this._notifyFinancialTeam(caseData);
            }

            return true;
        } catch (error) {
            console.error('[Financial] Erro ao encaminhar caso:', error);
            return false;
        }
    }

    /**
     * Obtém casos pendentes
     * @returns {Promise<Array>} Lista de casos
     */
    async getPendingCases() {
        try {
            const queueKey = this._getQueueKey();
            const caseIds = await this.redisStore.lrange(queueKey, 0, -1);
            
            if (!caseIds.length) return [];

            const cases = await Promise.all(
                caseIds.map(async (caseId) => {
                    const caseKey = this._getCaseKey(caseId);
                    const caseData = await this.redisStore.get(caseKey);
                    return caseData ? JSON.parse(caseData) : null;
                })
            );

            return cases.filter(Boolean);
        } catch (error) {
            console.error('[Financial] Erro ao obter casos pendentes:', error);
            return [];
        }
    }

    /**
     * Atualiza status de um caso
     * @param {string} caseId ID do caso
     * @param {string} status Novo status
     * @param {string} resolution Resolução do caso
     * @returns {Promise<boolean>} Sucesso da atualização
     */
    async updateCaseStatus(caseId, status, resolution = '') {
        try {
            const caseKey = this._getCaseKey(caseId);
            const queueKey = this._getQueueKey();

            // Obtém dados atuais do caso
            const caseData = await this.redisStore.get(caseKey);
            if (!caseData) {
                throw new Error('Caso não encontrado');
            }

            // Atualiza dados
            const updatedCase = {
                ...JSON.parse(caseData),
                status,
                resolution,
                updated_at: new Date().toISOString()
            };

            // Salva atualização
            await this.redisStore.set(caseKey, JSON.stringify(updatedCase), REDIS_CONFIG.ttl.ecommerce.cases);

            // Remove da fila se resolvido
            if (status === 'resolved') {
                await this.redisStore.lrem(queueKey, 0, caseId);
            }

            return true;
        } catch (error) {
            console.error('[Financial] Erro ao atualizar caso:', error);
            return false;
        }
    }

    /**
     * Notifica equipe financeira via WhatsApp
     * @private
     */
    async _notifyFinancialTeam(caseData) {
        try {
            if (!this._whatsAppService) return;

            const message = this._formatNotificationMessage(caseData);
            await this._whatsAppService.sendMessage(
                WHATSAPP_CONFIG.notifications.financial.number,
                message
            );
        } catch (error) {
            console.error('[Financial] Erro ao notificar equipe:', error);
        }
    }

    /**
     * Formata mensagem de notificação
     * @private
     */
    _formatNotificationMessage(caseData) {
        const priority = caseData.priority || 'normal';
        const priorityEmoji = {
            high: '🔴',
            medium: '🟡',
            low: '🟢'
        }[priority];

        return `*Novo Caso Financeiro* ${priorityEmoji}\n\n` +
            `*ID:* ${caseData.id}\n` +
            `*Motivo:* ${caseData.reason}\n` +
            `*Pedido:* ${caseData.order_number || 'N/A'}\n` +
            `*Rastreio:* ${caseData.tracking_code || 'N/A'}\n` +
            `*Mensagem:* ${caseData.customer_message}\n` +
            (caseData.additional_info ? `*Info Adicional:* ${caseData.additional_info}\n` : '') +
            `\nPrioridade: ${priority.toUpperCase()}`;
    }
}

module.exports = { FinancialService };
