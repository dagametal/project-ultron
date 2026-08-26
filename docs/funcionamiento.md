# Funcionamiento de Ultron

Ultron automatiza en Jira/Xray el trabajo de **releases de producción** del proyecto AVCD: crea Test Plans y Test Executions, asocia los casos de los Test Sets y sube evidencias.

Sitio: `https://avaldigitallabs.atlassian.net`

---

## 1. Preparación

1. Copiar `jira-config.example.js` a `jira-config.js` (este archivo no se versiona).
2. Completar URL de Jira, `PROJECT_KEY` (`AVCD`), email, token de Jira y API Keys de Xray.
3. Para evidencias, definir también `ISSUE_KEY` (el issue destino) y `FOLDER_PATH` (carpeta local de videos/archivos).

Los comandos se ejecutan desde la raíz del repo. La versión siempre es `x.x.x` (por ejemplo `4.12.0` o `Release 4.12.0`). El script la resuelve contra las **versiones corregidas** de Jira (`Release` / `Releases`).

---

## 2. Organización del repo

| Carpeta | Qué hay |
| --- | --- |
| `prod-release/` | Creación de Test Plans y Test Executions de release |
| `evidence-manager/` | Comentarios y carga de evidencias en un issue |
| `docs/` | Documentación de este proceso |

`casos.txt` (raíz) alimenta `npm run comment:txt`.

---

## 3. Flujo de un release

Orden habitual:::::::::::::::::::::::::::::::::::::::::

1. Crear las **Test Executions** que correspondan (humo y/o regresión).
2. Crear el **Test Plan** de esa misma versión.
3. Si aplica, asociar al plan una TE ya creada (solo con el número del issue).
4. Cuando haya evidencias, comentarlas o subirlas al issue que toque.

Todos los issues de release quedan con esa **versión corregida**.

### 3.1 Humo básico

```bash
npm run smoke -- "4.12.0"
```

Pregunta canal:

- **1 — Banca Mobile** → Test Set [AVCD-4345](https://avaldigitallabs.atlassian.net/browse/AVCD-4345)
- **2 — Portal Bancario** → Test Set [AVCD-4346](https://avaldigitallabs.atlassian.net/browse/AVCD-4346)

Lee **todos** los casos actuales del Test Set en Xray (no el índice JQL) y los asocia al TE. Si más adelante se agregan casos al set, la próxima ejecución los incluye.

- Summary: `Pruebas de Humo  - Release x.x.x`
- Descripción: texto fijo de arquitectura (QA no acompaña; humo lo valida arquitectura en el paso)
- Asignado: usuario de Jira con el que se autentica el script

### 3.2 Humo completo

```bash
npm run smoke:complete -- "4.12.0"
```

Arma un TE con:

1. Historias / Story / Tech Story de esa versión.
2. Casos del Test Set [AVCD-2387](https://avaldigitallabs.atlassian.net/browse/AVCD-2387) que coincidan con `prod-release/funcionalidades.json` (palabras en el título de la HU y en el título del caso).
3. Todos los casos de [AVCD-4346](https://avaldigitallabs.atlassian.net/browse/AVCD-4346), salvo los que ya entraron en el paso 2.

Al final lista las HU de la versión que no matchearon ningún caso de AVCD-2387.

- Summary: `Pruebas de Humo - Release x.x.x`
- Descripción: `Pruebas de humo Release x.x.x`
- Asignado: `diegoan.garcia`

Si una HU nueva no entra, hay que ampliar el diccionario; no basta con meter el caso solo al Test Set.

### 3.3 Regresión manual

```bash
npm run regression -- "4.12.0"
```

Asocia **todos** los casos actuales de [AVCD-2387](https://avaldigitallabs.atlassian.net/browse/AVCD-2387) (lectura Xray, paginada). Si se agregan casos al set, la próxima ejecución los trae.

- Summary: `Regresión Manual - Release x.x.x`
- Descripción: `Pruebas Manuales Release x.x.x`
- Asignado: usuario de Jira con el que se autentica el script

### 3.4 Test Plan

```bash
npm run test-plan -- "4.12.0"
```

Crea un Test Plan vacío de esa versión:

- Summary y descripción: `Test Plan  - Release x.x.x`
- Asignado: `diegoan.garcia`

Al final pregunta si se quiere añadir una Test Execution. Si la respuesta es **s**, pide solo el **número** (`4447` → `AVCD-4447`), valida que sea un Test Execution y lo asocia al plan (pestaña *Ejecuciones de Tests*).

---

## 4. Evidencias

Trabajan contra el `ISSUE_KEY` definido en `jira-config.js`.

| Comando | Qué hace |
| --- | --- |
| `npm run comment` | Comenta el issue a partir de los nombres de archivos en `FOLDER_PATH` |
| `npm run comment:txt` | Comenta una tabla ADF leída de `casos.txt` (pregunta si ordenar alfabéticamente) |
| `npm run upload` | Sube los archivos de `FOLDER_PATH` como adjuntos y comenta con el enlace |

---

## 5. Test Sets de referencia

| Key | Uso |
| --- | --- |
| [AVCD-2387](https://avaldigitallabs.atlassian.net/browse/AVCD-2387) | Regresión completa y filtro del humo completo (diccionario) |
| [AVCD-4345](https://avaldigitallabs.atlassian.net/browse/AVCD-4345) | Humo básico Banca Mobile |
| [AVCD-4346](https://avaldigitallabs.atlassian.net/browse/AVCD-4346) | Humo básico Portal Bancario y set fijo del humo completo |

---

## 6. Comandos

| Comando | Script |
| --- | --- |
| `npm run smoke` / `smoke:basic` | `prod-release/create-basic-smoke-test-execution.js` |
| `npm run smoke:complete` | `prod-release/create-complete-smoke-test-execution.js` |
| `npm run regression` | `prod-release/create-functional-test-execution.js` |
| `npm run test-plan` | `prod-release/create-test-plan.js` |
| `npm run comment` | `evidence-manager/comment-jira.js` |
| `npm run comment:txt` | `evidence-manager/comment-jira-from-txt.js` |
| `npm run upload` | `evidence-manager/upload-jira.js` |

La versión se pasa con `--`, por ejemplo: `npm run regression -- "4.12.0"`.

---

## 7. Criterios que no hay que romper

- **Quitar casos de un TE existente** se hace solo en ese issue de Jira/Xray. No se cambian los scripts de creación ni se agregan listas de exclusión fijas por una limpieza puntual.
- Humo básico y regresión deben seguir trayendo **todo** lo que tenga el Test Set en Xray al momento de ejecutar.
- El humo completo sigue el diccionario + AVCD-4346, no una lista de keys hardcodeada.
- `jira-config.js` no se sube al repo: tiene tokens.
