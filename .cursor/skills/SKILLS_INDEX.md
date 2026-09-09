# Skills Index (Skill Master)

Catálogo de habilidades de automatización de Ultron. Antes de una tarea compleja, el agente consulta este índice y carga la `SKILL.md` que coincida.

| Nombre de la Skill | Descripción Corta | Cuándo Usarla (Triggers / Casos de uso) | Entradas Requeridas |
| --- | --- | --- | --- |
| Fast release documentation | Crea la documentación de un release AVCD: Test Execution de humo básico + Test Plan asociado y en estado Terminado (Banca Mobile o Portal Bancario). | El usuario dice `fast-release-documentation`, documentación de release, documentar release, o pide humo básico y Test Plan juntos para BM/PB. | Versión `x.x.x` (ej. `4.12.0`); canal `BM` o `PB`; credenciales en `jira-config.js` (`EMAIL`, `API_TOKEN`, `XRAY_CLIENT_ID`, `XRAY_CLIENT_SECRET`). No pide screenshots. |
| Smoke and regression test (PB) | Crea el humo completo y la regresión manual de un release AVCD (Portal Bancario) y, si aplica, las vincula a un Test Plan existente. | El usuario dice `smoke-and-regression-test-pb`, humo completo y regresión, smoke complete + regression, o pide ambas Test Executions para un release `x.x.x`. | Versión `x.x.x` que exista en Jira (`Release` / `Releases`); opcional key de Test Plan (`AVCD-XXXX` o `XXXX`); credenciales en `jira-config.js`. No pide screenshots. |

## Mantenimiento

Cada vez que se cree, modifique o elimine una Skill, este archivo debe actualizarse de forma obligatoria.
