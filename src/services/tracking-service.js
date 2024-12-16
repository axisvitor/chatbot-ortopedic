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

        console.log('[17Track] Configuração da requisição:', {
            endpoint: options.hostname,
            path: options.path,
            method: options.method
        });

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

            // CPF é apenas para controle interno
            if (!cpf) {
                throw new Error('CPF é obrigatório para consulta de rastreamento');
            }

            // Remove espaços e caracteres especiais do número de rastreamento
            trackingNumber = trackingNumber.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

            console.log('[Tracking] Iniciando consulta:', {
                trackingNumber
            });

            // 1. Registrar o número de rastreamento
            const registrationResult = await this.registerTracking(trackingNumber);
            
            console.log('[Tracking] Resultado do registro:', registrationResult);

            if (registrationResult.code !== 0) {
                throw new Error(`Erro ao registrar rastreamento: ${registrationResult.message || 'Erro desconhecido'}`);
            }

            // Tenta consultar o status mesmo sem carrier identificado
            const statusResult = await this.getTrackingStatus(trackingNumber, 'auto');
            
            console.log('[Tracking] Resultado da consulta:', statusResult);

            if (statusResult.code !== 0) {
                throw new Error(`Erro ao consultar status: ${statusResult.message || 'Erro desconhecido'}`);
            }

            if (!statusResult.data || !Array.isArray(statusResult.data)) {
                throw new Error('Formato de resposta inválido do serviço de rastreamento');
            }

            // Formata a resposta mesmo se não houver eventos
            return this._formatTrackingResponse(statusResult);
            
        } catch (error) {
            console.error('[Tracking] Erro ao processar rastreamento:', error);
            throw error;
        }
    }

    _formatTrackingResponse(statusResult) {
        try {
            if (!statusResult.data || !Array.isArray(statusResult.data)) {
                return 'Não foi possível encontrar informações para este rastreamento no momento. Por favor, tente novamente mais tarde.';
            }

            // Se não houver eventos ainda
            if (statusResult.data.length === 0 || !statusResult.data[0].events || statusResult.data[0].events.length === 0) {
                return 'O código de rastreamento foi registrado, mas ainda não há eventos de movimentação. Por favor, aguarde e tente novamente mais tarde.';
            }

            const tracking = statusResult.data[0];
            const events = tracking.events || [];
            
            // Formata a resposta com os eventos disponíveis
            let response = `📦 *Status do Rastreamento*\n\n`;
            response += `*Código:* ${tracking.number}\n`;
            response += `*Transportadora:* ${tracking.carrier || 'Não identificada'}\n\n`;
            
            response += '*Movimentações:*\n';
            events.forEach((event, index) => {
                response += `\n📍 ${event.date || 'Data não informada'}\n`;
                response += `${event.status || 'Status não informado'}\n`;
                if (event.location) response += `📌 ${event.location}\n`;
            });

            return response;

        } catch (error) {
            console.error('[Tracking] Erro ao formatar resposta:', error);
            return 'Desculpe, ocorreu um erro ao formatar as informações do rastreamento.';
        }
    }
}

module.exports = { TrackingService };
