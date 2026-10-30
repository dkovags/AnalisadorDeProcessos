import type { Collection, Dataset, ID, Prefs } from "../domain/types";

/** Registro de uma coleção (processo, expediente, providência...). */
export type EntityOf<C extends Collection> = Dataset[C][string];

/**
 * Alterações produzidas pelas ações: gravar ou apagar um registro, ou trocar as preferências.
 * A memória é atualizada na hora; o armazenamento grava só o que mudou.
 */
export type Op =
  | { [C in Collection]: { t: "put"; c: C; v: EntityOf<C> } }[Collection]
  | { t: "del"; c: Collection; id: ID }
  | { t: "prefs"; v: Prefs };

export function put<C extends Collection>(c: C, v: EntityOf<C>): Op {
  return { t: "put", c, v } as Op;
}

export function del(c: Collection, id: ID): Op {
  return { t: "del", c, id };
}

export function applyOps(ds: Dataset, ops: Op[]): Dataset {
  if (!ops.length) return ds;
  const out: Dataset = { ...ds };
  const touched = new Set<Collection>();
  const coll = (c: Collection) => {
    if (!touched.has(c)) {
      (out as unknown as Record<string, unknown>)[c] = { ...ds[c] };
      touched.add(c);
    }
    return out[c] as Record<ID, unknown>;
  };
  for (const op of ops) {
    if (op.t === "put") coll(op.c)[op.v.id] = op.v;
    else if (op.t === "del") delete coll(op.c)[op.id];
    else out.prefs = op.v;
  }
  return out;
}
