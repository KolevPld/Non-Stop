---
name: nonstopapp
version: 2.0.0
description: |
  Skill за работа с Нон Стоп приложението (nonstopapp-c30b1.web.app).
  Управление на дневни отчети, смени, каса, заплати и Firebase за нон-стоп
  магазини. Използвай когато трябва да добавяш функции, оправяш бъгове или
  променяш логиката на приложението.
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

Уеб приложение (PWA) за управление на два нон-стоп магазина в Пловдив.
Собственик: Колев (KolevPld).

**Линкове:**
- Продукция: https://nonstopapp-c30b1.web.app/
- GitHub: https://github.com/KolevPld/Non-Stop
- Firebase проект: `nonstopapp-c30b1` (регион europe-west1)
- Firebase план: **Blaze** (платен, но реалните разходи са центове/месец)
- Вход: `akbar@gmail.com`

## Технически стек

- **Frontend:** Vanilla JS + HTML + CSS — `index.html` + `main.js` (~8000 реда) + `style.css`
- **Backend:** Firebase Firestore (NoSQL) + **Cloud Functions** (`functions/index.js`)
- **Auth:** Firebase Authentication (Email/Password)
- **Hosting:** Firebase Hosting
- **Реално време:** някои екрани ползват `onSnapshot` (live auto-refresh)
- **Локален клон:** папка `Non-Stop` на компютъра, работи се през **VS Code + Claude Code**

## Структура на файловете

```
Non-Stop/
├── index.html        ← HTML структура, модали, навигация
├── main.js           ← цялата клиентска бизнес логика
├── style.css         ← стилове (тъмна тема по подразбиране, responsive)
├── manifest.json     ← PWA настройки
├── sw.js             ← Service Worker (offline + кеш)
├── firebase.json     ← Firebase deploy конфигурация
├── firestore.rules   ← Security Rules
└── functions/
    ├── index.js      ← Cloud Functions (важно! виж раздел по-долу)
    └── package.json
```

## ⚠️ ВАЖНО: реални имена (НЕ както изглеждат в UI)

Това са честите грешки. UI показва едно, кодът ползва друго:

| Концепция | В UI / разговор | В кода / Firestore |
|---|---|---|
| Колекция отчети | "дневни отчети" | `daily_reports` (НЕ `dailyReports`) |
| Магазин 1 | "Магазин 1", "М1" | `store1` (НЕ `magazin1`) |
| Магазин 2 | "Магазин 2", "М2" | `store2` (НЕ `magazin2`) |
| Document ID | — | `${storeId}_${date}` напр. `store1_2026-06-04` |
| Дата | "04.06.2026" | ISO: `2026-06-04` |

Document ID за дневен отчет се прави с `setDoc` и фиксиран ID `{storeId}_{date}`.
**НЕ ползвай `addDoc`** — създава дубликати с random ID (стар бъг, виж по-долу).

## Firestore колекции

```
daily_reports/{storeId}_{date}   ← Дневни отчети (основната колекция)
records/{id}                     ← Приходи/разходи записи
tasks/{id}                       ← Бележки/задачи
advances/{id}                    ← Аванси
employees/{id}                   ← Служители
suppliers/{id}                   ← Доставчици
work_hours/{id}                  ← Отработени часове
owners/{id}                      ← Собственици
users/{id}                       ← Потребители
notifications/{id}               ← Известия
monthly_reports/{YYYY-MM}        ← Месечни справки (генерират се от Cloud Function)
```

### Структура на дневен отчет (`daily_reports`)

```
{
  shopId: "store1" | "store2",
  date: "2026-06-04",
  status: "closed" | "draft",      ← ВАЖНО: затворен или чернова
  startCash: number,               ← Начална каса (= крайна каса на предишния ден)
  shifts: [                        ← обикновено 3 смени
    { name, from, to, operator, cash, pos, plus, minus }
  ],
  expensesGoods: [ { supplier, amount, method } ],   ← разход стоки (до 20 реда)
  expensesOther: [ { description, amount, method } ],
  sideIncomes:   [ { description, amount, method } ],
  advances:      [ { employeeId, employeeName, amount, note } ],
  endCash: number,                 ← Крайна каса (изчислена, виж формулата)
  editAllowed: boolean,            ← разрешена ли е редакция на затворен отчет
  editAllowedAt, editAllowedBy,
  createdAt, updatedAt
}
```

`method` за разходи/приходи: `"Кеш"` | `"Карта"` | `"Банков превод"`. Празно/липсва = третира се като Кеш.

## Магазини и смени

- **Магазин 1** = `store1`, **Магазин 2** = `store2`
- 3 смени дневно: Сутрешна (07–15), Следобедна (15–23), Нощна (23–07)
- Числата са в **евро (€)**

