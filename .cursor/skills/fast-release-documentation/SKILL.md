---
name: fast-release-documentation
description: Crea la documentación de un release AVCD (humo básico + Test Plan asociado y Terminado) a partir de versión y canal. Use when the user says fast-release-documentation, documentación de release, documentar release, o pide humo básico y Test Plan juntos para Banca Mobile o Portal Bancario.
when_to_use: El usuario dice fast-release-documentation, documentación de release, documentar release, o pide humo básico y Test Plan juntos para Banca Mobile o Portal Bancario.
---

# Fast release documentation

Orquesta los JS existentes. **No los edites** y **no** reimplementes Jira/Xray.

- TE: `prod-release/create-basic-smoke-test-execution.js`
- Plan: `prod-release/create-test-plan.js`

## 1. Pedir datos si faltan

Antes de crear nada, necesitas **versión** (`x.x.x`, ej. `4.11.1`) y **canal**. Si el usuario no dio uno o ambos, usa `AskQuestion` para pedirlos. No arranques el humo ni el plan sin ambos.

**Canal** — si falta, pregunta con `AskQuestion`:
- Opciones: `Banca Mobile (BM)` y `Portal Bancario (PB)`.
- No uses texto plano con "1 o 2".

**Versión** — si falta, pregunta con `AskQuestion` (el usuario escribe en "Other" o en su respuesta).

Aliases que el helper entiende para canal:

| Input | Canal | Valor al JS |
| --- | --- | --- |
| `1`, `bm`, `mb`, `mobile`, `banca mobile` | Banca Mobile | `1` → `AVCD-4345` |
| `2`, `pb`, `pv`, `portal`, `portal bancario` | Portal Bancario | `2` → `AVCD-4346` |

No inventes el canal.

## 2. Ejecutar

Desde la raíz del repo, con **ambos** datos:

```bash
node .cursor/skills/fast-release-documentation/scripts/run.js 4.11.1 BM
```

El helper:

1. Lanza el humo con la versión en argv y el canal (`1` o `2`) por stdin. Summary, descripción, asignado y Test Set quedan como en el JS.
2. Parsea `✅ Creado AVCD-####`. Si falla el humo, **no** crea el plan.
3. Lanza el Test Plan con flags, sin prompts: `node prod-release/create-test-plan.js 4.11.1 --te #### --terminado`. Campos del plan: los del JS.

Usa `node …js`, no `npm run` (npm se come el stdin del humo).

## 3. Reportar

Devuelve keys y URLs (`https://avaldigitallabs.atlassian.net/browse/AVCD-…`) del TE y del Test Plan. Menciona canal y versión resuelta.

## Qué no hacer

- No pidas al usuario el “sí” de asociar TE ni el de Terminado: usa `--te` y `--terminado`.
- No hardcodees keys de tests. No toques los JS de humo/regresión.
- No crees humo completo ni regresión en este flujo.
