#!/bin/bash

# Скрипт для обновления статических файлов в папке public/
# Использование: ./update-static.sh

echo "🔄 Обновление статических файлов..."

# Проверяем существование исходных файлов
if [ ! -f "script.js" ]; then
    echo "❌ Ошибка: файл script.js не найден"
    exit 1
fi

if [ ! -f "styles.css" ]; then
    echo "❌ Ошибка: файл styles.css не найден"
    exit 1
fi

# Создаем папку public если её нет
mkdir -p public

# Копируем файлы
cp script.js public/script.js
cp styles.css public/styles.css

echo "✅ Файлы обновлены:"
echo "   - script.js → public/script.js"
echo "   - styles.css → public/styles.css"
echo ""
echo "📝 Не забудьте закоммитить изменения:"
echo "   git add public/script.js public/styles.css"
echo "   git commit -m 'Обновлены статические файлы'"
echo "   git push origin main"

