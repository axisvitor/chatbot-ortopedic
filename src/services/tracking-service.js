'use strict';

const https = require('https');
const { TRACKING_CONFIG } = require('../config/settings');

class TrackingService {
    constructor() {
        this.config = TRACKING_CONFIG;
    }

    async registerTracking(trackingNumber) {
        const data = JSON.stringify([{
            number: trackingNumber,
            carrier: 'auto'
        }]);

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

        return await this._makeRequest(options, data);
    }

    async getTrackingStatus(trackingNumber, carrier) {
        const data = JSON.stringify([{
            number: trackingNumber,
            carrier: carrier || 'auto'
        }]);

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

    async processTrackingRequest(trackingNumber, cpf) {
        try {
            if (!trackingNumber) {
                throw new Error('Número de rastreamento é obrigatório');
            }

            if (!cpf) {
                throw new Error('CPF é obrigatório para consulta de rastreamento');
            }

            // 1. Registrar o número de rastreamento
            const registrationResult = await this.registerTracking(trackingNumber);
            
            if (registrationResult.code !== 0) {
                throw new Error(`Erro ao registrar rastreamento: ${registrationResult.message || 'Erro desconhecido'}`);
            }

            // 2. Se o registro foi bem sucedido e retornou um carrier
            if (registrationResult.data && registrationResult.data.accepted && registrationResult.data.accepted.length > 0) {
                const carrier = registrationResult.data.accepted[0].carrier;
                
                // 3. Consultar o status usando o carrier retornado
                const statusResult = await this.getTrackingStatus(trackingNumber, carrier);
                
                if (statusResult.code !== 0) {
                    throw new Error(`Erro ao consultar status: ${statusResult.message || 'Erro desconhecido'}`);
                }

                return this._formatTrackingResponse(statusResult);
            } else {
                throw new Error('Número de rastreamento inválido ou não reconhecido');
            }
        } catch (error) {
            console.error('Erro ao processar rastreamento:', error);
            throw error;
        }
    }

    _formatTrackingResponse(statusResult) {
        try {
            if (!statusResult.data || !statusResult.data.accepted || statusResult.data.accepted.length === 0) {
                return 'Não foi possível encontrar informações para este rastreamento.';
            }

            const tracking = statusResult.data.accepted[0];
            
            // Verifica se temos as informações necessárias
            if (!tracking.package_status || !tracking.latest_event_info) {
                return 'Ainda não há informações disponíveis para este rastreamento.';
            }

            const status = tracking.package_status;
            const lastEvent = tracking.latest_event_info;
            const lastEventTime = tracking.latest_event_time ? 
                new Date(tracking.latest_event_time).toLocaleString('pt-BR') :
                'Não disponível';

            // Verifica se o pedido está taxado ou aguardando pagamento
            const isTaxed = lastEvent.toLowerCase().includes('aguardando pagamento') || 
                          lastEvent.toLowerCase().includes('tributo') ||
                          lastEvent.toLowerCase().includes('taxa') ||
                          status.toLowerCase().includes('taxado');

            let response = `Status do rastreamento:
 Número: ${tracking.number}
 Situação: ${status}
 Última atualização: ${lastEventTime}
 Detalhes: ${lastEvent}`;

            if (isTaxed) {
                response += `\n\n⚠️ ATENÇÃO: Seu pedido foi taxado!
 
 Para prosseguir com a entrega, é necessário pagar a taxa dos Correios.
 Para pagar a taxa:
 1. Acesse: https://apps.correios.com.br/portalimportador
 2. Digite seu CPF e o código de rastreamento
 3. Siga as instruções para pagamento
 
 ℹ️ Após o pagamento, aguarde 1-2 dias úteis para atualização do status.`;
            }

            return response;
        } catch (error) {
            console.error('Erro ao formatar resposta:', error);
            return 'Ocorreu um erro ao processar as informações do rastreamento. Por favor, tente novamente mais tarde.';
        }
    }
}

module.exports = { TrackingService };