## 💰 Финансова логика — КРИТИЧНО ВАЖНА

Това е сърцето на приложението. Грешка тук = грешни каси = реални пари.

### Формулата на endCash (Крайна каса)

`main.js`, функция `collectDrData` (~ред 3165):

```javascript
endCash = r2(
  startCash
  + totalCashIncome          // сума на shifts[].cash
  + cashSideIncomes          // странични приходи С МЕТОД Кеш
  + totalShiftPlus           // сума на shifts[].plus
  - totalShiftMinus          // сума на shifts[].minus
  - cashExpenseTotal         // разходи (стоки+други) С МЕТОД Кеш
  - totalAdvances            // аванси (винаги кеш — потвърдено)
);
```

### Ключови правила (научени с цената на бъгове)

1. **plus/minus УЧАСТВАТ в endCash, но НЕ в "Оборот на смяна".**
   - Оборот на смяна = `cash + pos` САМО (от софтуера за продажби).
   - plus/minus са корекции на ФИЗИЧЕСКАТА кеш каса (разлика между броен кеш и софтуерен оборот). Управителите ги ползват да отчетат липси/излишъци.

2. **POS приходи НЕ влизат в касата** — отиват по банка. Само cash влиза.

3. **Аванси са винаги в кеш** (потвърдено от собственика 2026-06-04). Ако някога станат и по банка — трябва поле `method` в advance + филтриране.

4. **Седмичните справки броят САМО `status == "closed"`** — черновите се изключват.

5. **Крайна каса на ден N = Начална каса на ден N+1.** Това е счетоводно правило. Прехвърля се чрез `loadPrevEndCash` (клиент) и `autoCarryStartCash` (Cloud Function).

6. **Оборотът се смята САМО от `daily_reports.shifts[].cash + pos`.**
   Записите в `records` НЕ участват в оборота — нито клиентските
   справки, нито `generateMonthlyReport`. Виртуалните магазини
   `КасаКеш` и `КасаБанка` са отделни пулове за салдо, не са източник
   на приход. НЕ добавяй логика, която брои `records` като оборот —
   това е класът грешка, който доведе до 46 605 EUR фалшив приход
   (виж хронологията 2026-08-01).

7. **НЕ създавай автоматични записи в `records`, които сумират
   съществуващи записи.** Салдото се смята от цялата история при
   всяко показване. Всеки "пренос", "снапшот" или "начално салдо"
   като запис води до двойно броене. Ако някога потрябва — задължително
   с детерминистично ID (`setDoc`, не `addDoc`) и с изключване на
   собствения тип от изчислението.

### Helper функции за показване (винаги преизчисляват от суровите данни)

- **`_recalcEndCash(r)`** (~ред 3302) — преизчислява endCash от суровите данни. Ползва се навсякъде при ПОКАЗВАНЕ, защото стари отчети имат сторирана грешна стойност. "Самоизлекуват се" без миграция.
- **`_recalcReportTotals(r)`** — преизчислява ВСИЧКИ обобщителни суми (приходи, разходи, и т.н.), не само endCash. За консистентност между стари и нови отчети.
- **`_ymdToWeekday(ymd)`** — връща българския ден от седмицата (Пн/Вт/...).
- **`r2(n)`** — закръгляне до 2 знака. Закръглявай само финалния резултат, НЕ промеждутъчните суми (двойно закръгляне дава ±0.01 грешки).

При промяна на формулата на endCash — обнови я на ВСИЧКИТЕ места: `collectDrData`, `_recalcEndCash`, и в Cloud Function `autoCarryStartCash` (в `functions/index.js`).

## ☁️ Cloud Functions (functions/index.js)

Тези работят на сървъра — деплой с `firebase deploy --only functions`.

| Функция | Какво прави |
|---|---|
| `protectStartCash` | ⚠️ Пази startCash/endCash от случайна промяна на затворен отчет. **Пропуска при `editAllowed === true`** (иначе блокира легитимни редакции и прави безкраен цикъл — стар голям бъг!). |
| `autoCarryStartCash` | При затваряне на ден прехвърля endCash → startCash на следващия ден. Трябва да ползва ПРЕИЗЧИСЛЕН endCash (с plus/minus). |
| `generateMonthlyReport` | Scheduled — генерира месечна справка в `monthly_reports`. |
| `generateMonthlyReportManual` | onCall — ръчно генериране на месечен отчет. |
| `firestoreBackup` / `triggerBackupNow` | Backup на Firestore. Автоматичен backup всяка вечер в 03:00. |
| `checkMissingDays` | Алерт за дни без затворен отчет. |
| `notifyOwnerWeekClosed` | Известие до собственика при затваряне на седмица. |
| `overtimeAlerts` | Алерти за извънреден труд. |
| `sendTaskReminders` | Напомняния за задачи. |
| `resetUserPassword` | Нулиране на парола. |

