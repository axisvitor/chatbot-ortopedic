const { RedisStore } = require('../store/redis-store');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');
const { WHATSAPP_CONFIG } = require('../config/settings');

class ForwardingService {
    constructor() {
        this.redisStore = new RedisStore();
        this.ticketPrefix = 'ticket:';
        this.ticketTTL = 30 * 24 * 60 * 60; // 30 dias
    }

    /**
     * Gera um novo ID de ticket
     * @private
     */
    _generateTicketId() {
        return `${this.ticketPrefix}${uuidv4()}`;
    }

    /**
     * Salva um ticket no Redis
     * @private
     */
    async _saveTicket(ticket) {
        try {
            const key = `${this.ticketPrefix}${ticket.id}`;
            await this.redisStore.set(key, JSON.stringify(ticket), this.ticketTTL);
            logger.info('[ForwardingService] Ticket salvo:', { ticketId: ticket.id });
            return true;
        } catch (error) {
            logger.error('[ForwardingService] Erro ao salvar ticket:', error);
            return false;
        }
    }

    /**
     * Cria um novo ticket com dados básicos
     * @private
     */
    _createBaseTicket(customerId, priority, message) {
        return {
            id: this._generateTicketId(),
            customerId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            status: 'pending',
            priority,
            message,
            history: [{
                timestamp: new Date().toISOString(),
                action: 'created',
                details: 'Ticket criado'
            }]
        };
    }

    /**
     * Encaminha caso para o setor financeiro
     */
    async forwardToFinancial({ customerId, orderNumber, reason, priority, message }) {
        try {
            // Cria o ticket base
            const ticket = {
                ...this._createBaseTicket(customerId, priority, message),
                type: 'financial',
                orderNumber,
                reason,
                department: 'financial',
                departmentNumber: WHATSAPP_CONFIG.departments.financial,
                meta: {
                    financialReason: reason
                }
            };

            // Adiciona detalhes específicos baseado no motivo
            switch (reason) {
                case 'payment_issue':
                    ticket.meta.requiresImmediate = true;
                    ticket.meta.category = 'payment';
                    break;
                case 'refund_request':
                    ticket.meta.category = 'refund';
                    ticket.meta.requiresApproval = true;
                    break;
                case 'payment_proof':
                    ticket.meta.category = 'proof';
                    ticket.meta.requiresValidation = true;
                    break;
                // Outros casos específicos...
            }

            // Salva o ticket
            const saved = await this._saveTicket(ticket);
            if (!saved) {
                throw new Error('Falha ao salvar ticket');
            }

            // Notifica o departamento financeiro (implementar integração real depois)
            logger.info('[ForwardingService] Caso encaminhado para financeiro:', {
                ticketId: ticket.id,
                customerId,
                orderNumber,
                reason,
                priority
            });

            return {
                success: true,
                message: 'Caso encaminhado com sucesso',
                ticketId: ticket.id
            };

        } catch (error) {
            logger.error('[ForwardingService] Erro ao encaminhar para financeiro:', error);
            throw error;
        }
    }

    /**
     * Encaminha caso para departamento específico
     */
    async forwardToDepartment({ customerId, department, orderNumber, reason, priority, message }) {
        try {
            if (!WHATSAPP_CONFIG.departments[department]) {
                throw new Error(`Departamento ${department} não configurado`);
            }

            // Valida o departamento
            const validDepartments = ['support', 'technical', 'logistics', 'commercial'];
            if (!validDepartments.includes(department)) {
                throw new Error(`Departamento inválido: ${department}`);
            }

            // Cria o ticket base
            const ticket = {
                ...this._createBaseTicket(customerId, priority, message),
                type: 'department',
                department,
                orderNumber,
                reason,
                departmentNumber: WHATSAPP_CONFIG.departments[department],
                meta: {
                    departmentSpecific: {
                        category: this._getDepartmentCategory(department, reason)
                    }
                }
            };

            // Adiciona campos específicos por departamento
            switch (department) {
                case 'logistics':
                    ticket.meta.trackingRequired = true;
                    ticket.meta.requiresShippingReview = true;
                    break;
                case 'technical':
                    ticket.meta.requiresTechnicalAssessment = true;
                    break;
                case 'support':
                    ticket.meta.customerSatisfaction = 'pending_review';
                    break;
                case 'commercial':
                    ticket.meta.businessImpact = 'to_be_evaluated';
                    break;
            }

            // Salva o ticket
            const saved = await this._saveTicket(ticket);
            if (!saved) {
                throw new Error('Falha ao salvar ticket');
            }

            // Notifica o departamento (implementar integração real depois)
            logger.info('[ForwardingService] Caso encaminhado para departamento:', {
                ticketId: ticket.id,
                department,
                customerId,
                orderNumber,
                reason,
                priority
            });

            return {
                success: true,
                message: 'Caso encaminhado com sucesso',
                ticketId: ticket.id
            };

        } catch (error) {
            logger.error('[ForwardingService] Erro ao encaminhar para departamento:', error);
            throw error;
        }
    }

    /**
     * Determina a categoria baseada no departamento e razão
     * @private
     */
    _getDepartmentCategory(department, reason) {
        const categories = {
            support: {
                default: 'general_support',
                product_doubt: 'product_information',
                size_guide: 'sizing_help'
            },
            technical: {
                default: 'technical_assessment',
                product_specification: 'spec_review',
                compatibility: 'compatibility_check'
            },
            logistics: {
                default: 'shipping_general',
                delivery_delay: 'delay_investigation',
                address_change: 'address_update'
            },
            commercial: {
                default: 'commercial_general',
                bulk_order: 'bulk_purchase',
                partnership: 'partnership_request'
            }
        };

        return categories[department][reason] || categories[department].default;
    }

    /**
     * Busca um ticket pelo ID
     */
    async getTicket(ticketId) {
        try {
            const key = `${this.ticketPrefix}${ticketId}`;
            const ticket = await this.redisStore.get(key);
            return ticket ? JSON.parse(ticket) : null;
        } catch (error) {
            logger.error('[ForwardingService] Erro ao buscar ticket:', error);
            return null;
        }
    }

    /**
     * Atualiza o status de um ticket
     */
    async updateTicketStatus(ticketId, newStatus, details = '') {
        try {
            const ticket = await this.getTicket(ticketId);
            if (!ticket) {
                throw new Error('Ticket não encontrado');
            }

            ticket.status = newStatus;
            ticket.updatedAt = new Date().toISOString();
            ticket.history.push({
                timestamp: new Date().toISOString(),
                action: 'status_update',
                details: details || `Status atualizado para ${newStatus}`
            });

            await this._saveTicket(ticket);
            return true;
        } catch (error) {
            logger.error('[ForwardingService] Erro ao atualizar status do ticket:', error);
            return false;
        }
    }
}

module.exports = { ForwardingService };
