# Chatbot Ortopédico

Chatbot inteligente para atendimento de clientes de loja de calçados ortopédicos.

## Estrutura do Projeto

```
src/
├── config/
│   └── settings.js          # Configurações do projeto
├── services/
│   ├── ai-services.js       # Serviços de IA (OpenAI)
│   ├── audio-service.js     # Processamento de áudio
│   ├── business-hours.js    # Controle de horário comercial
│   ├── groq-services.js     # Serviços Groq (áudio e imagem)
│   ├── image-service.js     # Processamento de imagens
│   ├── nuvemshop-service.js # Integração com Nuvemshop
│   ├── redis-store.js       # Cache Redis e histórico
│   ├── tracking.js          # Serviço de rastreamento
│   ├── webhook-service.js   # Processamento de webhooks
│   └── whatsapp.js         # Serviço do WhatsApp
├── utils/
│   └── image-validator.js   # Validação de imagens
└── server.js               # Servidor principal
```

## Configuração

1. Clone o repositório
2. Instale as dependências:
   ```bash
   npm install
   ```
3. Configure as variáveis de ambiente no arquivo `.env`:
   ```env
   # OpenAI
   OPENAI_API_KEY=sua_chave
   ASSISTANT_ID=seu_assistant_id

   # Groq
   GROQ_API_KEY=sua_chave

   # Redis
   REDIS_HOST=seu_host
   REDIS_PORT=sua_porta
   REDIS_PASSWORD=sua_senha

   # WhatsApp
   WAPI_URL=sua_url
   WAPI_TOKEN=seu_token
   WAPI_CONNECTION_KEY=sua_chave

   # Nuvemshop
   NUVEMSHOP_ACCESS_TOKEN=seu_token
   NUVEMSHOP_API_URL=sua_url
   NUVEMSHOP_STORE_ID=seu_id

   # Outros
   NODE_ENV=production
   PORT=8080
   FINANCIAL_DEPT_NUMBER=numero_whatsapp
   ```

## Uso

Para iniciar o servidor:

```bash
npm start
```

O servidor estará rodando na porta especificada no .env (padrão: 8080).

## Endpoints

- `GET /` - Healthcheck
- `POST /webhook/msg_recebidas_ou_enviadas` - Webhook principal para mensagens do WhatsApp

## Recursos

### Processamento de Mensagens
- ✅ Texto: Processado pelo OpenAI Assistant
- ✅ Áudio: Transcrito pelo Groq Whisper e processado pelo Assistant
- ✅ Imagens: Analisadas pelo Groq Vision e processadas pelo Assistant

### Integração com E-commerce
- ✅ Consulta de produtos
- ✅ Verificação de estoque
- ✅ Consulta de pedidos
- ✅ Validação segura de identidade

### Armazenamento e Cache
- ✅ Cache de contexto
- ✅ Histórico de conversas (60 dias)
- ✅ Validação de identidade

### Validações
- ✅ Formato e tamanho de arquivos
- ✅ Horário comercial
- ✅ Segurança de dados

### Logs e Monitoramento
- ✅ Logs detalhados de cada etapa
- ✅ Tratamento de erros específicos
- ✅ Métricas de uso

## Licença

Este projeto está licenciado sob a MIT License.
