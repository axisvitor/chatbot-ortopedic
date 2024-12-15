const axios = require('axios');
const { WHATSAPP_CONFIG } = require('../config/settings');

class WhatsAppService {
    constructor() {
        this.axiosInstance = axios.create({
            baseURL: WHATSAPP_CONFIG.apiUrl,
            headers: {
                'Authorization': `Bearer cnQfI8UaFha8fVY7dR80srpxKALKkUmgG`,
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });

        // Adiciona interceptor para log de erros
        this.axiosInstance.interceptors.response.use(
            response => response,
            error => {
                console.error('[WhatsApp] Erro na requisição:', {
                    status: error.response?.status,
                    data: error.response?.data,
                    message: error.message
                });
                return Promise.reject(error);
            }
        );
    }

    /**
     * Delay entre mensagens para evitar bloqueio
     * @returns {Promise<void>}
     */
    async delay() {
        return new Promise(resolve => setTimeout(resolve, WHATSAPP_CONFIG.messageDelay));
    }

    /**
     * Envia uma mensagem de texto
     * @param {string} to - Número do destinatário
     * @param {string} message - Mensagem a ser enviada
     * @returns {Promise<Object>} Resposta da API
     */
    async sendText(to, message) {
        try {
            console.log('[WhatsApp] Enviando mensagem:', {
                to,
                messagePreview: message.substring(0, 100),
                connectionKey: WHATSAPP_CONFIG.connectionKey
            });

            const response = await this.axiosInstance.post(WHATSAPP_CONFIG.endpoints.text, {
                connectionKey: WHATSAPP_CONFIG.connectionKey,
                phone: to,
                message
            });

            console.log('[WhatsApp] Mensagem enviada com sucesso:', {
                to,
                messageId: response.data?.id
            });

            await this.delay();
            return response.data;
        } catch (error) {
            console.error('[WhatsApp] Erro ao enviar mensagem:', error.message);
            throw error;
        }
    }

    /**
     * Envia uma imagem
     * @param {string} to - Número do destinatário
     * @param {string} imageUrl - URL da imagem
     * @param {string} caption - Legenda da imagem
     * @returns {Promise<Object>} Resposta da API
     */
    async sendImage(to, imageUrl, caption = '') {
        try {
            const response = await this.axiosInstance.post(WHATSAPP_CONFIG.endpoints.image, {
                connectionKey: WHATSAPP_CONFIG.connectionKey,
                phone: to,
                image: imageUrl,
                caption
            });

            await this.delay();
            return response.data;
        } catch (error) {
            console.error('[WhatsApp] Erro ao enviar imagem:', error.message);
            throw error;
        }
    }

    /**
     * Envia um documento
     * @param {string} to - Número do destinatário
     * @param {string} documentUrl - URL do documento
     * @param {string} filename - Nome do arquivo
     * @returns {Promise<Object>} Resposta da API
     */
    async sendDocument(to, documentUrl, filename) {
        try {
            const response = await this.axiosInstance.post(WHATSAPP_CONFIG.endpoints.document, {
                connectionKey: WHATSAPP_CONFIG.connectionKey,
                phone: to,
                document: documentUrl,
                filename
            });

            await this.delay();
            return response.data;
        } catch (error) {
            console.error('[WhatsApp] Erro ao enviar documento:', error.message);
            throw error;
        }
    }

    /**
     * Envia um áudio
     * @param {string} to - Número do destinatário
     * @param {string} audioUrl - URL do áudio
     * @returns {Promise<Object>} Resposta da API
     */
    async sendAudio(to, audioUrl) {
        try {
            const response = await this.axiosInstance.post(WHATSAPP_CONFIG.endpoints.audio, {
                connectionKey: WHATSAPP_CONFIG.connectionKey,
                phone: to,
                audio: audioUrl
            });

            await this.delay();
            return response.data;
        } catch (error) {
            console.error('[WhatsApp] Erro ao enviar áudio:', error.message);
            throw error;
        }
    }

    /**
     * Notifica o departamento financeiro sobre um novo comprovante
     * @param {Object} paymentInfo - Informações do pagamento
     * @returns {Promise<void>}
     */
    async notifyFinancialDepartment(paymentInfo) {
        try {
            const message = this.formatPaymentNotification(paymentInfo);
            await this.sendText(WHATSAPP_CONFIG.departments.financial.number, message);

            if (paymentInfo.imageUrl) {
                await this.sendImage(
                    WHATSAPP_CONFIG.departments.financial.number,
                    paymentInfo.imageUrl,
                    'Comprovante de pagamento'
                );
            }
        } catch (error) {
            console.error('[WhatsApp] Erro ao notificar departamento financeiro:', error.message);
            throw error;
        }
    }

    /**
     * Formata a notificação de pagamento
     * @param {Object} paymentInfo - Informações do pagamento
     * @returns {string} Mensagem formatada
     */
    formatPaymentNotification(paymentInfo) {
        const parts = [
            '🔔 *Novo Comprovante de Pagamento*\n',
            paymentInfo.amount ? `💰 Valor: R$ ${paymentInfo.amount.toFixed(2)}` : '',
            paymentInfo.bank ? `🏦 Banco: ${paymentInfo.bank}` : '',
            paymentInfo.paymentType ? `💳 Tipo: ${paymentInfo.paymentType}` : '',
            paymentInfo.from ? `📱 De: ${paymentInfo.from}` : '',
            paymentInfo.timestamp ? `⏰ Data: ${new Date(paymentInfo.timestamp).toLocaleString('pt-BR')}` : ''
        ];

        return parts.filter(Boolean).join('\n');
    }

    /**
     * Verifica o status de uma mensagem
     * @param {string} messageId - ID da mensagem
     * @returns {Promise<Object>} Status da mensagem
     */
    async getMessageStatus(messageId) {
        try {
            const response = await this.axiosInstance.get(`${WHATSAPP_CONFIG.endpoints.status}/${messageId}`, {
                params: {
                    connectionKey: WHATSAPP_CONFIG.connectionKey
                }
            });

            return response.data;
        } catch (error) {
            console.error('[WhatsApp] Erro ao verificar status da mensagem:', error.message);
            throw error;
        }
    }
}

module.exports = { WhatsAppService };
