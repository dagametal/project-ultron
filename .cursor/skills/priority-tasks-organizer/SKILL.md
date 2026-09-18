---
name: priority-tasks-organizer
description: Ordena las HUs/tareas/bugs de un sprint AVCD a partir de una imagen del tablero y decide la siguiente a trabajar. Use when the user says priority-tasks-organizer, siguiente tarea, priorizar sprint, organizar tareas, o pega una imagen del sprint.
when_to_use: El usuario dice priority-tasks-organizer, siguiente tarea, priorizar sprint, organizar tareas, o envía la imagen de Historias de Usuario del sprint.
---

# Priority tasks organizer

Lee la imagen del sprint, consulta Jira y ranquea. **No crees ni transiciones issues.** El reporte es el de `.cursor/rules/priority-tasks-organizer-report.mdc`.

## 1. Pedir la imagen si falta

Necesitas la captura con la columna **Historias de Usuario** (ID + título). Si no hay imagen ni keys, usa `AskQuestion` pidiéndola. No arranques sin IDs.

Si el usuario ya listó keys (`AVCD-4815` o `4815`) en el mensaje, úsalas y no pidas la imagen.

Extrae **todos** los IDs de la segunda columna (`4815` → `AVCD-4815`), aunque el asignado no sea el usuario. El ID es el número al inicio de esa celda, pegado al título. No uses la columna de índice a la izquierda, ni horas, ni fechas (`17/09/2026`).

## 2. Consultar Jira

MCP `user-atlassian`. Cloud: `avaldigitallabs.atlassian.net`. Una sola `searchJiraIssuesUsingJql`:

```
key in (AVCD-4815, AVCD-4891, …)
```

Campos: `summary`, `status`, `issuetype`, `priority`, `fixVersions`. `maxResults` 100; pagina si hace falta.

Si un ID no vuelve, va a **No encontradas**. Si Jira falla, no armes las tablas: muestra el error.

## 3. Rankear (no mostrar estos campos)

Orden lexicográfico. El primer criterio que desempate gana. Nombres en minúsculas y sin tildes.

**1. Estado**

- Alta (mismo nivel): `Listo para pruebas`, `En pruebas`
- Baja: `En Desarrollo`, `Bloqueado`, `Por Hacer` y cualquier otro no finalizado
- Nula (Fuera de cola): `validacion po`, `RELEASE`, `Terminado`, `En producción`

**2. Prioridad Jira:** Highest > High > Medium > Low > Lowest

**3. Tipo:** `Error` gana a Historia / Story / Tech Story / Task, aunque no tenga release

**4. Versiones corregidas:** gana si **alguna** versión tiene `\d+\.\d+\.\d+` (`Release 4.12.0`, `Releases 3.14.0`). Pierde si está vacío o es `Próximo paso AVCD`, `No requiere paso`, `Backlog releases`. Si mezcla numerada y placeholder, cuenta como numerada.

Empate total: orden de aparición en la imagen.

Emoji de Estado (solo visual; detalle en la rule de reporte):

| Emoji | Estados |
| --- | --- |
| 🟢 | Listo para pruebas, En pruebas |
| 🟡 | En Desarrollo, Por Hacer y resto activo |
| 🔴 | Bloqueado |
| ⚪ | validacion po, RELEASE, Terminado, En producción |

## 4. Reportar

Mensaje al usuario: **solo** el formato de `.cursor/rules/priority-tasks-organizer-report.mdc`. No expliques el ranking.

## Qué no hacer

- No pidas confirmación extra si ya tienes la imagen o las keys.
- No filtres por asignado de la hoja ni de Jira.
- No muestres prioridad, tipo, versión ni “por qué”.
- No crees ni transiciones issues.
- No uses `jira-config.js` ni scripts Node para esta skill.
