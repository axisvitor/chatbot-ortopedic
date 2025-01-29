const { RedisStore } = require('../store/redis-store');
const { WHATSAPP_CONFIG, REDIS_CONFIG } = require('../config/settings');

class DepartmentService {
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
     * Gera uma chave única para o caso
     * @private
     */
    _getCaseKey(caseId) {
        return `${REDIS_CONFIG.prefix.ecommerce}department:case:${caseId}`;
    }

    /**
     * Gera uma chave única para a fila do departamento
     * @private
     */
    _getQueueKey(department) {
        return `${REDIS_CONFIG.prefix.ecommerce}department:${department}:queue`;
    }

    /**
     * Encaminha um caso para análise de um departamento
     * @param {Object} data Dados do caso
     * @param {string} data.department Departamento destino
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
            if (!data.department || !data.reason || !data.customer_message) {
                throw new Error('Departamento, motivo e mensagem do cliente são obrigatórios');
            }

            // Valida departamento
            const validDepartments = ['support', 'technical', 'logistics', 'commercial'];
            if (!validDepartments.includes(data.department)) {
                throw new Error('Departamento inválido');
            }

            // Valida prioridade
            const validPriorities = ['urgent', 'high', 'medium', 'low'];
            if (data.priority && !validPriorities.includes(data.priority)) {
                throw new Error('Prioridade inválida');
            }

            // Gera ID único para o caso
            const caseId = `${data.department.toUpperCase()}${Date.now()}`;
            const caseKey = this._getCaseKey(caseId);
            const queueKey = this._getQueueKey(data.department);

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

            // Adiciona à fila do departamento
            await this.redisStore.rpush(queueKey, caseId);

            // Notifica departamento via WhatsApp
            if (this._whatsAppService && WHATSAPP_CONFIG.notifications[data.department]) {
                await this._notifyDepartment(caseData);
            }

            return true;
        } catch (error) {
            console.error('[Department] Erro ao encaminhar caso:', error);
            return false;
        }
    }

    /**
     * Obtém casos pendentes de um departamento
     * @param {string} department Nome do departamento
     * @returns {Promise<Array>} Lista de casos
     */
    async getPendingCases(department) {
        try {
            const queueKey = this._getQueueKey(department);
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
            console.error('[Department] Erro ao obter casos pendentes:', error);
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

            // Obtém dados atuais do caso
            const caseData = await this.redisStore.get(caseKey);
            if (!caseData) {
                throw new Error('Caso não encontrado');
            }

            const parsedCase = JSON.parse(caseData);
            const queueKey = this._getQueueKey(parsedCase.department);

            // Atualiza dados
            const updatedCase = {
                ...parsedCase,
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
            console.error('[Department] Erro ao atualizar caso:', error);
            return false;
        }
    }

    /**
     * Notifica departamento via WhatsApp
     * @private
     */
    async _notifyDepartment(caseData) {
        try {
            if (!this._whatsAppService) return;

            const message = this._formatNotificationMessage(caseData);
            const departmentConfig = WHATSAPP_CONFIG.notifications[caseData.department];
            
            if (departmentConfig && departmentConfig.number) {
                await this._whatsAppService.sendMessage(
                    departmentConfig.number,
                    message
                );
            }
        } catch (error) {
            console.error('[Department] Erro ao notificar departamento:', error);
        }
    }

    /**
     * Formata mensagem de notificação
     * @private
     */
    _formatNotificationMessage(caseData) {
        const priority = caseData.priority || 'normal';
        const priorityEmoji = {
            urgent: '⚡',
            high: '🔴',
            medium: '🟡',
            low: '🟢'
        }[priority];

        const departmentName = {
            support: 'Suporte',
            technical: 'Técnico',
            logistics: 'Logística',
            commercial: 'Comercial'
        }[caseData.department];

        return `*Novo Caso - ${departmentName}* ${priorityEmoji}\n\n` +
            `*ID:* ${caseData.id}\n` +
            `*Motivo:* ${caseData.reason}\n` +
            `*Pedido:* ${caseData.order_number || 'N/A'}\n` +
            `*Rastreio:* ${caseData.tracking_code || 'N/A'}\n` +
            `*Mensagem:* ${caseData.customer_message}\n` +
            (caseData.additional_info ? `*Info Adicional:* ${caseData.additional_info}\n` : '') +
            `\nPrioridade: ${priority.toUpperCase()}`;
    }
}

module.exports = { DepartmentService };
