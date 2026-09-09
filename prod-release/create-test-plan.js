const readline = require("readline");
const axios = require("axios");

// npm run test-plan -- "Release 4.12.0"
// node prod-release/create-test-plan.js 4.12.0 --te 4614 --terminado

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
const ESTADO_EN_PRUEBAS = "En pruebas";
const ESTADO_TERMINADO = "Terminado";

const auth = {
  username: EMAIL,
  password: API_TOKEN,
};

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
  let terminado = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--terminado") {
      terminado = true;
      continue;
    }
    if (arg === "--te") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("Falta el valor de --te (ej. --te 4614).");
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
    versionInput: rest.join(" ").trim(),
    te: te ? String(te).trim() : null,
    terminado,
  };
}

async function preguntarVersion(desdeArgs) {
  if (desdeArgs) return desdeArgs;
  return preguntar("Versión corregida (ej. Release 3.11.1): ");
}

async function preguntarSiNo(texto) {
  while (true) {
    const respuesta = (await preguntar(texto)).toLowerCase();
    if (["s", "si", "sí", "y", "yes"].includes(respuesta)) return true;
    if (["n", "no"].includes(respuesta)) return false;
    console.log("Escribe s o n.\n");
  }
}

function resolverKeyTE(input) {
  const valor = String(input || "").trim().toUpperCase();
  if (/^\d+$/.test(valor)) return `${PROJECT_KEY}-${valor}`;

  const match = valor.match(/^([A-Z][A-Z0-9]+)-\d+$/);
  if (match) return valor;

  return null;
}

function extraerNumeroVersion(texto) {
  const match = texto.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

function normalizar(texto) {
  return texto.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizarEstado(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolverVersion(input, versiones) {
  const numero = extraerNumeroVersion(input);
  if (!numero) {
    throw new Error(
      `No encontré un número de versión tipo x.x.x en "${input}". Ejemplo válido: Release 3.11.1`,
    );
  }

  const inputNormalizado = normalizar(input);
  const candidatas = versiones.filter(
    (v) => extraerNumeroVersion(v.name) === numero,
  );

  const exacta = candidatas.find(
    (v) => normalizar(v.name) === inputNormalizado,
  );
  if (exacta) return exacta;

  const porPrefijo = candidatas.find((v) =>
    ["release", "releases"].includes(normalizar(v.name).split(" ")[0]),
  );
  if (porPrefijo) return porPrefijo;

  if (candidatas.length === 1) return candidatas[0];

  const disponibles = versiones
    .map((v) => v.name)
    .filter((name) => /release/i.test(name))
    .slice(-15)
    .join("\n  - ");

  throw new Error(
    `No existe la versión "${input}" en ${PROJECT_KEY}.\n` +
      `Versiones recientes:\n  - ${disponibles}`,
  );
}

function textoADF(texto) {
  return {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: texto }],
      },
    ],
  };
}

