import { createInterface } from "node:readline";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { permissions, User } from "./domain";
import { GreencodeService, parseRole, parseState, parseStatus } from "./service";
import { SecureStore } from "./store";

const SESSION_MS = 30 * 60 * 1000;
const store = new SecureStore(); const service = new GreencodeService(store);
const tokens = (line: string) => line.match(/(?:[^\s"]+|"[^"]*")+/g)?.map(x => x.replace(/^"|"$/g, "")) || [];
function options(parts: string[]) { const result: Record<string, string> = {}; for (let i = 0; i < parts.length; i++) if (parts[i].startsWith("--")) result[parts[i].slice(2)] = parts[++i] || ""; return result; }
const help = "Comandos: user criar, org criar, lote criar, equipamento adicionar|mover, rastrear, journal, ajuda, sair";

async function execute(user: User, line: string): Promise<string> {
  const [resource, action, ...tail] = tokens(line); const opt = options([action, ...tail]);
  if (resource === "ajuda") return help;
  if (resource === "user" && action === "criar") { await service.createUser(user, opt.user, opt.password, parseRole(opt.role)); return "[SUCESSO] Usuário criado."; }
  if (resource === "org" && action === "criar") { await service.createOrganization(user, opt.id, opt.cnpj, opt.nome); return "[SUCESSO] Organização cadastrada."; }
  if (resource === "lote" && action === "criar") { const batch = await service.createBatch(user, opt.org, opt.nf, opt.transp, opt.data || new Date().toISOString().slice(0, 10)); return `[SUCESSO] Lote ${batch.id} criado.`; }
  if (resource === "equipamento" && action === "adicionar") { await service.addEquipment(user, opt.id, opt.lote, opt.tipo, parseState(opt.estado)); return "[SUCESSO] Equipamento cadastrado."; }
  if (resource === "equipamento" && action === "mover") { await service.moveEquipment(user, opt.id, parseStatus(opt.status), parseState(opt.estado), opt.justificativa); return "[SUCESSO] Movimentação registrada."; }
  if (resource === "rastrear") return JSON.stringify(await service.trace(user, action), null, 2);
  if (resource === "journal") return JSON.stringify(await service.auditLog(user), null, 2);
  throw new Error("[ERRO] Comando inválido. " + help);
}

async function main() {
  const historyPath = join(store.dir, ".history");
  let history: string[] = []; try { history = (await readFile(historyPath, "utf8")).split("\n").filter(Boolean); } catch { /* sem histórico */ }
  const rl = createInterface({ input: process.stdin, output: process.stdout, completer: (line: string) => { const words = ["user criar", "org criar", "lote criar", "equipamento adicionar", "equipamento mover", "rastrear", "journal", "ajuda", "sair"]; const hits = words.filter(x => x.startsWith(line)); return [hits.length ? hits : words, line]; } });
  (rl as unknown as { history: string[] }).history = history;
  const ask = (q: string) => new Promise<string>(resolve => rl.question(q, resolve));
  try {
    if (!(await store.initialized())) { console.log("[INFO] Provisionamento inicial."); await service.initialize(await ask("Senha do administrador (mín. 8): ")); console.log("[SUCESSO] Administrador 'admin' criado."); } else await service.initialize();
    const user = await service.login(await ask("Usuário: "), await ask("Senha: "));
    console.log(`[INFO] Autenticado como ${user.username} (${user.role}). ${help}`); console.log(`[INFO] Recursos permitidos: ${permissions[user.role].join(", ")}`);
    let lastActivity = Date.now();
    while (true) { const line = (await ask("greencode> ")).trim(); if (!line) continue; if (Date.now() - lastActivity > SESSION_MS) throw new Error("[AVISO] Sessão expirada após 30 minutos de inatividade."); lastActivity = Date.now(); if (line === "sair") break;
      try { console.log(await execute(user, line)); history.unshift(line); history = [...new Set(history)].slice(0, 200); } catch (e) { console.error(e instanceof Error ? e.message : "[ERRO] Falha inesperada."); }
    }
  } finally { await writeFile(historyPath, history.join("\n"), { mode: 0o600 }); rl.close(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
export { execute };
