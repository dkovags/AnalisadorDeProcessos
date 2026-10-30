# Analisador de Processos

Controle de processos judiciais para um escritório ou um advogado: a situação de cada processo, os expedientes
dirigidos a cada parte, os prazos e as petições que precisam ser protocoladas, com a lista de documentos para
instruí-las. Guarda o processo inteiro, os documentos e os expedientes numa base de conhecimento pesquisável e mantém
a jurisprudência usada nas petições, com as partes de cada julgado e a verificação das citações. Lê o processo
baixado do PJe, do eproc e do e-SAJ. Funciona no navegador do computador e do celular, pode ser instalado como
aplicativo e funciona sem internet.

**Endereço:** https://dkovags.github.io/AnalisadorDeProcessos/

## O que ele faz

- **Processos e situação**: número CNJ com conferência do dígito verificador e do tribunal, partes por polo (com o
  cliente marcado, o tipo de pessoa e o prazo em dobro da Fazenda Pública, do Ministério Público e da Defensoria),
  classe, órgão julgador, valor da causa, rito dos prazos (cível, juizado, trabalhista ou penal) e situação (em
  andamento, aguardando manifestação, concluso, sentenciado, em grau de recurso, transitado em julgado, cumprimento de
  sentença, suspenso, arquivado...). Cada mudança de situação fica nos andamentos, junto com as anotações, os
  documentos juntados, as petições protocoladas e, no eproc, as movimentações (eventos) lidas do processo.
- **Expedientes de cada parte**: intimações, citações, notificações e vistas, com os destinatários, o meio (DJEN, diário
  do tribunal, sistema, Domicílio Judicial Eletrônico, correio, oficial de justiça, *e-mail*, audiência, edital), as
  datas e o prazo. A aba de prazos do processo mostra, para cada parte, os expedientes em aberto, o último e o próximo
  vencimento, e cada expediente diz se é dirigido ao cliente ou à parte contrária.
- **Prazos com memória de cálculo**: dias úteis (CPC, art. 219; CLT, art. 775; juizados) ou corridos (CPP, art. 798),
  publicação no dia útil seguinte à disponibilização no DJEN (CPC, art. 224, §§ 2º e 3º), ciência ficta em 10 dias
  corridos na intimação pelo sistema (Lei 11.419/2006, art. 5º), juntada do aviso de recebimento ou do mandado (CPC,
  art. 231), 5º dia útil depois da confirmação na citação eletrônica (art. 231, IX), prazo contado da audiência (art.
  335, I), prazo em dobro, expediente reduzido no começo ou no fim do prazo, como na Quarta-feira de Cinzas (art. 224,
  § 1º), feriados nacionais (inclusive o de 20 de novembro, desde 2024), Carnaval e Sexta-feira da Paixão, os feriados
  da Justiça Federal e Corpus Christi quando marcados, o recesso e a suspensão de 20/12 a 20/01 (CPC, art. 220; CLT,
  art. 775-A; CPP, art. 798-A) e os feriados locais e suspensões que você cadastrar para cada tribunal. Cada prazo
  mostra o passo a passo do cálculo, que dá para copiar. Há também uma calculadora avulsa.
- **Petições a protocolar e documentos para instruí-las**: ao colar a intimação (ou a decisão, o despacho, o ato
  ordinatório), o Analisador de Processos lê o ato a praticar (réplica, contestação, emenda, contrarrazões, manifestação sobre laudo,
  especificação de provas, recolhimento de custas, pagamento no cumprimento de sentença, recurso cabível contra a
  sentença ou o acórdão conforme o rito...), o prazo escrito ou o legal, a quem a ordem se dirige, a audiência marcada e
  os documentos pedidos ("junte comprovante de residência e cópia do contrato"). Com isso, cria a providência com o
  prazo fatal, o prazo interno (alguns dias úteis antes, configurável) e a lista de documentos para instruir a petição;
  quando um documento da lista já está nos autos (a procuração, por exemplo), ele aparece para marcar. Ao importar o
  processo, o resumo avisa o que pede a última decisão ainda sem expediente.
- **Conferência da citação**: nos expedientes de citação, lembra as regras do meio escolhido para o tipo de réu
  (Domicílio Judicial Eletrônico para empresas e entes públicos, confirmação em 3 dias úteis, carta entregue ao próprio
  citando, edital só depois de esgotadas as tentativas, sem edital nos juizados, regras do processo penal e do
  trabalhista) e o início do prazo da contestação.
