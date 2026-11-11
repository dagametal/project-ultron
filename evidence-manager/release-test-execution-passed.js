const readline = require("readline");
const axios = require("axios");

// node evidence-manager/release-test-execution-passed.js 3.16.0

const {
  JIRA_URL,
  EMAIL,
  API_TOKEN,
  PROJECT_KEY,
  XRAY_CLIENT_ID,
  XRAY_CLIENT_SECRET,
  XRAY_BASE_URL = "https://xray.cloud.getxray.app",
} = require("../jira-config");

const TIPOS = ["Historia", "Story", "Tech Story", "Error"];
const TIPO_TE = "Test Execution";
const ESTADOS_EVALUAR = new Set(["terminado", "release", "en produccion"]);
const ESTADOS_XRAY_PASSED = new Set(["passed"]);
const ESTADOS_XRAY_MARCAR = new Set(["todo", "to do", "executing"]);
const ESTADOS_XRAY_NO_TOCAR = new Set(["failed", "fail", "aborted", "blocked"]);
const BROWSE = "https://avaldigitallabs.atlassian.net/browse";

const auth = { username: EMAIL, password: API_TOKEN };
const headers = {
  Accept: "application/json",
  "Content-Type": "application/json",
};

function preguntar(texto) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(texto, (respuesta) => {
      rl.close();
      resolve(respuesta.trim());
    });
  });
}

