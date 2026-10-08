/**
 * Сообщения между Angular и PhotoCraft (iframe), см. photocraft/apps/photocraft-web/src/embed.rs.
 * Каждое сообщение — объект с полями `source` и `type`; байты передаются как Uint8Array.
 */

/** Angular → PhotoCraft */
export type HostMessage =
  | { source: 'photocraft-host'; type: 'open'; name: string; bytes: Uint8Array | ArrayBuffer }
  | { source: 'photocraft-host'; type: 'export'; id: number; name?: string; format?: string };

/** PhotoCraft → Angular */
export type EditorMessage =
  | { source: 'photocraft'; type: 'ready' }
  | { source: 'photocraft'; type: 'saved'; name: string; mime: string; bytes: Uint8Array }
  | { source: 'photocraft'; type: 'exported'; id: number; name: string; mime: string; bytes: Uint8Array }
  | { source: 'photocraft'; type: 'error'; id: number; message: string };

/** Файл, который вернул редактор. */
export interface PhotocraftFile {
  name: string;
  mime: string;
  blob: Blob;
  /** `saved` — пользователь сам нажал Save/Export в меню; `exported` — Angular запросил экспорт. */
  via: 'saved' | 'exported';
}

/** Форматы, которые редактор умеет сохранять (по расширению имени файла). */
export type PhotocraftFormat = 'png' | 'jpg' | 'webp' | 'tiff' | 'psd' | 'pcraft';

export function isEditorMessage(data: unknown): data is EditorMessage {
  return typeof data === 'object' && data !== null && (data as { source?: unknown }).source === 'photocraft';
}
