const { RedisStore } = require('../store/redis-store');
const { WHATSAPP_CONFIG } = require('../config/settings');

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
                low: '🟢 Baixa',
                medium: '🟡 Média',
                high: '🟠 Alta',
                urgent: '🔴 Urgente'
            };

            // Monta mensagem para o departamento
            const message = `*📋 Novo Caso - ${caseId}*\n\n` +
                          `*Departamento:* ${departmentMap[data.department]}\n` +
                          `*Prioridade:* ${priorityMap[data.priority] || '🟡 Média'}\n` +
                          `*Motivo:* ${data.reason}\n` +
                          (data.order_number ? `*Pedido:* #${data.order_number}\n` : '') +
                          (data.tracking_code ? `*Rastreio:* ${data.tracking_code}\n` : '') +
                          `\n*📱 Mensagem do Cliente:*\n${data.customer_message.replace(/(\r\n|\n|\r)/gm, '\n')}\n` +
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
            if (!whatsapp) {
                throw new Error('WhatsApp service não configurado');
            }

            await whatsapp.forwardToDepartment({ 
                body: message,
                from: 'SISTEMA',
                department: data.department
            }, data.order_number);

            console.log('✅ Caso encaminhado ao departamento:', {
                id: caseId,
                department: data.department,
                reason: data.reason,
                order: data.order_number,
                priority: data.priority,
                timestamp: new Date().toISOString()
            });

            return true;
        } catch (error) {
            console.error('❌ Erro ao encaminhar caso:', {
                department: data.department,
                dados: data,
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            return false;
        }
    }

    /**
     * Define o serviço WhatsApp após inicialização
     * @param {Object} whatsappService - Serviço de WhatsApp
     */
    setWhatsAppService(whatsappService) {
        this.whatsAppService = whatsappService;
    }
}

module.exports = { DepartmentService };
