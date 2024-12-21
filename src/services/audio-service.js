const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { Queue } = require('../utils/queue');

class AudioService {
    constructor(groqServices, whatsappClient) {
        this.groqServices = groqServices;
        this.whatsappClient = whatsappClient;
        this.audioQueue = new Queue();
        this.tempDir = path.join(__dirname, '../../temp');
        this.ensureTempDir();
    }

    async ensureTempDir() {
        try {
            await fs.access(this.tempDir);
        } catch {
            await fs.mkdir(this.tempDir, { recursive: true });
        }
    }

    async processWhatsAppAudio({ audioMessage }) {
        if (!audioMessage) {
            throw new Error('Mensagem de áudio inválida');
        }

        const audioPath = path.join(this.tempDir, `${uuidv4()}.ogg`);
        const wavPath = path.join(this.tempDir, `${uuidv4()}.wav`);

        try {
            const audioBuffer = await this.whatsappClient.downloadMediaMessage(audioMessage);
            await fs.writeFile(audioPath, audioBuffer);

            await this.convertToWav(audioPath, wavPath);

            const wavBuffer = await fs.readFile(wavPath);
            const transcription = await this.groqServices.transcribeAudio(wavBuffer);

            return transcription;

        } catch (error) {
            console.error('Erro ao processar áudio:', error);
            throw error;
        } finally {
            this.cleanupFiles(audioPath, wavPath);
        }
    }

    convertToWav(inputPath, outputPath) {
        return new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .toFormat('wav')
                .on('error', reject)
                .on('end', resolve)
                .save(outputPath);
        });
    }

    async cleanupFiles(...files) {
        for (const file of files) {
            try {
                await fs.unlink(file);
            } catch (error) {
                console.error(`Erro ao deletar arquivo ${file}:`, error);
            }
        }
    }
}

module.exports = AudioService;