- **Base de conhecimento**: o PDF do processo inteiro vira um processo cadastrado, com a capa lida (número, classe,
  órgão julgador, distribuição ou autuação, valor, assuntos, sigilo, justiça gratuita), as partes com os advogados ou
  procuradores e cada documento separado, com nome, tipo, data e quem assinou:
  - no **PJe**, pelo carimbo "Num. Id - Pág." de cada página, com o índice de documentos da capa;
  - no **eproc**, pelo carimbo de cada página, com o evento e o código do documento (INIC1, PROC2, DESPADEC1, e também
    códigos como "PED LIMINAR_ANT TUTE1"), ou, sem ele, pelos marcadores (índice) do PDF. O nome de cada documento vem
    dos marcadores ("Evento 1 - Doc. 2 - PROCURAÇÃO"); as datas e as descrições dos eventos, das páginas de separação
    (ou da tabela de eventos da capa), e as páginas de separação ficam fora dos documentos. Do quadro "Partes e
    Representantes", o Analisador de Processos tira o polo de cada parte pela coluna em que ela aparece, os procuradores
    (com a OAB ou o código da procuradoria) e o tipo de pessoa: o ente público já entra com o prazo em dobro. Cada
    documento fica com a referência "Evento 15, CONTES1", do jeito que se cita nos autos, e as movimentações entram
    nos andamentos;
  - no **e-SAJ**, pelo código da pasta digital;
  - em outros sistemas, pelos marcadores do PDF, quando houver.

  Quando um processo integral mais novo é importado, os documentos já guardados passam para o arquivo novo, sem
  duplicar. Também aceita documentos avulsos (PDF, Word, ODT, HTML e texto, inclusive colado) e o expediente. A
  pesquisa ignora acentos e maiúsculas, procura as palavras pelo começo, aceita "frase exata" e -exclusão, ordena por
  relevância e abre o documento na página, com os termos destacados e o botão para abrir o PDF original naquela página.
- **Jurisprudência com as partes identificadas**: ao colar o cabeçalho e a ementa de um acórdão (ou o resultado da
  pesquisa do STJ, do STF ou de repositórios), o Analisador de Processos lê o tribunal, a classe, o número, o relator ou a relatora, o
  órgão julgador, as datas, a ementa, o tema e as partes com os seus papéis (recorrente, agravado, impetrante,
  apelante...) e advogados. A base mostra os processos seus que têm parte em comum com cada decisão, separa os
  precedentes qualificados (CPC, art. 927) e marca as decisões já conferidas na fonte oficial. O inteiro teor pode ser
  guardado e entra na pesquisa.
- **Citação no formato adequado**: cada decisão tem a referência nos formatos forense
  ("STJ, REsp 1.234.567/SP, Rel. Min. ..., Terceira Turma, j. 12/03/2024, DJe 15/03/2024"), do STJ e da ABNT (NBR
  6023, com as partes). O botão "Copiar com a ementa" traz a referência e, na linha de baixo, a ementa como citação
  direta; colada no Word, ela vem com recuo de 4 cm e letra menor (NBR 10520).
- **Verificação das citações**: num texto colado, num arquivo ou num documento da base, encontra as citações de
  acórdãos dos tribunais superiores, de números CNJ de segundo grau, de súmulas e de temas, e aponta: classe que não é
  daquele tribunal (REsp no STF, por exemplo), turma ou seção que não existe, relator com o título errado, publicação
  anterior ao julgamento ou em fim de semana, datas no futuro, súmula do STF acima da 736, número CNJ com dígito
  verificador errado ou de outro tribunal, citação incompleta (CPC, art. 1.029, § 1º), divergência com a decisão
  cadastrada (relator, órgão, datas, entendimento superado) e diferenças entre o trecho entre aspas e a ementa, com as
  palavras acrescentadas e suprimidas destacadas (as supressões marcadas com [...] são aceitas). Para cada citação,
  mostra a referência adequada da base ou os *links* para conferir no *site* do tribunal.
- **Avisos e agenda**: o painel mostra os prazos vencidos, os de hoje e os próximos, as audiências e quantas petições
  ainda não têm todos os documentos; o navegador avisa dos prazos do dia quando o Analisador de Processos é aberto; o ícone do aplicativo
  instalado mostra quantos prazos venceram ou vencem hoje; e os prazos e audiências podem ser exportados para o Google
  Agenda, o Outlook ou o calendário do celular (arquivo .ics, com lembrete).
- **Planilha e cópia de segurança**: a lista de processos sai em planilha (.csv) para o Excel, e a cópia de segurança
  é um .zip com os dados, os arquivos originais e o texto já lido, que restaura tudo em outro aparelho.

## Onde ficam os dados

Tudo fica guardado só no navegador do aparelho (IndexedDB): processos, documentos e jurisprudência não vão para a
internet, e a leitura dos PDFs e as análises são feitas no próprio navegador. Por isso:

- faça a cópia de segurança com frequência (**Configurações > Fazer cópia de segurança**) e guarde o .zip num lugar
  seguro: se os dados do navegador forem apagados, só a cópia recupera os processos e os arquivos;
- para usar em outro aparelho, restaure a cópia lá (não há sincronização automática);
- instalar o aplicativo e tocar em **Pedir ao navegador para não apagar os dados** ajuda a preservar a base.

## Como usar

- **Para conhecer**: na primeira tela, **Ver um exemplo** carrega dois processos fictícios, com prazos, documentos e
  súmulas reais do STJ, que podem ser apagados depois.
