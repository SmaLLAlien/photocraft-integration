import { Component, DestroyRef, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatToolbarModule } from '@angular/material/toolbar';
import { EditorDialog } from './editor-dialog/editor-dialog';
import { fetchRandomImage, formatSize } from './image-utils';

/** Картинка, показанная на странице. */
interface Picture {
  blob: Blob;
  name: string;
  url: string;
  edited: boolean;
}

@Component({
  selector: 'app-root',
  imports: [MatToolbarModule, MatButtonModule, MatMenuModule, MatCardModule, MatProgressBarModule, MatSnackBarModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);

  protected readonly picture = signal<Picture | null>(null);
  protected readonly loading = signal(false);
  protected readonly formatSize = formatSize;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.setPicture(null));
  }

  /** «Загрузить картинку › С компьютера» */
  protected pickImage(input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = '';
    if (file) this.setPicture({ blob: file, name: file.name, edited: false });
  }

  /** «Загрузить картинку › Случайная из интернета» */
  protected async loadRandom(): Promise<void> {
    this.loading.set(true);
    try {
      const { blob, name } = await fetchRandomImage();
      this.setPicture({ blob, name, edited: false });
    } catch (e) {
      this.snack.open(`Не удалось загрузить картинку из интернета: ${(e as Error).message}`, 'OK', { duration: 6000 });
    } finally {
      this.loading.set(false);
    }
  }

  /** «Редактировать»: открыть показанную картинку в редакторе. */
  protected edit(): void {
    const pic = this.picture();
    if (pic) this.openEditor(pic.blob, pic.name);
  }

  /** «Открыть PSD»: сразу в редактор. */
  protected pickPsd(input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = '';
    if (file) this.openEditor(file, file.name);
  }

  private openEditor(file: Blob, name: string): void {
    EditorDialog.open(this.dialog, { file, name })
      .afterClosed()
      .subscribe((result) => {
        // «Забрать»: показываем отредактированную картинку вместо прежней
        if (result) this.setPicture({ blob: result.blob, name: result.name, edited: true });
      });
  }

  private setPicture(pic: Omit<Picture, 'url'> | null): void {
    const old = this.picture();
    if (old) URL.revokeObjectURL(old.url);
    this.picture.set(pic ? { ...pic, url: URL.createObjectURL(pic.blob) } : null);
  }
}
