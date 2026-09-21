const readline = require("readline");
const axios = require("axios");

// node evidence-manager/qa-cierre.js AVCD-4549
// node evidence-manager/qa-cierre.js 4549 --te 4645

const {
  JIRA_URL,
  EMAIL,
  API_TOKEN,
  PROJECT_KEY,
  XRAY_CLIENT_ID,
  XRAY_CLIENT_SECRET,
  XRAY_BASE_URL = "https://xray.cloud.getxray.app",
} = require("../jira-config");

const ASSIGNEE_QUERY = "diegoan.garcia";
const SUMMARY_CIERRE = "QA: Cierre";
const TIPOS_HU = ["Historia", "Story", "Tech Story", "Error"];
const TIPO_TE = "Test Execution";
const TIPO_TEST = "Test";
const TIPO_SUBTAREA = "Subtarea";
const ESTADO_TERMINADO = "Terminado";
const ESTADO_EN_PRUEBAS = "En pruebas";
const ESTADO_EN_DESARROLLO = "En Desarrollo";
const ESTADO_VALIDACION_PO = "validacion po";
const VIA_TERMINADO = [ESTADO_EN_PRUEBAS, ESTADO_EN_DESARROLLO];
const ESTADOS_XRAY_PASSED = new Set(["passed"]);
const ESTADOS_XRAY_MARCAR = new Set(["todo", "to do", "executing"]);
const ESTADOS_XRAY_NO_TOCAR = new Set(["failed", "fail", "aborted", "blocked"]);
const ESTADOS_PROHIBIDOS = new Set(["bloqueado", "cancelado"]);
const BROWSE = "https://avaldigitallabs.atlassian.net/browse";
const EXIT_ELEGIR_TE = 2;

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

function parseArgs(argv) {
  const rest = [];
  let te = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--te") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("Falta el valor de --te (ej. --te 4645).");
      }
      te = next;
      i += 1;
      continue;
    }
    if (arg.startsWith("--te=")) {
      te = arg.slice("--te=".length);
      continue;
    }
    rest.push(arg);
  }

  return {
    huInput: rest.join(" ").trim(),
    te: te ? String(te).trim() : null,
  };
}

function resolverKey(input) {
  const valor = String(input || "").trim().toUpperCase();
  if (/^\d+$/.test(valor)) return `${PROJECT_KEY}-${valor}`;
  if (/^([A-Z][A-Z0-9]+)-\d+$/.test(valor)) return valor;
  return null;
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

function esSummaryCierre(summary) {
  return normalizar(summary) === normalizar(SUMMARY_CIERRE);
}

function urlIssue(key) {
  return `${BROWSE}/${key}`;
}

function mdKey(key) {
  return `[${key}](${urlIssue(key)})`;
}

function comentarioEvidenciasAdf(teKey) {
  return {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Evidencias: " },
          {
            type: "inlineCard",
            attrs: { url: urlIssue(teKey) },
          },
        ],
      },
    ],
  };
}

function textoDeAdf(nodo) {
  if (!nodo) return "";
  if (typeof nodo === "string") return nodo;
  if (nodo.type === "text") return nodo.text || "";
  if (nodo.type === "inlineCard") return nodo.attrs?.url || "";
  if (nodo.attrs?.url) return nodo.attrs.url;
  if (Array.isArray(nodo.content)) return nodo.content.map(textoDeAdf).join("");
  if (nodo.body) return textoDeAdf(nodo.body);
  return "";
}

function compactarKeys(keys) {
  if (!keys.length) return "(ninguno)";
  const ordenadas = [...keys].sort((a, b) => {
    const na = Number(String(a).split("-")[1]) || 0;
    const nb = Number(String(b).split("-")[1]) || 0;
    return na - nb;
  });
  const nums = ordenadas.map((k) => Number(String(k).split("-")[1]) || 0);
  const consecutivas =
    ordenadas.length > 2 &&
    nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
  if (consecutivas) return `${ordenadas[0]} … ${ordenadas[ordenadas.length - 1]}`;
  return ordenadas.join(", ");
}

function negritaFinal(cadena) {
  const partes = String(cadena || "").split(" → ");
  if (partes.length <= 1) return `**${cadena}**`;
  const ultimo = partes.pop();
  return `${partes.join(" → ")} → **${ultimo}**`;
}

function issueDesdeLink(link) {
  return link.outwardIssue || link.inwardIssue || null;
}

async function obtenerIssue(key, fields) {
  const lista = fields || [
    "summary",
    "issuetype",
    "status",
    "assignee",
    "subtasks",
    "issuelinks",
    "parent",
  ];
  const { data } = await axios.get(
    `${JIRA_URL}/rest/api/3/issue/${key}?fields=${lista.join(",")}`,
    { auth, headers },
  );
  return data;
}

