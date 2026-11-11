---
name: release-test-execution-passed
description: En una publicación AVCD (fixVersion), marca PASSED en Xray los runs TO DO y EXECUTING de las Test Execution vinculadas a Historia, Story, Tech Story y Error que estén en Terminado, RELEASE o EN PRODUCCIÓN. Use when the user says release-test-execution-passed, or asks to pass pending test runs of a release version to PASSED.
when_to_use: El usuario dice `release-test-execution-passed`, pasar a PASSED los runs de una publicación, o marcar TO DO/EXECUTING de las Test Execution de una versión `x.x.x`.
---

# release-test-execution-passed

Ejecuta `evidence-manager/release-test-execution-passed.js`. **No lo reimplementes** con MCP. No llames a `qa-cierre.js`.

Programación opcional: `hora: HH:mm` (regla `.cursor/rules/skill-schedule.mdc`). Parsea la versión **después** de quitar `hora: …`.

## 1. Pedir la versión si falta

Necesitas `x.x.x` (ej. `3.16.0`). Si el usuario no la dio, usa `AskQuestion` (puede escribirla en "Other"). No arranques sin ella.

## 2. Ejecutar

Desde la raíz del repo. El `node` a Jira/Xray **siempre** con `required_permissions: ["full_network"]` en la **primera** llamada Shell. El sandbox con red limitada da 403. No uses `all` salvo que falle la lectura de `jira-config.js`.

```bash
node evidence-manager/release-test-execution-passed.js 3.16.0
```

El JS:

1. Resuelve el fixVersion en el proyecto: nombre exacto, si no `Release x.x.x`, si no `Releases x.x.x`.
2. Lee Historia, Story, Tech Story y Error de esa versión.
3. Evalúa solo las que están en **Terminado**, **RELEASE** o **EN PRODUCCIÓN**. El resto sale en la tabla como `Otro estado` y no llama a Xray.
4. En cada una, toma todas las Test Execution con link tipo **Test**. Si no hay, `Sin Test Execution`.
5. En Xray, **TO DO** y **EXECUTING** → **PASSED**. Ya PASSED se saltan. **FAILED**, **ABORTED** y **BLOCKED** no se tocan. Si no hay pendientes, no escribe en esa Test Execution.
6. No mueve la historia. No crea QA: Cierre. No pasa la Test Execution ni los Tests a Terminado. No comenta. No reasigna.

Idempotente: un run que ya está PASSED no se vuelve a escribir.

## 3. Reportar

El JS imprime la tabla. Reprósela **tal cual** (markdown), desde el encabezado `release-test-execution-passed listo para …`. No inventes otro formato. Detalle en `.cursor/rules/release-test-execution-passed-report.mdc`.

## Qué no hacer

- No pidas confirmación extra si ya tienes la versión.
- No hardcodees keys de tests. No toques los JS de creación de TE ni `qa-cierre.js`.
- No transiciones issues de Jira.