## Ключови клиентски функции (main.js)

| Функция | Ред (~) | Какво прави |
|---|---|---|
| `collectDrData` | 3060 | Събира данните от формата + изчислява endCash. ЗАПИСВА. |
| `saveClosedReportEdits` | 3890 | Запазва редакция на затворен отчет. Чете startCash/endCash от `data` (формата), НЕ от `_drData`. |
| `persistReport` | 3862 | Записва/обновява дневен отчет. |
| `loadPrevEndCash` | 3508 | Тегли preизчисления endCash на предишния ден → startCash. |
| `loadRecentReports` | 3988 | "Последни 10 отчета" (manager). Live чрез `onSnapshot`. |
| `loadDailyReportsScreen` | 4124 | Owner таблица "Дневни отчети". Live чрез `onSnapshot`. |
| `renderWeeklyReport` | 1159 | Седмична справка (само closed). |
| `exportWeeklyPDF` | 1468 | PDF на седмична справка (jsPDF + autoTable, кирилица през `_loadRobotoFont`). |
| `exportDailyPDF` | 4648 | PDF на дневен отчет (на 1 страница A4). |
| `printWeeklyReport` | 1308 | Принт на седмична справка (landscape). |
| `openTransferModal` / `closeTransferModal` | 7874 / 7883 | Трансфер модал — отваря/затваря |
| `saveTransfer` | 7887 | Трансфер — валидира, записва двата Firestore документа с rollback |
| `_findOpenReport` | 7852 | Търси незатворен daily_report за магазин, до 7 дни напред |
| `_getPrevEndCash` | 7834 | startCash за нов скелет-чернова (сървърен query, 1 документ) |
| `checkAndCreateMonthlyCarryover` | 416 | ⛔ СПРЯНА — двойно броене, виж хронологията |

## 💸 Трансфер банка → каса

Нова функция (2026-08-01) — собственикът регистрира теглене на кеш от банката.

### Логика

**Получател КасаКеш** — два симетрични записа в `records`:
1. `{ type:"Трансфер", method:"Банка", store:"КасаКеш", category:"Трансфер" }` → намалява банката
2. `{ type:"Приход", method:"Кеш", store:"КасаКеш", category:"Трансфер", isTransfer:true }` → увеличава кешовата каса

Ако вторият запис фейлне → `deleteDoc` на първия (без сираци).

**Получател Магазин 1/2** — един запис в `records` + ред в `sideIncomes` на дневния отчет:
- `records`: `{ type:"Трансфер", method:"Банка", store:"store1/2", category:"Трансфер" }`
- `daily_reports.sideIncomes[]`: `{ method:"Кеш", isTransfer:true, transferId }` → влиза в `endCash` формулата
- При затваряне на деня `createMainRecordsFromDr` (~ред 4034) прехвърля `isTransfer:true` и `category:"Трансфер"` в новия Приход запис

Ако записът в `daily_reports` фейлне → `deleteDoc` на `records` записа (rollback).

**При затворен отчет:** `_findOpenReport` търси напред до 7 дни. При сместена дата → confirmation dialog. При липса на незатворен ден в 7 дни → грешка, нищо не се записва.

**startCash при нов скелет:** `_getPrevEndCash` прави сървърен query (`where("date","<",date) + orderBy("date","desc") + limit(1)`) — може да поиска composite index при първо изпълнение.

### Правила за display

| Функция | Трансфери |
|---|---|
| `renderMethodSummary` | **Включени** — `type:"Трансфер"` намалява `totals.Банка`; `type:"Приход" isTransfer:true` влиза в `totals.Кеш`. Правилно за салдото по каси. |
| `renderStoreComparison` | **Включени** — касовите колони (Каса Кеш / Каса Банка) отразяват реалното движение. |
| `renderTotalSummaryCards` | **Изключени** — `isTransfer \|\| category==="Трансфер"` → не е приход/разход на бизнеса. |
| `renderChart` | **Изключени** — същото условие. |
| `updateFilterSummary` | **Изключени** — същото условие. |

### ID в records

Трансфер записите ползват `addDoc` (random ID). Връзката е чрез `transferId` в `sideIncomes[]` и в Приход записа при КасаКеш.

## Real-time (onSnapshot)

`loadRecentReports` и `loadDailyReportsScreen` ползват `onSnapshot` вместо `getDocs` —
промени от един таб се появяват на всички табове за 1-2 сек без F5.
Unsubscribe променливи: `_recentReportsUnsub`, `_ownerReportsUnsub` (отписвай при смяна на екран).