async function obtenerAsignado() {
  const { data } = await axios.get(`${JIRA_URL}/rest/api/3/user/search`, {
    auth,
    headers,
    params: { query: ASSIGNEE_QUERY },
  });

  const usuario =
    (data || []).find(
      (u) =>
        u.displayName === ASSIGNEE_QUERY ||
        (u.emailAddress || "").toLowerCase().startsWith(`${ASSIGNEE_QUERY}@`),
    ) || data?.[0];

  if (!usuario?.accountId) {
    throw new Error(`No encontré el usuario "${ASSIGNEE_QUERY}" en Jira.`);
  }

  return usuario;
}

async function asignarSiHaceFalta(issue, accountId) {
  const actual = issue.fields?.assignee?.accountId;
  if (actual === accountId) {
    console.log(`⏭️  ${issue.key} ya está asignado a ${ASSIGNEE_QUERY}.`);
    return;
  }

  await axios.put(
    `${JIRA_URL}/rest/api/3/issue/${issue.key}`,
    { fields: { assignee: { accountId } } },
    { auth, headers },
  );
  console.log(`👤 ${issue.key} asignado a ${ASSIGNEE_QUERY}.`);
}

async function obtenerTransiciones(issueKey) {
  const { data } = await axios.get(
    `${JIRA_URL}/rest/api/3/issue/${issueKey}/transitions`,
    { auth, headers },
  );
  return data.transitions || [];
}

async function aplicarTransicion(issueKey, transicion) {
  const destino = normalizarEstado(transicion.to?.name);
  if (ESTADOS_PROHIBIDOS.has(destino)) {
    throw new Error(`No se permite transicionar ${issueKey} a ${transicion.to?.name}.`);
  }

  await axios.post(
    `${JIRA_URL}/rest/api/3/issue/${issueKey}/transitions`,
    { transition: { id: transicion.id } },
    { auth, headers },
  );
}

async function transicionarHasta(issueKey, estadoDestino, { via = [] } = {}) {
  const destino = normalizarEstado(estadoDestino);
  if (ESTADOS_PROHIBIDOS.has(destino)) {
    throw new Error(`No se permite transicionar a ${estadoDestino}.`);
  }

  const pasos = [];

  for (let hop = 0; hop < 8; hop += 1) {
    const issue = await obtenerIssue(issueKey, ["summary", "status"]);
    const nombre = issue.fields?.status?.name || "";
    const actual = normalizarEstado(nombre);
    if (!pasos.length) pasos.push(nombre);

    if (actual === destino) {
      if (hop === 0) {
        console.log(`⏭️  ${issueKey} ya está en ${nombre}.`);
      }
      return { skipped: hop === 0, cadena: pasos.join(" → ") };
    }

    const transiciones = await obtenerTransiciones(issueKey);
    const directa = transiciones.find(
      (t) => normalizarEstado(t.to?.name) === destino,
    );
    if (directa) {
      await aplicarTransicion(issueKey, directa);
      console.log(`➡️  ${issueKey}: ${nombre} → ${directa.to.name}`);
      pasos.push(directa.to.name);
      continue;
    }

    const puente = via
      .map((nombreVia) =>
        transiciones.find(
          (t) => normalizarEstado(t.to?.name) === normalizarEstado(nombreVia),
        ),
      )
      .find(Boolean);

    if (puente && normalizarEstado(puente.to?.name) !== actual) {
      await aplicarTransicion(issueKey, puente);
      console.log(`➡️  ${issueKey}: ${nombre} → ${puente.to.name}`);
      pasos.push(puente.to.name);
      continue;
    }

    const disponibles = transiciones
      .map((t) => t.to?.name)
      .filter(Boolean)
      .join(", ");
    throw new Error(
      `No hay transición a "${estadoDestino}" desde ${issueKey} (${nombre}). Disponibles: ${disponibles || "ninguna"}`,
    );
  }

  throw new Error(`Demasiados saltos al transicionar ${issueKey} a ${estadoDestino}.`);
}

async function crearSubtareaCierre(huKey, accountId) {
  const { data } = await axios.post(
    `${JIRA_URL}/rest/api/3/issue`,
    {
      fields: {
        project: { key: PROJECT_KEY },
        parent: { key: huKey },
        issuetype: { name: TIPO_SUBTAREA },
        summary: SUMMARY_CIERRE,
        assignee: { accountId },
      },
    },
    { auth, headers },
  );
  return data;
}

async function obtenerComentarios(issueKey) {
  const { data } = await axios.get(
    `${JIRA_URL}/rest/api/3/issue/${issueKey}/comment`,
    { auth, headers },
  );
  return data.comments || [];
}

