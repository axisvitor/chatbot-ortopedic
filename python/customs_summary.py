from tracking_service import TrackingService
from whatsapp_service import WhatsAppService
from apscheduler.schedulers.asyncio import AsyncIOScheduler
import asyncio

class CustomsSummary:
    def __init__(self):
        self.tracking_service = TrackingService()
        self.whatsapp_service = WhatsAppService()

    async def generate_daily_summary(self):
        """Gera e envia o resumo diário de taxas pendentes"""
        try:
            print('Gerando resumo diário de taxas...')

            # Busca pacotes com taxas pendentes
            pending_packages = self.tracking_service.get_packages_with_pending_customs()
            
            if not pending_packages:
                message = "Resumo Diário de Taxas Pendentes\n\n" \
                         "Nenhum pacote aguardando pagamento de taxa na alfândega."
                await self.whatsapp_service.send_message(message)
                return

            tracking_codes = [pkg['tracking_number'] for pkg in pending_packages]
            total_packages = len(tracking_codes)

            # Cria mensagem simplificada
            message = "Resumo Diário de Taxas Pendentes\n\n" \
                     f"Total de pacotes aguardando pagamento: {total_packages}\n\n" \
                     "Códigos de rastreamento:\n" + \
                     "\n".join(tracking_codes)

            # Envia mensagem
            await self.whatsapp_service.send_message(message)
            print('Resumo diário enviado com sucesso')

        except Exception as error:
            print(f'Erro ao gerar resumo diário: {str(error)}')
            error_message = "Erro ao gerar resumo diário de taxas pendentes. " \
                          "Por favor, verifique o sistema."
            await self.whatsapp_service.send_message(error_message)

    def start_scheduler(self):
        """Inicia o agendador para rodar todos os dias às 20:00"""
        scheduler = AsyncIOScheduler()
        scheduler.add_job(self.generate_daily_summary, 'cron', hour=20)
        scheduler.start()
        print('Agendador de resumo diário iniciado')