async function obtenerVersiones() {
  const { data } = await axios.get(
    `${JIRA_URL}/rest/api/3/project/${PROJECT_KEY}/versions`,
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

async function crearTestPlan(summary, description, version, accountId) {
  const { data } = await axios.post(
    `${JIRA_URL}/rest/api/3/issue`,
    {
      fields: {
        project: { key: PROJECT_KEY },
        issuetype: { name: "Test Plan" },
        summary,
        description: textoADF(description),
        fixVersions: [{ name: version.name }],
        assignee: { accountId },
      },
    },
    { auth, headers },
  );

  return data;
}

async function obtenerIssue(key) {
  const { data } = await axios.get(
    `${JIRA_URL}/rest/api/3/issue/${key}?fields=summary,issuetype`,
    { auth, headers },
  );
  return data;
}

async function obtenerTransiciones(issueKey) {
  const { data } = await axios.get(
    `${JIRA_URL}/rest/api/3/issue/${issueKey}/transitions`,
    { auth, headers },
  );
  return data.transitions || [];
}

async function transicionarA(issueKey, estadoDestino) {
  const destino = normalizarEstado(estadoDestino);
  if (destino === "bloqueado") {
    throw new Error("No se permite transicionar a Bloqueado.");
  }

  const transiciones = await obtenerTransiciones(issueKey);
  const transicion = transiciones.find(
    (t) => normalizarEstado(t.to?.name) === destino,
  );

  if (!transicion) {
    const disponibles = transiciones
      .map((t) => t.to?.name)
      .filter(Boolean)
      .join(", ");
    throw new Error(
      `No hay transición a "${estadoDestino}" desde ${issueKey}. Disponibles: ${disponibles || "ninguna"}`,
    );
  }

  await axios.post(
    `${JIRA_URL}/rest/api/3/issue/${issueKey}/transitions`,
    { transition: { id: transicion.id } },
    { auth, headers },
  );
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

async function asociarTestExecution(token, testPlanId, testExecutionId) {
  const data = await xrayGraphql(
    token,
    `
      mutation($issueId: String!, $testExecIssueIds: [String]!) {
        addTestExecutionsToTestPlan(
          issueId: $issueId
          testExecIssueIds: $testExecIssueIds
        ) {
          addedTestExecutions
          warning
        }
      }
    `,
    {
      issueId: String(testPlanId),
      testExecIssueIds: [String(testExecutionId)],
    },
  );

  return data.addTestExecutionsToTestPlan;
}

async function asociarTEAlPlan(testPlan, numero) {
  const teKey = resolverKeyTE(numero);
  if (!teKey) {
    throw new Error(
      `El valor "${numero}" no es un número de TE válido. Ejemplo: 4447`,
    );
  }

  const te = await obtenerIssue(teKey);
  const tipo = te.fields?.issuetype?.name || "";
  if (tipo !== "Test Execution") {
    throw new Error(`${te.key} es "${tipo}", no un Test Execution.`);
  }

  console.log(`🔗 Asociando ${te.key} a ${testPlan.key}...`);
  const xrayToken = await autenticarXray();
  const resultado = await asociarTestExecution(xrayToken, testPlan.id, te.id);
  if (resultado?.warning) {
    console.log(`⚠️  Xray: ${resultado.warning}`);
  }
  console.log(`✅ Asociada ${te.key}: ${te.fields.summary}`);
}

async function preguntarYAsociarTE(testPlan) {
  const quiereAsociar = await preguntarSiNo(
    "¿Añadir una Test Execution a este Test Plan? (s/n): ",
  );
  if (!quiereAsociar) return;

  const numero = await preguntar(
    `Número de la TE (ej. 4447 → ${PROJECT_KEY}-4447): `,
  );
  await asociarTEAlPlan(testPlan, numero);
}

async function main() {
  try {
    if (!PROJECT_KEY) {
      throw new Error("Falta PROJECT_KEY en jira-config.js (ej. AVCD).");
    }

    const cli = parseArgs(process.argv.slice(2));
    const input = await preguntarVersion(cli.versionInput);
    if (!input) {
      throw new Error("Debes indicar la versión, por ejemplo: Release 3.11.1");
    }

    console.log("🔎 Buscando versión en Jira...");
    const versiones = await obtenerVersiones();
    const version = resolverVersion(input, versiones);
    const numero = extraerNumeroVersion(version.name);
    const summary = `Test Plan  - Release ${numero}`;
    const description = `Test Plan  - Release ${numero}`;

    const usuario = await obtenerAsignado();

    console.log(`📌 Versión corregida: ${version.name}`);
    console.log(`📝 Summary: ${summary}`);
    console.log(`📄 Descripción: ${description}`);
    console.log(`👤 Persona asignada: ${usuario.displayName} (${usuario.emailAddress})`);
    console.log("🚀 Creando Test Plan...");

    const issue = await crearTestPlan(
      summary,
      description,
      version,
      usuario.accountId,
    );
    const url = `${JIRA_URL}/browse/${issue.key}`;

    console.log(`✅ Creado ${issue.key}`);
    console.log(`🔗 ${url}`);

    console.log(`🔄 Pasando a ${ESTADO_EN_PRUEBAS}...`);
    await transicionarA(issue.key, ESTADO_EN_PRUEBAS);
    console.log(`📌 Estado: ${ESTADO_EN_PRUEBAS}`);

    if (cli.te) {
      await asociarTEAlPlan(issue, cli.te);
    } else {
      await preguntarYAsociarTE(issue);
    }

    const quiereTerminar = cli.terminado
      ? true
      : cli.te
        ? false
        : await preguntarSiNo(
            `¿Cambiar el Test Plan de ${ESTADO_EN_PRUEBAS} a ${ESTADO_TERMINADO}? (s/n): `,
          );
    if (quiereTerminar) {
      await transicionarA(issue.key, ESTADO_TERMINADO);
      console.log(`📌 Estado: ${ESTADO_TERMINADO}`);
    } else {
      console.log(`📌 Estado: ${ESTADO_EN_PRUEBAS}`);
    }
  } catch (error) {
    const detalle = error.response?.data || error.message;
    console.log("❌ Error:", detalle);
    process.exitCode = 1;
  }
}

main();