async function comentarEvidencias(issueKey, teKey) {
  const url = urlIssue(teKey);
  const comentarios = await obtenerComentarios(issueKey);
  const yaEsta = comentarios.some((c) => {
    const texto = normalizar(textoDeAdf(c.body));
    return texto.includes("evidencias:") && texto.includes(normalizar(teKey));
  });

  if (yaEsta) {
    console.log(`⏭️  ${issueKey} ya tiene el comentario de evidencias de ${teKey}.`);
    return { skipped: true, url };
  }

  await axios.post(
    `${JIRA_URL}/rest/api/3/issue/${issueKey}/comment`,
    { body: comentarioEvidenciasAdf(teKey) },
    { auth, headers },
  );
  console.log(`💬 Comentario en ${issueKey}: Evidencias: ${url} (smart link)`);
  return { skipped: false, url };
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
    {
      client_id: XRAY_CLIENT_ID,
      client_secret: XRAY_CLIENT_SECRET,
    },
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
    {
      headers: {
        ...headers,
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (data.errors?.length) {
    throw new Error(JSON.stringify(data.errors, null, 2));
  }

  return data.data;
}

function nombreStatusXray(status) {
  if (!status) return "";
  if (typeof status === "string") return status;
  return status.name || "";
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
                status {
                  name
                }
                test {
                  issueId
                  jira(fields: ["key"])
                }
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
    passed: [],
    skippedPassed: [],
    skippedFailed: [],
    otros: [],
  };

  if (!runs.length) {
    console.log(`⚠️  ${te.key} no tiene test runs en Xray.`);
    return reporte;
  }

  for (const run of runs) {
    const key = run.test?.jira?.key || run.test?.issueId || run.id;
    const status = normalizarEstado(nombreStatusXray(run.status));

    if (ESTADOS_XRAY_PASSED.has(status)) {
      reporte.skippedPassed.push(key);
      continue;
    }

    if (ESTADOS_XRAY_NO_TOCAR.has(status)) {
      reporte.skippedFailed.push(`${key} (${nombreStatusXray(run.status)})`);
      continue;
    }

    if (!ESTADOS_XRAY_MARCAR.has(status)) {
      reporte.otros.push(`${key} (${nombreStatusXray(run.status) || "sin estado"})`);
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
    console.log(`✅ Xray ${key} en ${te.key}: ${nombreStatusXray(run.status)} → PASSED`);
  }

  if (reporte.skippedPassed.length) {
    console.log(`⏭️  Ya PASSED: ${reporte.skippedPassed.join(", ")}`);
  }
  if (reporte.skippedFailed.length) {
    console.log(`🚫 FAILED/no tocados: ${reporte.skippedFailed.join(", ")}`);
  }
  if (reporte.otros.length) {
    console.log(`⚠️  Runs no marcados: ${reporte.otros.join(", ")}`);
  }

  return reporte;
}

function recolectarVinculados(hu) {
  const links = hu.fields?.issuelinks || [];
  const tes = [];
  const tests = [];
  const vistos = new Set();

  for (const link of links) {
    const tipoLink = link.type?.name;
    if (tipoLink !== "Test") continue;
    const issue = issueDesdeLink(link);
    if (!issue?.key || vistos.has(issue.key)) continue;
    vistos.add(issue.key);

    const tipo = issue.fields?.issuetype?.name;
    if (tipo === TIPO_TE) tes.push(issue);
    if (tipo === TIPO_TEST) tests.push(issue);
  }

  return { tes, tests };
}

async function resolverTe(tes, teInput) {
  if (!tes.length) {
    throw new Error("La HU no tiene Test Execution vinculadas (link tipo Test).");
  }

  if (tes.length === 1) return tes[0];

  if (teInput) {
    const key = resolverKey(teInput);
    const elegida = tes.find((te) => te.key === key);
    if (!elegida) {
      const lista = tes.map((te) => te.key).join(", ");
      throw new Error(
        `${key || teInput} no está entre las TE vinculadas: ${lista}`,
      );
    }
    return elegida;
  }

  const lineas = tes
    .map((te) => `${te.key} | ${te.fields?.summary || ""}`)
    .join("\n");

  if (process.stdin.isTTY) {
    console.log("\nVarias Test Executions vinculadas:");
    tes.forEach((te, i) => {
      console.log(`  ${i + 1}. ${te.key} — ${te.fields?.summary || ""}`);
    });
    const respuesta = await preguntar("Número o key de la TE para Xray/evidencias: ");
    const porNumero = tes[Number(respuesta) - 1];
    if (porNumero) return porNumero;
    return resolverTe(tes, respuesta);
  }

  console.log("⚠️ Varias Test Executions vinculadas. Pasa --te <numero>.");
  console.log("TES:");
  console.log(lineas);
  process.exitCode = EXIT_ELEGIR_TE;
  throw new Error("NEED_TE");
}

async function preguntarHu(desdeArgs) {
  if (desdeArgs) return desdeArgs;
  return preguntar("Key de la HU (ej. AVCD-4549 o 4549): ");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const huInput = await preguntarHu(args.huInput);
  const huKey = resolverKey(huInput);
  if (!huKey) {
    throw new Error(`No pude resolver una key de HU desde "${huInput}".`);
  }

  const hu = await obtenerIssue(huKey);
  const tipoHu = hu.fields?.issuetype?.name || "";
  if (!TIPOS_HU.includes(tipoHu)) {
    throw new Error(
      `${hu.key} es "${tipoHu}". Tipos admitidos: ${TIPOS_HU.join(", ")}.`,
    );
  }

  const { tes, tests } = recolectarVinculados(hu);
  const te = await resolverTe(tes, args.te);
  const usuario = await obtenerAsignado();

  console.log(`\n🚀 QA: Cierre de ${hu.key} — ${hu.fields.summary}`);
  console.log(`   TE evidencias: ${te.key}`);
  console.log(`   Tests vinculados: ${tests.map((t) => t.key).join(", ") || "(ninguno)"}\n`);

  const subtareas = hu.fields?.subtasks || [];
  let cierre = subtareas.find((s) => esSummaryCierre(s.fields?.summary));
  let cierreCreada = false;
  if (cierre) {
    console.log(`⏭️  Subtarea ${cierre.key} "QA: Cierre" ya existe.`);
    cierre = await obtenerIssue(cierre.key, ["summary", "assignee", "status"]);
  } else {
    cierre = await crearSubtareaCierre(hu.key, usuario.accountId);
    console.log(`✅ Creada subtarea ${cierre.key} "QA: Cierre"`);
    cierre = await obtenerIssue(cierre.key, ["summary", "assignee", "status"]);
    cierreCreada = true;
  }
  await asignarSiHaceFalta(cierre, usuario.accountId);

  for (const issue of tes) {
    const fresco = await obtenerIssue(issue.key, ["summary", "assignee", "status"]);
    await asignarSiHaceFalta(fresco, usuario.accountId);
  }

  let teCadena = te.fields?.status?.name || "";
  for (const issue of tes) {
    const resultado = await transicionarHasta(issue.key, ESTADO_TERMINADO, {
      via: VIA_TERMINADO,
    });
    if (issue.key === te.key) teCadena = resultado.cadena;
  }
  for (const issue of tests) {
    await transicionarHasta(issue.key, ESTADO_TERMINADO, {
      via: VIA_TERMINADO,
    });
  }

  const token = await autenticarXray();
  const xray = await marcarRunsPassed(token, te);
  await comentarEvidencias(cierre.key, te.key);
  const cierreTrans = await transicionarHasta(cierre.key, ESTADO_TERMINADO, {
    via: VIA_TERMINADO,
  });

  const hayFallidos = xray.skippedFailed.length > 0;
  let huCadena;
  if (hayFallidos) {
    console.log(
      `\n⚠️  Hay runs FAILED. No paso ${hu.key} a ${ESTADO_VALIDACION_PO}.`,
    );
    huCadena = `${hu.fields.status.name} (no se movió: hay FAILED)`;
  } else {
    const huTrans = await transicionarHasta(hu.key, ESTADO_VALIDACION_PO, {
      via: VIA_TERMINADO,
    });
    huCadena = huTrans.cadena;
  }

  const origenCierre = cierreCreada ? "creada" : "ya existía";
  const xrayLine = hayFallidos
    ? `${xray.passed.length} runs → **PASSED**. FAILED no tocados: ${xray.skippedFailed.join(", ")}`
    : `${xray.passed.length} runs TO DO/EXECUTING → **PASSED**. Ningún FAILED`;

  console.log(`\nCierre de QA listo para ${mdKey(hu.key)}.\n`);
  console.log("| Qué | Resultado |");
  console.log("| --- | --- |");
  console.log(`| HU | ${mdKey(hu.key)} — ${negritaFinal(huCadena)} |`);
  console.log(
    `| Subtarea | ${mdKey(cierre.key)} **QA: Cierre** (${origenCierre}, asignada a \`${ASSIGNEE_QUERY}\`) — ${negritaFinal(cierreTrans.cadena)} |`,
  );
  console.log(
    `| TE | ${mdKey(te.key)} asignada a \`${ASSIGNEE_QUERY}\`, ${negritaFinal(teCadena)} |`,
  );
  console.log(
    `| Tests | ${compactarKeys(tests.map((t) => t.key))} a **Terminado** |`,
  );
  console.log(`| Xray | ${xrayLine} |`);
  console.log(`| Comentario | Evidencias: ${mdKey(te.key)} (smart link) |`);
}

main().catch((error) => {
  if (error.message === "NEED_TE") {
    process.exit(EXIT_ELEGIR_TE);
  }
  console.error(`\n❌ ${error.message}`);
  process.exit(1);
});
