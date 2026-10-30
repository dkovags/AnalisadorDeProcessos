import type { Calendar } from "./calendar";
import { formatDate } from "./dates";
import type { Channel, PersonKind, Rite } from "./types";

// Conferência da citação (o ato processual): o meio usado é adequado para o tipo de réu e o rito?

export interface SummonsNote {
  level: "ok" | "info" | "alerta" | "erro";
  text: string;
}

export interface SummonsInput {
  kind?: PersonKind;
  channel: Channel;
  sentAt?: string;
  readAt?: string;
  today: string;
  rite: Rite;
  cal: Calendar;
}

function businessAfter(cal: Calendar, iso: string, n: number): string {
  let d = iso;
  for (let i = 0; i < n; i++) d = cal.nextBusiness(d);
  return d;
}

export function checkSummons(i: SummonsInput): SummonsNote[] {
  const out: SummonsNote[] = [];
  const electronic = i.channel === "domicilio" || i.channel === "email" || i.channel === "sistema";
  if (i.rite === "penal") {
    out.push({
      level: i.channel === "oficial" || i.channel === "edital" ? "info" : "alerta",
      text: "No processo penal, a citação é pessoal, por mandado (CPP, art. 351); por edital, só se o réu não for encontrado (CPP, art. 361), e com hora certa se ele se ocultar (CPP, art. 362).",
    });
    return out;
  }
  if (i.rite === "trabalho")
    out.push({ level: "info", text: "Na Justiça do Trabalho, a notificação inicial vai pelo correio e presume-se recebida 48 horas depois da postagem (CLT, art. 841, § 1º, e Súmula 16 do TST)." });
  if (i.rite === "juizado" && i.channel === "edital") out.push({ level: "erro", text: "Nos Juizados Especiais não se faz citação por edital (Lei 9.099/1995, art. 18, § 2º)." });

  if ((i.kind === "pj" || i.kind === "publico") && !electronic)
    out.push({
      level: "alerta",
      text: "Empresas e entes públicos devem ser citados preferencialmente por meio eletrônico, no Domicílio Judicial Eletrônico (CPC, art. 246, caput e §§ 1º e 2º). Outros meios valem quando não há confirmação em 3 dias úteis (§ 1º-A).",
    });
  if (i.kind === "me" && !electronic)
    out.push({ level: "info", text: "Micro e pequenas empresas só são obrigadas ao cadastro eletrônico se não tiverem endereço eletrônico na Redesim (CPC, art. 246, § 5º)." });
  if (i.kind === "publico") out.push({ level: "info", text: "Fazenda Pública: prazo em dobro para todas as manifestações (CPC, art. 183)." });

  if (i.channel === "domicilio" || i.channel === "email") {
    if (i.readAt) out.push({ level: "ok", text: `Recebimento confirmado em ${formatDate(i.readAt)}: o prazo começa no 5º dia útil seguinte (CPC, art. 231, IX).` });
    else if (i.sentAt) {
      const limit = businessAfter(i.cal, i.sentAt, 3);
      if (i.today > limit)
        out.push({
          level: "erro",
          text: `Sem confirmação em 3 dias úteis (até ${formatDate(limit)}): a citação eletrônica não se completou e deve ser feita pelo correio, por oficial de justiça, pelo escrivão ou por edital (CPC, art. 246, § 1º-A). Quem não confirmou deve justificar na primeira oportunidade (§ 1º-B).`,
        });
      else out.push({ level: "info", text: `Aguardando a confirmação do recebimento, que deve ocorrer até ${formatDate(limit)} (3 dias úteis: CPC, art. 246, § 1º-A).` });
    }
  }
  if (i.channel === "correio") {
    if (i.kind === "pj" || i.kind === "me" || i.kind === "publico")
      out.push({
        level: "info",
        text: "Pessoa jurídica: vale a entrega a quem tem poderes de gerência ou de administração, ou ao funcionário responsável pelo recebimento de correspondências (CPC, art. 248, § 2º).",
      });
    else
      out.push({
        level: "alerta",
        text: "Pessoa física: a carta deve ser entregue ao próprio citando, que assina o recibo (CPC, art. 248, § 1º). Confira quem assinou o aviso de recebimento; em condomínio com controle de acesso, vale a entrega ao porteiro (§ 4º).",
      });
  }
  if (i.channel === "oficial") out.push({ level: "info", text: "Se houver suspeita de ocultação, cabe a citação com hora certa (CPC, arts. 252 a 254)." });
  if (i.channel === "edital")
    out.push({
      level: "alerta",
      text: "Edital só quando desconhecido ou incerto o citando, ou ignorado, incerto ou inacessível o lugar; o réu só é considerado em lugar ignorado depois de frustradas as tentativas de localização, inclusive em cadastros de órgãos públicos e concessionárias (CPC, art. 256, § 3º). Revel citado por edital recebe curador especial (CPC, art. 72, II).",
    });
  if (i.rite === "civel")
    out.push({
      level: "info",
      text: "Contestação: 15 dias úteis, contados da audiência de conciliação, do protocolo do pedido de cancelamento dela ou, sem audiência, da data do art. 231 (CPC, art. 335).",
    });
  return out;
}
