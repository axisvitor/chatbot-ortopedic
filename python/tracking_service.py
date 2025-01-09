import requests
import json
from config import TRACKING_CONFIG

class TrackingService:
    def __init__(self):
        self.config = TRACKING_CONFIG
        
        # Status que indicam taxação na alfândega
        self.customs_status = [
            'InTransit_CustomsProcessing',  # Em processo de desembaraço
            'Exception_Security',           # Problemas com desembaraço/taxas
            'DeliveryFailure_Security',     # Falha na entrega por questões de taxa
            'CustomsHold'                   # Retido na alfândega
        ]

        # Palavras-chave que indicam taxação
        self.customs_keywords = [
            'customs',
            'tax',
            'clearance',
            'alfândega',
            'taxa',
            'imposto',
            'tributação',
            'desembaraço',
            'declaração'
        ]

    def list_all_tracking_numbers(self):
        """Lista todos os códigos de rastreio registrados"""
        try:
            print('[Tracking] Buscando todos os códigos de rastreio...')
            tracking_numbers = []
            page = 1
            total_pages = 1  # será atualizado com a primeira resposta

            while page <= total_pages:
                # Prepara a requisição para listar todos os pacotes
                url = f'https://{self.config["endpoint"]}/track/v2.2/gettracklist'
                headers = {
                    '17token': self.config['apiKey'],
                    'Content-Type': 'application/json'
                }
                
                # Payload para buscar todos os pacotes ativos
                data = {
                    "tracking_status": "Tracking",
                    "page_size": 40,
                    "page_no": page
                }

                print(f'[Tracking] Buscando página {page} de {total_pages}...')
                print(f'[Tracking] URL: {url}')
                print(f'[Tracking] Data:', json.dumps(data, indent=2))

                # Faz a requisição
                response = requests.post(url, headers=headers, json=data)
                response_data = response.json()

                print(f'[Tracking] Status code: {response.status_code}')

                if (not response_data or 
                    response_data.get('code') != 0 or 
                    'data' not in response_data or 
                    'accepted' not in response_data['data']):
                    raise Exception('Resposta inválida da API')

                # Atualiza o total de páginas na primeira iteração
                if page == 1 and 'page' in response_data:
                    total_items = response_data['page'].get('data_total', 0)
                    page_size = response_data['page'].get('page_size', 40)
                    total_pages = (total_items + page_size - 1) // page_size
                    print(f'[Tracking] Total de {total_items} pacotes encontrados em {total_pages} páginas')

                # Lista todos os pacotes com seus status
                for item in response_data['data']['accepted']:
                    tracking_info = {
                        'tracking_number': item['number'],
                        'carrier': item.get('carrier'),
                        'package_status': item.get('package_status'),
                        'latest_event_info': item.get('latest_event_info', ''),
                        'shipping_country': item.get('shipping_country', ''),
                        'recipient_country': item.get('recipient_country', ''),
                        'days_after_last_update': item.get('days_after_last_update'),
                        'days_of_transit': item.get('days_of_transit')
                    }
                    tracking_numbers.append(tracking_info)
                    print(f'[Tracking] Encontrado: {json.dumps(tracking_info, indent=2)}')

                page += 1

            print(f'[Tracking] Total de {len(tracking_numbers)} códigos encontrados')
            return tracking_numbers

        except Exception as error:
            print(f'[Tracking] Erro ao buscar códigos de rastreio: {str(error)}')
            raise

    def _check_taxation(self, tracking_info):
        """Verifica se há eventos de taxação nos dados de rastreamento"""
        if not tracking_info:
            return False

        # Verifica o status atual
        status = tracking_info.get('package_status', '')
        latest_event = tracking_info.get('latest_event_info', '') or ''
        latest_event = latest_event.lower() if latest_event else ''

        print(f'[Tracking] Verificando status: {status}')
        print(f'[Tracking] Último evento: {latest_event}')
        
        # Verifica se está em algum dos status de alfândega
        if status in self.customs_status:
            print(f'[Tracking] Status indica taxação: {status}')
            return True

        # Verifica se há palavras-chave de alfândega no último evento
        for keyword in self.customs_keywords:
            if keyword.lower() in latest_event:
                print(f'[Tracking] Palavra-chave encontrada: {keyword}')
                return True

        return False

    def get_packages_with_pending_customs(self):
        """Busca pacotes com taxas pendentes na alfândega"""
        try:
            print('[Tracking] Buscando pacotes com taxas pendentes...')
            pending_packages = []
            page = 1
            total_pages = 1  # será atualizado com a primeira resposta

            while page <= total_pages:
                # Prepara a requisição para listar todos os pacotes
                url = f'https://{self.config["endpoint"]}/track/v2.2/gettracklist'
                headers = {
                    '17token': self.config['apiKey'],
                    'Content-Type': 'application/json'
                }
                
                # Payload para buscar todos os pacotes ativos
                data = {
                    "tracking_status": "Tracking",
                    "page_size": 40,
                    "page_no": page
                }

                print(f'[Tracking] Buscando página {page} de {total_pages}...')
                print(f'[Tracking] URL: {url}')

                # Faz a requisição
                response = requests.post(url, headers=headers, json=data)
                response_data = response.json()

                print(f'[Tracking] Status code: {response.status_code}')

                if (not response_data or 
                    response_data.get('code') != 0 or 
                    'data' not in response_data or 
                    'accepted' not in response_data['data']):
                    raise Exception('Resposta inválida da API')

                # Atualiza o total de páginas na primeira iteração
                if page == 1 and 'page' in response_data:
                    total_items = response_data['page'].get('data_total', 0)
                    page_size = response_data['page'].get('page_size', 40)
                    total_pages = (total_items + page_size - 1) // page_size
                    print(f'[Tracking] Total de {total_items} pacotes encontrados em {total_pages} páginas')

                # Filtra apenas os pacotes retidos na alfândega
                for item in response_data['data']['accepted']:
                    if self._check_taxation(item):
                        try:
                            package_info = {
                                'tracking_number': item['number'],
                                'status': item.get('package_status', 'Unknown'),
                                'latest_event': item.get('latest_event_info', ''),
                                'shipping_country': item.get('shipping_country', ''),
                                'recipient_country': item.get('recipient_country', ''),
                                'days_in_transit': item.get('days_of_transit'),
                                'days_since_update': item.get('days_after_last_update')
                            }
                            pending_packages.append(package_info)
                            print(f'[Tracking] Pacote com taxa encontrado: {package_info["tracking_number"]} - Status: {package_info["status"]}')
                        except UnicodeEncodeError:
                            # Se houver erro com caracteres especiais, imprime versão simplificada
                            print(f'[Tracking] Pacote com taxa encontrado: {item["number"]} (detalhes omitidos)')
                            pending_packages.append({
                                'tracking_number': item['number'],
                                'status': item.get('package_status', 'Unknown')
                            })

                page += 1

            print(f'[Tracking] Busca concluída. {len(pending_packages)} pacotes com taxas encontrados')
            return pending_packages

        except Exception as error:
            print(f'[Tracking] Erro ao buscar pacotes com taxas: {str(error)}')
            raise
