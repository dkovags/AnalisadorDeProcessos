/** Texto passado de uma tela para outra (ex.: "Verificar citações" a partir de um documento). */
let pendingText = "";

export function handOff(text: string) {
  pendingText = text;
}

export function takeHandOff(): string {
  const t = pendingText;
  pendingText = "";
  return t;
}
