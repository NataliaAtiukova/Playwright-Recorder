#!/bin/zsh
set -euo pipefail

cd '/Volumes/KINGSTON/QA Playwright'

# Если node не в PATH при запуске из Finder, попробуем типовые пути
if ! command -v node >/dev/null 2>&1; then
  if [ -x '/opt/homebrew/bin/node' ]; then
    export PATH="/opt/homebrew/bin:$PATH"
  elif [ -x '/usr/local/bin/node' ]; then
    export PATH="/usr/local/bin:$PATH"
  fi
fi

echo "Запуск WinWinBot UI automation..."
echo "Папка: $(pwd)"
echo

if [ ! -d "node_modules/playwright" ] || [ ! -d "node_modules/express" ]; then
  echo "Зависимости не найдены. Выполняю установку..."
  npm init -y >/dev/null 2>&1 || true
  npm install
  npx playwright install chromium
  echo
fi

npm start

EXIT_CODE=$?
echo
echo "Скрипт завершен с кодом: $EXIT_CODE"
echo "Нажмите Enter, чтобы закрыть окно..."
read _
