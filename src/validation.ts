import { PhysicalState } from "./domain";

export function required(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`${label} é obrigatório.`);
  return value.trim();
}

export function validateCnpj(input: string): string {
  const cnpj = input.replace(/\D/g, "");
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1+$/.test(cnpj)) throw new Error("CNPJ inválido.");
  const digit = (base: string, weights: number[]) => {
    const sum = [...base].reduce((total, value, index) => total + Number(value) * weights[index], 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  const d1 = digit(cnpj.slice(0, 12), [5,4,3,2,9,8,7,6,5,4,3,2]);
  const d2 = digit(cnpj.slice(0, 12) + d1, [6,5,4,3,2,9,8,7,6,5,4,3,2]);
  if (Number(cnpj[12]) !== d1 || Number(cnpj[13]) !== d2) throw new Error("CNPJ inválido (dígitos verificadores).");
  return cnpj;
}

export function validateEntryDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Data de entrada inválida; use AAAA-MM-DD.");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new Error("Data de entrada inválida; use AAAA-MM-DD.");
  const now = new Date(); now.setUTCHours(0, 0, 0, 0);
  const oldest = new Date(now); oldest.setUTCDate(now.getUTCDate() - 90);
  if (date > now || date < oldest) throw new Error("A entrada deve estar entre hoje e os últimos 90 dias.");
  return value;
}

export function stateIndex(state: PhysicalState): number { return ["NOVO", "BOM", "REGULAR", "RUIM", "SUCATA"].indexOf(state); }
export function enumValue<T extends string>(value: string | undefined, values: readonly T[], label: string): T {
  if (!value || !values.includes(value as T)) throw new Error(`${label} inválido. Valores: ${values.join(", ")}.`);
  return value as T;
}
