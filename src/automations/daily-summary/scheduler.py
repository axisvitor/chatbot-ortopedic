import os
import asyncio
from datetime import datetime
import pytz
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from dotenv import load_dotenv
from customs_summary import CustomsSummary

# Carregar variáveis de ambiente
load_dotenv()

def get_config():
    """Obtém configuração dos dados de ambiente."""
    return {
        'endpoint': os.getenv('TRACK17_API_URL'),
        'api_key': os.getenv('TRACK17_API_KEY'),
        'whatsapp_number': os.getenv('WHATSAPP_NUMBER') or os.getenv('TECHNICAL_DEPT_NUMBER')
    }

async def generate_summary():
    """Função que será executada pelo agendador."""
    try:
        config = get_config()
        summary = CustomsSummary(config)
        await summary.generate_daily_summary()
    except Exception as e:
        print(f"Erro ao gerar resumo: {e}")
        raise

def main():
    """Função principal que configura e inicia o agendador."""
    # Configura o scheduler
    scheduler = AsyncIOScheduler()
    
    # Agenda para rodar todos os dias às 20:00 (horário de Brasília)
    scheduler.add_job(
        generate_summary,
        CronTrigger(
            hour=20,
            minute=0,
            timezone=pytz.timezone('America/Sao_Paulo')
        ),
        name='daily_summary'
    )
    
    try:
        print("Iniciando agendador...")
        scheduler.start()
        print(f"Próxima execução: {scheduler.get_job('daily_summary').next_run_time}")
        
        # Mantém o programa rodando
        asyncio.get_event_loop().run_forever()
        
    except (KeyboardInterrupt, SystemExit):
        print("Parando agendador...")
        scheduler.shutdown()

if __name__ == '__main__':
    main()
