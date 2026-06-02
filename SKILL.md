---
name: nonstopapp
version: 1.0.0
description: |
  Skill за работа с Нон Стоп приложението (nonstopapp-c30b1.web.app).
  Управление на дневни отчети, смени, каса и Firebase за нон-стоп магазини.
  Използвай когато трябва да добавяш функции, оправяш бъгове или променяш
  логиката на приложението.
license: private
compatibility: claude-code
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
---

# Нон Стоп Отчет — Project Skill

## Описание на проекта

Уеб приложение за управление на нон-стоп магазини в Пловдив.
Собственик: Колев (KolevPld).

**Линкове:**
- Продукция: https://nonstopapp-c30b1.web.app/
- GitHub: https://github.com/KolevPld/Non-Stop
- Firebase проект: `nonstopapp-c30b1`

## Технически стек

- **Frontend:** Vanilla JS + HTML + CSS (един файл `index.html` + `main.js` + `style.css`)
- **Backend:** Firebase Firestore (NoSQL база данни)
- **Auth:** Firebase Authentication (Email/Password)
- **Hosting:** Firebase Hosting (`firebase deploy`)
- **Локален клон:** папката `Non-Stop` на компютъра

## Структура на файловете

```
Non-Stop/
├── index.html       ← HTML структура, модали, навигация
├── main.js          ← цялата бизнес логика
├── style.css        ← стилове (тъмна тема, responsive)
├── manifest.json    ← PWA настройки
├── sw.js            ← Service Worker (offline support)
└── firebase.json    ← Firebase deploy конфигурация
```

## Firestore структура

```
Колекции:
├── dailyReports/{storeId}_{date}    ← Дневни отчети
│   ├── date: "2026-05-12"
│   ├── storeId: "magazin1" | "magazin2"
│   ├── startCash: number            ← Начална каса
│   ├── shifts: [                    ← Масив от смени
│   │   { name, startTime, endTime, operator, turnover, cash, pos, plus, minus }
│   │ ]
│   ├── closed: boolean              ← Затворен ли е отчетът
│   └── updatedAt: timestamp
│
├── records/{id}                     ← Приходи/разходи записи
│   ├── date, type, amount, method
│   ├── store, category, note
│   └── createdBy, createdAt
│
└── tasks/{id}                       ← Бележки/задачи
    ├── text, done, createdAt
    └── createdBy
```

## Магазини

- **Магазин 1** — storeId: `magazin1`
- **Магазин 2** — storeId: `magazin2`

## Смени

Всеки ден има 3 смени:
- **Сутрешна:** 07:00 – 14:00
- **Следобедна:** 14:00 – 21:00
- **Нощна:** 20:00 – 08:00

> Забележка: 1-часовите припокривания (14:00 / 20:00) и краят на нощната в 08:00 са нарочни — за предаване на смяна.

## Дневен отчет — логика

Документ ID в Firestore: `{storeId}_{date}` (напр. `magazin1_2026-05-12`)

**Незатворени дни** се показват с жълт банер горе.
Бутон "Попълни [дата]" трябва да отвори отчета за тази дата.

### Как работи отварянето на отчет:

```javascript
// Функцията която трябва да се извика при "Попълни":
function openDayReport(date, storeId) {
  // date формат: "2026-05-12" (ISO)
  // Зарежда или създава документ от Firestore
  // После рендерира формата за попълване
}
```

**Чест бъг:** Датата може да е в грешен формат — приложението използва ISO (`2026-05-12`) но понякога UI-ът показва `12.05.2026`. Преди да подадеш датата към Firestore, конвертирай:

```javascript
// Конвертиране от показван формат към Firestore ключ:
function toISODate(displayDate) {
  // "12.05.2026" → "2026-05-12"
  const [d, m, y] = displayDate.split('.');
  return `${y}-${m}-${d}`;
}
```

## Firebase команди

```bash
# Deploy на приложението:
firebase deploy

# Само hosting (без Firestore rules):
firebase deploy --only hosting

# Локален preview:
firebase serve
```

## Git работен процес

```bash
# Стандартен commit:
git add .
git commit -m "Fix: описание на промяната"
git push

# После задължително:
firebase deploy
```

## Firestore Security Rules (текущи)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /records/{docId} {
      allow read, write: if request.auth != null;
    }
    match /tasks/{docId} {
      allow read, write: if request.auth != null;
    }
    match /dailyReports/{docId} {
      allow read, write: if request.auth != null;
    }
  }
}
```

Ако добавяш нова колекция → добави правило и тук!

## Потребители

- Акаунтът за вход: `akbar@gmail.com` (от Firebase Auth)
- Admin потребителят вижда всички функции

## Чести задачи и как се правят

### Добавяне на нова функция в UI:
1. HTML компонента → `index.html`
2. Стиловете → `style.css`
3. Логиката → `main.js`
4. `git add . && git commit -m "..." && git push && firebase deploy`

### Оправяне на бъг в дневния отчет:
1. Намери функцията с `grep -n "openDayReport\|fillDay\|Попълни\|unclosed" main.js`
2. Провери формата на датата
3. Провери дали Firestore документът се създава правилно
4. Тествай локално с `firebase serve`

### Проверка на Firestore данни:
Влез в https://console.firebase.google.com → проект `nonstopapp-c30b1` → Firestore Database → колекция `dailyReports`

## Важни бележки

- Приложението е **PWA** — може да се инсталира на телефон
- Тъмната тема е по подразбиране, има toggle за светла
- Числата са в **евро (€)**
- Датите се пазят в ISO формат в Firestore (`YYYY-MM-DD`)
- Service Worker кешира приложението — след deploy може да трябва hard refresh (Ctrl+Shift+R)
