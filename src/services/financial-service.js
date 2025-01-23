const { RedisStore } = require('../store/redis-store');
const { FINANCIAL_CONFIG } = require('../config/settings');
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

            // Gera ID único para o caso
            const caseId = `FIN${Date.now()}`;
            const caseKey = `financial_case:${caseId}`;

            // Traduz o motivo para português
            const reasonMap = {
                payment_issue: 'Problema de Pagamento',
                refund_request: 'Solicitação de Reembolso',
                taxation: 'Taxação/Tributos',
                customs: 'Retenção na Alfândega',
                payment_proof: 'Comprovante de Pagamento',
                other: 'Outro Motivo'
            };

            // Traduz a prioridade para português
            const priorityMap = {
                low: '🟢 Baixa',
                medium: '🟡 Média',
                high: '🟠 Alta',
                urgent: '🔴 Urgente'
            };

            // Monta mensagem para o financeiro
            const message = `*📋 Novo Caso Financeiro - ${caseId}*\n\n` +
                          `*Prioridade:* ${priorityMap[data.priority] || '🟡 Média'}\n` +
                          `*Motivo:* ${reasonMap[data.reason] || data.reason}\n` +
                          (data.order_number ? `*Pedido:* #${data.order_number}\n` : '') +
                          (data.tracking_code ? `*Rastreio:* ${data.tracking_code}\n` : '') +
                          `\n*📱 Mensagem do Cliente:*\n${data.customer_message}\n` +
                          (data.additional_info ? `\n*ℹ️ Informações Adicionais:*\n${data.additional_info}` : '');

            // Salva caso no Redis
            const caseData = {
                ...data,
                id: caseId,
                created_at: new Date().toISOString(),
                status: 'pending'
            };
            
            await this.redisStore.set(caseKey, JSON.stringify(caseData));

            // Envia notificação via WhatsApp
            const whatsapp = this._whatsAppService;
            await whatsapp.forwardToFinancial({ 
                body: message,
                from: 'SISTEMA'
            }, data.order_number);

            console.log('✅ Caso encaminhado ao financeiro:', {
                id: caseId,
                reason: data.reason,
                order: data.order_number,
                priority: data.priority,
                timestamp: new Date().toISOString()
            });

            return true;
        } catch (error) {
            console.error('❌ Erro ao encaminhar caso:', {
                dados: data,
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            return false;
        }
    }

    /**
     * Cria um caso para análise de outro departamento
     * @param {Object} data Dados do caso
     * @param {string} data.department Departamento destino
     * @param {string} data.order_number Número do pedido (opcional)
     * @param {string} data.reason Motivo do encaminhamento
     * @param {string} data.priority Prioridade do caso
     * @param {string} data.details Detalhes adicionais
     * @returns {Promise<boolean>} Sucesso da criação
     */
    async createCase(data) {
        try {
            // Valida dados obrigatórios
            if (!data.department || !data.reason) {
                throw new Error('Departamento e motivo são obrigatórios');
            }

            // Gera ID único para o caso
            const caseId = `CASE${Date.now()}`;
            const caseKey = `department_case:${caseId}`;

            // Traduz o departamento para português
            const departmentMap = {
                support: 'Suporte',
                technical: 'Técnico',
                logistics: 'Logística',
                commercial: 'Comercial'
            };

            // Traduz a prioridade para português
            const priorityMap = {
                urgent: '🔴 Urgente',
                high: '🟠 Alta',
                medium: '🟡 Média',
                low: '🟢 Baixa'
            };

            // Monta mensagem para o departamento
            const message = `*📋 Novo Caso - ${caseId}*\n\n` +
                          `*Departamento:* ${departmentMap[data.department]}\n` +
                          `*Prioridade:* ${priorityMap[data.priority] || '🟡 Média'}\n` +
                          `*Motivo:* ${data.reason}\n` +
                          (data.order_number ? `*Pedido:* #${data.order_number}\n` : '') +
                          (data.tracking_code ? `*Rastreio:* ${data.tracking_code}\n` : '') +
                          `\n*📱 Detalhes do Caso:*\n${data.details || 'Não informado'}\n`;

            // Salva caso no Redis
            const caseData = {
                ...data,
                id: caseId,
                created_at: new Date().toISOString(),
                status: 'pending'
            };
            
            await this.redisStore.set(caseKey, JSON.stringify(caseData));

            // Envia notificação via WhatsApp
            const whatsapp = this._whatsAppService;
            await whatsapp.forwardToDepartment({ 
                body: message,
                from: 'SISTEMA',
                department: data.department
            }, data.order_number, WHATSAPP_CONFIG.departments.financial.number); // Usa mesmo número do financeiro

            console.log('✅ Caso criado:', {
                id: caseId,
                department: data.department,
                reason: data.reason,
                order: data.order_number,
                priority: data.priority,
                timestamp: new Date().toISOString()
            });

            return true;
        } catch (error) {
            console.error('❌ Erro ao criar caso:', {
                dados: data,
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            return false;
        }
    }

    /**
     * Lista casos pendentes do setor financeiro
     * @returns {Promise<Array>} Lista de casos pendentes
     */
    async listPendingCases() {
        try {
            const cases = await this.redisStore.keys('financial_case:*');
            const pendingCases = [];

            for (const caseKey of cases) {
                const caseData = await this.redisStore.get(caseKey);
                if (caseData) {
                    const parsedCase = JSON.parse(caseData);
                    if (parsedCase.status === 'pending') {
                        pendingCases.push(parsedCase);
                    }
                }
            }

            return pendingCases;
        } catch (error) {
            console.error('❌ Erro ao listar casos pendentes:', error);
            return [];
        }
    }

    /**
     * Atualiza o status de um caso
     * @param {string} caseId ID do caso
     * @param {string} status Novo status
     * @param {string} resolution Resolução do caso
     * @returns {Promise<boolean>} Sucesso da atualização
     */
    async updateCaseStatus(caseId, status, resolution) {
        try {
            const caseKey = `financial_case:${caseId}`;
            const caseData = await this.redisStore.get(caseKey);

            if (!caseData) {
                throw new Error('Caso não encontrado');
            }

            const parsedCase = JSON.parse(caseData);
            parsedCase.status = status;
            parsedCase.resolution = resolution;
            parsedCase.updated_at = new Date().toISOString();

            await this.redisStore.set(caseKey, JSON.stringify(parsedCase));

            console.log('✅ Status do caso atualizado:', {
                id: caseId,
                status,
                timestamp: new Date().toISOString()
            });

            return true;
        } catch (error) {
            console.error('❌ Erro ao atualizar status:', error);
            return false;
        }
    }
}

module.exports = { FinancialService };
