import asyncio
from customs_summary import CustomsSummary

async def main():
    try:
        print('Iniciando serviço de resumo diário...')
        summary = CustomsSummary()
        summary.start_scheduler()
        
        # Mantém o programa rodando
        while True:
            await asyncio.sleep(1)
            
    except KeyboardInterrupt:
        print('Serviço interrompido pelo usuário')
    except Exception as error:
        print(f'Erro no serviço: {str(error)}')

if __name__ == '__main__':
    asyncio.run(main())
