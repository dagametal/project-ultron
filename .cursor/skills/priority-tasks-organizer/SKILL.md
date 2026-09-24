---
name: priority-tasks-organizer
description: Ordena las HUs/tareas/bugs del sprint AVCD (tablero guardado, imagen o keys) y decide la siguiente a trabajar. Use when the user says priority-tasks-organizer, siguiente tarea, priorizar sprint, organizar tareas, o pega una imagen para actualizar el tablero.
when_to_use: El usuario dice priority-tasks-organizer, siguiente tarea, priorizar sprint, organizar tareas, envía imagen de Historias de Usuario para actualizar el tablero, o keys AVCD en el mensaje.
---

# Priority tasks organizer

Consulta Jira con las keys del tablero y ranquea. **No crees ni transiciones issues.** El reporte es el de `.cursor/rules/priority-tasks-organizer-report.mdc`.

Tablero compartido con **review-sprint**: `.cursor/data/hu-actuales.json` (plantilla: `hu-actuales.example.json`). Solo `keys` en orden de la hoja; títulos y estados vienen de Jira en cada corrida.

## 1. Resolver keys del tablero

**Actualizar** `.cursor/data/hu-actuales.json` (sobrescribe entero, sin merge) cuando el mensaje trae:

- **Imagen** con la columna **Historias de Usuario** (ID + título), o
- **Keys** listadas (`AVCD-4815` o `4815`).

Tras extraer o normalizar keys, escribe el JSON:

```json
{
  "updatedAt": "<ISO8601>",
  "source": "image",
  "keys": ["AVCD-4815", "AVCD-4891"]
}
```

`source`: `image` o `keys`. Usa esas keys para esta corrida.

**Leer** sin pedir imagen si no hay imagen ni keys en el mensaje: abre `.cursor/data/hu-actuales.json`. Si existe y `keys` tiene al menos un elemento, úsalo. No pidas captura en ese caso.

**Pedir imagen** solo si no hay imagen, no hay keys en el mensaje y no hay archivo usable (falta, JSON inválido o `keys` vacío). Usa `AskQuestion`. No arranques sin IDs.

Lectura de imagen (igual que review-sprint): extrae **todos** los IDs de la columna Historias de Usuario (`4815` → `AVCD-4815`), aunque el asignado no sea el usuario. El ID es el número al inicio de esa celda, pegado al título. No uses la columna de índice a la izquierda, ni horas, ni fechas (`17/09/2026`).

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

Empate total: orden de aparición en `keys` del tablero (imagen, keys del mensaje o archivo).

Emoji de Estado (solo visual; detalle en la rule de reporte):

| Emoji | Estados |
| --- | --- |
| 🟢 | Listo para pruebas, En pruebas |
| 🟡 | En Desarrollo, Por Hacer y resto activo |
| 🔴 | Bloqueado |
| ⚪ | validacion po, RELEASE, Terminado, En producción |

## 4. Reportar

Mensaje al usuario: **solo** el formato de `.cursor/rules/priority-tasks-organizer-report.mdc`. No expliques el ranking. No anuncies que guardaste el tablero salvo que el usuario pregunte.

## Qué no hacer

- No pidas confirmación extra si ya tienes keys (imagen, mensaje o archivo).
- No filtres por asignado de la hoja ni de Jira.
- No muestres prioridad, tipo, versión ni “por qué”.
- No crees ni transiciones issues.
- No uses `jira-config.js` ni scripts Node para esta skill.
