import os
import logging
import json
from datetime import datetime
from typing import Dict, List, Optional
import requests
from dotenv import load_dotenv
import time

# Configurar logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('CustomsSummary')

class CustomsSummary:
    def __init__(self, config: Dict):
        """
        Inicializa o CustomsSummary.
        
        Args:
            config: Dicionário com as configurações:
                - endpoint: URL base da API 17track
                - api_key: Chave da API 17track
        """
        self.validate_config(config)
        self.endpoint = config['endpoint'].rstrip('/')
        self.api_key = config['api_key']
        self.max_retries = 3
        self.retry_delay = 1
        
        # Palavras-chave para identificar problemas alfandegários
        self.customs_keywords = [
            'customs',
            'taxa',
            'imposto',
            'tributação',
            'alfândega',
            'fiscalização',
            'autoridade competente'
        ]
        
        logger.info('CustomsSummary inicializado com sucesso')
    
    def validate_config(self, config: Dict) -> None:
        """Valida se todas as configurações necessárias estão presentes."""
        required = ['endpoint', 'api_key']
        missing = [key for key in required if key not in config]
        if missing:
            raise ValueError(f'Configurações faltando: {", ".join(missing)}')
    
    def make_request(self, method: str, url: str, **kwargs) -> Dict:
        """Faz uma requisição HTTP com retry."""
        last_error = None
        
        for attempt in range(self.max_retries):
            try:
                response = requests.request(method, url, **kwargs)
                
                # Se a resposta for JSON, retorna o conteúdo
                if 'application/json' in response.headers.get('content-type', ''):
                    data = response.json()
                    if data.get('error'):
                        raise ValueError(f"Erro na API: {data.get('message')}")
                    return data
                
                # Se não for JSON, verifica se houve erro
                response.raise_for_status()
                return response.text
                
            except Exception as e:
                last_error = e
                if attempt < self.max_retries - 1:
                    logger.warning(f'Tentativa {attempt + 1} falhou: {str(e)}. Tentando novamente...')
                    time.sleep(self.retry_delay)
                else:
                    logger.error(f'Erro na requisição após {self.max_retries} tentativas: {str(e)}')
                    raise
    
    async def get_packages_with_pending_customs(self) -> List[Dict]:
        """Busca pacotes com pendências alfandegárias."""
        try:
            logger.info('🔍 Buscando pacotes no 17track...')
            
            # Headers para a API do 17track
            headers = {
                '17token': self.api_key,
                'Content-Type': 'application/json'
            }
            
            # URLs da API
            list_url = f"{self.endpoint}/track/v2.2/gettracklist"
            track_url = f"{self.endpoint}/track/v2.2/gettrackinfo"
            
            # Busca todos os pacotes
            packages = await self.get_all_packages(list_url, headers)
            logger.info(f'📦 Total de pacotes encontrados: {len(packages)}')
            
            # Busca detalhes dos pacotes
            logger.info('🔍 Buscando detalhes dos pacotes...')
            detailed_packages = await self.get_detailed_packages(packages, track_url, headers)
            
            # Filtra pacotes com pendências
            pending_packages = [
                pkg for pkg in detailed_packages 
                if self.check_taxation(pkg)
            ]
            
            logger.info(f'🚨 Pacotes com pendências encontrados: {len(pending_packages)}')
            return pending_packages
            
        except Exception as e:
            logger.error('Erro ao buscar pacotes:', exc_info=True)
            raise
    
    async def get_all_packages(self, url: str, headers: Dict) -> List[Dict]:
        """Busca todos os pacotes paginados."""
        all_packages = []
        current_page = 1
        
        while True:
            logger.info(f'📄 Buscando página {current_page}...')
            
            data = {
                "tracking_status": "Tracking",
                "page_no": current_page,
                "order_by": "RegisterTimeDesc"
            }
            
            response = self.make_request('POST', url, json=data, headers=headers)
            
            if response.get('code') != 0:
                raise ValueError(f'Erro ao buscar lista: {response.get("message")}')
            
            packages = response.get('data', {}).get('accepted', [])
            logger.info(f'✅ Encontrados {len(packages)} pacotes na página {current_page}')
            
            all_packages.extend(packages)
            
            # Verifica se há mais páginas
            if len(packages) < 40:
                break
                
            current_page += 1
        
        logger.info(f'📦 Total de pacotes encontrados: {len(all_packages)}')
        return all_packages
    
    async def get_detailed_packages(self, packages: List[Dict], url: str, headers: Dict) -> List[Dict]:
        """Busca detalhes dos pacotes em lotes."""
        if not packages:
            return []
            
        logger.info('🔍 Buscando detalhes dos pacotes...')
        detailed_packages = []
        batch_size = 40
        
        # Divide em lotes
        for i in range(0, len(packages), batch_size):
            batch = packages[i:i + batch_size]
            logger.info(f'📦 Processando lote {i//batch_size + 1} de {(len(packages)-1)//batch_size + 1}')
            
            track_data = [
                {"number": pkg["number"], "carrier": pkg["carrier"]}
                for pkg in batch
            ]
            
            response = self.make_request('POST', url, json=track_data, headers=headers)
            
            if response.get('code') != 0:
                raise ValueError(f'Erro ao buscar detalhes: {response.get("message")}')
            
            batch_details = response.get('data', {}).get('accepted', [])
            detailed_packages.extend(batch_details)
        
        return detailed_packages
    
    def check_taxation(self, package: Dict) -> bool:
        """Verifica se um pacote tem problemas alfandegários."""
        try:
            track_info = package.get('track_info', {})
            if not track_info:
                logger.debug('Pacote inválido ou sem track_info')
                return False
            
            latest_event = track_info.get('latest_event', {}) or {}
            latest_status = track_info.get('latest_status', {}) or {}
            
            status = (latest_status.get('status') or '').lower()
            event_description = (latest_event.get('description') or '').lower()
            tracking_number = package.get('number', 'N/A')
            
            logger.debug(f'Verificando pacote: {tracking_number}')
            logger.debug(f'Status: {status}')
            logger.debug(f'Último evento: {event_description}')
            
            # Verifica status problemáticos
            if status in ['alert', 'expired', 'undelivered']:
                logger.debug(f'Status problemático encontrado: {status}')
                return True
            
            # Verifica palavras-chave na descrição
            if any(keyword in event_description for keyword in self.customs_keywords):
                logger.debug(f'Pacote retido na alfândega: {event_description}')
                return True
            
            return False
            
        except Exception as e:
            logger.error(f'Erro ao verificar status do pacote {package.get("number", "N/A")}: {e}')
            return False
    
    def translate_event(self, event: str) -> str:
        """Traduz o evento para português."""
        translations = {
            'Import customs clearance delay': 'Atraso no desembaraço aduaneiro',
            'Customs duties payment requested': 'Pagamento de taxas alfandegárias solicitado',
            'Package returning to sender': 'Pacote retornando ao remetente',
            'Carrier note': 'Nota da transportadora',
            'Awaiting payment': 'Aguardando pagamento',
            'Devolução determinada pela autoridade competente': 'Devolução determinada pela autoridade competente',
            'Import customs retained': 'Retido na alfândega',
            'Import customs clearance complete': 'Desembaraço aduaneiro concluído',
            'Pending customs inspection': 'Aguardando inspeção aduaneira',
            'Customs charges due': 'Taxas alfandegárias pendentes'
        }
        
        # Traduz palavras/frases conhecidas
        translated = event
        for eng, pt in translations.items():
            translated = translated.replace(eng, pt)
        
        return translated

    def format_summary_message(self, packages: List[Dict]) -> str:
        """Formata a mensagem com o resumo dos pacotes."""
        if not packages:
            return "Nenhum pacote com pendências."
        
        taxas_pendentes = []
        em_alerta = []
        com_problemas = []
        mensagem_taxa = None
        
        for pkg in packages:
            if not pkg or not pkg.get('track_info'):
                continue
            
            track_info = pkg['track_info']
            latest_event = track_info.get('latest_event', {}) or {}
            latest_status = track_info.get('latest_status', {}) or {}
            tracking_number = pkg.get('number', 'N/A')
            status = (latest_status.get('status') or '').lower()
            event = latest_event.get('description', '')
            
            # Traduz o evento
            event = self.translate_event(event)
            
            # Verifica se o pacote está retornando ao remetente
            if 'retornando ao remetente' in event.lower():
                com_problemas.append(f'*{tracking_number}*: {event}')
                continue
            
            # Verifica se está retido na alfândega
            if any(keyword in event.lower() for keyword in self.customs_keywords):
                taxas_pendentes.append(f'*{tracking_number}*')
                if not mensagem_taxa:  # Guarda a primeira mensagem de taxa como padrão
                    mensagem_taxa = event
                continue
            
            # Verifica alertas
            if status == 'alert':
                em_alerta.append(f'*{tracking_number}*: {event}')
                continue
            
            # Outros problemas (expired, undelivered)
            if status in ['expired', 'undelivered']:
                com_problemas.append(f'*{tracking_number}*: {event}')
        
        message = "📦 *Resumo de Pacotes*\n"
        
        if taxas_pendentes:
            message += "\n💰 *Taxas Pendentes:*\n"
            message += '\n'.join(taxas_pendentes)
            if mensagem_taxa:
                message += f"\n\n_Status: {mensagem_taxa}_"
        
        if em_alerta:
            message += "\n\n⚠️ *Em Alerta:*\n"
            message += '\n'.join(em_alerta)
        
        if com_problemas:
            message += "\n\n❌ *Com Problemas:*\n"
            message += '\n'.join(com_problemas)
        
        return message
    
    async def send_whatsapp_message(self, message: str) -> None:
        """Envia mensagem via WhatsApp."""
        try:
            # Carrega configurações do WhatsApp
            whatsapp_config = {
                'api_url': os.getenv('WAPI_URL'),
                'token': os.getenv('WAPI_TOKEN'),
                'connection_key': os.getenv('WAPI_CONNECTION_KEY'),
                'whatsapp_number': os.getenv('TECHNICAL_DEPT_NUMBER')
            }
            
            # Valida configurações
            missing = [k for k, v in whatsapp_config.items() if not v]
            if missing:
                raise ValueError(f"Configurações do WhatsApp faltando: {', '.join(missing)}")
            
            # Remove caracteres não numéricos do número
            clean_number = ''.join(filter(str.isdigit, whatsapp_config['whatsapp_number']))
            if not clean_number:
                raise ValueError("Número do WhatsApp inválido")
            
            # Adiciona o prefixo 55 se não estiver presente
            if not clean_number.startswith('55'):
                clean_number = f'55{clean_number}'
            
            # Monta a URL com a connectionKey na query string
            url = f"{whatsapp_config['api_url']}/message/sendText?connectionKey={whatsapp_config['connection_key']}"
            
            # Headers da requisição
            headers = {
                'Authorization': f"Bearer {whatsapp_config['token']}",
                'Content-Type': 'application/json'
            }
            
            # Dados da mensagem seguindo o formato do cURL
            data = {
                'phoneNumber': clean_number,
                'message': message,
                'delayMessage': '1000'
            }
            
            logger.info(f'Enviando mensagem para {clean_number}...')
            
            # Faz a requisição
            response = self.make_request('POST', url, json=data, headers=headers)
            
            # Verifica se a mensagem foi enviada com sucesso
            if response and response.get('error'):
                raise ValueError(f"Erro ao enviar mensagem: {response.get('message')}")
            
            logger.info('✅ Mensagem enviada com sucesso!')
            
        except Exception as e:
            logger.error('Erro ao enviar mensagem:', exc_info=True)
            raise
    
    async def generate_daily_summary(self) -> Dict:
        """Gera o resumo diário de pacotes."""
        logger.info('Iniciando geração do resumo diário')
        try:
            packages = await self.get_packages_with_pending_customs()
            
            if packages:
                message = self.format_summary_message(packages)
                await self.send_whatsapp_message(message)
                logger.info('✅ Resumo diário enviado com sucesso!')
            else:
                logger.info('ℹ️ Nenhum pacote com pendência alfandegária encontrado.')
            
            return {'success': True, 'packages_count': len(packages)}
            
        except Exception as e:
            logger.error('Erro ao gerar resumo diário:', exc_info=True)
            raise
    
    async def test(self) -> Dict:
        """Método para testes."""
        logger.info('Iniciando teste do resumo diário...')
        result = await self.generate_daily_summary()
        logger.info('Teste concluído!')
        return result
