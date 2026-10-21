import { AfterViewInit, Component, inject, signal, viewChild } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogConfig, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { PhotocraftEditor } from '../photocraft/photocraft-editor';
import { PhotocraftFile } from '../photocraft/photocraft-protocol';
import { download, stem } from '../image-utils';

/** Что открыть в редакторе. */
export interface EditorDialogData {
  file: Blob;
  name: string;
}

/** Результат: отредактированная картинка (PNG) или undefined, если закрыли без «Забрать». */
export type EditorDialogResult = PhotocraftFile | undefined;

/**
 * Модалка почти на весь экран: PhotoCraft с переданным файлом и кнопки
 * «Забрать» (вернуть картинку на страницу) и «Сохранить PSD» (скачать PSD со слоями).
 */
@Component({
  selector: 'app-editor-dialog',
  imports: [MatDialogModule, MatButtonModule, MatProgressSpinnerModule, PhotocraftEditor],
  template: `
    <app-photocraft-editor class="editor" (loaded)="ready.set(true)" (saved)="onEditorSaved($event)" />
    <div class="actions">
      <span class="status">
        @if (busy()) {
          <mat-spinner diameter="18" />
        }
        {{ status() }}
      </span>
      <button mat-button (click)="cancel()">Отмена</button>
      <button mat-stroked-button [disabled]="!ready() || busy()" (click)="savePsd()">Сохранить PSD</button>
      <button mat-flat-button [disabled]="!ready() || busy()" (click)="take()">Забрать</button>
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; height: 100%; }
    .editor { flex: 1; min-height: 0; }
    .actions { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--mat-sys-outline-variant, #ddd); }
    .status { display: flex; align-items: center; gap: 8px; margin-right: auto; color: var(--mat-sys-on-surface-variant, #666); font-size: 14px; }
  `,
})
export class EditorDialog implements AfterViewInit {
  /** Открыть модалку с файлом; возвращает ссылку на диалог. */
  static open(dialog: MatDialog, data: EditorDialogData): MatDialogRef<EditorDialog, EditorDialogResult> {
    const config: MatDialogConfig<EditorDialogData> = {
      data,
      width: '96vw',
      height: '94vh',
      maxWidth: '100vw',
      panelClass: 'photocraft-dialog',
      autoFocus: false,
      // случайный клик мимо или Esc не должны выбрасывать несохранённую работу
      disableClose: true,
    };
    return dialog.open<EditorDialog, EditorDialogData, EditorDialogResult>(EditorDialog, config);
  }

  private readonly data = inject<EditorDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<EditorDialog, EditorDialogResult>>(MatDialogRef);
  private readonly editor = viewChild.required(PhotocraftEditor);

  protected readonly ready = signal(false);
  protected readonly busy = signal(false);
  protected readonly status = signal('Загрузка редактора…');

  ngAfterViewInit(): void {
    // Можно звать до загрузки редактора: файл подождёт в очереди
    this.editor()
      .open(this.data.file, this.data.name)
      .then(() => this.status.set(this.data.name));
  }

  /** «Забрать»: текущий документ редактора → PNG → обратно на страницу. */
  protected async take(): Promise<void> {
    await this.run('Готовлю картинку…', async () => {
      const file = await this.editor().export(`${stem(this.data.name)}.png`);
      this.ref.close(file);
    });
  }

  /** «Сохранить PSD»: документ со слоями → файл на компьютер. Модалка остаётся открытой. */
  protected async savePsd(): Promise<void> {
    await this.run('Сохраняю PSD…', async () => {
      const file = await this.editor().export(`${stem(this.data.name)}.psd`);
      download(file.blob, file.name);
      this.status.set(`Сохранён ${file.name}`);
    });
  }

  /** File › Save / Ctrl+S внутри редактора тоже сохраняют файл на компьютер. */
  protected onEditorSaved(file: PhotocraftFile): void {
    download(file.blob, file.name);
    this.status.set(`Сохранён ${file.name}`);
  }

  protected cancel(): void {
    this.ref.close(undefined);
  }

  private async run(label: string, work: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.status.set(label);
    try {
      await work();
    } catch (e) {
      this.status.set(`Не получилось: ${(e as Error).message}`);
    } finally {
      this.busy.set(false);
    }
  }
}
