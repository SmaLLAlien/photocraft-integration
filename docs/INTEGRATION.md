# Как встроить PhotoCraft в Angular-проект

Пошаговая инструкция: что взять из этого репозитория, куда положить в своём Angular-проекте,
как подключить и запустить, как пересобрать редактор и выложить на сервер.

- [1. Как это устроено](#1-как-это-устроено)
- [2. Что понадобится](#2-что-понадобится)
- [3. Быстрый путь: готовая сборка, без Rust](#3-быстрый-путь-готовая-сборка-без-rust)
- [4. Как пользоваться компонентом](#4-как-пользоваться-компонентом)
- [5. Пересборка редактора из исходников](#5-пересборка-редактора-из-исходников)
- [6. Перенос моста на новую версию PhotoCraft](#6-перенос-моста-на-новую-версию-photocraft)
- [7. Выкладка на сервер](#7-выкладка-на-сервер)
- [8. Протокол сообщений (без Angular)](#8-протокол-сообщений-без-angular)
- [9. Если что-то не работает](#9-если-что-то-не-работает)

---

## 1. Как это устроено

```
┌──────────────── ваше Angular-приложение ────────────────┐
│                                                         │
│  <app-photocraft-editor>  ── iframe ──►  photocraft/    │
│        open(file) ─────── postMessage ──►  index.html   │
│        export('png') ◄─── postMessage ───  *.js         │
│        (saved) ◄───────── postMessage ───  *_bg.wasm    │
│                                          (PhotoCraft,   │
│                                           Rust → wasm)  │
└─────────────────────────────────────────────────────────┘
```

- **PhotoCraft** — редактор на Rust. Его веб-версия (`photocraft/apps/photocraft-web`) собирается
  в WebAssembly: получается папка из трёх файлов (`index.html`, `photocraft-web-<hash>.js`,
  `photocraft-web-<hash>_bg.wasm`). Это обычная статика, её можно положить куда угодно.
- **Мост** (`photocraft/apps/photocraft-web/src/embed.rs`) — наша доработка редактора: он принимает
  файлы от страницы-хозяина и отдаёт ей сохранённые файлы через `window.postMessage`.
- **Angular-компонент** (`angular/src/app/photocraft/`) показывает редактор в `<iframe>` и даёт
  удобное API: `open()`, `export()`, событие `(saved)`.

iframe выбран намеренно: у редактора свой полноэкранный canvas, горячие клавиши и настройки, и в
iframe он никак не пересекается со стилями, роутингом и change detection вашего приложения.

## 2. Что понадобится

| Что | Версия | Зачем |
|---|---|---|
| Angular | **17.3+** (проверено на 21) | компонент использует `input()`, `output()`, `viewChild()`, `@if` |
| Node.js | как требует ваша версия Angular | сборка Angular |
| Браузер | с WebGPU или WebGL2 (Chrome, Edge, Firefox, Safari последних версий) | рендер редактора |
| Rust + trunk | Rust **1.95+** | **только** если пересобираете редактор (раздел 5) |

## 3. Быстрый путь: готовая сборка, без Rust

### Шаг 1. Взять файлы из этого репозитория

| Откуда (этот репозиторий) | Что это |
|---|---|
| `angular/public/photocraft/` — вся папка | готовая сборка редактора (3 файла) |
| `angular/src/app/photocraft/photocraft-editor.ts` | компонент `<app-photocraft-editor>` |
| `angular/src/app/photocraft/photocraft-protocol.ts` | типы сообщений |

Сборку редактора можно взять и из GitHub Actions: workflow **«editor»** выкладывает архив
`photocraft-embed-kit` (сборка + компонент + эта инструкция) в артефакты запуска, а при пуше тега
`v*` — в GitHub Release.

### Шаг 2. Положить в свой проект

```
ваш-проект/
├── public/
│   └── photocraft/                  ← папка сборки целиком
│       ├── index.html
│       ├── photocraft-web-<hash>.js
│       └── photocraft-web-<hash>_bg.wasm
└── src/app/
    └── photocraft/                  ← два файла компонента
        ├── photocraft-editor.ts
        └── photocraft-protocol.ts
```

**Старая структура проекта** (Angular ≤ 17, есть `src/assets`, нет `public`): положите сборку в
`src/assets/photocraft/` и укажите путь компоненту: `<app-photocraft-editor src="assets/photocraft/index.html" />`.

Проверьте, что папка попадает в сборку — в `angular.json` → `projects.<имя>.architect.build.options.assets`
должна быть запись для `public` (в новых проектах она есть по умолчанию):

```json
"assets": [{ "glob": "**/*", "input": "public" }]
```

Если у компонентов в проекте другой префикс (не `app-`), селектор можно переименовать в
`photocraft-editor.ts` — ни на что больше он не влияет.

### Шаг 3. Подключить компонент

```ts
// editor-page.component.ts
import { Component, viewChild } from '@angular/core';
import { PhotocraftEditor } from './photocraft/photocraft-editor';
import { PhotocraftFile } from './photocraft/photocraft-protocol';

@Component({
  selector: 'app-editor-page',
  imports: [PhotocraftEditor],
  template: `
    <input type="file" (change)="pick($event)" />
    <button (click)="done()">Готово</button>
    <app-photocraft-editor class="editor" (saved)="onSaved($event)" />
  `,
  styles: `.editor { height: 80vh; }`,   // у редактора обязательно должна быть высота
})
export class EditorPage {
  private readonly editor = viewChild.required(PhotocraftEditor);

  pick(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) this.editor().open(file);
  }

  async done() {
    const result = await this.editor().export('png');   // { name, mime, blob, via }
    console.log('получили', result.name, result.blob.size);
  }

  onSaved(file: PhotocraftFile) {
    // пользователь нажал File › Save / Export внутри редактора
  }
}
```

> Если в проекте используются NgModule, а не standalone-компоненты: компонент standalone,
> добавьте `PhotocraftEditor` в `imports` вашего модуля.

### Шаг 4. Запустить

```bash
npm start          # или ng serve
```

Откройте страницу с редактором. Первая загрузка — около 22 МБ (≈ 9 МБ в gzip), потом из кэша
браузера. Пока редактор грузится, поверх него показывается «Загрузка PhotoCraft…».

Проверка: выберите картинку → она откроется во вкладке редактора → порисуйте → «Готово» →
в консоли появится имя и размер PNG.

## 4. Как пользоваться компонентом

### Входные параметры и события

| | Тип | Описание |
|---|---|---|
| `src` | `string`, по умолчанию `'photocraft/index.html'` | где лежит сборка. Относительный путь — от `<base href>`; можно абсолютный URL на другой домен/CDN |
| `(loaded)` | `void` | редактор загрузился и принимает файлы |
| `(saved)` | `PhotocraftFile` | пользователь сохранил/экспортировал файл через меню редактора (File › Save, Save As, Export, Ctrl+S). Пока редактор встроен, файлы **не скачиваются**, а приходят сюда |
| `ready` | `Signal<boolean>` | готов ли редактор |

### Методы

```ts
open(file: Blob, name?: string): Promise<void>
```
Открывает файл новой вкладкой-документом. Формат определяется по имени: PNG, JPEG, WebP, GIF,
TIFF, BMP, PSD/PSB, `.pcraft`, HEIC, RAW-форматы камер. Можно вызывать до загрузки редактора —
файл подождёт в очереди.

```ts
export(format?: 'png' | 'jpg' | 'webp' | 'tiff' | 'psd' | 'pcraft' | string): Promise<PhotocraftFile>
```
Возвращает **активный** документ редактора. Можно передать формат (`'psd'`) или имя файла
(`'result.webp'`). PSD и `.pcraft` сохраняют слои; PNG/JPEG/WebP — сведённое изображение.
Если открытых документов нет — промис отклоняется с ошибкой `no open document`.

```ts
interface PhotocraftFile { name: string; mime: string; blob: Blob; via: 'saved' | 'exported' }
```

### Частые сценарии

**Открыть картинку по URL** (например, с вашего API):
```ts
const blob = await fetch('/api/images/42').then(r => r.blob());
await this.editor().open(blob, 'photo-42.jpg');   // имя нужно, чтобы редактор понял формат
```

**Отправить результат на сервер:**
```ts
private http = inject(HttpClient);

async save() {
  const file = await this.editor().export('png');
  const form = new FormData();
  form.append('file', file.blob, file.name);
  this.http.post('/api/images/42', form).subscribe();
}
```

**Показать результат на странице:**
```ts
const file = await this.editor().export('jpg');
this.previewUrl = URL.createObjectURL(file.blob);   // не забудьте URL.revokeObjectURL
```

**Хранить работу со слоями:** экспортируйте в `psd` (или `pcraft`), сохраните на сервере, позже
откройте снова через `open(blob, 'work.psd')` — слои, маски, текст сохранятся.

Полный рабочий пример — `angular/src/app/app.ts` и `app.html` в этом репозитории.

## 5. Пересборка редактора из исходников

Нужна, если вы меняете код PhotoCraft или мост, или обновляете PhotoCraft.

### Установка инструментов (один раз)

**Windows:**
1. Установите Rust: скачайте `rustup-init.exe` с https://rustup.rs и запустите (выберите
   вариант по умолчанию; при запросе поставьте Visual Studio Build Tools с «Desktop development with C++»).
2. В новом терминале:
   ```powershell
   rustup target add wasm32-unknown-unknown
   cargo install trunk --locked
   ```

**macOS / Linux:**
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown
cargo install trunk --locked
```

Проверка: `rustc --version` (нужна 1.95 или новее), `trunk --version`.

### Сборка

Из папки `angular/`:

```bash
npm run photocraft:build        # Windows (PowerShell)
npm run photocraft:build:sh     # macOS / Linux
```

Скрипт делает две вещи — их можно выполнить и вручную:

```bash
cd photocraft/apps/photocraft-web
trunk build --release                          # → photocraft/dist/web/
# затем заменить angular/public/photocraft содержимым photocraft/dist/web
```

Первая сборка идёт 10–30 минут (компилируется ~300 тыс. строк с LTO), следующие — быстрее.
`trunk` сам скачает подходящие `wasm-bindgen` и `wasm-opt`.

Для своего проекта: соберите так же и скопируйте `photocraft/dist/web/*` в `public/photocraft/`
своего проекта (старые файлы с другим `<hash>` удалите).

## 6. Перенос моста на новую версию PhotoCraft

PhotoCraft в этом репозитории — копия [storytold/photocraft](https://github.com/storytold/photocraft)
на коммите `24d10c3` плюс мост. Весь мост — это изменения в 4 файлах, они же лежат одним патчем
в [`patches/photocraft-embed.patch`](../patches/photocraft-embed.patch):

| Файл в `photocraft/apps/photocraft-web/` | Изменение |
|---|---|
| `src/embed.rs` | **новый**: приём/отправка сообщений, экспорт по запросу |
| `src/main.rs` | `mod embed;` |
| `src/web.rs` | подключение моста: `embed::listen(...)` при старте, `embed::serve(...)` каждый кадр, `embed::post_ready()`, сохранение отдаётся хозяину вместо скачивания; `Inbox` и `mime_for` стали `pub` |
| `Cargo.toml` | в фичи `web-sys` добавлены `MessageEvent`, `UrlSearchParams` |

Обновление на свежую версию оригинала:

```bash
git clone https://github.com/storytold/photocraft.git photocraft-new
cd photocraft-new
git apply --3way ../patches/photocraft-embed.patch   # если конфликт — поправить вручную по таблице выше
```

Затем замените папку `photocraft/` новой версией (без её `.git`) и пересоберите (раздел 5).

## 7. Выкладка на сервер

Сборка редактора — статические файлы, отдельный бэкенд не нужен. `ng build` копирует
`public/photocraft` в `dist/<проект>/browser/photocraft`, дальше всё выкладывается как обычно.

**MIME-тип `.wasm`.** Сервер должен отдавать `application/wasm`, иначе редактор зависнет на
«Loading». Nginx (если в его `mime.types` нет `wasm`):
```nginx
types { application/wasm wasm; }
gzip on; gzip_types application/wasm application/javascript;   # 22 МБ → ~9 МБ
location /photocraft/ { expires 1y; add_header Cache-Control "public, immutable"; }  # имена с хэшем
```
IIS — в `web.config`:
```xml
<system.webServer><staticContent>
  <remove fileExtension=".wasm" /><mimeMap fileExtension=".wasm" mimeType="application/wasm" />
</staticContent></system.webServer>
```
`index.html` редактора кэшировать долго нельзя — он ссылается на файлы с новым хэшем после пересборки.

**Приложение не в корне домена** (`ng build --base-href /app/`): ничего менять не нужно,
относительный `src` считается от `<base href>`.

**Редактор на другом домене / CDN:** `<app-photocraft-editor src="https://cdn.example.com/photocraft/index.html" />`.
Компонент сам добавит `?hostOrigin=<ваш домен>`, и редактор будет общаться только с ним.
Если у вас есть Content-Security-Policy, разрешите домен в `frame-src`.

**CSP для самого редактора:** если сервер ставит Content-Security-Policy и на страницу редактора,
ей нужны `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'` — trunk запускает wasm встроенным
`<script type="module">` в `index.html`.

## 8. Протокол сообщений (без Angular)

Мост работает с любой страницей — React, Vue, обычный JS. Все сообщения — объекты с полями
`source` и `type`; байты — `Uint8Array` (лучше передавать как transferable).

Страница → редактор (`source: 'photocraft-host'`):

| `type` | Поля | Что делает |
|---|---|---|
| `open` | `name`, `bytes` (`Uint8Array` / `ArrayBuffer`) | открывает файл новым документом |
| `export` | `id`, `name?` или `format?` | экспортирует активный документ, ответ — `exported` или `error` с тем же `id` |

Редактор → страница (`source: 'photocraft'`):

| `type` | Поля | Когда |
|---|---|---|
| `ready` | — | редактор запустился, можно слать сообщения |
| `saved` | `name`, `mime`, `bytes` | пользователь сохранил через меню редактора |
| `exported` | `id`, `name`, `mime`, `bytes` | ответ на `export` |
| `error` | `id`, `message` | `export` не удался |

Безопасность: редактор принимает сообщения только от родительского окна и только с origin из
`?hostOrigin=` (по умолчанию — свой собственный origin), и отправляет файлы только туда же.

Пример на чистом JS:

```html
<iframe id="pc" src="/photocraft/index.html" style="width:100%;height:80vh;border:0"></iframe>
<script>
  const frame = document.getElementById('pc');
  addEventListener('message', async (e) => {
    if (e.source !== frame.contentWindow || e.data?.source !== 'photocraft') return;
    if (e.data.type === 'ready') {
      const bytes = new Uint8Array(await (await fetch('/photo.jpg')).arrayBuffer());
      frame.contentWindow.postMessage({ source: 'photocraft-host', type: 'open', name: 'photo.jpg', bytes }, location.origin, [bytes.buffer]);
    }
    if (e.data.type === 'saved' || e.data.type === 'exported') {
      const blob = new Blob([e.data.bytes], { type: e.data.mime });
      console.log('файл из редактора', e.data.name, blob);
    }
  });
  // забрать результат: frame.contentWindow.postMessage({ source: 'photocraft-host', type: 'export', id: 1, format: 'png' }, location.origin);
</script>
```

## 9. Если что-то не работает

| Симптом | Причина и решение |
|---|---|
| Вечное «Loading PhotoCraft…» | откройте консоль браузера (F12). 404 на `.js`/`.wasm` — сборка лежит не там, куда указывает `src`. Ошибка про MIME — настройте `application/wasm` (раздел 7). Файлы от разных сборок — замените папку целиком |
| «A browser with WebGPU or WebGL2 is required» | браузер/видеодрайвер без WebGPU и WebGL2; обновите браузер, включите аппаратное ускорение |
| Редактор виден, но `open()`/`export()` молчат | не совпал origin: проверьте, что `src` и страница на одном домене, или что не переопределён `hostOrigin`. В консоли редактора будут предупреждения `embed:` |
| `export()` → `no open document` | в редакторе нет открытого документа |
| Редактор нулевой высоты | задайте высоту элементу `<app-photocraft-editor>` (например, `height: 80vh` или flex) |
| Тормозит рисование | редактор работает через WebGL вместо WebGPU или на программном рендере; на слабых устройствах это ожидаемо. Параметры `src="photocraft/index.html?webgl"` и `?cpu` принудительно выбирают бэкенд |
| SSR (Angular Universal / `@angular/ssr`) | компонент на сервере ничего не рендерит, iframe появляется уже в браузере — дополнительная настройка не нужна |

Ограничения самого PhotoCraft (ранняя альфа): возможны баги, интерфейс только в стиле Photoshop
(свою тему вашего дизайна не применить), в веб-сборке нет японского шрифта.
