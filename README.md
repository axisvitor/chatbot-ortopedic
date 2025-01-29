# Chatbot Ortopédico 🤖

Sistema de atendimento automatizado via WhatsApp para e-commerce ortopédico, utilizando GPT-4 para processamento de linguagem natural.

## 🌟 Principais Funcionalidades

### Atendimento ao Cliente

- Processamento de mensagens em texto, áudio e imagens
- Respostas contextualizadas e personalizadas
- Manutenção de histórico de conversas
- Encaminhamento inteligente para departamentos

### Rastreamento de Pedidos 📦

- Consulta automática de status em múltiplas transportadoras
- Notificações proativas de atualizações
- Tratamento especial para pedidos taxados
- Alertas automáticos sobre atrasos

### Processamento de Pagamentos 💳

- Análise automática de comprovantes via OCR
- Confirmação instantânea de recebimento
- Integração com setor financeiro
- Histórico de transações

## 🛠️ Tecnologias

- **Backend**: Node.js
- **IA**: OpenAI GPT-4
- **Banco de Dados**: Redis
- **Mensageria**: WhatsApp Business API
- **E-commerce**: Nuvemshop API
- **Rastreamento**: APIs de múltiplas transportadoras

## 📦 Instalação

1. Clone o repositório:
```bash
git clone https://github.com/axisvitor/chatbot-ortopedic.git
cd chatbot-ortopedic
```

2. Instale as dependências:
```bash
npm install
```

3. Configure as variáveis de ambiente:
```bash
cp .env.example .env
# Edite o arquivo .env com suas configurações
```

4. Inicie o servidor:
```bash
npm start
```

## 🚀 Deploy no Railway

1. Fork este repositório no GitHub

2. Crie uma nova conta no [Railway](https://railway.app/) se ainda não tiver

3. No Railway, crie um novo projeto a partir do GitHub:
   - Clique em "New Project"
   - Selecione "Deploy from GitHub repo"
   - Escolha o repositório forkado

4. Configure as variáveis de ambiente:
   - Vá em "Variables"
   - Adicione todas as variáveis listadas no `.env.example`

5. O deploy será iniciado automaticamente
   - O Railway usará o Dockerfile para build
   - A aplicação será iniciada com `npm start`
   - Healthcheck configurado em `/health`

6. Monitore os logs e métricas no dashboard do Railway

## 📚 Documentação

- [Arquitetura](./docs/architecture.md)
- [Instalação](./docs/installation.md)
- [Funções do Assistant](./docs/functions.md)
- [Serviços](./docs/services.md)
- [Integrações](./docs/integrations.md)
- [Armazenamento](./docs/storage.md)
- [Deploy](./docs/deployment.md)
- [Contribuindo](./docs/contributing.md)
- [Segurança](./docs/security.md)

## 🔒 Segurança

- Criptografia de ponta a ponta
- Conformidade com LGPD
- Validação de entrada de dados
- Proteção contra injeção
- Logs seguros

## 📝 Licença

Este projeto é privado e proprietário. Todos os direitos reservados.

## 👥 Suporte

Para suporte, entre em contato através do WhatsApp: (77) 98167-8577
