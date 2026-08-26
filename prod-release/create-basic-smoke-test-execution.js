const readline = require("readline");
const axios = require("axios");

// npm run smoke -- "Release 4.12.0"

const {
  JIRA_URL,
  EMAIL,
  API_TOKEN,
  PROJECT_KEY,
  XRAY_CLIENT_ID,
  XRAY_CLIENT_SECRET,
  XRAY_BASE_URL = "https://xray.cloud.getxray.app",
} = require("../jira-config");

const TEST_SETS = {
  "1": { nombre: "Banca Mobile", key: "AVCD-4345" },
  "2": { nombre: "Portal Bancario", key: "AVCD-4346" },
};

const DESCRIPCION_TE =
  "Cambio realizado por arquitectura, no solicita acompañamiento de QA. Las pruebas de humo para validar el correcto funcionamiento de la App las realiza arquitectura durante el paso";

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

async function preguntarVersion() {
  const desdeArgs = process.argv.slice(2).join(" ").trim();
  if (desdeArgs) return desdeArgs;
  return preguntar("Versión corregida (ej. Release 3.11.1): ");
}

async function preguntarCanal() {
  const ayuda = [
    "Canal:",
    "  1) Banca Mobile",
    "  2) Portal Bancario",
    "Elige (1/2): ",
  ].join("\n");

  const aliases = {
    "1": "1",
    bm: "1",
    mobile: "1",
    "banca mobile": "1",
    "2": "2",
    pb: "2",
    portal: "2",
    "portal bancario": "2",
  };

  while (true) {
    const respuesta = (await preguntar(ayuda)).toLowerCase();
    const opcion = aliases[respuesta];
    if (opcion) return TEST_SETS[opcion];
    console.log("Opción inválida. Escribe 1 o 2.\n");
  }
}

