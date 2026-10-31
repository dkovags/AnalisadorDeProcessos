# Intermediário no Brasil (AWS Lambda)

O DJEN recusa consultas feitas de fora do Brasil, e o DataJud não deixa *sites* lerem as respostas. Esta função roda
em São Paulo, consulta as duas APIs pelo aplicativo e devolve as respostas. Ela só aceita consultas a esses dois
endereços do CNJ e só de quem manda a senha certa.

**Custo.** O uso do aplicativo (dezenas de consultas por dia) fica muito abaixo do que o Lambda oferece de graça todo
mês (um milhão de chamadas). Contas novas da AWS começam no plano gratuito, com créditos e cerca de seis meses; ao fim
dele, a AWS pede para passar ao plano pago para manter a conta. Com este uso, a cobrança deve continuar zero, e o
alerta de gasto (passo 6) avisa se algo mudar.

## Passo a passo

1. **Abra o Lambda em São Paulo:**
   https://sa-east-1.console.aws.amazon.com/lambda/home?region=sa-east-1#/create/function
   Outra forma: no seletor de região, no alto da página, à direita, escolha **América do Sul (São Paulo)**.
2. **Crie a função:** escolha **Criar do zero**, dê o nome `analisador-cnj`, escolha o tempo de execução
   **Node.js 22.x** e clique em **Criar função**.
3. **Cole o código:** na aba **Código**, abra o arquivo `index.mjs`, apague o conteúdo e cole o código de
   [`aws-lambda/index.mjs`](aws-lambda/index.mjs) (no GitHub, o botão de copiar fica no alto do arquivo). Clique em
   **Deploy** (Implantar).
4. **Ajuste a função,** na aba **Configuração**:
   - em **Configuração geral**, clique em **Editar**, ponha o **Tempo limite** em 20 segundos e salve;
   - em **Variáveis de ambiente**, clique em **Editar**, depois em **Adicionar variável de ambiente**: chave `CHAVE`,
     valor uma senha longa só sua (por exemplo, 30 letras e números misturados), e salve.
5. **Crie o endereço público:** em **URL da função**, clique em **Criar URL da função**, escolha o tipo de autenticação
   **NONE** e marque a opção de configurar o **CORS**:
   - origem permitida: `https://dkovags.github.io`
   - cabeçalhos permitidos: `x-chave, content-type`
   - métodos permitidos: `GET, POST`

   Salve e copie o endereço que aparece (termina em `.lambda-url.sa-east-1.on.aws/`). Mesmo aberto, sem a senha a
   função só responde "Senha ausente ou errada" e não consulta nada.
6. **Crie o alerta de gasto:** procure **Budgets** (Orçamentos) na busca do console, clique em **Criar orçamento**,
   escolha **Usar um modelo** e **Orçamento de gasto zero**, informe o seu *e-mail* e confirme.

Depois, ponha o endereço e a senha em **Configurações** do aplicativo.

## Como funciona

- `GET <endereço>/djen?numeroOab=...&ufOab=...` repassa a consulta às comunicações do DJEN.
- `POST <endereço>/datajud/api_publica_<tribunal>` repassa a consulta ao DataJud, com a chave pública do CNJ.
- Qualquer outro caminho, ou uma chamada sem a senha no cabeçalho `x-chave`, é recusado.