- **No dia a dia**: baixe o processo inteiro no sistema do tribunal (no PJe, o *download* dos autos; no eproc, o
  processo completo em PDF) e importe em **Processos > Importar PDF do processo**; confira a capa, as partes e os
  documentos encontrados e escolha quem é o seu cliente. A cada intimação, abra o processo, toque em **Colar
  intimação** e confira o que o Analisador de Processos preencheu; acompanhe o painel e a agenda de prazos e marque cada providência como
  protocolada.

## Como publicar (GitHub Pages)

1. No GitHub, abra **Settings > Pages** e, em **Source**, escolha **GitHub Actions**.
2. Rode de novo o *workflow* **Testes e publicação** (aba **Actions**) ou faça um novo *push* na *branch* padrão.
3. O endereço do app aparece no resultado do passo **Publicar** (algo como `https://<usuário>.github.io/AnalisadorDeProcessos/`).

Enquanto o Pages não estiver ativado, o *workflow* só roda os testes e o *build*, sem marcar erro. Os dados ficam no
navegador e valem para o domínio do endereço (`<usuário>.github.io`): num domínio diferente, a base começa vazia, e a
cópia de segurança leva os dados para lá.

## Como rodar no computador

Requer Node.js 22.

```bash
npm install
npm run dev              # abre em http://localhost:5173
npm test                 # testes da lógica (prazos, leitura dos autos, jurisprudência, armazenamento)
npm run build            # gera a versão publicada em dist/
npm run test:e2e         # teste completo no navegador (gera capturas em screenshots/)
```

O teste de ponta a ponta monta PDFs nos formatos do PJe e do eproc (dois modelos de capa, um deles o do TJRJ) e um com
marcadores, importa cada um pela tela e passa por todas as funções. Para usar um Chromium já instalado nele e na geração dos ícones
(`node scripts/make-icons.mjs public "#24406b"`), informe o caminho em `CHROMIUM_PATH`.

Para trocar o nome do aplicativo, edite `src/config.ts`, `index.html` e `public/manifest.webmanifest`.

## Limites e cuidados

- Os cálculos e as análises são auxiliares e podem errar: confira sempre os prazos no sistema do tribunal. Na dúvida, o
  calendário fica do lado seguro (feriados forenses incertos, como Corpus Christi, vêm desmarcados e o prazo calculado
  fica mais curto, nunca mais longo); cadastre os feriados e as suspensões do seu tribunal em **Configurações**.
- A leitura de expedientes, processos e acórdãos é feita por regras, sem inteligência artificial: o resultado é uma
  sugestão que você confirma antes de salvar.
- A leitura do eproc foi ajustada com um processo real do TJRJ e testada com arquivos montados no formato de outros
  tribunais. A capa pode variar entre os tribunais que usam o eproc; se algo não for reconhecido, o processo inteiro
  fica guardado como um documento só, pesquisável do mesmo jeito, e as partes podem ser completadas à mão. Quando o
  eproc divide o *download* em partes ("Parte 1", "Parte 2"...), importe cada parte no mesmo processo.
- Páginas digitalizadas sem texto (imagem) ficam guardadas, mas não entram na pesquisa: o Analisador de Processos avisa quando isso
  acontece. Prefira baixar o processo com texto (OCR) no sistema do tribunal.
- A verificação de citações não consulta os tribunais: "fora da base" quer dizer que a decisão ainda não foi
  cadastrada, não que ela não exista. Os *links* levam à pesquisa no *site* do tribunal; depois de conferir, cadastre a
  decisão e marque **Conferi os dados na fonte oficial**.
- As intimações do DJEN e as movimentações do DataJud ainda não são buscadas automaticamente: copie o teor da
  comunicação e cole no Analisador de Processos. A busca automática fica para uma próxima etapa, que depende de confirmar o acesso às
  APIs públicas do CNJ a partir do navegador (ou de um pequeno servidor intermediário).

## Organização do código

```
index.html                 a página
src/domain/cnj.ts          número único do CNJ: dígito verificador e tribunal
src/domain/calendar.ts     calendário forense: feriados, Páscoa, recesso e feriados locais
src/domain/deadlines.ts    cálculo dos prazos com a memória de cálculo
src/domain/analysis.ts     leitura de expedientes e decisões: ato, prazo, documentos, audiência
src/domain/casefile.ts     leitura do PDF do processo integral (PJe, eproc, e-SAJ e marcadores do PDF)
src/domain/summons.ts      conferência da citação (o ato)
src/domain/precedents.ts   leitura de acórdãos e das partes, formatos de citação
src/domain/refs.ts         citações de jurisprudência encontradas num texto
src/domain/citations.ts    verificação das citações e do trecho citado
src/domain/search.ts       pesquisa sem acentos, com pontuação e destaques
src/store/                 ações, IndexedDB, leitura de arquivos (pdf.js, Word), cópia de segurança, exemplo
src/ui/                    telas (React)
public/                    ícones, manifesto e service worker (funciona sem internet)
tests/                     testes da lógica (Vitest)
scripts/e2e.mjs            teste de ponta a ponta no navegador (Playwright)
scripts/make-icons.mjs     geração dos ícones a partir de public/icon.svg
```
