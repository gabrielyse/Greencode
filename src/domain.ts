export type Role = "ADMIN" | "CADASTRO" | "ALMOXARIFADO" | "AUDITOR";
export type PhysicalState = "NOVO" | "BOM" | "REGULAR" | "RUIM" | "SUCATA";
export type EquipmentStatus = "RECEBIDO" | "TRIAGEM" | "DESMONTE" | "DESTINADO";

export interface User { username: string; passwordHash: string; role: Role; createdAt: string }
export interface Organization { id: string; cnpj: string; name: string; createdAt: string }
export interface Batch { id: string; organizationId: string; invoice: string; carrier: string; entryDate: string; createdAt: string }
export interface Movement { at: string; from: EquipmentStatus; to: EquipmentStatus; physicalState: PhysicalState; reason?: string; by: string }
export interface Equipment { id: string; batchId: string; type: string; status: EquipmentStatus; physicalState: PhysicalState; triageComplete: boolean; movements: Movement[]; createdAt: string }
export interface JournalEntry { id: string; at: string; actor: string; action: string; payload: Record<string, unknown> }
export const permissions: Record<Role, string[]> = {
  ADMIN: ["user", "org", "lote", "equipamento", "rastrear", "journal"],
  CADASTRO: ["org", "lote"],
  ALMOXARIFADO: ["equipamento", "rastrear"],
  AUDITOR: ["rastrear", "journal"]
};
