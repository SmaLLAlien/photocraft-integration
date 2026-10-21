/** Адрес случайной картинки. picsum.photos отдаёт JPEG и разрешает загрузку из браузера (CORS). */
export const RANDOM_IMAGE_URL = 'https://picsum.photos/1600/1000';

/** Скачать случайную картинку из интернета как Blob. */
export async function fetchRandomImage(): Promise<{ blob: Blob; name: string }> {
  // ?random=… — чтобы браузер не взял прошлую картинку из кэша
  const res = await fetch(`${RANDOM_IMAGE_URL}?random=${Date.now()}`);
  if (!res.ok) throw new Error(`сервер ответил ${res.status}`);
  const blob = await res.blob();
  // picsum возвращает id картинки в заголовке; если его нет — просто время
  const id = res.headers.get('picsum-id') ?? Date.now().toString();
  return { blob, name: `random-${id}.${extFor(blob.type)}` };
}

/** MIME → расширение, чтобы редактор понял формат по имени файла. */
export function extFor(mime: string): string {
  return (
    ({
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'image/tiff': 'tif',
      'image/bmp': 'bmp',
      'image/vnd.adobe.photoshop': 'psd',
    } as Record<string, string>)[mime] ?? 'png'
  );
}

/** Имя файла без расширения. */
export function stem(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

/** Предложить браузеру сохранить файл на компьютер. */
export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} КБ` : `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}
