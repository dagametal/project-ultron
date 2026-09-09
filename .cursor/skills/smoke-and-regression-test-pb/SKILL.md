---
name: smoke-and-regression-test-pb
description: Crea el humo completo y la regresión manual de un release AVCD (Portal Bancario) y pregunta si asociarlos a un Test Plan existente. Use when the user says smoke-and-regression-test-pb, humo completo y regresión, smoke complete + regression, o pide ambas Test Executions para un release x.x.x.
when_to_use: El usuario dice smoke-and-regression-test-pb, humo completo y regresión, smoke complete + regression, o pide ambas Test Executions para un release x.x.x.
---

# Smoke and regression test (PB)

Orquesta los JS existentes. **No los edites.**

- Humo: `prod-release/create-complete-smoke-test-execution.js`
- Regresión: `prod-release/create-functional-test-execution.js`

## 1. Versión

Necesitas `x.x.x` (ej. `4.11.1`). Si no la dio el usuario, usa `AskQuestion` para pedirla (el usuario escribe en "Other" o en su respuesta). No arranques sin ella.

Si el release **no existe** en Jira (`Release` / `Releases`), **no crees nada**. El helper lo valida antes.

## 2. Ejecutar las TE

Desde la raíz del repo:

```bash
node .cursor/skills/smoke-and-regression-test-pb/scripts/run.js 4.11.1
```

Si el usuario ya dijo que vincule a un plan (`AVCD-4447` o `4447`):

```bash
node .cursor/skills/smoke-and-regression-test-pb/scripts/run.js 4.11.1 --plan 4447
```

El helper:

1. Comprueba que la versión exista. Si no, sale sin crear issues.
2. Lanza el humo completo (diccionario + `AVCD-2387` filtrado + set fijo `AVCD-4346`). Campos del JS. Queda **Por hacer**.
3. Si el humo falla, **no** crea la regresión.
4. Lanza la regresión (todo `AVCD-2387`). Campos del JS. La pasa a **En pruebas** sin preguntar.

## 3. Test Plan existente

Si no pasó `--plan`, usa `AskQuestion` después de crear las dos TE:

1. Pregunta: "¿Vincular ambas TE a un Test Plan existente?"
   Opciones: `Sí, vincular` / `No vincular`.
2. **No vincular** → no hagas nada más.
3. **Sí, vincular** → pregunta el número del Test Plan (`AVCD-XXXX` o `XXXX`). Valida que sea Test Plan y corre:

```bash
node .cursor/skills/smoke-and-regression-test-pb/scripts/run.js --vincular-plan 4447 AVCD-1111 AVCD-2222
```

No uses `create-test-plan.js` (ese crea un plan nuevo).

## 4. Reportar

Keys y URLs (`https://avaldigitallabs.atlassian.net/browse/AVCD-…`) del humo, la regresión y, si aplica, el plan. Menciona estados y versión resuelta.

## Qué no hacer

- No pidas confirmación para pasar la regresión a En pruebas.
- No hardcodees keys de tests. No toques los JS de creación.
- No crees humo básico ni un Test Plan nuevo en este flujo.
