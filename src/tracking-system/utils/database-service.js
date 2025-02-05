const fs = require('fs').promises;
const path = require('path');
const { logger } = require('./logger');

class DatabaseService {
    constructor() {
        this.dbPath = path.join(__dirname, '../../data/tracking_data.json');
        this.ensureDirectoryExists();
    }

    async ensureDirectoryExists() {
        try {
            await fs.mkdir(path.dirname(this.dbPath), { recursive: true });
            logger.info('Diretório de dados criado/verificado com sucesso:', {
                path: path.dirname(this.dbPath)
            });
        } catch (error) {
            logger.error('Erro ao criar diretório de dados:', {
                error: error.message,
                path: path.dirname(this.dbPath)
            });
            throw error;
        }
    }

    async saveTrackingData(trackingUpdates) {
        try {
            // Lê dados existentes
            let existingData = [];
            try {
                const fileContent = await fs.readFile(this.dbPath, 'utf-8');
                existingData = JSON.parse(fileContent);
            } catch (error) {
                // Arquivo não existe ainda, começará vazio
            }

            // Atualiza ou adiciona novos dados
            const updatedData = this._mergeTrackingData(existingData, trackingUpdates);

            // Salva arquivo
            await fs.writeFile(this.dbPath, JSON.stringify(updatedData, null, 2));
            logger.info(`Dados de rastreio salvos com sucesso: ${trackingUpdates.length} atualizações`);
        } catch (error) {
            logger.error('Erro ao salvar dados de rastreio:', error);
            throw error;
        }
    }

    async getTrackingData(orderId) {
        try {
            const fileContent = await fs.readFile(this.dbPath, 'utf-8');
            const data = JSON.parse(fileContent);
            return data.find(item => item.orderId === orderId);
        } catch (error) {
            logger.error('Erro ao ler dados de rastreio:', error);
            return null;
        }
    }

    _mergeTrackingData(existing, updates) {
        const merged = [...existing];
        
        updates.forEach(update => {
            const index = merged.findIndex(item => item.orderId === update.orderId);
            if (index >= 0) {
                merged[index] = { ...merged[index], ...update };
            } else {
                merged.push(update);
            }
        });

        return merged;
    }
}

module.exports = DatabaseService;
