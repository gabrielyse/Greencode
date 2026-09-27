import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { JournalEntry } from "./domain";

interface MasterConfig { key: string; firstAdmin: string; createdAt: string }
const JOURNAL_LIMIT = 10 * 1024 * 1024;
const RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

export class SecureStore {
  private key!: Buffer;
  constructor(public readonly dir = process.env.GREENCODE_DATA_DIR || join(process.cwd(), "data")) {}
  private configPath() { return join(this.dir, "master.config.json"); }
  async initialized(): Promise<boolean> { try { await stat(this.configPath()); return true; } catch { return false; } }
  async provision(firstAdmin: string): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    if (await this.initialized()) throw new Error("Sistema já provisionado.");
    const config: MasterConfig = { key: randomBytes(32).toString("base64"), firstAdmin, createdAt: new Date().toISOString() };
    await this.atomic(this.configPath(), JSON.stringify(config)); this.key = Buffer.from(config.key, "base64");
  }
  async open(): Promise<void> {
    const config = JSON.parse(await readFile(this.configPath(), "utf8")) as MasterConfig;
    this.key = Buffer.from(config.key, "base64");
    if (this.key.length !== 32) throw new Error("Chave mestra inválida.");
  }
  private encrypt(value: string): string {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: encrypted.toString("base64") });
  }
  private decrypt(raw: string): string {
    const input = JSON.parse(raw) as { iv: string; tag: string; data: string };
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(input.iv, "base64"));
    decipher.setAuthTag(Buffer.from(input.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(input.data, "base64")), decipher.final()]).toString("utf8");
  }
  private async atomic(path: string, content: string): Promise<void> {
    const temporary = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 }); await rename(temporary, path);
  }
  async read<T>(name: string, fallback: T): Promise<T> {
    try { return JSON.parse(this.decrypt(await readFile(join(this.dir, `${name}.enc`), "utf8"))) as T; }
    catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback; throw new Error(`Não foi possível ler ${name}: dados corrompidos ou chave inválida.`); }
  }
  async write<T>(name: string, data: T): Promise<void> { await this.atomic(join(this.dir, `${name}.enc`), this.encrypt(JSON.stringify(data))); }
  async journal(entry: JournalEntry): Promise<void> {
    const path = join(this.dir, "transactions.journal");
    try { if ((await stat(path)).size >= JOURNAL_LIMIT) await rename(path, join(this.dir, `transactions-${Date.now()}.journal`)); } catch { /* primeiro journal */ }
    // Cada registro é uma unidade AES-GCM independente. A regravação atômica evita journal parcial em queda.
    let prior = ""; try { prior = await readFile(path, "utf8"); } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await this.atomic(path, `${prior}${this.encrypt(JSON.stringify(entry))}\n`);
    await this.pruneJournals();
  }
  private async pruneJournals(): Promise<void> {
    const files = await readdir(this.dir); const now = Date.now();
    await Promise.all(files.filter(f => /^transactions-\d+\.journal$/.test(f)).map(async f => {
      const file = join(this.dir, f); if (now - (await stat(file)).mtimeMs > RETENTION_MS) await unlink(file);
    }));
  }
  async journals(): Promise<JournalEntry[]> {
    const files = (await readdir(this.dir)).filter(f => f === "transactions.journal" || /^transactions-\d+\.journal$/.test(f));
    const items: JournalEntry[] = [];
    for (const file of files) { const lines = (await readFile(join(this.dir, file), "utf8")).trim().split("\n").filter(Boolean); for (const line of lines) items.push(JSON.parse(this.decrypt(line))); }
    return items.sort((a, b) => a.at.localeCompare(b.at));
  }
}