function extraerNumeroVersion(texto) {
  const match = String(texto || "").match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

function normalizar(texto) {
  return String(texto || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizarEstado(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function celda(texto) {
  return String(texto || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function mdKey(key) {
  return `[${key}](${BROWSE}/${key})`;
}

function issueDesdeLink(link) {
  return link.outwardIssue || link.inwardIssue || null;
}

function nombreStatusXray(status) {
  if (!status) return "";
  if (typeof status === "string") return status;
  return status.name || "";
}

async function preguntarVersion() {
  const desdeArgs = process.argv.slice(2).join(" ").trim();
  if (desdeArgs) return desdeArgs;
  return preguntar("Versión (ej. 3.16.0): ");
}

async function obtenerVersiones() {
  const { data } = await axios.get(
    `${JIRA_URL}/rest/api/3/project/${PROJECT_KEY}/versions`,
    { auth, headers },
  );
  return data || [];
}

function resolverVersion(input, versiones) {
  const numero = extraerNumeroVersion(input);
  if (!numero) {
    throw new Error(
      `No encontré un número de versión tipo x.x.x en "${input}". Ejemplo válido: 3.16.0`,
    );
  }

  const candidatas = versiones.filter(
    (version) => extraerNumeroVersion(version.name) === numero,
  );
  const exacta = candidatas.find(
    (version) => normalizar(version.name) === normalizar(input),
  );
  if (exacta) return exacta;

  const release = candidatas.find(
    (version) => normalizar(version.name) === `release ${numero}`,
  );
  if (release) return release;

  const releases = candidatas.find(
    (version) => normalizar(version.name) === `releases ${numero}`,
  );
  if (releases) return releases;

  if (candidatas.length === 1) return candidatas[0];

  throw new Error(
    `No existe la versión "${numero}" en ${PROJECT_KEY}.`,
  );
}

async function buscarIssues(jql) {
  const issues = [];
  let nextPageToken;

  do {
    const payload = {
      jql,
      maxResults: 100,
      fields: ["summary", "status", "issuetype", "issuelinks"],
    };
    if (nextPageToken) payload.nextPageToken = nextPageToken;

    const { data } = await axios.post(
      `${JIRA_URL}/rest/api/3/search/jql`,
      payload,
      { auth, headers },
    );

    issues.push(...(data.issues || []));
    nextPageToken = data.nextPageToken;
  } while (nextPageToken);

  return issues;
}

async function obtenerIssue(key) {
  const { data } = await axios.get(
    `${JIRA_URL}/rest/api/3/issue/${key}?fields=issuetype,status`,
    { auth, headers },
  );
  return data;
}

async function recolectarTestExecutions(issue) {
  const tes = [];
  const vistos = new Set();

  for (const link of issue.fields?.issuelinks || []) {
    if (link.type?.name !== "Test") continue;
    let ligado = issueDesdeLink(link);
    if (!ligado?.key || vistos.has(ligado.key)) continue;
    vistos.add(ligado.key);
    if (!ligado.id || !ligado.fields?.issuetype?.name) {
      ligado = await obtenerIssue(ligado.key);
    }
    if (ligado.fields?.issuetype?.name !== TIPO_TE) continue;
    tes.push({
      key: ligado.key,
      id: ligado.id,
      status: ligado.fields?.status?.name || "",
    });
  }

  return tes;
}

async function autenticarXray() {
  if (!XRAY_CLIENT_ID || !XRAY_CLIENT_SECRET) {
    throw new Error(
      "Faltan XRAY_CLIENT_ID y XRAY_CLIENT_SECRET en jira-config.js.\n" +
        "Créalos en Jira: Apps → Xray → API Keys.",
    );
  }

  const { data } = await axios.post(
    `${XRAY_BASE_URL}/api/v2/authenticate`,
    { client_id: XRAY_CLIENT_ID, client_secret: XRAY_CLIENT_SECRET },
    { headers },
  );

  const token = typeof data === "string" ? data.replace(/^"|"$/g, "") : data;
  if (!token) {
    throw new Error("Xray no devolvió un token de autenticación.");
  }
  return token;
}

async function xrayGraphql(token, query, variables) {
  const { data } = await axios.post(
    `${XRAY_BASE_URL}/api/v2/graphql`,
    { query, variables },
    { headers: { ...headers, Authorization: `Bearer ${token}` } },
  );

  if (data.errors?.length) {
    throw new Error(JSON.stringify(data.errors, null, 2));
  }

  return data.data;
}

async function obtenerTestRuns(token, executionId) {
  const runs = [];
  const limit = 100;
  let start = 0;
  let total = null;

  while (total === null || start < total) {
    const data = await xrayGraphql(
      token,
      `
        query($issueId: String!, $limit: Int!, $start: Int!) {
          getTestExecution(issueId: $issueId) {
            testRuns(limit: $limit, start: $start) {
              total
              results {
                id
                status { name }
                test { issueId jira(fields: ["key"]) }
              }
            }
          }
        }
      `,
      { issueId: String(executionId), limit, start },
    );

    const page = data.getTestExecution?.testRuns;
    if (!page) break;
    total = page.total ?? 0;
    const results = page.results || [];
    runs.push(...results);
    if (!results.length) break;
    start += limit;
  }

  return runs;
}

async function marcarRunsPassed(token, te) {
  const runs = await obtenerTestRuns(token, te.id);
  const reporte = {
    total: runs.length,
    passed: [],
    skippedPassed: [],
    skippedFailed: [],
    otros: [],
  };

  for (const run of runs) {
    const key = run.test?.jira?.key || run.test?.issueId || run.id;
    const status = normalizarEstado(nombreStatusXray(run.status));
    const visible = nombreStatusXray(run.status) || "sin estado";

    if (ESTADOS_XRAY_PASSED.has(status)) {
      reporte.skippedPassed.push(key);
      continue;
    }

    if (ESTADOS_XRAY_NO_TOCAR.has(status)) {
      reporte.skippedFailed.push(`${key} (${visible})`);
      continue;
    }

    if (!ESTADOS_XRAY_MARCAR.has(status)) {
      reporte.otros.push(`${key} (${visible})`);
      continue;
    }

    await xrayGraphql(
      token,
      `
        mutation($id: String!, $status: String!) {
          updateTestRunStatus(id: $id, status: $status)
        }
      `,
      { id: String(run.id), status: "PASSED" },
    );
    reporte.passed.push(key);
    console.log(`✅ Xray ${key} en ${te.key}: ${visible} → PASSED`);
  }

  return reporte;
}

function textoDeReporte(reporte) {
  if (!reporte.total) return "Sin casos";

  const partes = [];
  if (reporte.passed.length) {
    partes.push(
      `${reporte.passed.length} runs TO DO/EXECUTING → **PASSED**`,
    );
  }
  if (reporte.skippedFailed.length) {
    partes.push(`No tocados: ${reporte.skippedFailed.join(", ")}`);
  }
  if (reporte.otros.length) {
    partes.push(`No marcados: ${reporte.otros.join(", ")}`);
  }
  if (!partes.length) return "Sin pendientes";
  return partes.join(". ");
}

function celdaResultado(detalles) {
  if (detalles.length === 1) return detalles[0].texto;
  return detalles.map((detalle) => `${mdKey(detalle.key)}: ${detalle.texto}`).join(". ");
}

function imprimirTabla(versionName, filas) {
  console.log(`\nrelease-test-execution-passed listo para ${versionName}.\n`);
  console.log("| HU | Estado | Test Execution | Resultado |");
  console.log("| --- | --- | --- | --- |");
  for (const fila of filas) {
    const tes = fila.tes.length
      ? fila.tes.map((te) => mdKey(te.key)).join(", ")
      : "—";
    console.log(
      `| ${mdKey(fila.key)} | ${celda(fila.estado)} | ${tes} | ${celda(fila.resultado)} |`,
    );
  }
}

async function main() {
  const input = await preguntarVersion();
  if (!input) {
    throw new Error("Debes indicar la versión, por ejemplo: 3.16.0");
  }

  const version = resolverVersion(input, await obtenerVersiones());
  if (version.name.includes('"')) {
    throw new Error(`El nombre de versión no es válido: ${version.name}`);
  }

  const tipos = TIPOS.map((tipo) => `"${tipo}"`).join(", ");
  const issues = await buscarIssues(
    `project = ${PROJECT_KEY} AND fixVersion = "${version.name}" AND issuetype in (${tipos}) ORDER BY key ASC`,
  );

  console.log(`\n🚀 ${version.name}: ${issues.length} issues\n`);

  const filas = [];
  for (const issue of issues) {
    filas.push({
      key: issue.key,
      estado: issue.fields?.status?.name || "",
      evaluar: ESTADOS_EVALUAR.has(normalizarEstado(issue.fields?.status?.name)),
      tes: await recolectarTestExecutions(issue),
      resultado: "",
    });
  }

  const hayRuns = filas.some((fila) => fila.evaluar && fila.tes.length);
  const token = hayRuns ? await autenticarXray() : null;

  for (const fila of filas) {
    if (!fila.evaluar) {
      fila.resultado = "Otro estado";
      continue;
    }
    if (!fila.tes.length) {
      fila.resultado = "Sin Test Execution";
      continue;
    }

    const detalles = [];
    for (const te of fila.tes) {
      if (!te.id) {
        throw new Error(`La Test Execution ${te.key} no trajo id de Jira.`);
      }
      const reporte = await marcarRunsPassed(token, te);
      detalles.push({ key: te.key, texto: textoDeReporte(reporte) });
    }
    fila.resultado = celdaResultado(detalles);
  }

  imprimirTabla(version.name, filas);
}

main().catch((error) => {
  const status = error.response?.status;
  const mensajes = error.response?.data?.errorMessages;
  const extra = Array.isArray(mensajes) ? mensajes.join(" ") : "";
  console.error(`\n❌ ${error.message}${status ? ` (${status})` : ""}${extra ? `: ${extra}` : ""}`);
  process.exit(1);
});
