#!/usr/bin/env python
# -*- coding: utf-8 -*-

import os
import sys
import logging
import subprocess
from datetime import datetime

# Configurar logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('automation.log', encoding='utf-8'),
        logging.StreamHandler(sys.stdout)
    ]
)

def load_env_variables():
    """Carrega e valida as variáveis de ambiente necessárias."""
    try:
        from dotenv import load_dotenv
        load_dotenv()
        logging.info("[ENV] Arquivo .env carregado com sucesso")

        # Configurar NODE_ENV
        if not os.getenv('NODE_ENV'):
            os.environ['NODE_ENV'] = 'development'
            logging.info("[ENV] Definindo NODE_ENV com valor padrão")

        # Validar variáveis obrigatórias
        required_vars = {
            'TRACK17_API_URL': None,
            'TRACK17_API_KEY': None,
            'TRACK17_STATUS_PATH': None,
            'WAPI_URL': None,
            'WAPI_TOKEN': None,
            'WAPI_CONNECTION_KEY': None,
            'TECHNICAL_DEPT_NUMBER': '5594991307744'
        }

        for var, default_value in required_vars.items():
            if not os.getenv(var):
                if default_value:
                    os.environ[var] = default_value
                    logging.info(f"[ENV] Definindo {var} com valor padrão")
                else:
                    if os.getenv(var):
                        logging.info(f"[ENV] {var} já está definido")
                    else:
                        logging.error(f"[ENV] Variável obrigatória {var} não definida")
                        raise ValueError(f"Variável obrigatória {var} não definida")

    except Exception as e:
        logging.error(f"[ENV] Erro ao carregar configurações: {str(e)}")
        raise

def run_automation():
    """Executa a automação de resumo diário."""
    try:
        # Registrar início da execução
        start_time = datetime.now()
        logging.info("=" * 50)
        logging.info(f"[START] Execução iniciada em: {start_time.strftime('%Y-%m-%d %H:%M:%S')}")
        logging.info("[START] Iniciando automação de resumo diário...")

        # Obter diretório do projeto
        project_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        logging.info(f"[DIR] Diretório do projeto: {project_dir}")

        # Definir caminho do script
        script_path = os.path.join(project_dir, "src", "automations", "daily-summary", "test_summary.py")
        logging.info(f"[SCRIPT] Script a ser executado: {script_path}")

        # Carregar variáveis de ambiente
        load_env_variables()

        # Executar o script Python
        process = subprocess.Popen(
            ["python", script_path],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=project_dir,
            encoding='utf-8',
            errors='replace'
        )

        # Capturar saída e erro
        stdout, stderr = process.communicate()

        if stdout:
            print(stdout)
        if stderr:
            print(stderr, file=sys.stderr)

        if process.returncode != 0:
            raise Exception("Falha na execução da automação")

        # Registrar fim da execução
        end_time = datetime.now()
        logging.info(f"[END] Execução finalizada em: {end_time.strftime('%Y-%m-%d %H:%M:%S')}")
        logging.info("=" * 50)

    except Exception as e:
        logging.error("[ERROR] Erro ao executar a automação")
        logging.error("[DETAILS] Detalhes do erro:")
        logging.error(str(e))
        logging.error("[ERROR] Erro inesperado: Falha na execução da automação")
        logging.error("[CRITICAL] Erro crítico na execução: Falha na execução da automação")
        sys.exit(1)

if __name__ == "__main__":
    run_automation()
