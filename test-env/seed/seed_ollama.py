"""Pull the small chat model into the optional Ollama service (profile `ai`).

    python seed/seed_ollama.py [--model qwen2.5:0.5b]

Idempotent: `ollama pull` only downloads what is missing. Skipped with a note
when the bpt-ollama container is not running.
"""
import argparse
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import docker_exec, http, wait_for, write_secret  # noqa: E402

CONTAINER = 'bpt-ollama'
BASE = 'http://localhost:' + os.environ.get('OLLAMA_PORT', '11434')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', default=os.environ.get('OLLAMA_MODEL', 'qwen2.5:0.5b'))
    args = ap.parse_args()

    running = subprocess.run(['docker', 'inspect', '-f', '{{.State.Running}}', CONTAINER],
                             capture_output=True, text=True)
    if running.stdout.strip() != 'true':
        print('ollama: bpt-ollama is not running (start with the ai profile), skipped')
        return

    wait_for('Ollama', lambda: http('GET', f'{BASE}/api/tags').status == 200)
    models = [m['name'] for m in http('GET', f'{BASE}/api/tags').json().get('models', [])]
    if args.model in models:
        print('ollama: model', args.model, 'already present')
    else:
        print('ollama: pulling', args.model, '(this can take a while)')
        docker_exec(CONTAINER, 'ollama', 'pull', args.model)

    path = write_secret('ollama', {
        'url': BASE,
        'openaiBaseUrl': f'{BASE}/v1',
        'chatCompletions': f'{BASE}/v1/chat/completions',
        'model': args.model,
        'apiKey': 'ollama (any value, Ollama does not check it)',
    })
    print(f'ollama: ok, model {args.model} at {BASE}/v1 (saved to {path})')


if __name__ == '__main__':
    main()
