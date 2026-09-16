---
name: qa-cierre
description: Cierra QA de una HU AVCD (Historia / Story / Tech Story): crea o reutiliza la subtarea QA: Cierre, pasa TE y Tests vinculados a Terminado, marca runs TO DO/EXECUTING como PASSED en Xray, comenta evidencias con smart link, termina la subtarea y deja la HU en validacion po. Use when the user says qa-cierre, QA: Cierre, cierre de HU, o cerrar certificación.
when_to_use: El usuario dice qa-cierre, QA: Cierre, cierre de HU, cerrar certificación, o pide crear QA: Cierre y pasar evidencias de una HU.
---

# QA: Cierre

Ejecuta `evidence-manager/qa-cierre.js`. **No lo reimplementes** con MCP ni edites los JS de humo/regresión.

## 1. Pedir la HU si falta

Necesitas la key (`AVCD-4549` o `4549`). Si el usuario no la dio, usa `AskQuestion` (puede escribirla en "Other"). No arranques sin ella.

Acepta Historia, Story y Tech Story. Si pasa un Test Execution o una subtarea, no inventes la HU: el JS falla y tú reportas el error.

## 2. Ejecutar

Desde la raíz del repo:

```bash
node evidence-manager/qa-cierre.js AVCD-4549
```

Si el usuario ya eligió una TE (`AVCD-4645` o `4645`):

```bash
node evidence-manager/qa-cierre.js AVCD-4549 --te 4645
```

El JS:

1. Crea la subtarea **QA: Cierre** si no existe (mismo resumen, sin mayúsculas). Si existe, la reutiliza. Asignada a `diegoan.garcia`.
2. Asigna las Test Executions vinculadas a `diegoan.garcia`.
3. Pasa a **Terminado** solo las TE y Tests **vinculados a esa HU** (link tipo Test) que no lo estén. Camino: Por Hacer → En pruebas → Terminado (o En Desarrollo si es subtarea). No toca Bloqueado. No toca Test Sets, Test Plans ni otras subtareas (p. ej. Evidencias QA de la TE).
4. En Xray, en la TE de evidencias: **TO DO** y **EXECUTING** → **PASSED**. Ya PASSED se saltan. **FAILED no se toca**.
5. Comenta en QA: Cierre ADF: texto `Evidencias: ` + `inlineCard` de la TE (smart link). No URL plana.
6. Pasa la subtarea QA: Cierre a **Terminado**.
7. Si no hubo FAILED, pasa la HU a **validacion po**. Si hubo FAILED, reporta y **no** mueve la HU.

Idempotente: no duplica subtarea, Terminado, PASSED ni el comentario.

Usa `node …js`, no `npm run`, si vas a pasar flags.

## 3. Varias Test Executions

Si el JS sale con código **2** y lista `TES:`, usa `AskQuestion` con esas keys. No escribas las opciones en el chat. Luego relanza con `--te`.

## 4. Reportar

El JS imprime la tabla. Reprósela **tal cual** (markdown). No inventes otro formato. Detalle en `.cursor/rules/qa-cierre-report.mdc`.

## Qué no hacer

- No pidas confirmación extra si ya tienes la HU (y la TE, si hay una sola).
- No hardcodees keys de tests. No toques los JS de creación de TE.
- No cambies el asignado de la HU. No transiciones la HU si hay FAILED en Xray.
