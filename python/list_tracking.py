import asyncio
from tracking_service import TrackingService

def run_test():
    try:
        print('Listando códigos de rastreio...')
        tracking = TrackingService()
        tracking.list_all_tracking_numbers()
        print('Listagem concluída!')
    except Exception as error:
        print(f'Erro ao listar códigos: {str(error)}')

if __name__ == '__main__':
    run_test()
