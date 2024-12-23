'use strict';

const https = require('https');
const { TRACKING_CONFIG } = require('../config/settings');

class TrackingService {
    constructor() {
        this.config = TRACKING_CONFIG;
    }

    async registerTracking(trackingNumber) {
        console.log('[17Track] Iniciando registro de rastreio:', {
            trackingNumber,
            apiKeyLength: this.config.apiKey?.length,
            hasApiKey: !!this.config.apiKey
        });

        const data = JSON.stringify({
            "tracking_number": trackingNumber
        });

        const options = {
            hostname: this.config.endpoint,
            path: this.config.paths.register,
            method: 'POST',
            headers: {
                '17token': this.config.apiKey,
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        };

        console.log('[17Track] Configuração da requisição:', {
            endpoint: options.hostname,
            path: options.path,
            method: options.method,
            requestData: JSON.parse(data)
        });

        return await this._makeRequest(options, data);
    }

    async getTrackingStatus(trackingNumber, carrier) {
        const data = JSON.stringify({
            "tracking_number": trackingNumber,
            "carrier_code": carrier || undefined
        });

        const options = {
            hostname: this.config.endpoint,
            path: this.config.paths.status,
            method: 'POST',
            headers: {
                '17token': this.config.apiKey,
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        };

        return await this._makeRequest(options, data);
    }

    async getTrackingStatus(trackingNumber) {
        const data = JSON.stringify({
            "tracking_number": trackingNumber
        });

        const options = {
            hostname: this.config.endpoint,
            path: this.config.paths.status,
            method: 'POST',
            headers: {
                '17token': this.config.apiKey,
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        };

        return await this._makeRequest(options, data);
    }

    async _makeRequest(options, data) {
        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let responseData = '';

                res.on('data', (chunk) => {
                    responseData += chunk;
                });

                res.on('end', () => {
                    try {
                        const parsedData = JSON.parse(responseData);
                        
                        // Verifica se a resposta indica erro de autenticação
                        if (parsedData.code === 401 || parsedData.code === 403) {
                            reject(new Error('Erro de autenticação com a API de rastreamento. Verifique sua chave API.'));
                            return;
                        }
                        
                        resolve(parsedData);
                    } catch (error) {
                        console.error('Error parsing response:', error);
                        reject(new Error('Erro ao processar resposta da API de rastreamento'));
                    }
                });
            });

            req.on('error', (error) => {
                console.error('Request error:', error);
                reject(new Error('Erro de conexão com a API de rastreamento'));
            });

            // Timeout de 30 segundos
            req.setTimeout(30000, () => {
                req.destroy();
                reject(new Error('Timeout na requisição de rastreamento'));
            });

            req.write(data);
            req.end();
        });
    }

    async processTrackingRequest(trackingNumber, cpf, from) {
        try {
            if (!trackingNumber) {
                throw new Error('Número de rastreamento é obrigatório');
            }

            // CPF é apenas para controle interno
            if (!cpf) {
                throw new Error('CPF é obrigatório para consulta de rastreamento');
            }

            // Remove espaços e caracteres especiais do número de rastreamento
            trackingNumber = trackingNumber.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

            console.log('[Tracking] Iniciando consulta:', {
                trackingNumber
            });

            // Consultar o status diretamente
            const statusResult = await this.getTrackingStatus(trackingNumber);
            
            console.log('[Tracking] Resultado da consulta:', JSON.stringify(statusResult, null, 2));

            if (statusResult.code !== 0) {
                throw new Error(`Erro ao consultar status: ${statusResult.message || 'Erro desconhecido'}`);
            }

            // Se tem erros na resposta
            if (statusResult.data?.errors?.length > 0) {
                const error = statusResult.data.errors[0];
                console.log('[Tracking] Erro na consulta:', JSON.stringify(error, null, 2));
                throw new Error(`Erro na consulta: ${error.message || 'Erro desconhecido'}`);
            }

            // Verifica se tem dados aceitos
            if (!statusResult.data?.accepted?.length) {
                return 'Não foi possível encontrar informações para este rastreamento no momento. Por favor, tente novamente mais tarde.';
            }

            const trackInfo = statusResult.data.accepted[0];

            // Se não tem eventos
            if (!trackInfo.latest_event_info) {
                return `📦 *Status do Rastreamento*\n\n*Código:* ${trackingNumber}\n\n_Ainda não há eventos de movimentação registrados._`;
            }

            // Formata a resposta com os eventos
            return this._formatTrackingResponse(trackInfo, from);
            
        } catch (error) {
            console.error('[Tracking] Erro ao processar rastreamento:', error);
            throw error;
        }
    }

    _formatTrackingResponse(trackInfo, from) {
        try {
            // Formata a resposta com os eventos disponíveis
            let response = `📦 *Status do Rastreamento*\n\n`;
            response += `*Código:* ${trackInfo.number}\n`;
            
            // Verifica se está em tributação para encaminhar ao financeiro
            const isCustomsHold = trackInfo.package_status === 'CustomsHold' || 
                                /tribut|taxa|imposto|aduaneir/i.test(trackInfo.latest_event_info);
            
            if (isCustomsHold) {
                try {
                    // Busca informações do pedido no Redis
                    const orderKey = `pending_order:${from}`;
                    const orderNumber = await this.redisStore.get(orderKey);
                    let orderInfo = null;
                    
                    if (orderNumber) {
                        orderInfo = await this.nuvemshopService.getOrderByNumber(orderNumber);
                    }
                    
                    // Encaminha para o financeiro
                    const financialMessage = {
                        type: 'tracking_customs',
                        trackingNumber: trackInfo.number,
                        status: trackInfo.package_status,
                        lastUpdate: trackInfo.latest_event_time,
                        originalMessage: trackInfo.latest_event_info,
                        from: from,
                        orderDetails: orderInfo ? {
                            number: orderInfo.number,
                            customerName: orderInfo.customer?.name || 'Não informado',
                            customerPhone: orderInfo.customer?.phone || from
                        } : {
                            number: 'Não encontrado',
                            customerName: 'Não encontrado',
                            customerPhone: from
                        }
                    };
                    
                    // Formata mensagem para o financeiro
                    const financialNotification = `🚨 *Pedido em Tributação*\n\n` +
                        `📦 Rastreio: ${trackInfo.number}\n` +
                        `🛍️ Pedido: #${financialMessage.orderDetails.number}\n` +
                        `👤 Cliente: ${financialMessage.orderDetails.customerName}\n` +
                        `📱 Telefone: ${financialMessage.orderDetails.customerPhone}\n` +
                        `📅 Atualização: ${new Date(trackInfo.latest_event_time).toLocaleString('pt-BR')}\n` +
                        `📝 Status Original: ${trackInfo.latest_event_info}`;
                    
                    await this.whatsAppService.forwardToFinancial(financialMessage, financialNotification);
                    
                    console.log('💰 Notificação enviada ao financeiro:', {
                        rastreio: trackInfo.number,
                        pedido: financialMessage.orderDetails.number,
                        cliente: financialMessage.orderDetails.customerName,
                        telefone: financialMessage.orderDetails.customerPhone,
                        timestamp: new Date().toISOString()
                    });
                } catch (error) {
                    console.error('❌ Erro ao notificar financeiro:', error);
                }
            }
            
            // Adiciona informações do status atual
            if (trackInfo.package_status) {
                let status = '';
                switch(trackInfo.package_status) {
                    case 'InTransit':
                        status = '📫 Em Trânsito';
                        break;
                    case 'Delivered':
                        status = '✅ Entregue';
                        break;
                    case 'Pickup':
                        status = '🚚 Coletado';
                        break;
                    case 'CustomsHold':
                        status = '📦 Em processamento';
                        break;
                    default:
                        status = trackInfo.package_status;
                }
                response += `*Status:* ${status}\n`;
            }

            // Adiciona última atualização
            if (trackInfo.latest_event_time) {
                const date = new Date(trackInfo.latest_event_time);
                response += `*Última Atualização:* ${date.toLocaleString('pt-BR')}\n`;
            }

            // Filtra mensagens de tributação/taxação
            if (trackInfo.latest_event_info) {
                let situacao = trackInfo.latest_event_info;
                
                // Lista de termos para filtrar
                const termsToReplace = [
                    /aguardando pagamento de tributos/i,
                    /em processo de tributação/i,
                    /pagamento de tributos/i,
                    /taxa/i,
                    /tribut[oaçã]/i,
                    /imposto/i,
                    /declaração aduaneira/i
                ];
                
                // Substitui termos relacionados à tributação
                if (termsToReplace.some(term => term.test(situacao))) {
                    situacao = 'Em processamento na unidade dos Correios';
                }
                
                response += `*Situação:* ${situacao}\n`;
            }

            // Adiciona tempo em trânsito
            if (trackInfo.days_of_transit) {
                response += `\n_Tempo em trânsito: ${trackInfo.days_of_transit} dias_\n`;
            }

            return response;

        } catch (error) {
            console.error('[Tracking] Erro ao formatar resposta:', error);
            return 'Desculpe, ocorreu um erro ao formatar as informações do rastreamento.';
        }
    }

    /**
     * Valida se o texto parece ser um código de rastreio
     * @param {string} text - Texto para validar
     * @returns {string|null} Código de rastreio limpo ou null
     */
    validateTrackingNumber(text) {
        if (!text) return null;

        // Remove espaços e caracteres especiais
        const cleanText = text.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

        // Padrões comuns de rastreio
        const patterns = [
            /^[A-Z]{2}\d{9}[A-Z]{2}$/,     // Correios: BR123456789BR
            /^[A-Z]{2}\d{12}$/,             // DHL, FedEx: XX123456789012
            /^1Z[A-Z0-9]{16}$/,             // UPS: 1Z999AA1234567890
            /^[A-Z]{3}\d{7}$/,              // TNT: ABC1234567
            /^\d{12,14}$/                    // Outros: 123456789012
        ];

        // Verifica se o texto limpo corresponde a algum padrão
        if (patterns.some(pattern => pattern.test(cleanText))) {
            return cleanText;
        }

        return null;
    }

    /**
     * Verifica se o texto contém palavras relacionadas a rastreamento
     * @param {string} text - Texto para verificar
     * @returns {boolean}
     */
    hasTrackingKeywords(text) {
        if (!text) return false;

        const keywords = [
            'rastrear', 'rastreio', 'rastreamento',
            'entrega', 'entregar', 'entregue',
            'código', 'codigo', 'track',
            'correio', 'correios', 'transportadora',
            'pedido', 'encomenda', 'pacote'
        ];

        const normalizedText = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return keywords.some(keyword => normalizedText.includes(keyword));
    }
}

module.exports = { TrackingService };