## Команди

```bash
# Deploy всичко:
firebase deploy

# Само hosting:
firebase deploy --only hosting

# Само Cloud Functions:
firebase deploy --only functions

# Git workflow (винаги в този ред):
git add .
git commit -m "Описание"
git push
firebase deploy

# Заздравяване на стабилна версия:
git tag -a vX.Y-описание -m "Какво е готово"
git push origin vX.Y-описание
```

**След всеки deploy** → тествай с **Ctrl+Shift+R** (Service Worker кешира старата версия).

## Firestore Security Rules

`firestore.rules` — всички колекции изискват `request.auth != null`.
При нова колекция → добави правило и направи `firebase deploy --only firestore:rules`.

## Хронология на големите поправки (контекст)

Сесия 2026-06-04 до 2026-06-17, основни неща:
- **plus/minus не влизаха в endCash** — поправено (касите не съвпадаха с реалните).
- **protectStartCash блокираше редакции** — правеше "мигащи" документи и infinite loop. Поправено да пропуска при `editAllowed=true`.
- **saveClosedReportEdits** четеше стари startCash/endCash от `_drData` — поправено да чете от формата.
- **addDoc → setDoc** — спряхме създаването на дубликати с random ID.
- **Stale cache** в owner панела — решено с `onSnapshot` (real-time).
- Седмични справки → само `closed`; премахната дублираща колона "Приход общо".
- Дни от седмицата до датите; процент кеш/карта в седмичната.
- PDF за дневен отчет (архив); седмичен принт landscape.

Сесия 2026-08-01 — банковата каса показваше повече пари от реалната:

- **ПРИЧИНАТА:** `checkAndCreateMonthlyCarryover` (main.js:416) създаваше всеки месец
  записи "Пренос от предходен месец" в `records` с `type:"Приход"`. Функцията сумираше
  ВСИЧКИ предишни записи, включително собствените си преноси от минали месеци → двойно
  броене, което расте експоненциално. За 3 месеца: **46 605 EUR фалшив приход по банка**
  и **35 884 EUR по кеш**. Функцията се викаше при ВСЯКО зареждане от admin, а guard-ът
  проверяваше само локалния масив `records`, не Firestore.
  **РЕШЕНИЕ:** функцията е спряна (закоментирана в `loadRecords`), шестте записа изтрити
  ръчно. Преносът не е нужен — салдото се смята от цялата история на records.

- **НОВА ФУНКЦИЯ:** Трансфер банка → каса. Собственикът тегли кеш от банката с един запис
  вместо два несвързани. Получател: Каса Кеш, Магазин 1 или Магазин 2.

- **`renderMethodSummary`:** нормализаторът режеше по интервал (`split(" ")[0]`), което
  пропускаше "Банков превод". Поправен с `startsWith`.

- **Потвърдено:** оборотът се смята САМО от `daily_reports.shifts[].cash + pos`. Записите
  в `records` с виртуални магазини (КасаКеш/КасаБанка) НЕ влизат в оборота, нито в
  месечния Cloud Function отчет. Двойно броене в официалните справки няма.

Тагът `v1.7-transfer-carryover-fix` отбелязва това стабилно състояние.

## TODO / бъдещи задачи

- **`checkAndCreateMonthlyCarryover` (main.js:416)** е закоментирана в `loadRecords`.
  Да се реши дали да се премахне изцяло или да се пренапише без двойно броене
  (трябва да изключва `category:"Пренос"` от изчислението + детерминистично ID).
- **ПОС комисионата** не се приспада никъде — `totalPosIncome` се записва бруто.
  Банката превежда нето (след комисиона ~0.7–1.5%). Разликата не се вижда в приложението.
- **Месечен отчет** — backend (`generateMonthlyReport`) и частичен UI вече има; може да
  се доразвие (PDF за архив, по-богат изглед).
- **Audit log** на редакции на затворени отчети (кой/кога/какво).
- Изчистване на стари random-ID документи в `daily_reports` ако още стоят.

## Стил на работа (предпочитан от потребителя)

- Потребителят работи през **Claude Code във VS Code**. Затова давай **готови промпт-блокове за копиране** с точни файлове, редове, преди/след код, и накрая git+deploy команди + раздел "Как да тестваш".
- За финансова логика — **първо обясни причината/диагнозата**, не променяй сляпо. Питай при бизнес решения.
- След всяка завършена промяна потребителят пита "да заздравявам ли" → дай му `git tag` команда.
- Backup-ите ги прави сам (автоматичен в 03:00 + ръчен през програмата).
