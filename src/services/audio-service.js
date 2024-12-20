const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const os = require('os');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { GROQ_CONFIG } = require('../config/settings');
const { Queue } = require('../utils/queue'); // Importa a classe Queue

class AudioService {
    constructor() {
        this.audioQueue = new Queue(); // Inicializa a fila de áudio
        ffmpeg.setFfmpegPath(ffmpegPath);
    }

    async processAudio(media, message) {
        return new Promise((resolve, reject) => {
            this.audioQueue.enqueue(async () => {
                try {
                    const result = await this._processAudio(media, message);
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    async _processAudio(media, message) {
        try {
            const audioBuffer = await downloadMediaMessage(message, 'buffer');
            const tempDir = os.tmpdir();
            const tempInputPath = path.join(tempDir, `${crypto.randomBytes(16).toString('hex')}.ogg`);
            const tempOutputPath = path.join(tempDir, `${crypto.randomBytes(16).toString('hex')}.wav`);

            fs.writeFileSync(tempInputPath, audioBuffer);

            await new Promise((resolve, reject) => {
                ffmpeg(tempInputPath)
                    .audioCodec('pcm_s16le')
                    .format('wav')
                    .on('end', () => resolve())
                    .on('error', (err) => {
                        console.error('❌ Erro ao converter áudio:', err);
                        reject(new Error(`Erro ao converter áudio: ${err.message}`));
                    })
                    .save(tempOutputPath);
            });

            const audioFile = fs.readFileSync(tempOutputPath);
            const formData = new FormData();
            formData.append('file', audioFile, 'audio.wav');

            const response = await axios.post(GROQ_CONFIG.audioUrl, formData, {
                headers: {
                    ...formData.getHeaders(),
                    'Authorization': `Bearer ${GROQ_CONFIG.apiKey}`
                },
                timeout: 30000
            });

            fs.unlinkSync(tempInputPath);
            fs.unlinkSync(tempOutputPath);

            if (response.status !== 200) {
                console.error('❌ Erro na API Groq:', response.status, response.data);
                throw new Error(`Erro na API Groq: ${response.status} - ${JSON.stringify(response.data)}`);
            }

            return response.data.text;

        } catch (error) {
            console.error('❌ Erro geral no processamento de áudio:', error);
            throw error;
        }
    }
}

module.exports = AudioService;