function extraerNumeroVersion(texto) {
  const match = texto.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

function normalizar(texto) {
  return texto.trim().toLowerCase().replace(/\s+/g, " ");
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

async function obtenerVersiones() {
  const { data } = await axios.get(
    `${JIRA_URL}/rest/api/3/project/${PROJECT_KEY}/versions`,
    { auth, headers },
  );
  return data;
}

async function obtenerIssue(key) {
  const { data } = await axios.get(
    `${JIRA_URL}/rest/api/3/issue/${key}?fields=summary`,
    { auth, headers },
  );
  return data;
}

async function obtenerUsuarioActual() {
  const { data } = await axios.get(`${JIRA_URL}/rest/api/3/myself`, {
    auth,
    headers,
  });
  return data;
}

async function crearTestExecution(summary, version, accountId) {
  const { data } = await axios.post(
    `${JIRA_URL}/rest/api/3/issue`,
    {
      fields: {
        project: { key: PROJECT_KEY },
        issuetype: { name: "Test Execution" },
        summary,
        description: textoADF(DESCRIPCION_TE),
        fixVersions: [{ name: version.name }],
        assignee: { accountId },
      },
    },
    { auth, headers },
  );

  return data;
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

function mapXrayTest(test) {
  const jira = test.jira || {};
  return {
    id: String(test.issueId),
    key: jira.key,
    fields: {
      summary: jira.summary || jira.fields?.summary || "",
    },
  };
}

async function obtenerTestsPaginados(token, query, variables, pickPage) {
  const tests = [];
  const limit = 100;
  let start = 0;
  let total = null;

  while (total === null || start < total) {
    const data = await xrayGraphql(token, query, {
      ...variables,
      limit,
      start,
    });
    const page = pickPage(data);
    if (!page) break;

    total = page.total ?? 0;
    const results = page.results || [];
    tests.push(...results.map(mapXrayTest));
    if (!results.length) break;
    start += limit;
  }

  return tests;
}

async function obtenerTestsDelSet(token, testSetId) {
  return obtenerTestsPaginados(
    token,
    `
      query($issueId: String!, $limit: Int!, $start: Int!) {
        getTestSet(issueId: $issueId) {
          tests(limit: $limit, start: $start) {
            total
            results {
              issueId
              jira(fields: ["key", "summary"])
            }
          }
        }
      }
    `,
    { issueId: String(testSetId) },
    (data) => data.getTestSet?.tests,
  );
}

async function obtenerTestsDelExecution(token, executionId) {
  return obtenerTestsPaginados(
    token,
    `
      query($issueId: String!, $limit: Int!, $start: Int!) {
        getTestExecution(issueId: $issueId) {
          tests(limit: $limit, start: $start) {
            total
            results {
              issueId
            }
          }
        }
      }
    `,
    { issueId: String(executionId) },
    (data) => data.getTestExecution?.tests,
  );
}

async function agregarTestSetAlExecution(token, executionId, testSetId) {
  const data = await xrayGraphql(
    token,
    `
      mutation($issueId: String!, $testSetIssueIds: [String]!) {
        addTestSetsToTestExecution(
          issueId: $issueId
          testSetIssueIds: $testSetIssueIds
        ) {
          addedTestSets
          warning
        }
      }
    `,
    {
      issueId: String(executionId),
      testSetIssueIds: [String(testSetId)],
    },
  );

  return data.addTestSetsToTestExecution;
}

async function agregarTestsAlExecution(token, executionId, testIds) {
  const BATCH = 50;
  let added = 0;

  for (let i = 0; i < testIds.length; i += BATCH) {
    const batch = testIds.slice(i, i + BATCH);
    const data = await xrayGraphql(
      token,
      `
        mutation($issueId: String!, $testIssueIds: [String]!) {
          addTestsToTestExecution(
            issueId: $issueId
            testIssueIds: $testIssueIds
          ) {
            addedTests
            warning
          }
        }
      `,
      {
        issueId: String(executionId),
        testIssueIds: batch.map(String),
      },
    );

    const resultado = data.addTestsToTestExecution;
    if (resultado?.warning) {
      console.log(`⚠️  Xray: ${resultado.warning}`);
    }
    added += resultado?.addedTests?.length || batch.length;
  }

  return added;
}

async function asociarCasos(token, executionId, testSet, tests) {
  const idsDelSet = tests.map((t) => t.id);
  let asociadosPorSet = false;

  try {
    const resultado = await agregarTestSetAlExecution(
      token,
      executionId,
      testSet.id,
    );
    if (resultado?.warning) {
      console.log(`⚠️  Xray: ${resultado.warning}`);
    }
    asociadosPorSet = true;
  } catch (error) {
    console.log(
      "⚠️  No se pudo asociar el Test Set completo. Agregando los casos por lotes...",
    );
  }

  if (!asociadosPorSet) {
    return agregarTestsAlExecution(token, executionId, idsDelSet);
  }

  const enExecution = await obtenerTestsDelExecution(token, executionId);
  const idsEnExecution = new Set(enExecution.map((t) => String(t.id)));
  const faltantes = idsDelSet.filter((id) => !idsEnExecution.has(String(id)));

  if (faltantes.length) {
    console.log(
      `📋 ${faltantes.length} casos del Test Set no estaban en el TE. Agregándolos...`,
    );
    await agregarTestsAlExecution(token, executionId, faltantes);
  }

  return idsDelSet.length;
}

async function main() {
  try {
    if (!PROJECT_KEY) {
      throw new Error("Falta PROJECT_KEY en jira-config.js (ej. AVCD).");
    }

    const input = await preguntarVersion();
    if (!input) {
      throw new Error("Debes indicar la versión, por ejemplo: Release 3.11.1");
    }

    const canal = await preguntarCanal();

    console.log("🔑 Autenticando en Xray...");
    const xrayToken = await autenticarXray();

    console.log("🔎 Buscando versión en Jira...");
    const versiones = await obtenerVersiones();
    const version = resolverVersion(input, versiones);
    const numero = extraerNumeroVersion(version.name);
    const summary = `Pruebas de Humo  - Release ${numero}`;

    console.log(`📦 Test Set ${canal.nombre}: ${canal.key}`);
    const testSet = await obtenerIssue(canal.key);
    const tests = await obtenerTestsDelSet(xrayToken, testSet.id);

    if (!tests.length) {
      throw new Error(`El Test Set ${canal.key} no tiene casos de prueba.`);
    }

    console.log(`📋 ${tests.length} casos:`);
    tests.forEach((t) => {
      console.log(`   - ${t.key}: ${t.fields.summary}`);
    });

    console.log(`📌 Versión corregida: ${version.name}`);
    console.log(`📝 Summary: ${summary}`);
    console.log("🚀 Creando Test Execution...");

    const usuario = await obtenerUsuarioActual();
    console.log(`👤 Persona asignada: ${usuario.displayName} (${usuario.emailAddress})`);

    const issue = await crearTestExecution(summary, version, usuario.accountId);
    const url = `${JIRA_URL}/browse/${issue.key}`;

    console.log(`🔗 Asociando casos de ${canal.key}...`);
    await asociarCasos(xrayToken, issue.id, testSet, tests);

    console.log(`✅ Creado ${issue.key} con ${tests.length} casos (${canal.nombre})`);
    console.log(`🔗 ${url}`);
  } catch (error) {
    const detalle = error.response?.data || error.message;
    console.log("❌ Error:", detalle);
    process.exitCode = 1;
  }
}

main();
