import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

/** Messenger accepts attachments up to 25 MB; the same cap applies to copies the CRM keeps. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** What a message keeps about each image / file (stored in Message.attachments). */
export interface StoredAttachment {
  type: 'image' | 'video' | 'audio' | 'file' | 'sticker' | 'other';
  /** Facebook's link; it expires after a while */
  url?: string;
  name?: string;
  mime?: string;
  size?: number;
  /** Copy kept by the CRM, relative to CHAT_FILES_DIR */
  file?: string;
}

const EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'application/pdf': '.pdf',
};

/** Copies of chat images and files on the server disk, in CHAT_FILES_DIR/YYYY/MM/<uuid>.<ext>. */
export class ChatFiles {
  private readonly root: string;

  constructor(dir: string) {
    this.root = resolve(dir);
  }

  async save(data: Buffer, mime: string, name?: string): Promise<string> {
    const now = new Date();
    const folder = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const ext = (name && /^\.[a-z0-9]{1,8}$/i.test(extname(name)) ? extname(name) : EXT[mime]) ?? '.bin';
    const rel = `${folder}/${randomUUID()}${ext.toLowerCase()}`;
    await mkdir(join(this.root, folder), { recursive: true });
    await writeFile(join(this.root, rel), data);
    return rel;
  }

  read(rel: string): Promise<Buffer> {
    return readFile(this.path(rel));
  }

  /** Absolute path of a stored copy; refuses anything that would leave the folder */
  path(rel: string): string {
    const full = resolve(this.root, rel);
    if (!full.startsWith(this.root + sep)) throw new Error('Invalid chat file path');
    return full;
  }
}
