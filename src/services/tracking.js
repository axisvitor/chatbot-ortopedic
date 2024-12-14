const httpClient = require('../utils/http-client');
const { TRACKING_CONFIG } = require('../config/settings');

class TrackingService {
  constructor(redisStore, whatsappService) {
    this.redisStore = redisStore;
    this.whatsappService = whatsappService;
    this.config = TRACKING_CONFIG;
  }

  async trackOrder(trackingNumber) {
    try {
      const response = await httpClient.post(
        this.config.endpoint,
        {
          tracking_number: trackingNumber,
          carrier: 'auto'
        },
        {
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('Error tracking order:', error);
      throw error;
    }
  }

  async saveTrackingInfo(phone, trackingNumber) {
    try {
      await this.redisStore.set(`tracking:${phone}`, trackingNumber);
      return true;
    } catch (error) {
      console.error('Error saving tracking info:', error);
      return false;
    }
  }

  async getTrackingNumber(phone) {
    try {
      return await this.redisStore.get(`tracking:${phone}`);
    } catch (error) {
      console.error('Error getting tracking number:', error);
      return null;
    }
  }

  async notifyCustomer(customerPhone, trackingInfo) {
    try {
      // Verifica se o pedido está taxado
      const isTaxed = trackingInfo.status.toLowerCase().includes('taxado') || 
                     (trackingInfo.details && trackingInfo.details.toLowerCase().includes('taxad'));

      if (isTaxed) {
        // Notifica o departamento financeiro
        await this.notifyFinancialDepartment(trackingInfo, customerPhone);
      }

      // Envia mensagem filtrada para o cliente
      const message = this.formatTrackingMessage(trackingInfo);
      await this.whatsappService.sendMessage(customerPhone, message);
      return true;
    } catch (error) {
      console.error('Error notifying about tracking:', error);
      throw error;
    }
  }

  formatTrackingMessage(trackingInfo) {
    // Remove informações sobre taxação da mensagem para o cliente
    const status = trackingInfo.status.toLowerCase().includes('taxado') ? 
      'Em processamento na alfândega' : trackingInfo.status;

    return `🚚 *Atualização do Rastreamento*\n\n` +
           `📦 Código: ${trackingInfo.tracking_number}\n` +
           `📍 Status: ${status}\n` +
           `📅 Última Atualização: ${new Date(trackingInfo.updated_at).toLocaleString('pt-BR')}\n\n` +
           `✍️ Detalhes: ${this.filterCustomsInfo(trackingInfo.details) || 'Sem detalhes disponíveis'}`;
  }

  filterCustomsInfo(details) {
    if (!details) return null;
    // Remove menções a taxação/alfândega do texto
    return details.replace(/taxad[oa]/gi, 'em processamento')
                 .replace(/\btaxa\b/gi, 'processo')
                 .replace(/alfândega/gi, 'processo alfandegário');
  }

  formatCustomsNotification(trackingInfo, customerPhone) {
    const timestamp = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    
    return `🚨 *Pedido Taxado na Alfândega*\n\n` +
           `📦 Código de Rastreio: ${trackingInfo.tracking_number}\n` +
           `📱 Telefone Cliente: ${customerPhone}\n` +
           `📅 Data: ${timestamp}\n` +
           `📍 Status: ${trackingInfo.status}\n\n` +
           `✍️ Detalhes: ${trackingInfo.details || 'Sem detalhes disponíveis'}`;
  }

  async notifyFinancialDepartment(trackingInfo, customerPhone) {
    try {
      if (!this.whatsappService.financialDeptNumber) {
        throw new Error('Financial department number not configured');
      }

      const message = this.formatCustomsNotification(trackingInfo, customerPhone);
      await this.whatsappService.sendMessage(this.whatsappService.financialDeptNumber, message);
      
      return true;
    } catch (error) {
      console.error('Error notifying financial department about customs:', error);
      throw error;
    }
  }
}

module.exports = { TrackingService };
