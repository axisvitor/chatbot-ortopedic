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

    async processTrackingRequest(trackingNumber, cpf) {
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
            return this._formatTrackingResponse(trackInfo);
            
        } catch (error) {
            console.error('[Tracking] Erro ao processar rastreamento:', error);
            throw error;
        }
    }

    _formatTrackingResponse(trackInfo) {
        try {
            // Formata a resposta com os eventos disponíveis
            let response = `📦 *Status do Rastreamento*\n\n`;
            response += `*Código:* ${trackInfo.number}\n`;
            
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

            // Adiciona última informação
            if (trackInfo.latest_event_info) {
                response += `*Situação:* ${trackInfo.latest_event_info}\n`;
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
}

module.exports = { TrackingService };
