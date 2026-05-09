# Tutorial: Getting Started with ohud

> **Diátaxis: Tutorial.** Aprenda fazendo. No final deste passeio você vai ter ohud rodando, customizado ao seu gosto, e vai entender o que está acontecendo a cada tick. ~15 minutos.

<p align="center">
  <img src="../_assets/tutorial-cover.png" alt="Getting Started with ohud" width="640"/>
</p>

## O que você vai aprender

Quando terminar este tutorial, você vai conseguir:

- Instalar ohud via `/plugin install`
- Ver a statusline rodando na sua sessão Claude Code
- Mudar quais linhas aparecem
- Personalizar cores
- Diagnosticar quando algo dá errado
- Saber para onde ir depois (referência, how-tos, explicação)

Não é uma referência exaustiva — é uma *sequência guiada*. Se você quer pesquisar um campo específico, vá direto a [reference/](../reference/).

## Pré-requisitos

| Item | Como verificar | Mínimo |
|---|---|---|
| Claude Code instalado | `claude --version` | qualquer recente |
| Node ou Bun | `node -v` ou `bun -v` | Node ≥18 ou qualquer Bun |
| Conta com plugin marketplace | tente `/plugin marketplace list` | precisa funcionar |

Se faltar Node ou Bun, instale antes de seguir:

```bash
# macOS
brew install node       # ou: brew install bun
# Linux
curl -fsSL https://nodejs.org/install.sh | sh
# Universal
curl -fsSL https://bun.sh/install | bash
```

## Passo 1 — Instalar ohud

Dentro de uma sessão Claude Code:

```
/plugin marketplace add nicolaslima/ohud
/plugin install ohud
```

Saída esperada (verbatim):

```
Plugin "ohud" installed successfully.
Reload Claude Code to activate.
```

