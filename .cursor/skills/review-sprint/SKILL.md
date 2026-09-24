---
name: review-sprint
description: Revisa un sprint AVCD del backlog (presentación y demo) y, si vienen versiones x.x.x, las publicaciones. Use when the user says review-sprint, revisar sprint, o review-sprint seguido de un número de sprint.
when_to_use: El usuario dice review-sprint, revisar sprint, o `review-sprint 10` (el número es el sprint). Opcional: versiones `x.x.x` e imagen de Historias de Usuario para actualizar el tablero compartido.
---

# Review sprint

Lee el backlog del sprint en Jira y arma el reporte de `.cursor/rules/review-sprint-report.mdc`. **No crees ni transiciones issues.** No uses `jira-config.js` ni scripts Node. Jira vía MCP `user-atlassian`, cloud `avaldigitallabs.atlassian.net`, proyecto `AVCD`.

Tablero compartido con **priority-tasks-organizer**: `.cursor/data/hu-actuales.json` (plantilla: `hu-actuales.example.json`).

## Entrada

En el mismo mensaje:

- Sprint: el entero suelto (`review-sprint 10` → `AVCD Sprint 10`). No lo confundas con una versión `x.x.x`. Si falta, pídelo en texto y no arranques.
- Versiones: cada `x.x.x` es una publicación, en el orden escrito. Si no hay ninguna, no hagas Publicaciones.
- Imagen o keys: opcionales. Si vienen, **actualiza** `.cursor/data/hu-actuales.json` (misma regla que priority-tasks-organizer: extrae IDs de Historias de Usuario o normaliza keys; sobrescribe el JSON con `updatedAt`, `source` `image` o `keys`, y `keys` ordenadas). No pidas imagen solo para review si el archivo ya tiene keys.

## Tablero para «En la hoja»

Tras resolver entrada, carga el conjunto de IDs del tablero:

- Si el mensaje trajo imagen o keys, usa las keys recién guardadas.
- Si no, lee `.cursor/data/hu-actuales.json` si existe.

Demo lleva la columna **En la hoja** si ese conjunto no está vacío (archivo o actualización en el mismo mensaje). Si no hay archivo usable ni imagen/keys en el mensaje, Demo sin tercera columna.

Comparación: el ID es el número al inicio de la celda de Historias de Usuario en la hoja (`4815` → coincide con `AVCD-4815`). Para cada Historia del sprint, el número de su key debe estar en `keys` del tablero (`335` no coincide con `1335`). 🟢 si coincide, 🔴 si no.

## 1. Presentación

Una `searchJiraIssuesUsingJql`, pagina con `nextPageToken` (`maxResults` 100):

```
project = AVCD AND sprint = "AVCD Sprint {n}" ORDER BY rank ASC
```

Campos: `summary`, `issuetype`, `customfield_10010`.

Si no vuelve ningún issue, no armes el reporte: di que el sprint no existe.

En `customfield_10010` toma el objeto cuyo `name` es exactamente `AVCD Sprint {n}`:

- Título = `name`.
- Fechas = `startDate` y `endDate` en `America/Bogota`, sin año: `16 sep – 30 sep`. Meses: ene, feb, mar, abr, may, jun, jul, ago, sep, oct, nov, dic. Guion `–`.
- Objetivo = `goal` tal cual (incluye `Obj.:` si Jira lo trae).

Listas, orden `rank`, `summary` recortado, una línea, sin key:

- Tareas: todo menos subtareas (`subtask: true` o `issuetype not in subTaskIssueTypes()`), Test Plan, Test Execution y Retrospectiva.
- Omitidas: solo esos tres tipos, con el tipo entre paréntesis: `Test Plan - AVCD Sprint 10 (Test Plan)`.

## 2. Demo

Otra búsqueda, mismos campos más `issuelinks`:

```
project = AVCD AND sprint = "AVCD Sprint {n}" AND issuetype = Story ORDER BY rank ASC
```

`Story` en JQL es el tipo **Historia**. No incluyas Tech Story, Error, Tarea ni el resto.

Test Execution: enlace cuyo `type.name` es `Test` y el issue ligado (`inwardIssue` o `outwardIssue`) tiene `issuetype.name` `Test Execution`. Ignora los de tipo Test. Si hay varias, todas en la celda. Si no hay, `—`.

Columna **En la hoja**: ver sección Tablero arriba.

## 3. Publicaciones

Por cada `x.x.x`, en orden. Prueba primero `fixVersion = "Release 4.12.0"` y, si no hay issues, `fixVersion = "Releases 4.12.0"`. Campos: `summary`, `issuetype`, `fixVersions`. Orden `rank`. Pagina.

Si las dos consultas vuelven vacías, no armes los bloques de esa versión: indica que no existe.

Fecha: `releaseDate` (`AAAA-MM-DD`) de la versión que coincidió, en `DD/MM/AAAA` (`2026-09-08` → `08/09/2026`). Sin hora ni cambio de zona. Si no hay fecha, el bloque queda vacío y la lista sí se entrega.

Actividades: títulos recortados, sin key. Fuera Test Plan y Test Execution. Una issue con las dos versiones sale en los dos bloques.

## Reportar

Mensaje al usuario: **solo** el formato de `.cursor/rules/review-sprint-report.mdc`. Si Jira falla, no armes el reporte: muestra el error.
