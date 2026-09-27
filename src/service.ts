import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { Batch, Equipment, EquipmentStatus, JournalEntry, Organization, PhysicalState, Role, User } from "./domain";
import { SecureStore } from "./store";
import { enumValue, required, stateIndex, validateCnpj, validateEntryDate } from "./validation";

const hash = (password: string) => createHash("sha256").update(password, "utf8").digest("hex");
const sameHash = (a: string, b: string) => timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));

export class GreencodeService {
  constructor(private readonly store: SecureStore) {}
  async initialize(adminPassword?: string): Promise<boolean> {
    if (await this.store.initialized()) { await this.store.open(); return false; }
    const password = required(adminPassword, "Senha inicial");
    if (password.length < 8) throw new Error("A senha inicial deve ter ao menos 8 caracteres.");
    await this.store.provision("admin");
    await this.store.write<User[]>("credentials", [{ username: "admin", passwordHash: hash(password), role: "ADMIN", createdAt: new Date().toISOString() }]);
    return true;
  }
  async login(username: string, password: string): Promise<User> {
    const users = await this.store.read<User[]>("credentials", []); const user = users.find(x => x.username === username);
    if (!user || !sameHash(user.passwordHash, hash(password))) throw new Error("Credenciais inválidas.");
    return user;
  }
  private async audit(actor: string, action: string, payload: Record<string, unknown>): Promise<void> {
    await this.store.journal({ id: randomUUID(), at: new Date().toISOString(), actor, action, payload });
  }
  async createUser(actor: User, username: string, password: string, role: Role): Promise<void> {
    this.allow(actor, "user"); username = required(username, "Usuário"); if (password.length < 8) throw new Error("A senha deve ter ao menos 8 caracteres.");
    const users = await this.store.read<User[]>("credentials", []); if (users.some(u => u.username === username)) throw new Error("Usuário já existe.");
    users.push({ username, passwordHash: hash(password), role, createdAt: new Date().toISOString() }); await this.store.write("credentials", users); await this.audit(actor.username, "USER_CREATED", { username, role });
  }
  async createOrganization(actor: User, id: string, cnpj: string, name: string): Promise<void> {
    this.allow(actor, "org"); id = required(id, "Identificador"); name = required(name, "Nome"); cnpj = validateCnpj(cnpj);
    const organizations = await this.store.read<Organization[]>("organizations", []);
    if (organizations.some(x => x.id === id || x.cnpj === cnpj)) throw new Error("Identificador ou CNPJ já cadastrado.");
    organizations.push({ id, cnpj, name, createdAt: new Date().toISOString() }); await this.store.write("organizations", organizations); await this.audit(actor.username, "ORGANIZATION_CREATED", { id, cnpj });
  }
  async createBatch(actor: User, organizationId: string, invoice: string, carrier: string, entryDate: string): Promise<Batch> {
    this.allow(actor, "lote"); organizationId = required(organizationId, "Organização"); entryDate = validateEntryDate(entryDate);
    if (!(await this.store.read<Organization[]>("organizations", [])).some(x => x.id === organizationId)) throw new Error("Organização não encontrada.");
    const batches = await this.store.read<Batch[]>("batches", []); const batch = { id: `LT-${randomUUID().slice(0, 8).toUpperCase()}`, organizationId, invoice: required(invoice, "Nota fiscal"), carrier: required(carrier, "Transportadora"), entryDate, createdAt: new Date().toISOString() };
    batches.push(batch); await this.store.write("batches", batches); await this.audit(actor.username, "BATCH_CREATED", { id: batch.id, organizationId }); return batch;
  }
  async addEquipment(actor: User, id: string, batchId: string, type: string, physicalState: PhysicalState): Promise<void> {
    this.allow(actor, "equipamento"); id = required(id, "Código de barras");
    if (!(await this.store.read<Batch[]>("batches", [])).some(x => x.id === batchId)) throw new Error("Lote não encontrado.");
    const equipment = await this.store.read<Equipment[]>("equipment", []); if (equipment.some(x => x.id === id)) throw new Error("Equipamento já cadastrado.");
    equipment.push({ id, batchId, type: required(type, "Tipo"), status: "RECEBIDO", physicalState, triageComplete: false, movements: [], createdAt: new Date().toISOString() }); await this.store.write("equipment", equipment); await this.audit(actor.username, "EQUIPMENT_ADDED", { id, batchId });
  }
  async moveEquipment(actor: User, id: string, status: EquipmentStatus, physicalState: PhysicalState, reason?: string): Promise<void> {
    this.allow(actor, "equipamento"); const equipment = await this.store.read<Equipment[]>("equipment", []); const item = equipment.find(x => x.id === id); if (!item) throw new Error("Equipamento não encontrado.");
    if (status === "DESMONTE" && !item.triageComplete) throw new Error("O equipamento exige triagem completa antes do desmonte.");
    if (stateIndex(physicalState) - stateIndex(item.physicalState) >= 2 && !reason?.trim()) throw new Error("Informe justificativa para redução de duas ou mais categorias físicas.");
    const from = item.status; item.status = status; item.physicalState = physicalState; item.triageComplete ||= status === "TRIAGEM"; item.movements.push({ at: new Date().toISOString(), from, to: status, physicalState, reason: reason?.trim(), by: actor.username });
    await this.store.write("equipment", equipment); await this.audit(actor.username, "EQUIPMENT_MOVED", { id, from, status, physicalState });
  }
  async trace(actor: User, id: string): Promise<Equipment> { this.allow(actor, "rastrear"); const item = (await this.store.read<Equipment[]>("equipment", [])).find(x => x.id === id); if (!item) throw new Error("Equipamento não encontrado."); return item; }
  async auditLog(actor: User): Promise<JournalEntry[]> { this.allow(actor, "journal"); return this.store.journals(); }
  private allow(user: User, resource: string): void { const { permissions } = require("./domain") as typeof import("./domain"); if (!permissions[user.role].includes(resource)) throw new Error("[ERRO] Permissão negada para este papel."); }
}
export const parseRole = (value: string) => enumValue(value, ["ADMIN", "CADASTRO", "ALMOXARIFADO", "AUDITOR"] as const, "Papel");
export const parseState = (value: string) => enumValue(value, ["NOVO", "BOM", "REGULAR", "RUIM", "SUCATA"] as const, "Estado físico");
export const parseStatus = (value: string) => enumValue(value, ["RECEBIDO", "TRIAGEM", "DESMONTE", "DESTINADO"] as const, "Status");
