import { Component, DestroyRef, ElementRef, PLATFORM_ID, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { DomSanitizer } from '@angular/platform-browser';
import { HostMessage, PhotocraftFile, PhotocraftFormat, isEditorMessage } from './photocraft-protocol';

/**
 * PhotoCraft внутри iframe. Требуется Angular 17.3+.
 *
 *   <app-photocraft-editor #editor (saved)="onSaved($event)" />
 *   editor.open(file);                       // открыть картинку/PSD в редакторе
 *   const png = await editor.export('png');  // забрать текущий документ (Blob)
 *
 * Сборка редактора (index.html + .js + .wasm) должна лежать по адресу `src`,
 * по умолчанию — в public/photocraft. Подробности: docs/INTEGRATION.md.
 */
@Component({
  selector: 'app-photocraft-editor',
  template: `
    @if (url(); as url) {
      <iframe #frame [src]="url" title="PhotoCraft" allow="clipboard-read; clipboard-write; fullscreen"></iframe>
    }
    @if (!ready()) {
      <div class="loading">Загрузка PhotoCraft…</div>
    }
  `,
  styles: `
    :host { position: relative; display: block; background: #262626; }
    iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; display: block; }
    .loading { position: absolute; inset: 0; display: grid; place-items: center; color: #aaa; font: 14px system-ui, sans-serif; pointer-events: none; }
  `,
})
export class PhotocraftEditor {
  /**
   * Адрес index.html сборки PhotoCraft. Относительный путь считается от <base href>.
   * Может быть и на другом домене (например, CDN): тогда редактору передаётся ?hostOrigin=…
   */
  readonly src = input('photocraft/index.html');

  /** Редактор загрузился и принимает файлы. */
  readonly loaded = output<void>();
  /** Пользователь сохранил/экспортировал файл через меню File редактора. */
  readonly saved = output<PhotocraftFile>();

  readonly ready = signal(false);

  private readonly frame = viewChild<ElementRef<HTMLIFrameElement>>('frame');
  /** При SSR редактор не рендерится: iframe появится уже в браузере. */
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly sanitizer = inject(DomSanitizer);
  /** Файлы, отправленные до того, как редактор загрузился. */
  private queue: HostMessage[] = [];
  private nextId = 1;
  private pending = new Map<number, { resolve: (f: PhotocraftFile) => void; reject: (e: Error) => void }>();

  /** Полный адрес редактора; с другого домена — с ?hostOrigin, чтобы редактор принимал наши сообщения. */
  private readonly editorUrl = computed(() => {
    if (!this.browser) return null;
    const url = new URL(this.src(), document.baseURI);
    if (url.origin !== location.origin) url.searchParams.set('hostOrigin', location.origin);
    return url;
  });
  // computed: один и тот же объект, иначе iframe перезагружался бы на каждой проверке изменений.
  protected readonly url = computed(() => {
    const url = this.editorUrl();
    return url ? this.sanitizer.bypassSecurityTrustResourceUrl(url.href) : null;
  });

  constructor() {
    // Новый src — iframe перезагружается: ждём от него нового `ready`.
    effect(() => {
      this.editorUrl();
      untracked(() => this.ready.set(false));
    });
    const destroyRef = inject(DestroyRef);
    if (!this.browser) return;
    const onMessage = (e: MessageEvent) => this.onMessage(e);
    window.addEventListener('message', onMessage);
    destroyRef.onDestroy(() => {
      window.removeEventListener('message', onMessage);
      this.pending.forEach((p) => p.reject(new Error('PhotoCraft закрыт')));
    });
  }

  /** Открыть файл (PNG, JPEG, WebP, TIFF, PSD, …) как новый документ. */
  async open(file: Blob, name = (file as File).name ?? 'image.png'): Promise<void> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    this.send({ source: 'photocraft-host', type: 'open', name, bytes }, [bytes.buffer]);
  }

  /**
   * Получить активный документ редактора в нужном формате.
   * @param format формат (`png`, `jpg`, `psd`, …) или полное имя файла (`result.webp`).
   */
  export(format: PhotocraftFormat | string = 'png'): Promise<PhotocraftFile> {
    const id = this.nextId++;
    const named = format.includes('.');
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ source: 'photocraft-host', type: 'export', id, ...(named ? { name: format } : { format }) });
    });
  }

  private send(msg: HostMessage, transfer: Transferable[] = []): void {
    const win = this.frame()?.nativeElement.contentWindow;
    const target = this.editorUrl()?.origin;
    if (!this.ready() || !win || !target) {
      this.queue.push(msg);
      return;
    }
    win.postMessage(msg, target, transfer);
  }

  private onMessage(e: MessageEvent): void {
    if (!this.frame() || e.source !== this.frame()?.nativeElement.contentWindow || e.origin !== this.editorUrl()?.origin || !isEditorMessage(e.data)) {
      return;
    }
    const msg = e.data;
    switch (msg.type) {
      case 'ready': {
        this.ready.set(true);
        const queued = this.queue;
        this.queue = [];
        queued.forEach((m) => this.send(m));
        this.loaded.emit();
        break;
      }
      case 'saved':
        this.saved.emit({ name: msg.name, mime: msg.mime, blob: new Blob([msg.bytes as BlobPart], { type: msg.mime }), via: 'saved' });
        break;
      case 'exported':
        this.pending.get(msg.id)?.resolve({ name: msg.name, mime: msg.mime, blob: new Blob([msg.bytes as BlobPart], { type: msg.mime }), via: 'exported' });
        this.pending.delete(msg.id);
        break;
      case 'error':
        this.pending.get(msg.id)?.reject(new Error(msg.message));
        this.pending.delete(msg.id);
        break;
    }
  }
}