`★ O que aconteceu:` Claude Code clonou o repo em `~/.claude/plugins/cache/...`, leu `.claude-plugin/plugin.json`, e registrou os 4 slash commands (`/ohud doctor`, etc). **Mas a statusline ainda não está ativa** — Claude Code não lê `statusLine` de `plugin.json` em v0.1.x. Próximo passo resolve isso. Ver [explanation/design-decisions.md](../explanation/design-decisions.md#claude_plugin_root-in-pluginjson--aspirational-not-active) para o porquê.

## Passo 2 — Ativar a statusline com `/ohud setup`

```
/ohud setup
```

Esse comando:
1. Detecta seu runtime (Node ou Bun) — testa `bun --version` primeiro, fallback `node --version`.
2. Resolve o caminho absoluto do bundle do plugin.
3. Escreve um bloco `statusLine` em `~/.claude/settings.json` apontando para o bundle.
4. Verifica spawn enviando um stdin sintético.
5. Persiste `state.json` para `/ohud configure` ler depois.

Saída esperada:
```
Detected runtime: bun (or node)
Plugin path: /Users/me/.claude/plugins/cache/ohud/ohud/0.1.0/dist/index.js
Wrote statusLine to ~/.claude/settings.json
Verification: OK (rendered 2 lines)
Restart Claude Code.
```

`★ Por que esse passo é separado:` `/plugin install` registra commands mas **não** ativa statusLine. v0.1.x precisa de uma escrita explícita em `settings.json`. Setup é idempotente — pode rodar múltiplas vezes sem efeito colateral.

Reinicie a sessão (`/exit` e reabra, ou Ctrl+D).

## Passo 3 — Ver a primeira render

Volte para Claude Code, mande qualquer prompt:

```
oi
```

Logo abaixo da resposta, uma statusline aparece. Algo como:

```
[claude-sonnet-4-6] meu-projeto │ git:(main) │ effort:max
Context ████░░░░░░ 12%
```

Se você vê isso → **funcionou**. Pule para o Passo 3.

Se você vê só `ohud` (uma palavra solta) ou nada → ver [diagnose-blank-statusline.md](../how-to/diagnose-blank-statusline.md) e volte aqui.

## Passo 4 — Inspecionar com `/ohud doctor`

Doctor é seu amigo:

```
/ohud doctor
```

Saída anotada:

```
ohud version: 0.1.0           ← qual versão você tem
runtime: v22.22.2 (process.argv0=node)   ← Node ou Bun + versão
resolved bundle: /Users/me/.claude/plugins/cache/.../ohud/dist/index.js (exists: yes)
                                ↑ onde o bundle vive — confirme exists: yes

probe: live (cache bypassed) — daemonOk: no
                                ↑ daemon Ollama? "yes" se você tem Ollama rodando

mode: anthropic                 ← seu modo atual

active config flags (consumed?):
  display.lineLayout: "expanded" (consumed)
  display.showModel: true (consumed)
  display.showCost: false (consumed)
  ...
```

`★ O que olhar:` `mode:` confirma o que ohud detectou. Se você está usando Ollama mas vê `mode: anthropic`, ver [enable-ollama-cloud-mode.md](../how-to/enable-ollama-cloud-mode.md).

## Passo 5 — Customizar via `/ohud configure`

Por padrão ohud mostra uma versão minimalista (model + path + git + context). Para ver mais linhas, use o wizard:

```
/ohud configure
```

Você verá:

```
Choose a preset:
1. Full      — everything on (cost, tools, agents, todos, memory, ...)
2. Essential — sane middle ground (tools + todos + effort, no cost)
3. Minimal   — model + context + api-time + usage only
4. Custom    — keep current and ask per-flag
```

Vamos com **Essential** para começar:

```
> 2
```

ohud vai:

1. Editar `~/.claude/plugins/ohud/config.json`
2. Mostrar um **preview** rodando o bundle contra sua sessão mais recente
3. Pedir confirmação

Você verá a statusline preview com as flags do preset. Se gostou:

```
Save? [y/n] y
```

Reinicie Claude Code. Próxima statusline já reflete.

`★ Bastidores:` `/ohud configure` lê `~/.claude/plugins/ohud/state.json` (escrito por `/ohud setup` se você rodou) para saber qual runtime + bundle path usar no preview. Se `state.json` não existe, cai em `$CLAUDE_PLUGIN_ROOT`. Ver [reference/slash-commands.md](../reference/slash-commands.md#ohud-configure).

## Passo 6 — Ver as novas linhas

Mande outro prompt e veja:

```
[claude-sonnet-4-6] meu-projeto │ git:(main) │ effort:max
Context ████░░░░░░ 12%
◐ Read: tutorial.md │ ✓ Bash ×2
▸ in-progress (3/9)
```

3 linhas extras: tools (mostrando o que está rodando), todos (atual + progresso). Compare com o que você tinha no Passo 2.

## Passo 7 — Personalizar cores

Edite `~/.claude/plugins/ohud/config.json`. Achar `colors`:

```json
"colors": {
  "context": "green",
  "apiTime": "brightBlue",
  ...
}
```

Mude `context` para uma cor que você gosta:

```json
"colors": {
  "context": "#FF6B00",   ← laranja
  ...
}
```

Salve. Mande outro prompt. A barra de Context agora é laranja.

Para uma paleta inteira pré-fabricada, ver [customize-colors-and-glyphs.md](../how-to/customize-colors-and-glyphs.md) — tem receitas Solarized, Catppuccin e tema acessível.

## Passo 8 — Entender o que cada linha consome

Curioso de onde vem cada número?

| Linha | Vem de |
|---|---|
| `[modelo]` | `stdin.model.id` ou `display_name` que Claude Code pipa |
| `meu-projeto` | `stdin.workspace.current_dir` slice por `pathLevels` |
| `git:(main)` | comando `git status -b` cacheado |
| `Context ███` | `stdin.context_window.used_percentage` |
| `◐ Read` | parsed do transcript JSONL — tools em `running` state |
| `▸ todo` | parsed do transcript — TodoWrite blocks |

Cada linha tem seu próprio módulo em `src/render/widgets/`. Catálogo completo: [reference/widgets.md](../reference/widgets.md).

## Passo 9 — Quebrar e consertar

Vamos provocar um failure de propósito para ver como ohud reage.

Edite o config para apontar Ollama para uma porta inexistente:

```json
{
  "ollama": {
    "host": "http://localhost:99999",
    "probeTimeoutMs": 100
  }
}
```

Reinicie e mande um prompt. ohud vai tentar probar 99999, falhar em 100ms, marcar daemon `false`, cair em modo Anthropic. Statusline ainda renderiza — sem badge `⚡`.

Rode `/ohud doctor`:

```
probe: live (cache bypassed) — daemonOk: no
```

Tudo certo. Volte o config para `localhost:11434` (ou o que era antes) e siga em frente.

`★ Por que isso importa:` ohud é fail-soft por design. A blank statusline seria a pior UX (indistinguível de "ohud quebrou"). Em vez disso, ohud sempre emite *alguma* linha — mesmo que mínima. Ver [explanation/architecture.md](../explanation/architecture.md#failure-modes-and-observability).

## Passo 10 — Medir o overhead

Rode com profiling:

```bash
OHUD_PROFILE=1 node "$CLAUDE_PLUGIN_ROOT/dist/index.js" < /tmp/sample-stdin.json
# Saída no stderr:
# ohud-profile: total=78.2ms
```

ohud roda em ~76ms median (75% do budget de 300ms livre). Se você ver > 200ms consistentemente, algo está com problema — provavelmente probe Ollama timing out. Ajuste `ollama.probeTimeoutMs` para baixo.

Para o método de medição completo, ver [explanation/300ms-budget.md](../explanation/300ms-budget.md).

## Passo 11 — Você está pronto

Você sabe agora:

- ✅ Como instalar ohud
- ✅ Como configurar via wizard
- ✅ Como customizar cores e flags
- ✅ Como diagnosticar com `/ohud doctor`
- ✅ De onde vem cada linha
- ✅ Como ohud falha (e por que isso é bom)

## Próximos passos

| Quero... | Vá para |
|---|---|
| Referência completa de configuração | [reference/config-schema.md](../reference/config-schema.md) |
| Referência completa de slash commands | [reference/slash-commands.md](../reference/slash-commands.md) |
| Saber o que cada linha mostra | [reference/widgets.md](../reference/widgets.md) |
| Diagnosticar problemas | [how-to/diagnose-blank-statusline.md](../how-to/diagnose-blank-statusline.md) |
| Habilitar Ollama mode | [how-to/enable-ollama-cloud-mode.md](../how-to/enable-ollama-cloud-mode.md) |
| Trabalhar em CI / terminais restritos | [how-to/work-in-restricted-terminals.md](../how-to/work-in-restricted-terminals.md) |
| Adicionar uma 13ª linha | [how-to/add-a-new-line-module.md](../how-to/add-a-new-line-module.md) |
| Entender o "porquê" das decisões | [explanation/design-decisions.md](../explanation/design-decisions.md) |
| Entender a arquitetura | [explanation/architecture.md](../explanation/architecture.md) |

Bem-vindo ao ohud. Bom statusline-ing.
