import { Component, DestroyRef, inject, signal, viewChild } from '@angular/core';
import { PhotocraftEditor } from './photocraft/photocraft-editor';
import { PhotocraftFile } from './photocraft/photocraft-protocol';

interface Result extends PhotocraftFile {
  url: string;
  isImage: boolean;
  at: Date;
}

/** Демо: открыть картинку в PhotoCraft, отредактировать и забрать результат обратно в Angular. */
@Component({
  selector: 'app-root',
  imports: [PhotocraftEditor],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly editor = viewChild.required(PhotocraftEditor);
  protected readonly results = signal<Result[]>([]);
  protected readonly status = signal('Загружаю редактор…');
  protected readonly busy = signal(false);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.results().forEach((r) => URL.revokeObjectURL(r.url)));
  }

  protected onLoaded(): void {
    this.status.set('Редактор готов. Откройте файл или пример.');
  }

  protected async openFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    await this.editor().open(file);
    this.status.set(`Открыт «${file.name}»`);
  }

  protected async openSample(): Promise<void> {
    await this.editor().open(await sampleImage(), 'пример.png');
    this.status.set('Открыт пример');
  }

  /** Angular сам запрашивает текущий документ у редактора. */
  protected async take(format: string): Promise<void> {
    this.busy.set(true);
    try {
      const file = await this.editor().export(format);
      this.add(file);
      this.status.set(`Получен ${file.name} (${size(file.blob.size)})`);
    } catch (e) {
      this.status.set(`Не удалось: ${(e as Error).message}`);
    } finally {
      this.busy.set(false);
    }
  }

  /** Пользователь сам нажал File › Save / Export внутри редактора. */
  protected onSaved(file: PhotocraftFile): void {
    this.add(file);
    this.status.set(`Редактор сохранил ${file.name} (${size(file.blob.size)})`);
  }

  private add(file: PhotocraftFile): void {
    const isImage = /^image\/(png|jpeg|webp|gif)$/.test(file.mime);
    this.results.update((list) => [{ ...file, url: URL.createObjectURL(file.blob), isImage, at: new Date() }, ...list]);
  }

  protected readonly size = size;
}

function size(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} КБ` : `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

/** Небольшая картинка для быстрой проверки, рисуется на canvas. */
function sampleImage(): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = 1200;
  c.height = 800;
  const g = c.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, c.height);
  sky.addColorStop(0, '#1d3557');
  sky.addColorStop(1, '#e76f51');
  g.fillStyle = sky;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#f4d35e';
  g.beginPath();
  g.arc(850, 330, 120, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#0b132b';
  g.beginPath();
  g.moveTo(0, 800);
  g.lineTo(300, 420);
  g.lineTo(520, 640);
  g.lineTo(760, 380);
  g.lineTo(1200, 800);
  g.fill();
  g.fillStyle = '#fff';
  g.font = '600 64px system-ui, sans-serif';
  g.fillText('Hello, PhotoCraft', 60, 120);
  return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('canvas'))), 'image/png'));
}
