declare module 'adm-zip' {
  export interface ZipEntry {
    entryName: string;
    isDirectory: boolean;
    attr?: number;
    header: { size: number; attr?: number };
  }

  export default class AdmZip {
    constructor(buffer?: Buffer);
    getEntries(): ZipEntry[];
    extractAllTo(target: string, overwrite?: boolean): void;
    addFile(entryName: string, content: Buffer): void;
    toBuffer(): Buffer;
  }
}
